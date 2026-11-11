import { config } from '../../config.ts';
import type { Fixture, FramePlacement, LayoutModule, Part, WallSide } from '../../types/layout.ts';
import type { TemplateGeometry } from '../templates/geometry.ts';
import {
  add,
  dirToWorld,
  type Frame2,
  length,
  mul,
  type P2,
  rectOf,
  sub,
  toWorld,
  unit,
  wallRun,
} from './geom.ts';
import { easelSize } from './artworkSize.ts';
import { cornerIn, fillWall, single, tiles } from './modules.ts';
import type { PartPlan } from './roomSizing.ts';
import { placeFrames, WALK_ORDER, wallGeometry } from './wallPlacement.ts';

/**
 * 관 하나를 세계 좌표로 짓는다(PLAN §4.4~§4.7): 조각·액자·명판·설비·정지 지점 자리·문 경로점.
 * 논리 → 세계는 관의 `frame`(회랑 왼쪽 관은 거울상). 조각 자체는 거울로 뒤집지 않고 늘 방 안쪽을 보게 놓는다.
 */

export type P3 = [number, number, number];

export interface StopAnchor {
  readonly target: P3;
  readonly normal: P2;
  readonly outer: { readonly w: number; readonly h: number };
  readonly maxDistance: number;
  readonly floorY: number;
}

export interface DoorPoints {
  /** 방 안쪽 · 벽 두께 가운데 · 회랑 쪽(바닥 평면) */
  readonly inner: P2;
  readonly center: P2;
  readonly outer: P2;
}

export interface BuiltPart {
  readonly part: Part;
  readonly modules: LayoutModule[];
  readonly frames: FramePlacement[];
  readonly labels: { artworkId: string; pos: P3; normal: P2 }[];
  readonly fixtures: Fixture[];
  readonly intro: StopAnchor;
  /** 걷는 순서의 작품 정지 지점 */
  readonly artworkStops: { artworkId: string; anchor: StopAnchor }[];
  readonly doorIn: DoorPoints;
  readonly doorOut: DoorPoints;
}

export interface PartArgs {
  readonly partId: string;
  readonly roomId: string;
  readonly partIndex: number;
  readonly partCount: number;
  readonly plan: PartPlan;
  readonly frame: Frame2;
  readonly featuredIds: ReadonlySet<string>;
  readonly geometry: TemplateGeometry;
}

/** 설비의 앞(지역 +Z)이 n을 보게 하는 회전 */
export const facing = (n: P2): number => {
  const r = Math.atan2(n[0], n[1]);
  return Object.is(r, -0) ? 0 : r;
};

const LOGICAL_NORMAL: Readonly<Record<WallSide, P2>> = { L: [1, 0], F: [0, -1], R: [-1, 0], N: [0, 1] };

