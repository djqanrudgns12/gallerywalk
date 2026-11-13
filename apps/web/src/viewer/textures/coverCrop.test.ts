import { describe, expect, it } from 'vitest';
import { coverCrop } from './coverCrop.ts';

/**
 * 소리 명판 표지(V-23): 정사각 표지를 가로로 긴 명판(0.5 × 0.35m)에 늘이지 않고 가운데를 잘라 채운다.
 * 상주 관리가 올린 `ImageBitmap` 텍스처는 UV를 뒤집어 쓴다(repeat.y < 0) — 뒤집기를 지킨 채 자른다.
 */
describe('coverCrop', () => {
  it('정사각 표지 → 가로 긴 명판: 위아래를 같이 잘라 가운데 70%', () => {
    const flip = coverCrop({ w: 512, h: 512 }, { w: 0.5, h: 0.35 }, true);
    expect(flip.repeat[0]).toBe(1);
    expect(flip.repeat[1]).toBeCloseTo(-0.7, 6);
    expect(flip.offset[0]).toBe(0);
    expect(flip.offset[1]).toBeCloseTo(0.85, 6);
    const std = coverCrop({ w: 512, h: 512 }, { w: 0.5, h: 0.35 }, false);
    expect(std.repeat[1]).toBeCloseTo(0.7, 6);
    expect(std.offset[1]).toBeCloseTo(0.15, 6);
  });

  it('가로 긴 표지 → 정사각 판: 양옆을 잘라 가운데', () => {
    const r = coverCrop({ w: 800, h: 400 }, { w: 1, h: 1 }, true);
    expect(r.repeat[0]).toBeCloseTo(0.5, 6);
    expect(r.offset[0]).toBeCloseTo(0.25, 6);
    expect(r.repeat[1]).toBe(-1);
    expect(r.offset[1]).toBe(1);
  });

  it('비율이 같으면 그대로(뒤집기만)', () => {
    expect(coverCrop({ w: 500, h: 350 }, { w: 0.5, h: 0.35 }, true)).toEqual({
      repeat: [1, -1],
      offset: [0, 1],
    });
    expect(coverCrop({ w: 500, h: 350 }, { w: 0.5, h: 0.35 }, false)).toEqual({
      repeat: [1, 1],
      offset: [0, 0],
    });
  });
});
