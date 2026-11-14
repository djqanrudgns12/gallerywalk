import { config } from '../../../config.ts';
import type { PartSize, WallSide } from '../../../types/layout.ts';
import { easelForm } from '../artworkSize.ts';
import { assignWalls, type SizedItem, type WallPlan } from '../roomSizing.ts';

/**
 * 공간 v4 관 계획(ADR-071, PRD_V2 §5.2). 논리 좌표는 v3와 같다: x는 L(0) → R(W, 홀을 따라), y는 N(0, 홀 쪽) → F(D).
 *
 * ```
 *   F ┌──────────────────────────┐
 *     │                          │
 *   L │ ◀ 방 사이 문(이전 관)      │ R  ▶ 방 사이 문(다음 관)
 *     │                          │
 *   N └─ 소개 벽 ─┤ 포털 ├─ 작품 ──┘   (홀)
 * ```
 * - 작품은 걷는 순서 L(N → F) → F(L → R) → R(F → N) → N 오른쪽 조각(R 끝 → 포털)에 놓는다. N 왼쪽 조각은 소개 벽이다.
 * - 방 사이 문은 L·R 벽의 N 쪽(`enfilade.fromN`부터 `enfilade.w`)에 있다. 계획할 때는 이웃이 있든 없든 문이 있다고 보고
 *   크기를 정한다(관 수가 나눔에 달려 있어 미리 알 수 없다). 지을 때 문이 없는 벽은 작품 구간이 그만큼 넓어진다.
 * - 크기는 작품 수로 S·M·L을 고르고 `LAYOUT_V4.room` 최소 크기 이상. 어느 벽이든 넘치면 한 단계 올리고, L에서도 넘치면 null(둘로 나눔).
 */

export interface RoomPlanV4 {
  readonly size: PartSize;
  readonly walls: WallPlan;
  /** 순서 끝의 이젤 작품(방 가운데 섬) */
  readonly easels: readonly SizedItem[];
  /** 논리 폭 W(4m 배수)·깊이 D(2m 배수) */
  readonly width: number;
  readonly depth: number;
}

const SIZES: readonly PartSize[] = ['S', 'M', 'L'];

const ceilTo = (v: number, u: number): number => Math.ceil(v / u - 1e-9) * u;

export const initialSizeV4 = (n: number): PartSize => {
  const v = config().LAYOUT_V4;
  return n <= v.sizeSMax ? 'S' : n <= v.sizeMMax ? 'M' : 'L';
};

/** 작품 줄 길이 = Σ바깥 폭 + v4 최소 여백 × (개수 − 1) */
export const runLengthV4 = (items: readonly SizedItem[]): number =>
  items.length === 0
    ? 0
    : items.reduce((s, a) => s + a.size.outer.w, 0) + config().LAYOUT_V4.frameGapMin * (items.length - 1);

/** 옆벽(L·R)에서 작품을 놓지 못하는 N 쪽 길이(방 사이 문 + 문 옆 여백) */
export const sideDoorReserve = (): number => {
  const v = config().LAYOUT_V4;
  return v.enfilade.fromN + v.enfilade.w + v.doorMargin;
};

/**
 * 벽마다 그 작품들을 놓는 데 필요한 방 치수(F·N은 폭 W, L·R은 깊이 D). 작품이 없으면 0.
 * N은 오른쪽 조각만 쓰므로 W ≥ 2 × (줄 + 문 옆 여백 + 모서리 여백) + 포털.
 */
export const dimNeed = (side: WallSide, items: readonly SizedItem[]): number => {
  if (items.length === 0) return 0;
  const v = config().LAYOUT_V4;
  const run = runLengthV4(items);
  switch (side) {
    case 'F':
      return run + 2 * v.cornerMargin;
    case 'N':
      return 2 * (run + v.doorMargin + v.cornerMargin) + v.portal.w;
    case 'L':
    case 'R':
      return run + sideDoorReserve() + v.cornerMargin;
  }
};

/** 순서 끝의 작품 중 이젤에 놓을 것: 크기별 수까지, 끝에서부터 연속으로 이젤에 맞는 형태이고 대표작 뒤인 것만 */
const easelSplitV4 = (
  size: PartSize,
  items: readonly SizedItem[],
  featured: number,
): { wall: SizedItem[]; easel: SizedItem[] } => {
  const c = config();
  if (items.length < c.EASEL_MIN_ITEMS) return { wall: [...items], easel: [] };
  let k = 0;
  while (k < c.LAYOUT_V4.easels[size]) {
    const i = items.length - 1 - k;
    if (i <= featured || !easelForm(items[i]!.form)) break;
    k++;
  }
  return { wall: items.slice(0, items.length - k), easel: items.slice(items.length - k) };
};

const withDims = (size: PartSize, walls: WallPlan, easels: readonly SizedItem[]): RoomPlanV4 | null => {
  const c = config();
  const v = c.LAYOUT_V4;
  const min = v.room[size];
  const width = ceilTo(Math.max(min.w, dimNeed('F', walls.F), dimNeed('N', walls.N)), 2 * c.MODULE_UNIT_M);
  const depth = ceilTo(
    Math.max(
      min.d,
      dimNeed('L', walls.L),
      dimNeed('R', walls.R),
      easels.length > 0 ? c.EASEL_ROOM_MIN_D_M : 0,
    ),
    c.MODULE_UNIT_M,
  );
  if (width > v.roomMaxW + 1e-9 || depth > v.roomMaxD + 1e-9) return null;
  return { size, walls, easels, width, depth };
};

/** 관 하나의 v4 계획(넘치면 크기를 올리고, L에서도 넘치면 null) */
export const planRoomV4 = (items: readonly SizedItem[], featured: number): RoomPlanV4 | null => {
  if (items.length > 0 && items.every(a => a.form === 'SOUND')) {
    const plan = withDims('S', { L: items, F: [], R: [], N: [] }, []);
    if (plan) return plan;
  }
  for (let s = SIZES.indexOf(initialSizeV4(items.length)); s < SIZES.length; s++) {
    const size = SIZES[s]!;
    const { wall, easel } = easelSplitV4(size, items, featured);
    const plan = withDims(size, assignWalls(size, wall, featured), easel);
    if (plan) return plan;
  }
  return null;
};
