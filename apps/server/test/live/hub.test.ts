import { config, overrideConfig, resetConfig } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import type { ErrorCode } from '@gallery/core/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { CLOSE } from '../../src/live/hub.ts';
import type { ExhibitionRecord } from '../../src/ports/index.ts';
import {
  hello,
  enter,
  LiveClient,
  newToken,
  pose,
  seedExhibition,
  seedTeacher,
  seedVisitor,
  startRig,
  tickMs,
  until,
  type LiveRig,
} from './support.ts';

/**
 * 함께 관람 허브 약속(R-5, ADR-057): 실제 HTTP 서버 + `ws` 클라이언트. 방송 타이머(`setInterval`)만 가짜로 돌리고
 * 나머지(소켓·`hello` 시간 초과)는 진짜 시간이다. 위치·별명·토큰은 모두 시험 안에서 만든 가상 값.
 */

let rig: LiveRig;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  rig = await startRig();
});

afterEach(async () => {
  await rig.stop();
  vi.useRealTimers();
  resetConfig();
});

const url = (ex: ExhibitionRecord): string => `${rig.base}/api/e/${ex.entryCode}/live`;
const anon = (n: number): string => fill(copy.live.anonymous, { n });
const tick = (): void => void vi.advanceTimersByTime(tickMs());

const expectBye = async (client: LiveClient, code: ErrorCode, closeCode: number = CLOSE.policy) => {
  expect(await client.next('bye')).toEqual({ t: 'bye', code });
  expect(await client.closed).toEqual({ code: closeCode, reason: code });
};

/** 열린 전시에 익명 방문자 둘(A의 `join` 알림은 꺼내 둔다) */
const pair = async (ex: ExhibitionRecord = seedExhibition(rig.t)) => {
  const a = await enter(rig, ex.entryCode, hello(newToken()));
  const b = await enter(rig, ex.entryCode, hello(newToken()));
  await a.client.next('join');
  return { ex, a, b };
};

