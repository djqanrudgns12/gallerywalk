import { config } from '@gallery/core/config';

/** 화면 정규 좌표(-1~1)에 투영한 이름표. 깊이가 작을수록 카메라에 가깝다. */
export interface ProjectedTag {
  readonly id: string;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  readonly hw: number;
  readonly hh: number;
}

export interface PlacedTag extends ProjectedTag {
  readonly row: number;
  /** 화면 위쪽으로 옮긴 양. 셰이더의 카메라 평면에서 그대로 적용한다. */
  readonly lift: number;
}

/** 가까운 사람 우선, 최대 두 단. 두 단 모두 겹치거나 화면을 벗어나면 먼 표를 숨긴다. */
export const placePeerTags = (
  tags: readonly ProjectedTag[],
  gap: { readonly x: number; readonly y: number },
): PlacedTag[] => {
  const placed: PlacedTag[] = [];
  const sorted = [...tags].sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const tag of sorted) {
    if (tag.depth <= 0 || Math.abs(tag.x) - tag.hw > 1) continue;
    for (let row = 0; row < config().PEER_TAG_ROWS; row++) {
      const lift =
        row === 0
          ? 0
          : Math.max(
              2 * tag.hh + gap.y,
              ...placed
                .filter(p => p.row < row && Math.abs(p.x - tag.x) < p.hw + tag.hw + gap.x)
                .map(p => p.y + p.hh + tag.hh + gap.y - tag.y),
            );
      const y = tag.y + lift;
      if (y - tag.hh < -1 || y + tag.hh > 1) continue;
      const hit = placed.some(
        p => Math.abs(p.x - tag.x) < p.hw + tag.hw + gap.x && Math.abs(p.y - y) < p.hh + tag.hh + gap.y,
      );
      if (hit) continue;
      placed.push({ ...tag, y, lift, row });
      break;
    }
  }
  return placed;
};
