import { describe, expect, it } from 'vitest';
import { ShuffleBag } from './shuffleBag.ts';

/** 시험용 고정 난수(mulberry32) */
const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const sorted = (a: readonly number[]): number[] => [...a].sort((x, y) => x - y);
const LINES = [2, 3, 5, 8, 9, 15, 16, 17];

describe('섞은 주머니 ShuffleBag(W-10 "1번씩 랜덤")', () => {
  it('한 바퀴 안에서는 모든 줄이 한 번씩만 나온다', () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      const bag = new ShuffleBag(LINES, seeded(seed));
      for (let round = 0; round < 30; round++) {
        const got = Array.from({ length: LINES.length }, () => bag.next());
        expect(sorted(got)).toEqual(sorted(LINES));
      }
    }
  });

  it('바퀴가 바뀌어도 같은 줄이 연달아 나오지 않는다(새 바퀴 첫 줄 ≠ 지난 바퀴 마지막 줄)', () => {
    let boundaries = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const bag = new ShuffleBag([1, 2, 3], seeded(seed));
      let prev = bag.next();
      for (let i = 1; i < 300; i++) {
        const v = bag.next();
        expect(v).not.toBe(prev);
        if (i % 3 === 0) boundaries++;
        prev = v;
      }
    }
    // 세 줄짜리는 섞기만 하면 경계에서 1/3 확률로 겹친다 — 경계를 충분히 지나 봤는지
    expect(boundaries).toBeGreaterThan(5000);
  });

  it('주입한 난수만 쓴다: 같은 난수면 같은 순서, 다른 난수면 대체로 다른 순서', () => {
    const take = (seed: number): number[] => {
      const bag = new ShuffleBag(LINES, seeded(seed));
      return Array.from({ length: LINES.length * 3 }, () => bag.next());
    };
    expect(take(7)).toEqual(take(7));
    expect(take(7)).not.toEqual(take(8));
  });

  it('난수가 범위 끝(1·NaN)을 내도 범위 안에서 고르고 규칙을 지킨다', () => {
    for (const r of [0, 0.999999999, 1, Number.NaN]) {
      const bag = new ShuffleBag(LINES, () => r);
      let prev: number | null = null;
      for (let round = 0; round < 4; round++) {
        const got = Array.from({ length: LINES.length }, () => bag.next());
        expect(sorted(got)).toEqual(sorted(LINES));
        expect(got[0]).not.toBe(prev);
        prev = got[got.length - 1] ?? null;
      }
    }
  });

  it('한 줄짜리는 늘 그 줄, 겹친 항목은 하나로, 빈 목록은 받지 않는다', () => {
    const one = new ShuffleBag([4], seeded(1));
    expect([one.next(), one.next(), one.next()]).toEqual([4, 4, 4]);
    const dup = new ShuffleBag([1, 1, 2], seeded(1));
    const got = [dup.next(), dup.next()];
    expect(sorted(got)).toEqual([1, 2]);
    expect(dup.remaining).toBe(0);
    expect(() => new ShuffleBag([], seeded(1))).toThrow();
  });
});
