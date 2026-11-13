import { config } from '../../../config.ts';
import type { Fixture, FramePlacement, LayoutModule, Part, WallSide } from '../../../types/layout.ts';
import type { TemplateGeometry } from '../../templates/geometry.ts';
import type { TemplateGeometryV4 } from '../../templates/geometryV4.ts';
import { easelSize } from '../artworkSize.ts';
import {
  add,
  dirToWorld,
  type Frame2,
  length,
  mul,
  type P2,
  type Rect,
  rectOf,
  sub,
  toWorld,
  unit,
  wallRun,
} from '../geom.ts';
import { cornerIn, fillWall, single, tiles } from '../modules.ts';
import { type DoorPoints, facing, type P3, type StopAnchor } from '../part.ts';
import type { SizedItem } from '../roomSizing.ts';
import { frameHeight } from '../wallPlacement.ts';
import type { RoomPlanV4 } from './plan.ts';
import { sideDoorReserve } from './plan.ts';

/**
 * v4 관 하나를 세계 좌표로 짓는다(ADR-071). 벽 높이 `LAYOUT_V4.roomHeight`, N 벽 가운데 포털, L·R 벽 N 쪽에 방 사이 문.
 * 논리 → 세계는 관의 `frame`. 같은 날개의 다음 관은 이 관의 frame을 ax 쪽으로 (W + roomGap)만큼 옮긴 자리에 있다.
 */

export interface DecorSlotDraft {
  readonly kind: 'fountain' | 'sculpture' | 'bust' | 'planter' | 'topiary' | 'urn' | 'desk' | 'pendant';
  readonly pos: P3;
  readonly rotY: number;
  /** 구역 id(관이면 partId) */
  readonly zone: string;
}

export interface SignDraft {
  readonly kind: 'frieze' | 'banner' | 'portalLettering' | 'blade' | 'totem' | 'introWall' | 'exit';
  /** 무엇을 보이는가: 관 ID(소개 벽·포털 레터링·돌출 사인) · null(전시 이름·출구) */
  readonly ref: string | null;
  readonly zone: string;
  readonly pos: P3;
  readonly rotY: number;
  readonly w: number;
  readonly h: number;
}

export interface BuiltRoomV4 {
  readonly part: Part;
  readonly modules: LayoutModule[];
  readonly frames: FramePlacement[];
  readonly labels: { artworkId: string; pos: P3; normal: P2 }[];
  readonly fixtures: Fixture[];
  readonly decor: DecorSlotDraft[];
  readonly signs: SignDraft[];
  readonly intro: StopAnchor;
  readonly artworkStops: { artworkId: string; anchor: StopAnchor }[];
  /** 홀 쪽 포털(안쪽 · 벽 두께 가운데 · 홀 쪽) */
  readonly portal: DoorPoints;
  /** 방 사이 문: 들어오는 문(L 벽) · 나가는 문(R 벽). 바깥 점은 이웃 관 안쪽 */
  readonly doorPrev: DoorPoints | null;
  readonly doorNext: DoorPoints | null;
  /** 방 사이 통로의 걸을 수 있는 사각형(나가는 문 쪽만 — 이웃 관과 겹침) */
  readonly passage: Rect | null;
  /** 관 안 도슨트가 설 자리(포털 옆, 방 안쪽을 봄) */
  readonly npc: { readonly pos: P3; readonly yaw: number };
}

export interface RoomArgsV4 {
  readonly partId: string;
  readonly roomId: string;
  readonly partIndex: number;
  readonly partCount: number;
  readonly plan: RoomPlanV4;
  readonly frame: Frame2;
  readonly featuredIds: ReadonlySet<string>;
  readonly prev: boolean;
  readonly next: boolean;
  readonly g: TemplateGeometryV4;
}

interface SlotV4 {
  readonly side: WallSide;
  readonly item: SizedItem;
  readonly pos: P2;
  readonly height: number;
  readonly normal: P2;
  readonly walk: P2;
}

