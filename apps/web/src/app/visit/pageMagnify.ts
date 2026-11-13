import { config } from '@gallery/core/config';

/**
 * 쪽 크게 보기 안 확대(PRD G-03 "두 번 누르기·두 손가락으로 최대 3배", ADR-047). 순수 함수 — 화면(`PageZoom`)과 따로 시험.
 * 배율 `s`는 1~`ZOOM_MAX_SCALE`, 옮김 `x`·`y`(CSS px)는 확대한 쪽이 상자 밖으로 빈 곳을 보이지 않게 묶는다.
 */
export interface Magnify {
  readonly s: number;
  readonly x: number;
  readonly y: number;
}

export const MAG_NONE: Magnify = { s: 1, x: 0, y: 0 };

const clampOffset = (m: Magnify, w: number, h: number): Magnify => {
  const mx = (w * (m.s - 1)) / 2;
  const my = (h * (m.s - 1)) / 2;
  return { s: m.s, x: Math.max(-mx, Math.min(mx, m.x)), y: Math.max(-my, Math.min(my, m.y)) };
};

/** 배율을 바꾼다(가운데 기준). 1에 가까우면(`PINCH_LOCK_SCALE` 안) 1로 붙인다 */
export const magnifyTo = (m: Magnify, s: number, w: number, h: number): Magnify => {
  const c = config();
  const next = Math.max(1, Math.min(c.ZOOM_MAX_SCALE, s));
  if (next < c.PINCH_LOCK_SCALE) return MAG_NONE;
  return clampOffset({ s: next, x: m.x * (next / m.s), y: m.y * (next / m.s) }, w, h);
};

/** 두 번 누르기: 1배면 2배(최대 배율 안), 아니면 1배로 */
export const toggleMagnify = (m: Magnify, w: number, h: number): Magnify =>
  m.s > 1 ? MAG_NONE : magnifyTo(m, Math.min(2, config().ZOOM_MAX_SCALE), w, h);

/** 확대한 동안 끌기로 옮기기 */
export const panBy = (m: Magnify, dx: number, dy: number, w: number, h: number): Magnify =>
  m.s <= 1 ? m : clampOffset({ s: m.s, x: m.x + dx, y: m.y + dy }, w, h);
