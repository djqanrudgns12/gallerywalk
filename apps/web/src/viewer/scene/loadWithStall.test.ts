import { describe, expect, it } from 'vitest';
import { type LoadProgress, loadWithStall, type StallTimers } from './loadWithStall.ts';

/** 가짜 시계: `advance(ms)`로 시간을 보낸다 */
const fakeTimers = () => {
  let now = 0;
  let next = 1;
  const list: { id: number; at: number; fn: () => void }[] = [];
  const timers: StallTimers = {
    set: (fn, ms) => {
      const id = next++;
      list.push({ id, at: now + ms, fn });
      return id;
    },
    clear: id => {
      const i = list.findIndex(t => t.id === id);
      if (i >= 0) list.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      list.sort((a, b) => a.at - b.at);
      const t = list[0];
      if (!t || t.at > now) break;
      list.shift();
      t.fn();
    }
  };
  return { timers, advance };
};

/** 손으로 진행·끝을 알리는 받기 */
const manualLoad = <T>() => {
  let progress: (p: LoadProgress) => void = () => {};
  let finish: (v: T | null) => void = () => {};
  let fail: (e: unknown) => void = () => {};
  const start = (onProgress: (p: LoadProgress) => void) => {
    progress = onProgress;
    return new Promise<T | null>((res, rej) => {
      finish = res;
      fail = rej;
    });
  };
  return {
    start,
    progress: (p: LoadProgress) => progress(p),
    finish: (v: T | null) => finish(v),
    fail: (e: unknown) => fail(e),
  };
};

const STALL = 15_000;

describe('loadWithStall(G-24 HW-01)', () => {
  it('진행이 멈춘 채 상한이 지나면 null, 늦게 오면 late로 넘긴다', async () => {
    const t = fakeTimers();
    const m = manualLoad<string>();
    const late: string[] = [];
    const p = loadWithStall(m.start, STALL, v => late.push(v), t.timers);
    t.advance(STALL - 1);
    m.progress({ loaded: 10, total: 100 });
    t.advance(STALL - 1);
    let out: string | null | undefined;
    void p.then(v => (out = v));
    await Promise.resolve();
    expect(out).toBeUndefined();
    t.advance(1);
    await p;
    expect(out).toBeNull();
    m.finish('glb');
    await Promise.resolve();
    await Promise.resolve();
    expect(late).toEqual(['glb']);
  });

  it('바이트가 오는 동안은 오래 걸려도 기다린다(느린 학교 와이파이)', async () => {
    const t = fakeTimers();
    const m = manualLoad<string>();
    const p = loadWithStall(m.start, STALL, () => {}, t.timers);
    for (let i = 1; i <= 10; i++) {
      t.advance(STALL - 1);
      m.progress({ loaded: i * 10, total: 1000 });
    }
    m.finish('glb');
    expect(await p).toBe('glb');
  });

  it('다 받은 뒤 해석에는 상한을 걸지 않는다', async () => {
    const t = fakeTimers();
    const m = manualLoad<string>();
    const p = loadWithStall(m.start, STALL, () => {}, t.timers);
    m.progress({ loaded: 100, total: 100 });
    t.advance(STALL * 3);
    m.finish('glb');
    expect(await p).toBe('glb');
  });

  it('실패는 null', async () => {
    const t = fakeTimers();
    const m = manualLoad<string>();
    const p = loadWithStall(m.start, STALL, () => {}, t.timers);
    m.fail(new Error('403'));
    expect(await p).toBeNull();
  });
});