const LOGICAL_NORMAL: Readonly<Record<WallSide, P2>> = { L: [1, 0], F: [0, -1], R: [-1, 0], N: [0, 1] };

/** 벽 하나의 작품 구간(논리 벽 방향 좌표, 작은 쪽 → 큰 쪽)과 걷는 방향 */
const spanOf = (
  side: WallSide,
  W: number,
  D: number,
  doors: { prev: boolean; next: boolean },
): { at: (a: number) => P2; span: readonly [number, number]; walk: P2 } => {
  const v = config().LAYOUT_V4;
  const corner = v.cornerMargin;
  const reserve = sideDoorReserve();
  switch (side) {
    case 'L':
      return { at: a => [0, a], span: [doors.prev ? reserve : corner, D - corner], walk: [0, 1] };
    case 'F':
      return { at: a => [a, D], span: [corner, W - corner], walk: [1, 0] };
    case 'R':
      return { at: a => [W, a], span: [doors.next ? reserve : corner, D - corner], walk: [0, -1] };
    case 'N':
      return { at: a => [a, 0], span: [(W + v.portal.w) / 2 + v.doorMargin, W - corner], walk: [-1, 0] };
  }
};

/** 걷는 순서의 작품들을 구간에 고르게(v4 여백) — 남는 길이를 작품 사이·양끝에 같게 나눠 가운데 정렬 */
const distributeV4 = (
  items: readonly SizedItem[],
  span: readonly [number, number],
  forward: boolean,
): number[] => {
  const gap = config().LAYOUT_V4.frameGapMin;
  const widths = items.map(a => a.size.outer.w);
  const run = widths.reduce((s, w) => s + w, 0) + gap * (items.length - 1);
  const per = Math.max(0, span[1] - span[0] - run) / (items.length + 1);
  const order = forward ? widths : [...widths].reverse();
  const centers: number[] = [];
  let pos = span[0] + per;
  for (const w of order) {
    centers.push(pos + w / 2);
    pos += w + gap + per;
  }
  return forward ? centers : centers.reverse();
};

const placeFramesV4 = (plan: RoomPlanV4, doors: { prev: boolean; next: boolean }): SlotV4[] => {
  const out: SlotV4[] = [];
  for (const side of ['L', 'F', 'R', 'N'] as const) {
    const items = plan.walls[side];
    if (items.length === 0) continue;
    const s = spanOf(side, plan.width, plan.depth, doors);
    const forward = s.walk[0] + s.walk[1] > 0;
    const centers = distributeV4(items, s.span, forward);
    items.forEach((item, i) => {
      out.push({
        side,
        item,
        pos: s.at(centers[i]!),
        height: frameHeight(item.size.outer.h),
        normal: LOGICAL_NORMAL[side],
        walk: s.walk,
      });
    });
  }
  return out;
};

/** 조각 놓기 도우미(`modules.ts`)가 읽는 이름만 v4 전시실 조각으로 바꾼 템플릿 */
const roomKit = (g: TemplateGeometryV4): TemplateGeometry => ({
  ...g.base,
  modules: {
    ...g.base.modules,
    wall4: g.modules.roomWall4,
    wall2: g.modules.roomWall2,
    cornerIn: g.modules.roomCornerIn,
  },
});

