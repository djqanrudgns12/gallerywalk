import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { config } from '../../config.ts';
import { estimateLinePitch } from './linePitch.ts';

/** 합성 줄 활동 배열: 간격 pitch마다 글 줄(높은 값) — 글자 줄 두께 thick, 바탕 잡음 noise */
const lines = (
  n: number,
  pitch: number,
  opts: { thick?: number; noise?: number; seed?: number; weakEvery?: number } = {},
) => {
  const { thick = 6, noise = 0, seed = 1, weakEvery = 0 } = opts;
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return Float64Array.from({ length: n }, (_, i) => {
    const k = Math.floor(i / pitch);
    const inLine = i % pitch < thick;
    const strength = weakEvery > 0 && k % weakEvery === 1 ? 0.6 : 1;
    return (inLine ? 100 * strength : 5) + noise * (rand() - 0.5) * 100;
  });
};

describe('estimateLinePitch(P2-4)', () => {
  it('간격 40의 줄무늬 → 40(±2), 신뢰도 높음', () => {
    const r = estimateLinePitch(lines(4000, 40));
    expect(r.pitch).not.toBeNull();
    expect(Math.abs(r.pitch! - 40)).toBeLessThanOrEqual(2);
    expect(r.confidence).toBeGreaterThan(config().LINE_PITCH_MIN_CONFIDENCE);
  });

  it('두 줄마다 진하기가 다른 글(배수 주기)이어도 기본 주기 40을 고른다', () => {
    const r = estimateLinePitch(lines(4000, 40, { weakEvery: 2 }));
    expect(Math.abs(r.pitch! - 40)).toBeLessThanOrEqual(2);
  });

  it('잡음이 섞여도 간격을 찾는다(여러 간격 · 시드)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 18, max: 120 }), fc.integer({ min: 1, max: 1000 }), (pitch, seed) => {
        const r = estimateLinePitch(
          lines(pitch * 40, pitch, { thick: Math.max(3, Math.round(pitch / 5)), noise: 0.2, seed }),
        );
        expect(r.pitch).not.toBeNull();
        expect(Math.abs(r.pitch! - pitch)).toBeLessThanOrEqual(Math.max(2, pitch * 0.05));
      }),
      { seed: 11, numRuns: 60 },
    );
  });

  it('줄 없는 그림(고른 면·흰 잡음)은 null 또는 낮은 신뢰도', () => {
    const flat = estimateLinePitch(new Float64Array(3000).fill(7));
    expect(flat.pitch).toBeNull();
    let s = 99;
    const noise = Float64Array.from({ length: 3000 }, () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    });
    const r = estimateLinePitch(noise);
    expect(r.pitch === null || r.confidence < config().LINE_PITCH_MIN_CONFIDENCE).toBe(true);
  });

  it('3주기보다 짧으면 찾지 않는다', () => {
    expect(estimateLinePitch(lines(100, 40)).pitch).toBeNull();
    expect(estimateLinePitch([]).pitch).toBeNull();
  });
});
