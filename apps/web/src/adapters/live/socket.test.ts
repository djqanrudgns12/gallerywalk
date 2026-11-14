import { config } from '@gallery/core/config';
import type { Pose } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import type { LiveStatus } from '../../ports/index.ts';
import { createLiveChannel, type LiveSocketDeps, type SocketLike } from './socket.ts';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closed: number | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.closed = code;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const TOKEN = 'A'.repeat(43);
const pose = (x: number): Pose => ({ x, y: 0, z: 0, yaw: 0, move: 1 });

const harness = () => {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const sockets: FakeSocket[] = [];
  const deps: LiveSocketDeps = {
    open: url => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    urlFor: code => `ws://test/api/e/${code}/live`,
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: id => {
      const i = timers.findIndex(t => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    random: () => 0.5,
  };
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > now) break;
      timers.shift();
      t.fn();
    }
  };
  return { deps, sockets, advance, timers };
};

const welcome = { t: 'welcome', you: 'abcd1234', nickname: '하늘', peers: [], at: 1 };

describe('createLiveChannel', () => {
  it('열리면 hello(토큰은 첫 메시지에만, 주소에는 코드만), welcome이면 live', () => {
    const h = harness();
    const statuses: LiveStatus[] = [];
    const ch = createLiveChannel(h.deps);
    ch.join(
      { code: '482910', token: TOKEN, as: 'visitor', character: 'student-m', pose: pose(0) },
      { onMessage: () => {}, onStatus: s => statuses.push(s) },
    );
    const s = h.sockets[0]!;
    expect(s.url).toBe('ws://test/api/e/482910/live');
    expect(s.url).not.toContain(TOKEN);
    s.open();
    expect(s.sent[0]).toMatchObject({
      t: 'hello',
      v: 2,
      token: TOKEN,
      as: 'visitor',
      character: 'student-m',
    });
    s.receive(welcome);
    expect(statuses).toEqual(['connecting', 'live']);
  });

  it('판 2 위치 p: 번호를 sid로 바꿔 peers로 넘기고, 내 것·모르는 번호는 빼고, 틀린 모양은 버린다', () => {
    const h = harness();
    const got: unknown[] = [];
    const ch = createLiveChannel(h.deps);
    ch.join(
      { code: '482910', token: TOKEN, as: 'visitor', character: 'student-m', pose: pose(0) },
      { onMessage: m => got.push(m), onStatus: () => {} },
    );
    const s = h.sockets[0]!;
    s.open();
    const peer = (sid: string, n: number) => ({
      sid,
      nickname: '바다',
      role: 'visitor',
      character: 'student-f',
      pose: pose(1),
      n,
    });
    s.receive({ ...welcome, n: 1, peers: [peer('bbbbbbbb', 2)] });
    s.receive({ t: 'join', peer: peer('cccccccc', 3) });
    got.length = 0;
    // 나(1)·b(2)·c(3)·모르는 번호(9)
    s.onmessage?.({
      data: '{"t":"p","at":5000,"p":[1,100,0,100,0,1,2,250,0,-50,1571,2,3,-12345,10,0,-3142,0,9,0,0,0,0,0]}',
    });
    expect(got).toEqual([
      {
        t: 'peers',
        at: 5000,
        poses: [
          { sid: 'bbbbbbbb', pose: { x: 2.5, y: 0, z: -0.5, yaw: 1.571, move: 2 } },
          { sid: 'cccccccc', pose: { x: -123.45, y: 0.1, z: 0, yaw: -3.142, move: 0 } },
        ],
      },
    ]);
    s.receive({ t: 'leave', sid: 'cccccccc' });
    got.length = 0;
    s.onmessage?.({ data: '{"t":"p","at":5200,"p":[3,0,0,0,0,0]}' });
    expect(got).toEqual([{ t: 'peers', at: 5200, poses: [] }]);
    // 칸 수가 여섯의 배수가 아님·범위 밖·정수 아님 → 버림
    got.length = 0;
    for (const bad of ['[2,1,0,0,0]', '[2,99999999,0,0,0,1]', '[2,1.5,0,0,0,1]', '[2,0,0,0,0,4]'])
      s.onmessage?.({ data: `{"t":"p","at":5300,"p":${bad}}` });
    expect(got).toEqual([]);
  });

  it('점프 시작: 판 2 welcome(방 안 번호) 뒤에만 {t:jump} 한 번, 판 1 서버·잇기 전·다시 잇는 동안은 버린다(W-05)', () => {
    const h = harness();
    const ch = createLiveChannel(h.deps);
    ch.join(
      { code: '482910', token: TOKEN, as: 'visitor', character: 'student-m', pose: pose(0) },
      { onMessage: () => {}, onStatus: () => {} },
    );
    const jumps = (s: FakeSocket) => s.sent.filter(m => (m as { t: string }).t === 'jump');
    const s = h.sockets[0]!;
    ch.sendJump(); // 아직 열리지 않음
    s.open();
    ch.sendJump(); // welcome 전
    expect(jumps(s)).toEqual([]);
    s.receive({ ...welcome, n: 1 });
    ch.sendJump();
    expect(jumps(s)).toEqual([{ t: 'jump' }]);
    // 다시 이은 서버가 번호 없는 welcome(판 1)이면 보내지 않는다
    s.drop();
    h.advance(config().LIVE_RETRY_MAX_MS * 2);
    const again = h.sockets[1]!;
    again.open();
    ch.sendJump();
    again.receive(welcome);
    ch.sendJump();
    expect(jumps(again)).toEqual([]);
    ch.leave();
    ch.sendJump();
    expect(jumps(again)).toEqual([]);
  });

  it('받은 jump(sid·서버 시각)는 스키마 갈래로 그대로 넘기고, 모양이 틀리면 버린다', () => {
    const h = harness();
    const got: { msg: unknown; at: number }[] = [];
    const ch = createLiveChannel(h.deps);
    ch.join(
      { code: '482910', token: TOKEN, as: 'visitor', character: 'student-m', pose: pose(0) },
      { onMessage: (msg, at) => got.push({ msg, at }), onStatus: () => {} },
    );
    const s = h.sockets[0]!;
    s.open();
    s.receive({ ...welcome, n: 1 });
    got.length = 0;
    h.advance(70);
    s.receive({ t: 'jump', sid: 'bbbbbbbb', at: 5000 });
    expect(got).toEqual([{ msg: { t: 'jump', sid: 'bbbbbbbb', at: 5000 }, at: 70 }]);
    got.length = 0;
    for (const bad of [
      { t: 'jump', sid: 'BAD', at: 1 },
      { t: 'jump', sid: 'bbbbbbbb' },
      { t: 'jump', sid: 'bbbbbbbb', at: 1, extra: 1 },
    ])
      s.receive(bad);
    expect(got).toEqual([]);
  });

  it('말풍선: 판 2 welcome 뒤에만 보내고(잇기 전·판 1·떠난 뒤 버림), 받은 bubble은 스키마 갈래로 넘긴다(W-02)', () => {
    const h = harness();
    const got: unknown[] = [];
    const ch = createLiveChannel(h.deps);
    ch.join(
      { code: '482910', token: TOKEN, as: 'visitor', character: 'student-m', pose: pose(0) },
      { onMessage: msg => got.push(msg), onStatus: () => {} },
    );
    const bubbles = (s: FakeSocket) => s.sent.filter(m => (m as { t: string }).t === 'bubble');
    const s = h.sockets[0]!;
    ch.sendBubble({ s: 1 });
    s.open();
    ch.sendBubble({ s: 1 });
    expect(bubbles(s)).toEqual([]);
    s.receive({ ...welcome, n: 1 });
    ch.sendBubble({ w: 3 });
    ch.sendBubble({ text: '같이 보자' });
    expect(bubbles(s)).toEqual([
      { t: 'bubble', w: 3 },
      { t: 'bubble', text: '같이 보자' },
    ]);
    got.length = 0;
    s.receive({ t: 'bubble', sid: 'bbbbbbbb', at: 5000, s: 2 });
    s.receive({ t: 'bubble', sid: 'bbbbbbbb', at: 5000, s: 2, w: 1 });
    expect(got).toEqual([{ t: 'bubble', sid: 'bbbbbbbb', at: 5000, s: 2 }]);
    s.drop();
    h.advance(config().LIVE_RETRY_MAX_MS * 2);
    const again = h.sockets[1]!;
    again.open();
    again.receive(welcome);
    ch.sendBubble({ s: 0 });
    expect(bubbles(again)).toEqual([]);
    ch.leave();
    ch.sendBubble({ s: 0 });
    expect(bubbles(again)).toEqual([]);
  });

  it('보내는 위치는 1cm·0.001rad로 반올림한다', () => {
    const h = harness();
    const ch = createLiveChannel(h.deps);
    ch.join(
      { code: '482910', token: TOKEN, as: 'visitor', character: 'student-m', pose: pose(0) },
      { onMessage: () => {}, onStatus: () => {} },
    );
    const s = h.sockets[0]!;
    s.open();
    ch.sendPose({ x: 1.23456, y: 0.004, z: -7.89012, yaw: 7, move: 1 });
    h.advance(1000);
    const sent = s.sent.filter(m => (m as { t: string }).t === 'pose') as { pose: Pose }[];
    expect(sent.at(-1)?.pose).toEqual({ x: 1.23, y: 0, z: -7.89, yaw: 0.717, move: 1 });
  });

  it('위치는 초당 LIVE_POSE_HZ번까지, 바뀐 것만, 잦으면 마지막 것', () => {
    const h = harness();
    const ch = createLiveChannel(h.deps);
    ch.join(
      { code: '482910', token: TOKEN, as: 'visitor', character: 'student-m', pose: pose(0) },
      { onMessage: () => {}, onStatus: () => {} },
    );
    const s = h.sockets[0]!;
    s.open();
    const gap = 1000 / config().LIVE_POSE_HZ;
    ch.sendPose(pose(1));
    ch.sendPose(pose(2));
    ch.sendPose(pose(3));
    h.advance(gap);
    const poses = s.sent.filter(m => (m as { t: string }).t === 'pose') as { seq: number; pose: Pose }[];
    expect(poses.map(p => p.pose.x)).toEqual([3]);
    ch.sendPose(pose(3)); // 같으면 보내지 않음
    h.advance(gap);
    expect(s.sent.filter(m => (m as { t: string }).t === 'pose')).toHaveLength(1);
  });

  it('끊기면 지수로 다시 잇고, 꽉 참·거절이면 멈춘다', () => {
    const h = harness();
    const statuses: (LiveStatus | string)[] = [];
    const ch = createLiveChannel(h.deps);
    ch.join(
      { code: '482910', token: TOKEN, as: 'visitor', character: 'student-m', pose: pose(0) },
      { onMessage: () => {}, onStatus: (s, code) => statuses.push(code ? `${s}:${code}` : s) },
    );
    const c = config();
    h.sockets[0]!.open();
    h.sockets[0]!.drop();
    expect(statuses.at(-1)).toBe('retrying');
    h.advance(c.LIVE_RETRY_MIN_MS - 1);
    expect(h.sockets).toHaveLength(1);
    h.advance(1);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.drop();
    h.advance(c.LIVE_RETRY_MIN_MS * 2);
    expect(h.sockets).toHaveLength(3);
    // 꽉 참
    h.sockets[2]!.open();
    h.sockets[2]!.receive({ t: 'bye', code: 'E_LIVE_FULL' });
    h.sockets[2]!.drop(1013);
    expect(statuses.at(-1)).toBe('full:E_LIVE_FULL');
    h.advance(c.LIVE_RETRY_MAX_MS * 2);
    expect(h.sockets).toHaveLength(3);
  });

  it('다시 잇기 흔들기는 기본 간격의 0.5~1.5배다(한 반이 함께 끊겨도 흩어져 붙는다, HS-12)', () => {
    const c = config();
    for (const [r, factor] of [
      [0, 0.5],
      [0.999, 1.499],
    ] as const) {
      const h = harness();
      h.deps = { ...h.deps, random: () => r };
      const ch = createLiveChannel(h.deps);
      ch.join(
        { code: '482910', token: TOKEN, as: 'visitor', character: 'student-m', pose: pose(0) },
        { onMessage: () => {}, onStatus: () => {} },
      );
      h.sockets[0]!.open();
      h.sockets[0]!.drop();
      const wait = Math.round(c.LIVE_RETRY_MIN_MS * factor);
      h.advance(wait - 1);
      expect(h.sockets).toHaveLength(1);
      h.advance(1);
      expect(h.sockets).toHaveLength(2);
      ch.leave();
    }
  });

  it('형식이 틀린 메시지는 넘기지 않는다, leave는 닫고 다시 잇지 않는다', () => {
    const h = harness();
    const got: unknown[] = [];
    const ch = createLiveChannel(h.deps);
    ch.join(
      { code: '482910', token: TOKEN, as: 'visitor', character: 'student-m', pose: pose(0) },
      { onMessage: m => got.push(m), onStatus: () => {} },
    );
    const s = h.sockets[0]!;
    s.open();
    s.receive({ t: 'peers', at: 'x', poses: [] });
    s.onmessage?.({ data: '{not json' });
    s.receive(welcome);
    expect(got).toHaveLength(1);
    ch.leave();
    expect(s.closed).toBe(1000);
    s.drop(1000);
    h.advance(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('다시 입장한 뒤 옛 소켓의 늦은 이벤트는 무시한다(Codex 검토 P1)', () => {
    const h = harness();
    const got: unknown[] = [];
    const ch = createLiveChannel(h.deps);
    const join = {
      code: '482910',
      token: TOKEN,
      as: 'visitor' as const,
      character: 'student-m' as const,
      pose: pose(0),
    };
    ch.join(join, { onMessage: m => got.push(m), onStatus: () => {} });
    const a = h.sockets[0]!;
    a.open();
    ch.join({ ...join, code: '111111' }, { onMessage: m => got.push(m), onStatus: () => {} });
    const b = h.sockets[1]!;
    b.open();
    // A의 늦은 메시지·닫힘
    a.onmessage?.({ data: JSON.stringify(welcome) });
    a.onclose?.({ code: 1006 });
    h.advance(config().LIVE_RETRY_MAX_MS * 2);
    expect(h.sockets).toHaveLength(2);
    expect(got).toHaveLength(0);
    expect(b.closed).toBeNull();
  });

  it('가만히 있어도 LIVE_KEEPALIVE_SEC마다 같은 자리를 다시 보낸다(Codex 검토 P2)', () => {
    const h = harness();
    const ch = createLiveChannel(h.deps);
    ch.join(
      { code: '482910', token: TOKEN, as: 'visitor', character: 'student-m', pose: pose(0) },
      { onMessage: () => {}, onStatus: () => {} },
    );
    const s = h.sockets[0]!;
    s.open();
    s.receive(welcome);
    const k = config().LIVE_KEEPALIVE_SEC * 1000;
    h.advance(k);
    h.advance(k);
    const poses = s.sent.filter(m => (m as { t: string }).t === 'pose');
    expect(poses).toHaveLength(2);
    expect(k).toBeLessThan(config().LIVE_IDLE_TIMEOUT_SEC * 1000);
  });
});
