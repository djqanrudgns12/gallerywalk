import { config } from '../../config.ts';
import type { ArtworkForm } from '../../types/common.ts';
import type { PartSize, WallSide } from '../../types/layout.ts';
import { easelForm, type FrameSize } from './artworkSize.ts';

/**
 * 방 크기 고르기(PLAN §4.4). 논리 좌표: x는 L(0) → R(W), y는 N(0) → F(D). 들어가는 문은 N의 L 쪽 끝, 나오는 문은 R 쪽 끝.
 * 순서를 바꾸지 않는다: 대표작 앞 작품은 L, 뒤 작품은 크기별 자리(S: F 대표 오른쪽 / M: R / L: R 앞쪽 ⌈b/2⌉ + N 나머지).
 */

export interface SizedItem {
  readonly id: string;
  readonly form: ArtworkForm;
  /** 이 관에서 거는 크기(대표작이면 대표작 배율 적용) */
  readonly size: FrameSize;
}

export type WallPlan = Readonly<Record<WallSide, readonly SizedItem[]>>;

export interface PartPlan {
  readonly size: PartSize;
  readonly walls: WallPlan;
  /** 순서 끝의 이젤 작품(벽 크기 그대로 — 이젤 크기는 짓는 쪽에서, ADR-057) */
  readonly easels: readonly SizedItem[];
  /** 논리 폭 W(L → R)·깊이 D(N → F), 2m 단위 */
  readonly width: number;
  readonly depth: number;
}

const SIZES: readonly PartSize[] = ['S', 'M', 'L'];

export const initialSize = (n: number): PartSize => {
  const c = config();
  return n <= c.ROOM_SIZE_S_MAX ? 'S' : n <= c.ROOM_SIZE_M_MAX ? 'M' : 'L';
};

export const assignWalls = (size: PartSize, items: readonly SizedItem[], f: number): WallPlan => {
  const before = items.slice(0, f);
  const featured = items.slice(f, f + 1);
  const after = items.slice(f + 1);
  switch (size) {
    case 'S':
      return { L: before, F: [...featured, ...after], R: [], N: [] };
    case 'M':
      return { L: before, F: featured, R: after, N: [] };
    case 'L': {
      const k = Math.ceil(after.length / 2);
      return { L: before, F: featured, R: after.slice(0, k), N: after.slice(k) };
    }
  }
};

/** 작품 줄 길이 = Σ바깥 폭 + 최소 여백 × (개수 − 1) */
export const runLength = (items: readonly SizedItem[]): number =>
  items.length === 0
    ? 0
    : items.reduce((s, a) => s + a.size.outer.w, 0) + config().FRAME_GAP_MIN_M * (items.length - 1);

/**
 * 벽 필요 길이. N은 문이 양 끝(모서리)에 있어 모서리 여백 대신 문 2m + 문 옆 여백을 양쪽에 둔다(ADR-053).
 * 작품이 없는 벽은 0.
 */
export const wallNeed = (side: WallSide, items: readonly SizedItem[]): number => {
  if (items.length === 0) return 0;
  const c = config();
  const run = runLength(items);
  return side === 'N' ? run + 2 * (c.DOOR_WIDTH_M + c.DOOR_MARGIN_M) : run + 2 * c.CORNER_MARGIN_M;
};

const upToModule = (v: number): number => {
  const u = config().MODULE_UNIT_M;
  return Math.ceil(v / u - 1e-9) * u;
};

const fits = (walls: WallPlan): boolean =>
  (Object.keys(walls) as WallSide[]).every(
    side => wallNeed(side, walls[side]) <= config().WALL_MAX_LEN_M + 1e-9,
  );

/**
 * 순서 끝의 작품 중 이젤에 놓을 것(ADR-057): 관 작품이 `EASEL_MIN_ITEMS` 이상일 때 크기별 수까지,
 * 끝에서부터 연속으로 이젤에 맞는 형태이고 대표작 뒤인 것만. 순서는 그대로(벽 → 이젤).
 */
export const easelSplit = (
  size: PartSize,
  items: readonly SizedItem[],
  featured: number,
): { wall: SizedItem[]; easel: SizedItem[] } => {
  const c = config();
  if (items.length < c.EASEL_MIN_ITEMS) return { wall: [...items], easel: [] };
  let k = 0;
  while (k < c.EASEL_COUNT[size]) {
    const i = items.length - 1 - k;
    if (i <= featured || !easelForm(items[i]!.form)) break;
    k++;
  }
  return { wall: items.slice(0, items.length - k), easel: items.slice(items.length - k) };
};

const withDims = (size: PartSize, walls: WallPlan, easels: readonly SizedItem[] = []): PartPlan => {
  const c = config();
  let width = upToModule(Math.max(wallNeed('F', walls.F), wallNeed('N', walls.N), c.ROOM_MIN_W_M));
  const depth = upToModule(
    Math.max(
      wallNeed('L', walls.L),
      wallNeed('R', walls.R),
      c.ROOM_MIN_D_M,
      easels.length > 0 ? c.EASEL_ROOM_MIN_D_M : 0,
    ),
  );
  while (depth / width > c.ROOM_MAX_DW_RATIO + 1e-9) width += c.MODULE_UNIT_M;
  return { size, walls, easels, width, depth };
};

/**
 * 관 하나의 계획. 어느 벽이든 16m를 넘으면 S → M → L로 올려 다시. L에서도 넘으면 null(호출하는 쪽이 둘로 나눔).
 * 크기마다 이젤 작품을 먼저 떼고(`easelSplit`) 나머지를 벽에 나눈다.
 * 소리 작품만 있는 관은 S 크기에 L 벽 한 줄(넘치면 보통 규칙).
 */
export const planPart = (items: readonly SizedItem[], featured: number): PartPlan | null => {
  if (items.length > 0 && items.every(a => a.form === 'SOUND')) {
    const walls: WallPlan = { L: items, F: [], R: [], N: [] };
    if (fits(walls)) return withDims('S', walls);
  }
  for (let s = SIZES.indexOf(initialSize(items.length)); s < SIZES.length; s++) {
    const size = SIZES[s]!;
    const { wall, easel } = easelSplit(size, items, featured);
    const walls = assignWalls(size, wall, featured);
    if (fits(walls)) return withDims(size, walls, easel);
  }
  return null;
};