describe('함께 관람 허브', () => {
  it('두 사람이 서로 보인다: welcome·join·peers(자기 제외)·leave, 아무도 없으면 방을 치운다', async () => {
    const ex = seedExhibition(rig.t);
    const aToken = seedVisitor(rig.t, ex.id, '하늘빛');
    const a = await enter(rig, ex.entryCode, hello(aToken, { pose: pose(2) }));
    expect(a.welcome).toMatchObject({ t: 'welcome', nickname: '하늘빛', peers: [], at: rig.t.at() });

    const b = await enter(rig, ex.entryCode, hello(newToken(), { character: 'student-f', pose: pose(3) }));
    expect(b.welcome.nickname).toBe(anon(1));
    expect(b.welcome.peers).toEqual([
      { sid: a.welcome.you, nickname: '하늘빛', role: 'visitor', character: 'student-m', pose: pose(2) },
    ]);
    expect((await a.client.next('join')).peer).toEqual({
      sid: b.welcome.you,
      nickname: anon(1),
      role: 'visitor',
      character: 'student-f',
      pose: pose(3),
    });
    expect(a.welcome.you).not.toBe(b.welcome.you);

    b.client.send({ t: 'pose', seq: 1, pose: pose(4, { move: 2 }) });
    await b.client.barrier();
    tick();
    expect(await a.client.next('peers')).toEqual({
      t: 'peers',
      at: rig.t.at(),
      poses: [{ sid: b.welcome.you, pose: pose(4, { move: 2 }) }],
    });
    await b.client.barrier();
    expect(b.client.received('peers')).toEqual([]);

    b.client.close();
    expect(await a.client.next('leave')).toEqual({ t: 'leave', sid: b.welcome.you });
    a.client.close();
    await until(() => rig.hub.size().rooms === 0);
    expect(rig.hub.size()).toEqual({ rooms: 0, peers: 0, pending: 0 });
    expect(a.client.invalid).toEqual([]);
    expect(b.client.invalid).toEqual([]);
  });

  it('판 2 기기는 실제 웹소켓으로 p를 글 프레임으로 받고(자기 것 포함), 판 1 기기와 한 방에 섞여도 각자 형식', async () => {
    const ex = seedExhibition(rig.t);
    const a = await enter(rig, ex.entryCode, hello(newToken(), { v: 2 }));
    const b = await enter(rig, ex.entryCode, hello(newToken(), { pose: pose(2), v: 2 }));
    const old = await enter(rig, ex.entryCode, hello(newToken(), { pose: pose(3) }));
    expect(a.welcome.n).toBe(1);
    expect(b.welcome.n).toBe(2);
    expect(old.welcome.n).toBeUndefined();
    b.client.send({ t: 'pose', seq: 1, pose: pose(4) });
    await b.client.barrier();
    tick();
    const got = await a.client.next('p');
    expect(got.p).toEqual([2, 400, 0, -200, 500, 1]);
    expect((await b.client.next('p')).p).toEqual(got.p);
    expect((await old.client.next('peers')).poses).toEqual([{ sid: b.welcome.you, pose: pose(4) }]);
    for (const c of [a, b, old]) expect(c.client.invalid).toEqual([]);
  });

  it('별명은 서버 값: 기기가 보낸 별명 칸은 받지 않고, 익명 방식·별명 없음은 번호, 교사는 선생님', async () => {
    const ex = seedExhibition(rig.t, { naming: 'ANONYMOUS' });
    const named = seedVisitor(rig.t, ex.id, '하늘빛');

    const forged = await LiveClient.open(url(ex));
    forged.send({ ...hello(named), nickname: '가짜 선생님' });
    await expectBye(forged, 'E_VALIDATION');

    const a = await enter(rig, ex.entryCode, hello(named));
    expect(a.welcome.nickname).toBe(anon(1));
    const teacher = await enter(rig, ex.entryCode, hello(seedTeacher(rig.t, ex.id), { as: 'teacher' }));
    expect(teacher.welcome.nickname).toBe(copy.live.teacher);
    expect((await a.client.next('join')).peer).toMatchObject({
      nickname: copy.live.teacher,
      role: 'teacher',
      character: 'teacher-f',
    });

    const open = seedExhibition(rig.t);
    const noNickname = await enter(rig, open.entryCode, hello(seedVisitor(rig.t, open.id, null)));
    expect(noNickname.welcome.nickname).toBe(anon(1));
    // 다른 전시의 방문자 기록은 이 전시에서 쓰지 않는다
    const elsewhere = await enter(rig, open.entryCode, hello(named));
    expect(elsewhere.welcome.nickname).toBe(anon(2));
  });

  it('익명 번호는 그 방에서 비어 있는 가장 작은 번호이고, 같은 토큰의 연결은 같은 번호를 쓴다', async () => {
    const ex = seedExhibition(rig.t);
    const first = newToken();
    const a = await enter(rig, ex.entryCode, hello(first));
    const b = await enter(rig, ex.entryCode, hello(newToken()));
    const a2 = await enter(rig, ex.entryCode, hello(first));
    expect([a, b, a2].map(p => p.welcome.nickname)).toEqual([anon(1), anon(2), anon(1)]);
    expect(new Set([a, b, a2].map(p => p.welcome.you)).size).toBe(3);

    a.client.close();
    await until(() => rig.hub.size().peers === 2);
    expect((await enter(rig, ex.entryCode, hello(newToken()))).welcome.nickname).toBe(anon(3));
    a2.client.close();
    await until(() => rig.hub.size().peers === 2);
    expect((await enter(rig, ex.entryCode, hello(newToken()))).welcome.nickname).toBe(anon(1));
  });

  it('위치: 방송 사이에 여러 번 와도 마지막 것만, 늦은·같은 seq는 버리고, 바뀐 것이 없으면 보내지 않는다', async () => {
    const { a, b } = await pair();
    for (let seq = 1; seq <= 20; seq++) b.client.send({ t: 'pose', seq, pose: pose(seq) });
    await b.client.barrier();
    tick();
    expect((await a.client.next('peers')).poses).toEqual([{ sid: b.welcome.you, pose: pose(20) }]);

    tick();
    await a.client.barrier();
    expect(a.client.received('peers')).toEqual([]);

    b.client.send({ t: 'pose', seq: 30, pose: pose(30) });
    b.client.send({ t: 'pose', seq: 25, pose: pose(25) });
    b.client.send({ t: 'pose', seq: 30, pose: pose(31) });
    await b.client.barrier();
    tick();
    expect((await a.client.next('peers')).poses).toEqual([{ sid: b.welcome.you, pose: pose(30) }]);
  });

  it('한 사람의 위치는 초당 LIVE_POSE_HZ번까지만 나간다(그 사이에 온 것은 마지막 것만)', async () => {
    overrideConfig({ LIVE_POSE_HZ: 1 });
    const { a, b } = await pair();
    const ticksPerPose = config().LIVE_BROADCAST_HZ / config().LIVE_POSE_HZ;
    const seen: number[] = [];
    for (let seq = 1; seq <= ticksPerPose * 2; seq++) {
      b.client.send({ t: 'pose', seq, pose: pose(seq) });
      await b.client.barrier();
      tick();
      await a.client.barrier();
      seen.push(a.client.received('peers').length);
    }
    expect(seen).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    expect(a.client.received('peers').map(m => m.poses.map(p => p.pose.x))).toEqual([
      [1],
      [ticksPerPose + 1],
    ]);
  });

  it.each<[string, (c: LiveClient) => void]>([
    ['JSON이 아님', c => c.ws.send('{"t":"hello"')],
    ['모르는 종류', c => c.send({ t: 'chat', text: '안녕' })],
    ['hello 전에 pose', c => c.send({ t: 'pose', seq: 1, pose: pose(1) })],
    ['판이 다름(모르는 판)', c => c.send({ ...hello(newToken()), v: 3 })],
    ['토큰 모양이 틀림', c => c.send(hello('short-token'))],
    ['좌표가 범위 밖', c => c.send(hello(newToken(), { pose: pose(501) }))],
    ['바이너리', c => c.ws.send(Buffer.from('{}'))],
  ])('형식이 틀리면 bye E_VALIDATION 뒤 1008로 닫는다: %s', async (_name, send) => {
    const ex = seedExhibition(rig.t);
    const client = await LiveClient.open(url(ex));
    send(client);
    await expectBye(client, 'E_VALIDATION');
    expect(client.received('welcome')).toEqual([]);
  });

  it.each<[string, (c: LiveClient) => void]>([
    ['hello를 또 보냄', c => c.send(hello(newToken()))],
    ['pose에 모르는 칸', c => c.send({ t: 'pose', seq: 1, pose: pose(1), nickname: '가짜' })],
    ['seq가 음수', c => c.send({ t: 'pose', seq: -1, pose: pose(1) })],
  ])('들어온 뒤에도 형식이 틀리면 닫고 다른 사람에게 leave: %s', async (_name, send) => {
    const { a, b } = await pair();
    send(b.client);
    await expectBye(b.client, 'E_VALIDATION');
    expect((await a.client.next('leave')).sid).toBe(b.welcome.you);
  });

  it('메시지가 LIVE_MAX_MESSAGE_BYTES를 넘으면 1009로 닫고, 딱 그만큼은 받는다', async () => {
    const ex = seedExhibition(rig.t);
    const max = config().LIVE_MAX_MESSAGE_BYTES;
    const json = JSON.stringify(hello(newToken()));
    const exact = await LiveClient.open(url(ex));
    exact.ws.send(`${' '.repeat(max - Buffer.byteLength(json))}${json}`);
    expect((await exact.next('welcome')).nickname).toBe(anon(1));

    const big = await LiveClient.open(url(ex));
    big.ws.send(`${' '.repeat(max + 1 - Buffer.byteLength(json))}${json}`);
    expect((await big.closed).code).toBe(CLOSE.tooBig);
    expect(big.inbox).toEqual([]);
  });

  it('LIVE_HELLO_TIMEOUT_MS 안에 hello가 없으면 1008로 닫는다', async () => {
    overrideConfig({ LIVE_HELLO_TIMEOUT_MS: 50 });
    const ex = seedExhibition(rig.t);
    const client = await LiveClient.open(url(ex));
    expect(await client.closed).toEqual({ code: CLOSE.policy, reason: 'hello_timeout' });
    expect(client.inbox).toEqual([]);
    expect(rig.hub.size().pending).toBe(0);
  });

  it('LIVE_IDLE_TIMEOUT_SEC 동안 위치가 없으면 1000으로 닫고, 위치를 보낸 사람은 남는다', async () => {
    const { a, b } = await pair();
    const idleMs = config().LIVE_IDLE_TIMEOUT_SEC * 1000;
    rig.t.advance(idleMs - 1);
    b.client.send({ t: 'pose', seq: 1, pose: pose(5) });
    await b.client.barrier();
    rig.t.advance(1);
    tick();
    expect(await a.client.closed).toEqual({ code: CLOSE.normal, reason: 'idle' });
    expect((await b.client.next('leave')).sid).toBe(a.welcome.you);
    await b.client.barrier();
    expect(b.client.ws.readyState).toBe(WebSocket.OPEN);
    expect(rig.hub.size().peers).toBe(1);
  });

  it('전시의 사람이 LIVE_MAX_PER_EXHIBITION이면 E_LIVE_FULL·1013, 다른 전시는 따로 센다', async () => {
    overrideConfig({ LIVE_MAX_PER_EXHIBITION: 2 });
    const { ex } = await pair();
    const third = await LiveClient.open(url(ex));
    third.send(hello(newToken()));
    await expectBye(third, 'E_LIVE_FULL', CLOSE.tryAgain);
    // 교사는 꽉 차도 들어온다(안내하는 사람, ADR-057 보충)
    const teacher = await enter(rig, ex.entryCode, hello(seedTeacher(rig.t, ex.id), { as: 'teacher' }));
    expect(teacher.welcome.peers).toHaveLength(2);

    const other = seedExhibition(rig.t);
    expect((await enter(rig, other.entryCode, hello(newToken()))).welcome.peers).toEqual([]);
  });

  type Case = () => { readonly ex: ExhibitionRecord; readonly message: ReturnType<typeof hello> };
  it.each<[string, ErrorCode, Case]>([
    [
      '모르는 교사 토큰',
      'E_AUTH',
      () => ({ ex: seedExhibition(rig.t), message: hello(newToken(), { as: 'teacher' }) }),
    ],
    [
      '다른 전시의 교사 토큰',
      'E_AUTH',
      () => {
        const mine = seedExhibition(rig.t);
        const theirs = seedExhibition(rig.t);
        return { ex: mine, message: hello(seedTeacher(rig.t, theirs.id), { as: 'teacher' }) };
      },
    ],
    [
      '방문자 토큰을 교사로',
      'E_AUTH',
      () => {
        const ex = seedExhibition(rig.t);
        return { ex, message: hello(seedVisitor(rig.t, ex.id, '하늘빛'), { as: 'teacher' }) };
      },
    ],
    [
      '기한이 지난 전시',
      'E_NOT_FOUND',
      () => ({ ex: seedExhibition(rig.t, { expired: true }), message: hello(newToken()) }),
    ],
    [
      '준비 중 전시의 방문자',
      'E_EXHIBITION_DRAFT',
      () => ({ ex: seedExhibition(rig.t, { status: 'DRAFT' }), message: hello(newToken()) }),
    ],
    [
      '닫힌 전시의 방문자',
      'E_EXHIBITION_CLOSED',
      () => ({ ex: seedExhibition(rig.t, { status: 'CLOSED' }), message: hello(newToken()) }),
    ],
    [
      '방문자가 선생님 캐릭터',
      'E_VALIDATION',
      () => ({ ex: seedExhibition(rig.t), message: hello(newToken(), { character: 'teacher-m' }) }),
    ],
    [
      '교사가 학생 캐릭터',
      'E_VALIDATION',
      () => {
        const ex = seedExhibition(rig.t);
        return { ex, message: hello(seedTeacher(rig.t, ex.id), { as: 'teacher', character: 'student-f' }) };
      },
    ],
  ])('들여보내지 않음: %s → %s', async (_name, code, make) => {
    const { ex, message } = make();
    const client = await LiveClient.open(url(ex));
    client.send(message);
    await expectBye(client, code);
    expect(rig.hub.size().peers).toBe(0);
  });

  it('캐릭터 12종(M4-9): 새 ID는 그대로, 옛 별칭은 01번으로 받고, 옛 ID만 아는 기기에는 몸 틀로 낮춰 보낸다', async () => {
    const ex = seedExhibition(rig.t);
    const a = await enter(rig, ex.entryCode, hello(newToken(), { v: 2, character: 'student-m-03' }));
    // 옛 별칭을 보낸 기기(캐릭터 12종 전 앱)
    const b = await enter(rig, ex.entryCode, hello(newToken(), { v: 2, character: 'student-f' }));
    expect((await a.client.next('join')).peer.character).toBe('student-f-01');
    expect(b.welcome.peers.map(p => p.character)).toEqual(['student-m']);

    const t = await enter(
      rig,
      ex.entryCode,
      hello(seedTeacher(rig.t, ex.id), { as: 'teacher', v: 2, character: 'teacher-m' }),
    );
    expect(t.welcome.peers.map(p => p.character)).toEqual(['student-m-03', 'student-f-01']);
    expect((await a.client.next('join')).peer.character).toBe('teacher-m');
    expect((await b.client.next('join')).peer.character).toBe('teacher-m');

    // 판 1 기기도 옛 ID만 안다
    const old = await enter(rig, ex.entryCode, hello(newToken(), { character: 'student-f-05' }));
    expect(old.welcome.peers.map(p => p.character)).toEqual(['student-m', 'student-f', 'teacher-m']);
    expect((await a.client.next('join')).peer.character).toBe('student-f-05');
    expect((await b.client.next('join')).peer.character).toBe('student-f');
    expect((await t.client.next('join')).peer.character).toBe('student-f-05');
    for (const c of [a, b, t, old]) expect(c.client.invalid).toEqual([]);
  });

  it('캐릭터 판(M4-9): 판 2라도 `chars`가 없는 교사 앱(12종 전)에는 남의 학생 ID를 몸 틀로 낮춘다', async () => {
    const ex = seedExhibition(rig.t);
    await enter(rig, ex.entryCode, hello(newToken(), { v: 2, character: 'student-m-04' }));
    const oldTeacher = await enter(
      rig,
      ex.entryCode,
      hello(seedTeacher(rig.t, ex.id), { as: 'teacher', v: 2, character: 'teacher-f', chars: null }),
    );
    expect(oldTeacher.welcome.peers.map(p => p.character)).toEqual(['student-m']);
    expect(oldTeacher.client.invalid).toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['방문자가 도슨트 캐릭터', { character: 'docent-1' }],
    ['없는 학생 번호', { character: 'student-m-06' }],
    ['교사가 학생 캐릭터(새 ID)', { as: 'teacher', character: 'student-f-02' }],
  ])('캐릭터가 틀리면 들여보내지 않음: %s → E_VALIDATION', async (_name, over) => {
    const ex = seedExhibition(rig.t);
    const token = over['as'] === 'teacher' ? seedTeacher(rig.t, ex.id) : newToken();
    const client = await LiveClient.open(url(ex));
    client.send({ ...hello(token), ...over });
    await expectBye(client, 'E_VALIDATION');
    expect(rig.hub.size().peers).toBe(0);
  });

  it('없는 입장 코드는 E_NOT_FOUND', async () => {
    seedExhibition(rig.t);
    const client = await LiveClient.open(`${rig.base}/api/e/999999/live`);
    client.send(hello(newToken()));
    await expectBye(client, 'E_NOT_FOUND');
  });

  it.each(['DRAFT', 'CLOSED'] as const)(
    '교사는 그 전시의 세션이면 상태와 상관없이 들어온다: %s',
    async status => {
      const ex = seedExhibition(rig.t, { status });
      const teacher = await enter(rig, ex.entryCode, hello(seedTeacher(rig.t, ex.id), { as: 'teacher' }));
      expect(teacher.welcome).toMatchObject({ nickname: copy.live.teacher, peers: [] });
    },
  );

  it('closeExhibition: 상태 코드면 방문자만 닫고 교사는 남기며, 다른 코드면 모두 닫는다', async () => {
    const ex = seedExhibition(rig.t);
    const teacher = await enter(rig, ex.entryCode, hello(seedTeacher(rig.t, ex.id), { as: 'teacher' }));
    const visitor = await enter(rig, ex.entryCode, hello(newToken()));
    rig.hub.closeExhibition(ex.id, 'E_EXHIBITION_CLOSED');
    await expectBye(visitor.client, 'E_EXHIBITION_CLOSED');
    expect((await teacher.client.next('leave')).sid).toBe(visitor.welcome.you);
    await teacher.client.barrier();
    expect(teacher.client.ws.readyState).toBe(WebSocket.OPEN);

    rig.hub.closeExhibition(ex.id, 'E_NOT_FOUND');
    await expectBye(teacher.client, 'E_NOT_FOUND');
    await until(() => rig.hub.size().rooms === 0);
  });

  it('exhibitionCounts: 그 전시 방의 학생·교사 수만(다른 전시·hello 기다림은 세지 않음)', async () => {
    const ex = seedExhibition(rig.t);
    const other = seedExhibition(rig.t);
    expect(rig.hub.exhibitionCounts(ex.id)).toEqual({ visitors: 0, teachers: 0 });
    const a = await enter(rig, ex.entryCode, hello(newToken()));
    const b = await enter(rig, ex.entryCode, hello(newToken()));
    const teacher = await enter(rig, ex.entryCode, hello(seedTeacher(rig.t, ex.id), { as: 'teacher' }));
    await enter(rig, other.entryCode, hello(newToken()));
    const waiting = await LiveClient.open(url(ex));
    await until(() => rig.hub.size().pending === 1);
    expect(rig.hub.exhibitionCounts(ex.id)).toEqual({ visitors: 2, teachers: 1 });
    expect(rig.hub.exhibitionCounts(other.id)).toEqual({ visitors: 1, teachers: 0 });
    a.client.close();
    await until(() => rig.hub.exhibitionCounts(ex.id).visitors === 1);
    expect(rig.hub.exhibitionCounts(ex.id)).toEqual({ visitors: 1, teachers: 1 });
    b.client.close();
    teacher.client.close();
    waiting.close();
    await until(() => rig.hub.exhibitionCounts(ex.id).teachers === 0);
    expect(rig.hub.exhibitionCounts(ex.id)).toEqual({ visitors: 0, teachers: 0 });
  });
});