export const buildRoomV4 = (a: RoomArgsV4): BuiltRoomV4 => {
  const c = config();
  const v = c.LAYOUT_V4;
  const kit = roomKit(a.g);
  const { width: W, depth: D } = a.plan;
  const f = a.frame;
  const T = c.WALL_THICKNESS_M;
  const w = (x: number, y: number): P2 => toWorld(f, x, y);
  const n = (dx: number, dy: number): P2 => dirToWorld(f, dx, dy);
  const modules: LayoutModule[] = [];
  const doors = { prev: a.prev, next: a.next };

  // ── 벽 ──────────────────────────────────────────────────
  // 옆벽(L·R)은 N 쪽 `fromN`부터 문 조각 한 칸. 나가는 R 벽은 통로 두께 면이 있는 문, 들어오는 L 벽은 문틀만(겹쳐 깜빡이지 않게)
  const e = v.enfilade;
  const half = (W - v.portal.w) / 2;
  const walls: Part['walls'] = [];
  const seg = (side: WallSide, a0: P2, a1: P2) => {
    const ln = LOGICAL_NORMAL[side];
    return wallRun(w(a0[0], a0[1]), w(a1[0], a1[1]), n(ln[0], ln[1]));
  };
  const sides: { side: WallSide; a: P2; b: P2 }[] = [
    { side: 'L', a: [0, 0], b: [0, D] },
    { side: 'F', a: [0, D], b: [W, D] },
    { side: 'R', a: [W, D], b: [W, 0] },
    { side: 'N', a: [W, 0], b: [0, 0] },
  ];
  for (const s of sides) {
    const ln = LOGICAL_NORMAL[s.side];
    walls.push({ side: s.side, start: w(s.a[0], s.a[1]), end: w(s.b[0], s.b[1]), normal: n(ln[0], ln[1]) });
    cornerIn(modules, seg(s.side, s.a, s.b), kit, a.partId);
  }
  // L
  if (a.prev) {
    fillWall(modules, seg('L', [0, 0], [0, e.fromN]), kit, a.partId);
    single(modules, seg('L', [0, e.fromN], [0, e.fromN + e.w]), a.g.modules.enfiladeFrame, a.partId);
    fillWall(modules, seg('L', [0, e.fromN + e.w], [0, D]), kit, a.partId);
  } else fillWall(modules, seg('L', [0, 0], [0, D]), kit, a.partId);
  // F
  fillWall(modules, seg('F', [0, D], [W, D]), kit, a.partId);
  // R
  if (a.next) {
    fillWall(modules, seg('R', [W, D], [W, e.fromN + e.w]), kit, a.partId);
    single(modules, seg('R', [W, e.fromN + e.w], [W, e.fromN]), a.g.modules.enfiladeDoor, a.partId);
    fillWall(modules, seg('R', [W, e.fromN], [W, 0]), kit, a.partId);
  } else fillWall(modules, seg('R', [W, D], [W, 0]), kit, a.partId);
  // N: 오른쪽 조각 · 포털 · 소개 벽(왼쪽 조각)
  fillWall(modules, seg('N', [W, 0], [W - half, 0]), kit, a.partId);
  single(modules, seg('N', [W - half, 0], [half, 0]), a.g.modules.roomPortal, a.partId);
  fillWall(modules, seg('N', [half, 0], [0, 0]), kit, a.partId);
  const bounds = rectOf(w(0, 0), w(W, D));
  tiles(modules, bounds, a.g.modules.roomFloor, a.partId, kit.tileM);
  tiles(modules, bounds, a.g.modules.roomCeiling, a.partId, kit.tileM);

  // ── 이젤(가운데 섬) ─────────────────────────────────────────
  const easelY = D * c.EASEL_DEPTH_RATIO;
  const easels = a.plan.easels;
  const easelXs = easels.map((_, i) => W / 2 + (i - (easels.length - 1) / 2) * c.EASEL_SPACING_M);

  // ── 액자·명판 ─────────────────────────────────────────────
  const frames: FramePlacement[] = [];
  const labels: BuiltRoomV4['labels'] = [];
  const artworkStops: BuiltRoomV4['artworkStops'] = [];
  for (const s of placeFramesV4(a.plan, doors)) {
    const center = w(s.pos[0], s.pos[1]);
    const normal = n(s.normal[0], s.normal[1]);
    const size = s.item.size;
    frames.push({
      artworkId: s.item.id,
      partId: a.partId,
      mount: 'WALL',
      wall: s.side,
      center: [center[0], s.height, center[1]],
      normal,
      art: size.art,
      mat: { w: size.mat },
      outer: size.outer,
      featured: a.featuredIds.has(s.item.id),
    });
    if (s.item.form !== 'SOUND') {
      const back = sub(s.pos, mul(s.walk, size.outer.w / 2 + c.LABEL_OFFSET_M));
      const lp = w(back[0], back[1]);
      labels.push({ artworkId: s.item.id, pos: [lp[0], c.LABEL_HEIGHT_M, lp[1]], normal });
    }
    const across = s.side === 'L' || s.side === 'R' ? W : D;
    artworkStops.push({
      artworkId: s.item.id,
      anchor: {
        target: [center[0], s.height, center[1]],
        normal,
        outer: size.outer,
        maxDistance: across - c.CAMERA_WALL_CLEARANCE_M,
        floorY: 0,
      },
    });
  }

  // ── 설비·장식 ─────────────────────────────────────────────
  const fixtures: Fixture[] = [];
  const decor: DecorSlotDraft[] = [];
  const fixtureAt = (kind: Fixture['kind'], p: P2, y: number, face: P2, ref?: string): void => {
    const wp = w(p[0], p[1]);
    const out: Fixture = {
      kind,
      partId: a.partId,
      pos: [wp[0], y, wp[1]],
      rotY: facing(n(face[0], face[1])),
    };
    fixtures.push(ref === undefined ? out : { ...out, ref });
  };
  const decorAt = (kind: DecorSlotDraft['kind'], p: P2, face: P2, y = 0): void => {
    const wp = w(p[0], p[1]);
    decor.push({ kind, pos: [wp[0], y, wp[1]], rotY: facing(n(face[0], face[1])), zone: a.partId });
  };
  easels.forEach((item, i) => {
    const ex = easelXs[i]!;
    const size = easelSize(item.size, a.g.base.frameBorderM);
    const base = w(ex, easelY);
    const normal = n(0, -1);
    const center: P3 = [base[0], c.EASEL_LEDGE_Y_M + size.outer.h / 2, base[1]];
    frames.push({
      artworkId: item.id,
      partId: a.partId,
      mount: 'EASEL',
      wall: null,
      center,
      normal,
      art: size.art,
      mat: { w: size.mat },
      outer: size.outer,
      featured: false,
    });
    const lp = w(ex, easelY - a.g.base.fixtures.easelLabelOutM);
    labels.push({
      artworkId: item.id,
      pos: [lp[0], c.EASEL_LEDGE_Y_M - a.g.base.fixtures.easelLabelDropM, lp[1]],
      normal,
    });
    fixtureAt('easel', [ex, easelY], 0, [0, -1], item.id);
    artworkStops.push({
      artworkId: item.id,
      anchor: {
        target: center,
        normal,
        outer: size.outer,
        maxDistance: easelY - c.CAMERA_WALL_CLEARANCE_M,
        floorY: 0,
      },
    });
  });
  // 가운데 섬(루이지애나식 쉬어 가는 박자): 낮은 벤치만 축 위에 — 포털에서 대표작을 보는 시선을 가리지 않게.
  // 이젤이 있으면 이젤 뒤. 조형은 N 오른쪽 조각(작품이 없을 때) 앞에 두어 돌아설 때 보인다(소개 벽 맞은편)
  if (easels.length > 0)
    fixtureAt('bench', [W / 2, Math.min(easelY + c.EASEL_BENCH_GAP_M, D - 2)], 0, [0, 1]);
  else fixtureAt('bench', [W / 2, D * 0.6], 0, [0, 1]);
  if (a.plan.size !== 'S' && a.plan.walls.N.length === 0) decorAt('sculpture', [W - half / 2, 1.4], [0, 1]);
  // 소개 벽(N 왼쪽 조각 한가운데): 옛 소개판 설비도 함께 두어 지금 그리는 쪽이 그대로 보인다
  const introX = half / 2;
  const introW = Math.min(v.introWall.w, half - 2 * v.doorMargin);
  const introP = w(introX, a.g.base.fixtures.wallOffsetM);
  const inward = n(0, 1);
  fixtureAt('introPanel', [introX, a.g.base.fixtures.wallOffsetM], c.EYE_HEIGHT_M, [0, 1]);
  const signs: SignDraft[] = [
    {
      kind: 'introWall',
      ref: a.partId,
      zone: a.partId,
      pos: [introP[0], v.introWall.y, introP[1]],
      rotY: facing(inward),
      w: introW,
      h: v.introWall.h,
    },
  ];

  // ── 소개 정지 지점: 들어오는 문 안쪽에서 대표 벽 한가운데를 본다 ─────────
  // 이전 관에서 방 사이 문으로 들어오면 그 문 안쪽(소개 벽 바로 옆), 홀에서 들어오면 포털 안쪽 — 되돌아 걷지 않게
  const e0 = v.enfilade;
  const cam = a.prev ? w(c.DOOR_PATH_OFFSET_M, e0.fromN + e0.w / 2) : w(W / 2, c.INTRO_STOP_INSIDE_M);
  const fCenter = w(W / 2, D);
  const toCam = sub(cam, fCenter);
  const intro: StopAnchor = {
    target: [fCenter[0], c.EYE_HEIGHT_M + a.g.base.stops.introTargetLiftM, fCenter[1]],
    normal: unit(toCam),
    outer: { w: W - 2 * v.cornerMargin, h: v.roomHeight * a.g.base.stops.introOuterHeightRatio },
    maxDistance: length(toCam),
    floorY: 0,
  };

  // ── 문 ───────────────────────────────────────────────────
  const off = c.DOOR_PATH_OFFSET_M;
  const portal: DoorPoints = { inner: w(W / 2, off), center: w(W / 2, -T / 2), outer: w(W / 2, -T - off) };
  const yd = e.fromN + e.w / 2;
  const gap = v.roomGap;
  const doorNext: DoorPoints | null = a.next
    ? { inner: w(W - off, yd), center: w(W + gap / 2, yd), outer: w(W + gap + off, yd) }
    : null;
  const doorPrev: DoorPoints | null = a.prev
    ? { inner: w(off, yd), center: w(-gap / 2, yd), outer: w(-gap - off, yd) }
    : null;
  const m = c.WALKABLE_WALL_MARGIN_M;
  const reach = m + 0.05;
  const halfClear = e.clear / 2 - m;
  const passage = a.next ? rectOf(w(W - reach, yd - halfClear), w(W + gap + reach, yd + halfClear)) : null;
  const along = n(1, 0);
  const part: Part = {
    partId: a.partId,
    roomId: a.roomId,
    partIndex: a.partIndex,
    partCount: a.partCount,
    size: a.plan.size,
    width: W,
    depth: D,
    frame: { origin: f.origin, ax: f.ax, ay: f.ay },
    bounds: { min: bounds.min, max: bounds.max },
    doors: [
      { kind: 'IN', center: [portal.center[0], 0, portal.center[1]], normal: inward, width: v.portal.clear },
      ...(doorPrev
        ? [
            {
              kind: 'IN' as const,
              center: [doorPrev.center[0], 0, doorPrev.center[1]] as P3,
              normal: along,
              width: e.clear,
            },
          ]
        : []),
      ...(doorNext
        ? [
            {
              kind: 'OUT' as const,
              center: [doorNext.center[0], 0, doorNext.center[1]] as P3,
              normal: mul(along, -1),
              width: e.clear,
            },
          ]
        : []),
    ],
    walls,
  };

  // ── 관 안 도슨트 자리: 포털 옆(작품이 없는 쪽), 벽에서 `npcWallM` 앞, 방 안쪽을 본다 ──
  const npcX = a.plan.walls.N.length > 0 ? half - 0.9 : W - half + 0.9;
  const npcP = w(npcX, v.npcWallM + 0.3);
  const npc = { pos: [npcP[0], 0, npcP[1]] as P3, yaw: facing(n(0, 1)) };

  return {
    part,
    modules,
    frames,
    labels,
    fixtures,
    decor,
    signs,
    intro,
    artworkStops,
    portal,
    doorPrev,
    doorNext,
    passage,
    npc,
  };
};

/** 관 frame을 ax 쪽으로 옮긴 것(같은 날개 다음 관) */
export const shiftFrame = (f: Frame2, d: number): Frame2 => ({ ...f, origin: add(f.origin, mul(f.ax, d)) });
