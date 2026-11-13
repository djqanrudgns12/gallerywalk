/**
 * 명판 띄움 방향(V-57) — 순수 함수. 그리기(`ArtworkLabels.tsx`)와 따로 시험한다.
 */

/**
 * 벽을 따라 액자에서 명판 쪽으로 향하는 단위 방향(x, z): 액자 가운데 → 명판 자리에서 벽 법선 성분을 뺀 것.
 * 이젤(받침 아래 명판)이거나 명판이 액자 바로 위아래면 [0, 0].
 */
export const labelAwayOf = (
  pos: readonly [number, number, number],
  frameCenter: { readonly x: number; readonly z: number },
  normal: readonly [number, number],
  easel: boolean,
): [number, number] => {
  if (easel) return [0, 0];
  const dx = pos[0] - frameCenter.x;
  const dz = pos[2] - frameCenter.z;
  const along = dx * normal[0] + dz * normal[1];
  const tx = dx - along * normal[0];
  const tz = dz - along * normal[1];
  const len = Math.hypot(tx, tz);
  return len < 1e-6 ? [0, 0] : [tx / len, tz / len];
};
