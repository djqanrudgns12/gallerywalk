import { config, overrideConfig, resetConfig } from '@gallery/core/config';
import type { ServerType } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type ClientOptions } from 'ws';
import type { UpgradeSource } from '../../src/live/attach.ts';
import { CLOSE } from '../../src/live/hub.ts';
import type { ExhibitionRecord } from '../../src/ports/index.ts';
import {
  enter,
  hashOf,
  hello,
  LiveClient,
  newToken,
  pose,
  refusedStatus,
  seedExhibition,
  seedVisitor,
  startRig,
  until,
  type LiveRig,
} from './support.ts';

/**
 * 함께 관람 연결부(R-5): 경로·IP 머리·IP 칸·핑/퐁·끝내기·기록. 실제 HTTP 서버 + `ws` 클라이언트.
 * IP는 문서용 주소(RFC 5737·3849)만 쓴다.
 */

// `index.ts`가 `serve()` 결과를 그대로 넘길 수 있다(타입 검사에서 확인)
const serveResultAttaches: ServerType extends UpgradeSource ? true : never = true;
void serveResultAttaches;

const rigs: LiveRig[] = [];
const start = async (production = false): Promise<LiveRig> => {
  const rig = await startRig({ production });
  rigs.push(rig);
  return rig;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(async () => {
  await Promise.all(rigs.splice(0).map(rig => rig.stop()));
  vi.useRealTimers();
  resetConfig();
});

const liveUrl = (rig: LiveRig, ex: ExhibitionRecord): string => `${rig.base}/api/e/${ex.entryCode}/live`;
const fromIp = (ip: string): ClientOptions => ({ headers: { [config().CLIENT_IP_HEADER]: ip } });

describe('함께 관람 연결부', () => {
  it.each([
    '/api/e/{code}/other',
    '/api/e/{code}/live/x',
    '/api/e/{code}',
    '/live',
    '/api/e/12345/live',
    '/api/e/1234567/live',
    '/api/e/abcdef/live',
  ])('다른 경로·형식이 틀린 입장 코드는 웹소켓을 열지 않고 404: %s', async path => {
    const rig = await start();
    const ex = seedExhibition(rig.t);
    expect(await refusedStatus(`${rig.base}${path.replace('{code}', ex.entryCode)}`)).toBe(404);
    expect(rig.hub.size()).toEqual({ rooms: 0, peers: 0, pending: 0 });
  });

  it('주소 뒤 쿼리는 보지 않는다', async () => {
    const rig = await start();
    const ex = seedExhibition(rig.t);
    const client = await LiveClient.open(`${liveUrl(rig, ex)}?from=test`);
    client.send(hello(newToken()));
    expect((await client.next('welcome')).peers).toEqual([]);
  });

  it('운영: 믿는 IP 머리가 없거나 IP가 아니면 400, 있으면 연다', async () => {
    const rig = await start(true);
    const ex = seedExhibition(rig.t);
    const url = liveUrl(rig, ex);
    expect(await refusedStatus(url)).toBe(400);
    expect(await refusedStatus(url, fromIp('not-an-ip'))).toBe(400);
    expect(await refusedStatus(url, fromIp('203.0.113.7, 198.51.100.4'))).toBe(400);
    // X-Forwarded-For는 믿지 않는다
    expect(await refusedStatus(url, { headers: { 'x-forwarded-for': '203.0.113.7' } })).toBe(400);
    const client = await LiveClient.open(url, fromIp('203.0.113.7'));
    client.send(hello(newToken()));
    expect((await client.next('welcome')).peers).toEqual([]);
  });

  it('IP 칸: 1분에 LIVE_CONNECT_PER_IP_MIN번까지, IPv6는 /64로 묶고, 1분이 지나면 다시 연다', async () => {
    overrideConfig({ LIVE_CONNECT_PER_IP_MIN: 2 });
    const rig = await start(true);
    const url = liveUrl(rig, seedExhibition(rig.t));
    const opens = async (ip: string): Promise<boolean> => {
      try {
        await LiveClient.open(url, fromIp(ip));
        return true;
      } catch (error) {
        if (error instanceof Error && error.message === 'unexpected-response 429') return false;
        throw error;
      }
    };
    expect([await opens('203.0.113.7'), await opens('203.0.113.7'), await opens('203.0.113.7')]).toEqual([
      true,
      true,
      false,
    ]);
    // IPv4를 담은 IPv6도 같은 칸
    expect(await opens('::ffff:203.0.113.7')).toBe(false);
    expect(await opens('198.51.100.4')).toBe(true);
    expect([
      await opens('2001:db8:1:2::1'),
      await opens('2001:0db8:0001:0002:ffff::9'),
      await opens('2001:db8:1:2::abcd'),
      await opens('2001:db8:1:3::1'),
    ]).toEqual([true, true, false, true]);

    rig.t.advance(60_000);
    expect(await opens('203.0.113.7')).toBe(true);
  });

  it('개발: 머리가 없으면 소켓 주소로 센다', async () => {
    overrideConfig({ LIVE_CONNECT_PER_IP_MIN: 1 });
    const rig = await start(false);
    const url = liveUrl(rig, seedExhibition(rig.t));
    await LiveClient.open(url);
    expect(await refusedStatus(url)).toBe(429);
    // 머리가 있으면 그 값으로 센다
    await LiveClient.open(url, fromIp('198.51.100.4'));
  });

  it('LIVE_PING_SEC마다 핑, 그 사이 퐁이 없으면 끊고 다른 사람에게 leave', async () => {
    const rig = await start();
    const ex = seedExhibition(rig.t);
    const silent = await enter(rig, ex.entryCode, hello(newToken()), { autoPong: false });
    const lively = await enter(rig, ex.entryCode, hello(newToken()));
    await silent.client.next('join');
    const pingMs = config().LIVE_PING_SEC * 1000;

    vi.advanceTimersByTime(pingMs);
    // 서버 핑 → 자동 퐁이 서버에 닿았는지: 핑 뒤에 보낸 우리 핑의 퐁을 두 번 받는다
    await lively.client.barrier();
    await lively.client.barrier();
    vi.advanceTimersByTime(pingMs);

    expect((await silent.client.closed).code).toBe(1006);
    expect((await lively.client.next('leave')).sid).toBe(silent.welcome.you);
    await lively.client.barrier();
    expect(lively.client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('close(): 들어온 연결과 hello를 기다리는 연결을 모두 1001로 닫고, 그 뒤 upgrade는 받지 않는다', async () => {
    const rig = await start();
    const ex = seedExhibition(rig.t);
    const a = await enter(rig, ex.entryCode, hello(newToken()));
    const b = await enter(rig, ex.entryCode, hello(newToken()));
    const waiting = await LiveClient.open(liveUrl(rig, ex));
    await until(() => rig.hub.size().pending === 1);

    await rig.live.close();
    expect(await a.client.closed).toEqual({ code: CLOSE.goingAway, reason: 'shutdown' });
    expect(await b.client.closed).toEqual({ code: CLOSE.goingAway, reason: 'shutdown' });
    expect(await waiting.closed).toEqual({ code: CLOSE.goingAway, reason: 'shutdown' });
    // 끝내는 중에는 서로에게 leave를 돌리지 않는다
    expect([...a.client.received('leave'), ...b.client.received('leave')]).toEqual([]);
    expect(rig.hub.size()).toEqual({ rooms: 0, peers: 0, pending: 0 });
    expect(await refusedStatus(liveUrl(rig, ex))).toBe(404);
  });

  it('기록: 연결 수·거절 코드 수만 남고 토큰·해시·IP·위치·별명은 없다', async () => {
    const rig = await start(true);
    const ex = seedExhibition(rig.t);
    const url = liveUrl(rig, ex);
    const ip = '203.0.113.77';
    const v6 = '2001:db8:77:1::5';
    const visitorToken = seedVisitor(rig.t, ex.id, '하늘빛');
    const wrongTeacher = newToken();

    const visitor = await enter(rig, ex.entryCode, hello(visitorToken, { pose: pose(123.456) }), fromIp(ip));
    visitor.client.send({ t: 'pose', seq: 1, pose: pose(234.567) });
    await visitor.client.barrier();
    const teacher = await LiveClient.open(url, fromIp(v6));
    teacher.send(hello(wrongTeacher, { as: 'teacher' }));
    expect(await teacher.next('bye')).toEqual({ t: 'bye', code: 'E_AUTH' });
    expect(await refusedStatus(url)).toBe(400);

    await rig.live.close();
    const text = await rig.logText();
    const lines = text
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    expect(lines.filter(l => l['msg'] === 'live_reject').map(l => [l['code'], l['count']])).toEqual([
      ['E_AUTH', 1],
      ['E_VALIDATION', 1],
    ]);
    expect(lines.find(l => l['msg'] === 'live_joined')?.['count']).toBe(1);
    expect(lines.find(l => l['msg'] === 'live_connections')?.['count']).toBe(1);
    for (const secret of [
      visitorToken,
      hashOf(visitorToken),
      wrongTeacher,
      hashOf(wrongTeacher),
      ip,
      v6,
      '2001:db8:77:1',
      '하늘빛',
      '123.456',
      '234.567',
    ])
      expect(text).not.toContain(secret);
  });

  it('1분 서버 기록(HS-00): 루프 지연·이용률·보낸 양·메모리·진단 수가 숫자로만 남고 식별값은 없다', async () => {
    let taken = 0;
    const rig = await startRig({
      production: true,
      minuteStats: () => ({ diagFail: 3 + taken++, diagReport: 1 }),
    });
    rigs.push(rig);
    const ex = seedExhibition(rig.t);
    const ip = '203.0.113.88';
    const nickname = '은하수';
    const aToken = seedVisitor(rig.t, ex.id, nickname);
    const a = await enter(rig, ex.entryCode, hello(aToken, { pose: pose(345.678) }), fromIp(ip));
    const b = await enter(rig, ex.entryCode, hello(newToken()), fromIp(ip));
    await a.client.next('join');
    b.client.send({ t: 'pose', seq: 1, pose: pose(456.789) });
    await b.client.barrier();

    // 1분 타이머 한 번(그 사이 방송 타이머도 돈다)
    vi.advanceTimersByTime(60_000);
    const lines = (await rig.logText())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    const stats = lines.filter(l => l['msg'] === 'server_stats');
    expect(stats).toHaveLength(1);
    const line = stats[0]!;
    for (const key of [
      'loopP50Ms',
      'loopP99Ms',
      'loopMaxMs',
      'elu',
      'liveMsgs',
      'liveBytes',
      'liveBufMax',
      'rssMb',
      'heapMb',
      'liveRooms',
      'livePeers',
    ])
      expect(typeof line[key], key).toBe('number');
    expect(line).toMatchObject({ level: 'info', diagFail: 3, diagReport: 1, liveRooms: 1, livePeers: 2 });
    // welcome 둘 + join 하나 + 방송(위치) 하나 이상
    expect(line['liveMsgs']).toBeGreaterThanOrEqual(4);
    expect(line['liveBytes']).toBeGreaterThan(0);
    expect(line['elu']).toBeGreaterThanOrEqual(0);
    expect(line['elu']).toBeLessThanOrEqual(1);
    expect(line['rssMb']).toBeGreaterThan(0);
    // 기록 칸 밖의 이름은 없다
    expect(Object.keys(line).sort()).toEqual(
      [
        't',
        'level',
        'msg',
        'loopP50Ms',
        'loopP99Ms',
        'loopMaxMs',
        'elu',
        'liveRooms',
        'livePeers',
        'liveBuilt',
        'liveSkipped',
        'liveSlowClosed',
        'liveDegraded',
        'liveMsgs',
        'liveBytes',
        'liveBufMax',
        'rssMb',
        'heapMb',
        'diagFail',
        'diagReport',
      ].sort(),
    );

    // 다음 1분: 보낸 수는 비워져 다시 센다, 끝낼 때도 마지막 조각을 남긴다
    await rig.live.close();
    const after = (await rig.logText())
      .trim()
      .split('\n')
      .map(l => JSON.parse(l) as Record<string, unknown>)
      .filter(l => l['msg'] === 'server_stats');
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ diagFail: 4, liveMsgs: 0, liveBytes: 0 });

    const text = await rig.logText();
    for (const secret of [aToken, hashOf(aToken), ip, nickname, '345.678', '456.789', a.welcome.you])
      expect(text).not.toContain(secret);
  });
});
