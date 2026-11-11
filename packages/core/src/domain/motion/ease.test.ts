import { describe, expect, it } from 'vitest';
import { cubicBezier, equalPowerIn, equalPowerOut } from './ease.ts';

describe('cubicBezier', () => {
  it('직선 곡선은 그대로 돌려준다', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const t of [0.1, 0.25, 0.5, 0.9]) expect(linear(t)).toBeCloseTo(t, 4);
  });

  it('CSS ease(0.25, 0.1, 0.25, 1)의 알려진 값과 맞는다', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
  });

  it('출발 가속 짧게·도착 감속 길게: 앞 절반에 이미 절반 넘게 간다', () => {
    const move = cubicBezier(0.45, 0, 0.15, 1);
    expect(move(0)).toBe(0);
    expect(move(1)).toBe(1);
    expect(move(0.5)).toBeGreaterThan(0.5);
    // 단조 증가
    let prev = 0;
    for (let t = 0.01; t <= 1; t += 0.01) {
      const v = move(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe('equalPower', () => {
  it('두 소리의 세기 제곱 합이 1로 유지된다', () => {
    for (const p of [0, 0.2, 0.5, 0.8, 1]) {
      expect(equalPowerIn(p) ** 2 + equalPowerOut(p) ** 2).toBeCloseTo(1, 9);
    }
  });
});
