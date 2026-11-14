import type { Layout } from '@gallery/core/types';
import { standSpot } from './guide.ts';
import type { WalkStart } from './WalkView.tsx';

/**
 * 고른 작품 앞에서 걷기 시작(FIELD_PLAN HT-06 — 교사 3D 미리 보기가 광장부터가 아니라 그 작품 정지 지점에서 열림).
 * 서는 자리·바라보는 방향은 `다음 작품으로`로 걸어가 설 때와 같은 `standSpot`. 그 작품이 배치에 없으면(숨김·글만 등) undefined →
 * 평소처럼 처음 자리에서 시작한다.
 */
export const startAtArtwork = (layout: Layout, artworkId: string, aspect: number): WalkStart | undefined => {
  const stopIndex = layout.stops.findIndex(s => s.kind === 'artwork' && s.artworkId === artworkId);
  const stop = layout.stops[stopIndex];
  if (stopIndex < 0 || !stop) return undefined;
  const spot = standSpot(layout, stop, aspect);
  return { x: spot.at[0], z: spot.at[1], yaw: spot.yaw, stopIndex };
};
