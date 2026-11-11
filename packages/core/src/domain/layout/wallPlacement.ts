import { config } from '../../config.ts';
import type { WallSide } from '../../types/layout.ts';
import type { P2 } from './geom.ts';
import type { PartPlan, SizedItem } from './roomSizing.ts';

/**
 * 벽 자리(PLAN §4.5). 걷는 순서(논리): L(N 쪽 → F 쪽) → F(L 쪽 → R 쪽) → R(F 쪽 → N 쪽) → N(R 쪽 끝 → L 쪽 끝, 문 사이).
 * 벽 안에서는 1.2m 여백을 최소로 두고 남는 길이를 작품 사이·양끝에 고르게 나눠 가운데 정렬.
 */

export const WALK_ORDER: readonly WallSide[] = ['L', 'F', 'R', 'N'];

export interface WallGeometry {
  /** 벽 위 점(논리): 벽 방향 좌표 → (x, y) */
  readonly at: (along: number) => P2;
  /** 방 안쪽 법선(논리) */
  readonly normal: P2;
  /** 걷는 방향(논리 단위 벡터) */
  readonly walk: P2;
  /** 작품을 놓을 수 있는 구간(벽 방향 좌표, 작은 쪽 → 큰 쪽) */
  readonly span: readonly [number, number];
  /** 벽 전체 구간 */
  readonly extent: readonly [number, number];
}

export const wallGeometry = (side: WallSide, width: number, depth: number): WallGeometry => {
  const c = config();
  const corner = c.CORNER_MARGIN_M;
  switch (side) {
    case 'L':
      return {
        at: a => [0, a],
        normal: [1, 0],
        walk: [0, 1],
        span: [corner, depth - corner],
        extent: [0, depth],
      };
    case 'F':
      return {
        at: a => [a, depth],
        normal: [0, -1],
        walk: [1, 0],
        span: [corner, width - corner],
        extent: [0, width],
      };
    case 'R':
      return {
        at: a => [width, a],
        normal: [-1, 0],
        walk: [0, -1],
        span: [corner, depth - corner],
        extent: [0, depth],
      };
    case 'N': {
      const door = c.DOOR_WIDTH_M + c.DOOR_MARGIN_M;
      return {
        at: a => [a, 0],
        normal: [0, 1],
        walk: [-1, 0],
        span: [door, width - door],
        extent: [0, width],
      };
    }
  }
};

export interface WallSlot {
  readonly side: WallSide;
  readonly item: SizedItem;
  /** 액자 한가운데(논리 x, y) */
  readonly pos: P2;
  /** 액자 한가운데 높이(m) */
  readonly height: number;
  readonly normal: P2;
  readonly walk: P2;
}

/** 한가운데 높이: 1.5m. 바깥 높이가 2.6m를 넘으면 아래 끝 0.4m(§4.5). */
export const frameHeight = (outerH: number): number => {
  const c = config();
  return outerH > c.HIGH_FRAME_LIMIT_M ? c.HIGH_FRAME_BOTTOM_M + outerH / 2 : c.EYE_HEIGHT_M;
};

/** 걷는 순서의 작품들을 구간에 고르게 놓은 한가운데(벽 방향 좌표). */
const distribute = (
  items: readonly SizedItem[],
  span: readonly [number, number],
  forward: boolean,
): number[] => {
  const gap = config().FRAME_GAP_MIN_M;
  const widths = items.map(a => a.size.outer.w);
  const run = widths.reduce((s, w) => s + w, 0) + gap * (items.length - 1);
  const per = Math.max(0, span[1] - span[0] - run) / (items.length + 1);
  // 작은 좌표부터 놓을 순서(걷는 방향이 음수면 뒤집어서)
  const order = forward ? widths : [...widths].reverse();
  const centers: number[] = [];
  let pos = span[0] + per;
  for (const w of order) {
    centers.push(pos + w / 2);
    pos += w + gap + per;
  }
  return forward ? centers : centers.reverse();
};

/** 관 계획 → 걷는 순서대로 액자 자리 */
export const placeFrames = (plan: PartPlan): WallSlot[] => {
  const out: WallSlot[] = [];
  for (const side of WALK_ORDER) {
    const items = plan.walls[side];
    if (items.length === 0) continue;
    const g = wallGeometry(side, plan.width, plan.depth);
    const forward = g.walk[0] + g.walk[1] > 0;
    const centers = distribute(items, g.span, forward);
    items.forEach((item, i) => {
      out.push({
        side,
        item,
        pos: g.at(centers[i]!),
        height: frameHeight(item.size.outer.h),
        normal: g.normal,
        walk: g.walk,
      });
    });
  }
  return out;
};
