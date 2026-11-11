import type { Layout } from '@gallery/core/types';

/**
 * 전시실 지도(PLAN §4.9, ADR-018)를 그릴 좌표. 배치의 `map`(바닥 평면 [X, Z], m)을 SVG 좌표로 옮긴다.
 * 위쪽 = 회랑 하류(+Z)가 되게 Z를 뒤집는다(입구가 아래에 오는 안내도 모양). 스타일은 화면(토큰)이 정한다.
 */

export interface MapView {
  readonly viewBox: string;
  /** 홀·회랑 윤곽 */
  readonly outline: readonly string[];
  readonly parts: readonly { partId: string; points: string; label: { x: number; y: number } }[];
  readonly doors: readonly { x1: number; y1: number; x2: number; y2: number }[];
  /** 지금 있는 자리 표시(선택) */
  readonly here: { x: number; y: number } | null;
}

const MARGIN_M = 1;

export const mapView = (map: Layout['map'], here: readonly [number, number] | null = null): MapView => {
  const { min, max } = map.bounds;
  // SVG y = −Z: 하류가 위
  const px = (x: number): number => Number((x - min[0] + MARGIN_M).toFixed(3));
  const py = (z: number): number => Number((max[1] - z + MARGIN_M).toFixed(3));
  const poly = (pts: readonly (readonly [number, number])[]): string =>
    pts.map(p => `${px(p[0])},${py(p[1])}`).join(' ');
  const w = max[0] - min[0] + 2 * MARGIN_M;
  const h = max[1] - min[1] + 2 * MARGIN_M;
  return {
    viewBox: `0 0 ${w.toFixed(3)} ${h.toFixed(3)}`,
    outline: map.outline.map(poly),
    parts: map.parts.map(p => ({
      partId: p.partId,
      points: poly(p.polygon),
      label: { x: px(p.labelPos[0]), y: py(p.labelPos[1]) },
    })),
    doors: map.doors.map(d => {
      const along: [number, number] = [-d.normal[1], d.normal[0]];
      const half = d.width / 2;
      return {
        x1: px(d.pos[0] - along[0] * half),
        y1: py(d.pos[1] - along[1] * half),
        x2: px(d.pos[0] + along[0] * half),
        y2: py(d.pos[1] + along[1] * half),
      };
    }),
    here: here ? { x: px(here[0]), y: py(here[1]) } : null,
  };
};
