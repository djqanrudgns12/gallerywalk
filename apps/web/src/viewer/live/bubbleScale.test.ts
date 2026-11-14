import { config } from '@gallery/core/config';
import { describe, expect, it } from 'vitest';
import { bubbleInRange, bubbleStickerPx, bubbleWorldHeight, projectedPx } from './bubbleScale.ts';

const fov = (config().VFOV_MAX_DEG * Math.PI) / 180;
const PHONE_H = 740;

describe('말풍선 화면 크기 고정(W-02)', () => {
  it('휴대폰 10m·18m에서도 스티커 화면 높이 ≥ 56px', () => {
    for (const d of [10, 18]) {
      const world = bubbleWorldHeight(d, fov, PHONE_H, 'phone');
      expect(projectedPx(world, d, fov, PHONE_H)).toBeGreaterThanOrEqual(56 - 1e-9);
    }
  });

  it('가까우면 기기 상한에서 멈춘다', () => {
    const [, max] = config().BUBBLE_STICKER_PX.desktop;
    expect(bubbleStickerPx(0.5, fov, 1000, 'desktop')).toBe(max);
  });

  it('세계 높이를 다시 투영하면 고른 px와 같다', () => {
    const d = 6;
    const px = bubbleStickerPx(d, fov, 900, 'tablet');
    expect(projectedPx(bubbleWorldHeight(d, fov, 900, 'tablet'), d, fov, 900)).toBeCloseTo(px, 9);
  });

  it('BUBBLE_MAX_DIST_M 밖은 숨김', () => {
    expect(bubbleInRange(config().BUBBLE_MAX_DIST_M)).toBe(true);
    expect(bubbleInRange(config().BUBBLE_MAX_DIST_M + 0.01)).toBe(false);
  });
});
