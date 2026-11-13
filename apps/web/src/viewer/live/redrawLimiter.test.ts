import { describe, expect, it } from 'vitest';
import { createRedrawLimiter, type RedrawClock } from './redrawLimiter.ts';

const fakeClock = () => {
  let now = 0;
  let next = 1;
  const list: { id: number; at: number; fn: () => void }[] = [];
  const clock: RedrawClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = next++;
      list.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout: id => {
      const i = list.findIndex(t => t.id === id);
      if (i >= 0) list.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      list.sort((a, b) => a.at - b.at);
      const t = list[0];
      if (!t || t.at > end) break;
      list.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  };
  return { clock, advance };
};

describe('사람 쪽 다시 그리기 상한(G-25 HS-06)', () => {
  it('매 프레임(60회/초) 요청해도 초당 fps번 안쪽으로만 깨운다', () => {
    const c = fakeClock();
    let wakes = 0;
    const lim = createRedrawLimiter(20, () => (wakes += 1), c.clock);
    for (let f = 0; f < 60; f++) {
      lim.request();
      c.advance(1000 / 60);
    }
    expect(wakes).toBeGreaterThanOrEqual(19);
    expect(wakes).toBeLessThanOrEqual(21);
  });

  it('오래 쉬었다가 처음 요청은 바로 깨운다', () => {
    const c = fakeClock();
    let wakes = 0;
    const lim = createRedrawLimiter(20, () => (wakes += 1), c.clock);
    lim.request();
    expect(wakes).toBe(1);
    c.advance(5000);
    lim.request();
    expect(wakes).toBe(2);
  });

  it('cancel하면 기다리던 깨우기를 버린다', () => {
    const c = fakeClock();
    let wakes = 0;
    const lim = createRedrawLimiter(20, () => (wakes += 1), c.clock);
    lim.request();
    lim.request();
    lim.cancel();
    c.advance(1000);
    expect(wakes).toBe(1);
  });
});