export const buildPart = (a: PartArgs): BuiltPart => {
  const c = config();
  const g = a.geometry;
  const { width: W, depth: D } = a.plan;
  const f = a.frame;
  const w = (x: number, y: number): P2 => toWorld(f, x, y);
  const n = (dx: number, dy: number): P2 => dirToWorld(f, dx, dy);
  const modules: LayoutModule[] = [];

  // ── 벽·모서리 ─────────────────────────────────────────────
  const sides: { side: WallSide; a: P2; b: P2 }[] = [
    { side: 'L', a: [0, 0], b: [0, D] },
    { side: 'F', a: [0, D], b: [W, D] },
    { side: 'R', a: [W, D], b: [W, 0] },
    { side: 'N', a: [W, 0], b: [0, 0] },
  ];
  const walls: Part['walls'] = [];
  for (const s of sides) {
    const ln = LOGICAL_NORMAL[s.side];
    const interior = n(ln[0], ln[1]);
    const run = wallRun(w(s.a[0], s.a[1]), w(s.b[0], s.b[1]), interior);
    cornerIn(modules, run, g, a.partId);
    walls.push({ side: s.side, start: w(s.a[0], s.a[1]), end: w(s.b[0], s.b[1]), normal: interior });
    if (s.side !== 'N') {
      fillWall(modules, run, g, a.partId);
      continue;
    }
    // N: 들어가는 문(L 쪽 끝) · 가운데 벽 · 나오는 문(R 쪽 끝)
    const door = c.DOOR_WIDTH_M;
    const seg = (x0: number, x1: number) => wallRun(w(x0, 0), w(x1, 0), interior);
    single(modules, seg(0, door), g.modules.door, a.partId);
    fillWall(modules, seg(door, W - door), g, a.partId);
    single(modules, seg(W - door, W), g.modules.door, a.partId);
  }
  const bounds = rectOf(w(0, 0), w(W, D));
  tiles(modules, bounds, g.modules.floor, a.partId, g.tileM);
  tiles(modules, bounds, g.modules.ceiling, a.partId, g.tileM);

  // ── 이젤 자리(ADR-057): 방 가운데 줄 ─────────────────────────
  const easels = a.plan.easels;
  const easelY = D * c.EASEL_DEPTH_RATIO;
  const easelXs = easels.map((_, i) => W / 2 + (i - (easels.length - 1) / 2) * c.EASEL_SPACING_M);

  // ── 액자·명판 ─────────────────────────────────────────────
  const frames: FramePlacement[] = [];
  const labels: BuiltPart['labels'] = [];
  const artworkStops: BuiltPart['artworkStops'] = [];
  const slots = placeFrames(a.plan);
  for (const s of slots) {
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
    // 물러설 거리 = 맞은편 벽까지 − 여유(F·N 벽은 D, L·R 벽은 W, §4.7-1)
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

  // ── 설비: 빈 면 채우기(§4.4-6) + 크기별 벤치 + 이름판 ──────────
  const fixtures: Fixture[] = [];
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
  // ── 이젤(ADR-057): 방 가운데 줄, 앞 = 들어온 벽(N) 쪽. 걷는 순서의 끝(벽 작품 다음) ──
  easels.forEach((item, i) => {
    const ex = easelXs[i]!;
    const size = easelSize(item.size, g.frameBorderM);
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
    const lp = w(ex, easelY - g.fixtures.easelLabelOutM);
    labels.push({
      artworkId: item.id,
      pos: [lp[0], c.EASEL_LEDGE_Y_M - g.fixtures.easelLabelDropM, lp[1]],
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

  const empty = WALK_ORDER.filter(side => a.plan.walls[side].length === 0);
  const fills: Fixture['kind'][] = ['introPanel', 'bench', 'plant', 'plant'];
  let bench = false;
  empty.forEach((side, i) => {
    const kind = fills[i]!;
    // 이젤 앞(들어온 벽 쪽)은 이젤을 보는 자리라 벤치를 두지 않는다
    if (kind === 'bench' && side === 'N' && easels.length > 0) return;
    const geo = wallGeometry(side, W, D);
    const mid = geo.at((geo.extent[0] + geo.extent[1]) / 2);
    const inward = (d: number): P2 => add(mid, mul(geo.normal, d));
    if (kind === 'introPanel') fixtureAt(kind, inward(g.fixtures.wallOffsetM), c.EYE_HEIGHT_M, geo.normal);
    else if (kind === 'bench') {
      fixtureAt(kind, inward(g.fixtures.benchInwardM), 0, geo.normal);
      bench = true;
    } else fixtureAt(kind, inward(g.fixtures.plantInwardM), 0, geo.normal);
  });
  // 이젤이 있으면 가운데 벤치는 이젤 뒤(대표 벽 쪽)로 — 앉아서 대표 벽을 본다
  const behindEasel = Math.min(easelY + c.EASEL_BENCH_GAP_M, D - g.fixtures.benchInwardM);
  if (easels.length > 0) {
    if (!bench || a.plan.size === 'L') fixtureAt('bench', [W / 2, behindEasel], 0, [0, 1]);
  } else {
    if (a.plan.size === 'M' && !bench) fixtureAt('bench', [W / 2, g.fixtures.benchInwardM], 0, [0, 1]);
    if (a.plan.size === 'L') fixtureAt('bench', [W / 2, D / 2], 0, [0, 1]);
  }
  // 이름판: 대표 벽 한가운데 위 — 소개 정지 지점에서 대표작과 함께 보인다(ADR-053)
  const fTop = slots
    .filter(s => s.side === 'F')
    .reduce((top, s) => Math.max(top, s.height + s.item.size.outer.h / 2), 0);
  const np = g.fixtures.nameplate;
  const plateY = Math.min(c.WALL_HEIGHT_M - np.ceilingMarginM, Math.max(np.minY, fTop + np.gapAboveFramesM));
  fixtureAt('nameplate', [W / 2, D - g.fixtures.wallOffsetM], plateY, [0, -1], a.partId);

  // ── 소개 정지 지점: 들어가는 문 안쪽 1.2m에서 대표 벽 한가운데를 본다(§4.7) ──
  const doorMid = c.DOOR_WIDTH_M / 2;
  const cam = w(doorMid, c.INTRO_STOP_INSIDE_M);
  const fCenter = w(W / 2, D);
  const toCam = sub(cam, fCenter);
  const intro: StopAnchor = {
    target: [fCenter[0], c.EYE_HEIGHT_M + g.stops.introTargetLiftM, fCenter[1]],
    normal: unit(toCam),
    outer: { w: W - 2 * c.CORNER_MARGIN_M, h: c.WALL_HEIGHT_M * g.stops.introOuterHeightRatio },
    maxDistance: length(toCam),
    floorY: 0,
  };

  // ── 문 ───────────────────────────────────────────────────
  const T = c.WALL_THICKNESS_M;
  const doorPoints = (x: number): DoorPoints => ({
    inner: w(x, c.DOOR_PATH_OFFSET_M),
    center: w(x, -T / 2),
    outer: w(x, -T - c.DOOR_PATH_OFFSET_M),
  });
  const clear = c.DOOR_WIDTH_M - 2 * g.doorCasingM;
  const inward = n(0, 1);
  const doorIn = doorPoints(doorMid);
  const doorOut = doorPoints(W - doorMid);
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
      { kind: 'IN', center: [doorIn.center[0], 0, doorIn.center[1]], normal: inward, width: clear },
      { kind: 'OUT', center: [doorOut.center[0], 0, doorOut.center[1]], normal: inward, width: clear },
    ],
    walls,
  };
  return { part, modules, frames, labels, fixtures, intro, artworkStops, doorIn, doorOut };
};
