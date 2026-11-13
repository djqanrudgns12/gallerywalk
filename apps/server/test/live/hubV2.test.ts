import { randomInt } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { config, overrideConfig, resetConfig } from '@gallery/core/config';
import { decodePoses } from '@gallery/core/live';
import type { Pose } from '@gallery/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSlowGuard } from '../../src/live/attach.ts';
import { CLOSE, createLiveHub, type LiveHub, type LiveSocket } from '../../src/live/hub.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import { makeTempDir } from '../helpers/server.ts';
import { hello, newToken, pose, seedExhibition, seedTeacher, tickMs } from './support.ts';
import { testDeps } from '../support/memoryStore.ts';

/**
 * 함께 관람 판 2(G-25 HS-02~HS-05·HS-10, ADR-072): 허브를 가짜 소켓으로 바로 돌린다(웹소켓 없음). 방송 타이머만 가짜.
 * 위치·토큰은 모두 시험 안에서 만든 가상 값.
 */

class FakeSocket implements LiveSocket {
  readonly texts: string[] = [];
  readonly shared: Buffer[] = [];
  closedWith: number | null = null;
  /** false면 보낼 줄이 밀린 기기처럼 위치 글을 받지 않는다 */
  accept = true;
  send(text: string): void {
    if (this.closedWith === null) this.texts.push(text);
  }
  sendShared(data: Buffer): boolean {
    if (this.closedWith !== null) return true;
    if (!this.accept) return false;
    this.shared.push(data);
    return true;
  }
  close(code: number): void {
    this.closedWith = code;
  }
  /** 받은 글 메시지(종류별) */
  messages(t: string): Record<string, unknown>[] {
    return this.texts.map(x => JSON.parse(x) as Record<string, unknown>).filter(m => m['t'] === t);
  }
  /** 받은 `p` 글을 풀어 번호 → x 목록 */
  poses(): { n: number; pose: Pose }[][] {
    return this.shared.map(b => {
      const m = JSON.parse(b.toString('utf8')) as { t: string; p: unknown };
      expect(m.t).toBe('p');
      const d = decodePoses(m.p);
      expect(d).not.toBeNull();
      return d!;
    });
  }
}

let t: ReturnType<typeof testDeps>;
let hub: LiveHub;
let log: Logger;
let root: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  t = testDeps();
  root = await makeTempDir();
  log = createLogger({ dir: joinPath(root, 'logs'), keepFiles: 7 });
  // 시험 저장소의 난수는 짧게 되풀이돼 사람이 10명을 넘으면 sid가 겹친다 — 여기서는 진짜 난수
  hub = createLiveHub({ deps: { ...t.deps, random: { int: (lo, hi) => randomInt(lo, hi + 1) } }, log });
});

afterEach(async () => {
  hub.shutdown();
  log.close();
  await rm(root, { recursive: true, force: true });
  vi.useRealTimers();
  resetConfig();
});

const tick = (n = 1): void => void vi.advanceTimersByTime(tickMs() * n);

/** 판 `v` 기기 하나가 들어온다(`at` = 처음 자리) */
const join = (
  code: string,
  v: 1 | 2,
  at: Pose,
  as: 'visitor' | 'teacher' = 'visitor',
  token = newToken(),
) => {
  const socket = new FakeSocket();
  const conn = hub.open(socket, code);
  conn.receive(JSON.stringify({ ...hello(token, { as, pose: at }), v }));
  const welcome = socket.messages('welcome')[0];
  const move = (seq: number, p: Pose): void => conn.receive(JSON.stringify({ t: 'pose', seq, pose: p }));
  return { socket, conn, welcome, move };
};

