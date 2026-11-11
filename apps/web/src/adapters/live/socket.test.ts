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
      v: 1,
      token: TOKEN,
      as: 'visitor',
      character: 'student-m',
    });
    s.receive(welcome);
    expect(statuses).toEqual(['connecting', 'live']);
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
