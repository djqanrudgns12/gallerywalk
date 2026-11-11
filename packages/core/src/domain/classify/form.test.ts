import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { overrideConfig, resetConfig } from '../../config.ts';
import type { ArtworkForm } from '../../types/index.ts';
import { classifyForm, formFromAspect } from './form.ts';

const image = (w: number, h: number) => classifyForm({ kind: 'IMAGE', w, h, pageCount: 1 });

afterEach(() => resetConfig());

describe('formFromAspect — PRD 6.4 표의 경계', () => {
  it('파노라마는 r > 2.2 (2.2 자체는 가로)', () => {
    expect(image(11, 5)).toBe('LANDSCAPE'); // r = 2.2
    expect(image(2201, 1000)).toBe('PANORAMA');
    expect(image(6000, 1000)).toBe('PANORAMA');
  });

  it('가로는 1.2 < r ≤ 2.2 (1.2 자체는 정사각)', () => {
    expect(image(6, 5)).toBe('SQUARE'); // r = 1.2
    expect(image(1201, 1000)).toBe('LANDSCAPE');
    expect(image(1600, 900)).toBe('LANDSCAPE');
  });

  it('정사각은 0.83 ≤ r ≤ 1.2 (양 끝 포함)', () => {
    expect(image(83, 100)).toBe('SQUARE'); // r = 0.83
    expect(image(1000, 1000)).toBe('SQUARE');
    expect(image(829, 1000)).toBe('PORTRAIT');
  });

  it('세로는 0.45 ≤ r < 0.83 (0.45 자체는 세로)', () => {
    expect(image(9, 20)).toBe('PORTRAIT'); // r = 0.45
    expect(image(2480, 3508)).toBe('PORTRAIT'); // A4
    expect(image(449, 1000)).toBe('TALL');
  });

  it('긴 세로는 r < 0.45 (800×20000 웹툰)', () => {
    expect(image(800, 20000)).toBe('TALL');
  });

  it('경계는 설정 키를 따른다', () => {
    overrideConfig({ FORM_PANORAMA_MIN_R: 3 });
    expect(formFromAspect(2500, 1000)).toBe('LANDSCAPE');
    expect(formFromAspect(3001, 1000)).toBe('PANORAMA');
    overrideConfig({ FORM_PORTRAIT_MIN_R: 0.3 });
    expect(formFromAspect(400, 1000)).toBe('PORTRAIT');
  });

  it('r이 커지면 형태는 TALL → PORTRAIT → SQUARE → LANDSCAPE → PANORAMA 쪽으로만 간다', () => {
    const rank: Record<string, number> = { TALL: 0, PORTRAIT: 1, SQUARE: 2, LANDSCAPE: 3, PANORAMA: 4 };
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40000 }),
        fc.integer({ min: 1, max: 40000 }),
        fc.integer({ min: 1, max: 40000 }),
        (w1, w2, h) => {
          const [lo, hi] = w1 <= w2 ? [w1, w2] : [w2, w1];
          expect(rank[formFromAspect(lo, h)]!).toBeLessThanOrEqual(rank[formFromAspect(hi, h)]!);
        },
      ),
      { seed: 20261111, numRuns: 500 },
    );
  });
});

describe('classifyForm — 종류별', () => {
  it('글은 TEXTCARD, 소리는 SOUND (치수와 상관없이)', () => {
    expect(classifyForm({ kind: 'TEXT', w: 0, h: 0, pageCount: 1 })).toBe('TEXTCARD');
    expect(classifyForm({ kind: 'AUDIO', w: 0, h: 0, pageCount: 1 })).toBe('SOUND');
  });

  it('PDF는 첫 쪽 비율과 상관없이 MULTIPAGE, 첫 쪽 형태는 formFromAspect로', () => {
    const forms: ArtworkForm[] = [
      classifyForm({ kind: 'PDF', w: 2480, h: 3508, pageCount: 12 }),
      classifyForm({ kind: 'PDF', w: 3508, h: 2480, pageCount: 3 }),
      classifyForm({ kind: 'PDF', w: 2480, h: 3508, pageCount: 1 }),
    ];
    expect(forms).toEqual(['MULTIPAGE', 'MULTIPAGE', 'MULTIPAGE']);
    expect(formFromAspect(3508, 2480)).toBe('LANDSCAPE');
  });

  it('여러 쪽 그림도 MULTIPAGE', () => {
    expect(classifyForm({ kind: 'IMAGE', w: 1000, h: 1000, pageCount: 2 })).toBe('MULTIPAGE');
  });
});