describe('함께 관람 판 2', () => {
  it('welcome·join에 방 안 번호, 위치는 작은 정수 배열 p(자기 것 포함), 판 1 기기는 같은 방에서 예전 peers', () => {
    const ex = seedExhibition(t);
    const a = join(ex.entryCode, 2, pose(1));
    const b = join(ex.entryCode, 2, pose(2));
    const old = join(ex.entryCode, 1, pose(3));
    expect(a.welcome).toMatchObject({ t: 'welcome', n: 1, peers: [] });
    expect(b.welcome?.['n']).toBe(2);
    expect((b.welcome?.['peers'] as { n?: number }[])[0]?.n).toBe(1);
    // 판 1 기기의 welcome·join에는 번호가 없다(옛 앱의 strict 스키마가 깨지지 않게)
    expect(old.welcome?.['n']).toBeUndefined();
    expect((old.welcome?.['peers'] as Record<string, unknown>[]).every(p => !('n' in p))).toBe(true);
    expect((a.socket.messages('join')[0]?.['peer'] as { n?: number }).n).toBe(2);

    b.move(1, pose(4.567, { yaw: 7, move: 2 }));
    tick();
    const got = a.socket.poses();
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual([{ n: 2, pose: { x: 4.57, y: 0, z: -2.28, yaw: 0.717, move: 2 } }]);
    // 같은 글 하나를 b도 받는다(자기 것 — 기기가 번호로 건너뜀)
    expect(b.socket.shared[0]).toBe(a.socket.shared[0]);
    // 판 1 기기는 예전 형식(자기 제외, 반올림 없음)
    const peers = old.socket.messages('peers');
    expect(peers).toHaveLength(1);
    expect(peers[0]?.['poses']).toEqual([
      { sid: b.welcome?.['you'], pose: pose(4.567, { yaw: 7, move: 2 }) },
    ]);
    expect(old.socket.shared).toEqual([]);
  });

  it('30명이 한 칸에서 모두 움직여도 한 차례 글은 하나(같은 Buffer)이고 900바이트 이하', () => {
    const ex = seedExhibition(t);
    // 모두 같은 바닥 칸(x 0~9m, z 1m)
    const people = Array.from({ length: 30 }, (_, i) => join(ex.entryCode, 2, pose(i * 0.3, { z: 1 })));
    people.forEach((p, i) => p.move(1, pose(i * 0.3 + 0.123, { z: 1, yaw: -2.345, move: 1 })));
    tick();
    const first = people[0]!.socket.shared[0];
    expect(first).toBeDefined();
    for (const p of people) expect(p.socket.shared).toEqual([first]);
    expect(first!.length).toBeLessThanOrEqual(900);
    // 판 1 형식이었다면(사람마다 따로·자기 제외) 한 사람이 받는 양
    const v1Like = JSON.stringify({
      t: 'peers',
      at: t.at(),
      poses: people.slice(1).map(p => ({
        sid: String(p.welcome?.['you']),
        pose: pose(0.123 + 0.3 * 7, { yaw: -2.345, move: 1 }),
      })),
    }).length;
    expect(first!.length * 3).toBeLessThan(v1Like);
  });

  it('관심 영역: 먼 사람의 움직임은 LIVE_FAR_EVERY 차례마다, 가까운 사람은 매 차례', () => {
    const ex = seedExhibition(t);
    const cell = config().LIVE_AOI_CELL_M;
    const me = join(ex.entryCode, 2, pose(1, { z: 1 }));
    const near = join(ex.entryCode, 2, pose(2, { z: 1 }));
    const far = join(ex.entryCode, 2, pose(cell * 5, { z: cell * 5 }));
    const every = config().LIVE_FAR_EVERY;
    const sawNear: number[] = [];
    const sawFar: number[] = [];
    for (let k = 1; k <= every * 2; k++) {
      near.move(k, pose(2 + k * 0.1, { z: 1 }));
      far.move(k, pose(cell * 5 + k * 0.1, { z: cell * 5 }));
      const before = me.socket.shared.length;
      tick();
      const fresh = me.socket.poses().slice(before).flat();
      if (fresh.some(e => e.n === 2)) sawNear.push(k);
      if (fresh.some(e => e.n === 3)) sawFar.push(k);
    }
    expect(sawNear).toHaveLength(every * 2);
    // 먼 사람은 두 번(먼 차례마다), 그때 가장 최근 자리
    expect(sawFar).toHaveLength(2);
    const lastFar = me.socket
      .poses()
      .flat()
      .filter(e => e.n === 3)
      .at(-1);
    expect(lastFar?.pose.x).toBeCloseTo(cell * 5 + sawFar[1]! * 0.1, 2);
  });

  it('보낼 줄이 밀려 건너뛴 기기는 다음 차례에 모두의 지금 자리를 한 번에 받는다(멈춘 사람도)', () => {
    const ex = seedExhibition(t);
    const slow = join(ex.entryCode, 2, pose(1));
    const walker = join(ex.entryCode, 2, pose(2));
    const still = join(ex.entryCode, 2, pose(3));
    slow.socket.accept = false;
    walker.move(1, pose(2.5));
    tick();
    expect(slow.socket.shared).toEqual([]);
    // 그 사이 walker가 멈춰 더는 바뀌지 않는다 — 그래도 slow는 마지막 자리를 받아야 한다
    slow.socket.accept = true;
    tick();
    const got = slow.socket.poses();
    expect(got).toHaveLength(1);
    expect(got[0]!.map(e => e.n).sort()).toEqual([1, 2, 3]);
    expect(got[0]!.find(e => e.n === 2)?.pose.x).toBe(2.5);
    expect(still.socket.poses()).toHaveLength(1);
    tick();
    expect(slow.socket.shared).toHaveLength(1);
  });

  it('번호는 비어 있는 가장 작은 수를 다시 쓴다', () => {
    const ex = seedExhibition(t);
    join(ex.entryCode, 2, pose(1));
    const b = join(ex.entryCode, 2, pose(2));
    b.conn.closed();
    const c = join(ex.entryCode, 2, pose(3));
    expect(c.welcome?.['n']).toBe(2);
  });

  it('서버 전체 방문자가 LIVE_MAX_TOTAL이면 E_LIVE_FULL(교사는 들어온다)', () => {
    overrideConfig({ LIVE_MAX_TOTAL: 2 });
    const one = seedExhibition(t);
    const two = seedExhibition(t);
    join(one.entryCode, 2, pose(1));
    join(two.entryCode, 2, pose(1));
    const third = join(two.entryCode, 2, pose(2));
    expect(third.socket.messages('bye')).toEqual([{ t: 'bye', code: 'E_LIVE_FULL' }]);
    expect(third.socket.closedWith).toBe(CLOSE.tryAgain);
    const teacher = join(two.entryCode, 2, pose(3), 'teacher', seedTeacher(t, two.id));
    expect(teacher.welcome).toBeDefined();
  });

  it('루프가 바쁘면(setLoad) 한 사람 위치를 LIVE_DEGRADE_EVERY 차례에 한 번으로, 괜찮아지면 되돌린다', () => {
    // 먼 차례 묶음이 끼지 않게(그 차례에는 그동안 바뀐 사람이 다시 실린다)
    overrideConfig({ LIVE_FAR_EVERY: 1000 });
    const ex = seedExhibition(t);
    const a = join(ex.entryCode, 2, pose(1));
    const b = join(ex.entryCode, 2, pose(2));
    let seq = 0;
    const run = (ticks: number): number => {
      const before = a.socket.shared.length;
      for (let k = 0; k < ticks; k++) {
        seq += 1;
        b.move(seq, pose(2 + seq * 0.01));
        tick();
      }
      return a.socket
        .poses()
        .slice(before)
        .filter(list => list.some(e => e.n === 2)).length;
    };
    expect(run(10)).toBe(10);
    hub.setLoad(config().LIVE_DEGRADE_LOOP_MS);
    expect(run(10)).toBe(10 / config().LIVE_DEGRADE_EVERY);
    hub.setLoad(config().LIVE_DEGRADE_LOOP_MS - 1);
    tick();
    expect(run(10)).toBe(10);
  });
});

