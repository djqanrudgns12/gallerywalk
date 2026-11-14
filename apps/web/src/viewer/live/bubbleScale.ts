import { config } from '@gallery/core/config';
import type { DeviceKind } from '../quality/tier.ts';

/**
 * 머리 위 말풍선의 화면 크기 고정(PRD_V2 W-02 "모바일 가독성", M4-3). 원근 카메라에서 세계 높이 `h`(m)가 거리 `d`(m)·세로 화각
 * `fovY`(rad)·화면 높이 `screenH`(CSS px)일 때 화면에서 몇 px인지 계산하고, 기기별 `BUBBLE_STICKER_PX` 범위로 잘라 그 px가 되게
 * 하는 세계 높이를 돌려준다. 셰이더(인스턴스)도 같은 식을 쓴다 — 이 함수가 시험 기준이다.
 */

/** 세계 높이 `h`(m)가 화면에서 차지하는 높이(CSS px) */
export const projectedPx = (h: number, d: number, fovY: number, screenH: number): number =>
  (h * screenH) / (2 * Math.max(d, 1e-3) * Math.tan(fovY / 2));

/** 화면에서 `px`(CSS px)로 보이게 하는 세계 높이(m) */
export const worldForPx = (px: number, d: number, fovY: number, screenH: number): number =>
  (px * 2 * Math.max(d, 1e-3) * Math.tan(fovY / 2)) / screenH;

/** 스티커가 화면에서 보일 높이(CSS px): 기준 세계 크기 `BUBBLE_WORLD_M`의 투영을 기기 범위로 자름 */
export const bubbleStickerPx = (d: number, fovY: number, screenH: number, device: DeviceKind): number => {
  const [min, max] = config().BUBBLE_STICKER_PX[device];
  const px = projectedPx(config().BUBBLE_WORLD_M, d, fovY, screenH);
  return Math.min(max, Math.max(min, px));
};

/** 위 높이가 되게 하는 세계 높이(m) — 인스턴스 배율 */
export const bubbleWorldHeight = (d: number, fovY: number, screenH: number, device: DeviceKind): number =>
  worldForPx(bubbleStickerPx(d, fovY, screenH, device), d, fovY, screenH);

/** `BUBBLE_MAX_DIST_M` 안이면 보인다(벽 너머 구역은 부르는 쪽이 따로 거른다) */
export const bubbleInRange = (d: number): boolean => d <= config().BUBBLE_MAX_DIST_M;