describe('점프 시작 중계(PRD_V2 W-05)', () => {
  const jump = (conn: ReturnType<typeof join>['conn']): void => conn.receive(JSON.stringify({ t: 'jump' }));

  it('판 2의 jump는 같은 전시 다른 판 2 기기에 send로(자기·판 1·다른 전시 제외), at은 서버가 받은 시각', () => {
    const ex = seedExhibition(t);
    const other = seedExhibition(t);
    const a = join(ex.entryCode, 2, pose(1));
    const b = join(ex.entryCode, 2, pose(2));
    const old = join(ex.entryCode, 1, pose(3));
    const away = join(other.entryCode, 2, pose(1));
    jump(a.conn);
    const sid = a.welcome?.['you'];
    expect(b.socket.messages('jump')).toEqual([{ t: 'jump', sid, at: t.at() }]);
    // 건너뛰어도 되는 위치 글 길(sendShared)로 보내지 않는다
    expect(b.socket.shared).toEqual([]);
    expect(a.socket.messages('jump')).toEqual([]);
    expect(old.socket.texts.some(x => x.includes('"jump"'))).toBe(false);
    expect(away.socket.messages('jump')).toEqual([]);
    expect(a.socket.closedWith).toBeNull();
  });

  it('한 연결은 1초에 두 번까지만 넘기고, 넘는 것은 조용히 버린다(닫지 않음)', () => {
    const ex = seedExhibition(t);
    const a = join(ex.entryCode, 2, pose(1));
    const b = join(ex.entryCode, 2, pose(2));
    jump(a.conn);
    t.advance(100);
    jump(a.conn);
    t.advance(100);
    jump(a.conn);
    jump(a.conn);
    expect(b.socket.messages('jump')).toHaveLength(2);
    expect(a.socket.closedWith).toBeNull();
    expect(a.socket.messages('bye')).toEqual([]);
    // 첫 점프에서 1초가 지나면 한 칸이 다시 빈다
    t.advance(800);
    jump(a.conn);
    expect(b.socket.messages('jump')).toHaveLength(3);
    jump(a.conn);
    expect(b.socket.messages('jump')).toHaveLength(3);
    // 다른 사람의 상한은 따로
    jump(b.conn);
    expect(a.socket.messages('jump')).toHaveLength(1);
  });

  it('판 1 연결이 jump를 보내면 형식 틀림으로 닫는다, 들어오기 전 jump도 닫는다', () => {
    const ex = seedExhibition(t);
    const b = join(ex.entryCode, 2, pose(2));
    const old = join(ex.entryCode, 1, pose(1));
    jump(old.conn);
    expect(old.socket.messages('bye')).toEqual([{ t: 'bye', code: 'E_VALIDATION' }]);
    expect(old.socket.closedWith).toBe(CLOSE.policy);
    expect(b.socket.messages('jump')).toEqual([]);
    const early = new FakeSocket();
    hub.open(early, ex.entryCode).receive(JSON.stringify({ t: 'jump' }));
    expect(early.closedWith).toBe(CLOSE.policy);
    // 덧붙인 칸이 있으면 거절(strictObject)
    const c = join(ex.entryCode, 2, pose(3));
    c.conn.receive(JSON.stringify({ t: 'jump', at: 1 }));
    expect(c.socket.closedWith).toBe(CLOSE.policy);
    expect(b.socket.messages('jump')).toEqual([]);
  });
});

describe('느린 기기 판정(HS-04)', () => {
  it('보낼 줄이 상한 이하면 보냄, 넘으면 건너뜀, LIVE_SLOW_CLOSE_SEC 동안 계속 넘으면 닫음, 풀리면 다시 잰다', () => {
    let now = 0;
    const guard = createSlowGuard(() => now);
    const max = config().LIVE_SEND_BUFFER_MAX_BYTES;
    const closeMs = config().LIVE_SLOW_CLOSE_SEC * 1000;
    expect(guard.check(max)).toBe('send');
    expect(guard.check(max + 1)).toBe('skip');
    now += closeMs - 1;
    expect(guard.check(max + 1)).toBe('skip');
    now += 1;
    expect(guard.check(max + 1)).toBe('close');
    expect(guard.check(0)).toBe('send');
    now += closeMs;
    expect(guard.check(max + 1)).toBe('skip');
  });
});
