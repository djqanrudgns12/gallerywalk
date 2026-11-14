import { config } from '../../../config.ts';
import type { Fixture, Layout, LayoutInput, LayoutModule, Stop, WalkArea } from '../../../types/layout.ts';
import type { TemplateGeometry } from '../../templates/geometry.ts';
import { templateGeometryV4, type TemplateGeometryV4 } from '../../templates/geometryV4.ts';
import { frameSize } from '../artworkSize.ts';
import { type Frame2, mm, type P2, type Rect, rectOf, rectPolygon, shrink, unit, wallRun } from '../geom.ts';
import { buildExterior } from '../grammar/exterior.ts';
import { layoutHash } from '../hash.ts';
import { cornerIn, fillWall, single, tiles } from '../modules.ts';
import { type DoorPoints, facing, type P3, type StopAnchor } from '../part.ts';
import type { SizedItem } from '../roomSizing.ts';
import { evenChunks, featuredIndex, type SplitItem } from '../split.ts';
import { planRoomV4, type RoomPlanV4 } from './plan.ts';
import { type BuiltRoomV4, buildRoomV4, type DecorSlotDraft, type SignDraft } from './room.ts';

/**
 * 배치 엔진 v4(ADR-071, PRD_V2 §5): 대문 → 광장 → 큰 계단 → 현관 → 정문 → **메인홀** → 서쪽 날개(정문 쪽 → 안쪽) →
 * 동쪽 날개(안쪽 → 정문 쪽) → 홀 → 대문. 순수 함수이고 결정적이다(입력 정렬, 1mm 반올림, 난수 없음).
 *
 * ```
 *  z ↑ (+Z = 건물 안쪽)
 *  L ┌──────────── 홀 끝 벽(조형 하이라이트) ────────────┐
 *    │ 서1 서2 서3 …  ║          메인홀           ║  … 동6 동5 동4 │  (방 N 벽이 홀 벽, 가운데 포털)
 *  0 └──────────────── 정문(홀 앞 벽 가운데) ───────────────┘
 *                         현관 · 계단 · 광장 · 대문
 * ```
 * 서쪽 관은 −X(frame ax = +Z, ay = −X), 동쪽 관은 +X(ax = −Z, ay = +X) — 두 날개 모두 걷는 순서가 같은 손잡이다.
 */

type Artwork = LayoutInput['artworks'][number];

const byOrderId = (a: { order: number; id: string }, b: { order: number; id: string }): number =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const ceilTo = (v: number, u: number): number => Math.ceil(v / u - 1e-9) * u;

/** 1mm 반올림(회전은 1e-4 rad) — v3 `computeLayout`과 같은 규칙 */
const roundDeep = <T>(value: T, key = ''): T => {
  if (typeof value === 'number') {
    const v = key === 'rotY' || key === 'yaw' ? Math.round(value * 1e4) / 1e4 : mm(value);
    return (Object.is(v, -0) ? 0 : v) as T;
  }
  if (Array.isArray(value)) return value.map(v => roundDeep(v, key)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = roundDeep(v, k);
    return out as T;
  }
  return value;
};

/** 반직선 o + t·d(t > 0)가 처음 들어가는 사각형까지의 t(시작점을 품은 사각형은 뺌) */
const rayEntry = (o: P2, d: P2, rects: readonly { min: P2; max: P2 }[]): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const r of rects) {
    if (o[0] >= r.min[0] && o[0] <= r.max[0] && o[1] >= r.min[1] && o[1] <= r.max[1]) continue;
    let t0 = 0;
    let t1 = Number.POSITIVE_INFINITY;
    let hit = true;
    for (const k of [0, 1] as const) {
      if (Math.abs(d[k]) < 1e-12) {
        if (o[k] < r.min[k] || o[k] > r.max[k]) hit = false;
        continue;
      }
      const a = (r.min[k] - o[k]) / d[k];
      const b = (r.max[k] - o[k]) / d[k];
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (hit && t0 <= t1 && t0 > 0) best = Math.min(best, t0);
  }
  return best;
};

/** 바닥 넓이(가로 w × 깊이 d, 앞 = 지역 +Z)를 회전(90° 배수)·여유만큼 넓힌 사각형 */
const footprintRect = (pos: P3, rotY: number, fp: { w: number; d: number }, pad: number): Rect => {
  const turned = Math.abs(Math.sin(rotY)) > 0.5;
  const hx = (turned ? fp.d : fp.w) / 2 + pad;
  const hz = (turned ? fp.w : fp.d) / 2 + pad;
  return rectOf([pos[0] - hx, pos[2] - hz], [pos[0] + hx, pos[2] + hz]);
};

interface PlannedRoom {
  readonly roomId: string;
  readonly plan: RoomPlanV4;
  readonly featuredId: string;
}

const planChunkV4 = (chunk: readonly Artwork[], roomId: string, border: number): PlannedRoom[] => {
  const splitItems: SplitItem[] = chunk.map(a => ({
    id: a.id,
    order: a.order,
    form: a.form,
    featured: a.featured,
    baseArea: (s => s.outer.w * s.outer.h)(frameSize(a, false, border)),
  }));
  const f = featuredIndex(splitItems);
  const sized: SizedItem[] = chunk.map((a, i) => ({
    id: a.id,
    form: a.form,
    size: frameSize(a, i === f, border),
  }));
  const plan = planRoomV4(sized, f);
  if (plan) return [{ roomId, plan, featuredId: chunk[f]!.id }];
  if (chunk.length <= 1) throw new Error('planChunkV4: 작품 하나가 가장 큰 관에도 들어가지 않음');
  return evenChunks(chunk, 2).flatMap(half => planChunkV4(half, roomId, border));
};

/** 조각 도우미가 읽는 이름만 홀 조각으로 바꾼 템플릿 */
const hallKit = (g: TemplateGeometryV4): TemplateGeometry => ({
  ...g.base,
  modules: {
    ...g.base.modules,
    wall4: g.modules.hallWall4,
    wall2: g.modules.hallWall2,
    cornerIn: g.modules.hallCornerIn,
  },
});

export const computeLayoutV4 = (input: LayoutInput): Layout => {
  const c = config();
  const v = c.LAYOUT_V4;
  const g = templateGeometryV4[input.templateId];
  const T = c.WALL_THICKNESS_M;
  const unitM = c.MODULE_UNIT_M;
  const rooms = [...input.rooms].sort(byOrderId);
  const artworks = [...input.artworks].sort(byOrderId);

  // ── 전시실 → 관(v4 상한 `splitAt`) ─────────────────────────────
  const planned: {
    roomId: string;
    partIndex: number;
    partCount: number;
    plan: RoomPlanV4;
    featuredId: string;
  }[] = [];
  for (const room of rooms) {
    const list = artworks.filter(a => a.roomId === room.id);
    if (list.length === 0) continue;
    const parts = evenChunks(list, Math.max(1, Math.ceil(list.length / v.splitAt))).flatMap(chunk =>
      planChunkV4(chunk, room.id, g.base.frameBorderM),
    );
    parts.forEach((p, i) => planned.push({ ...p, partIndex: i, partCount: parts.length }));
  }

  // ── 날개 나누기·놓기 ───────────────────────────────────────────
  const count = planned.length;
  const westCount = count <= 2 ? count : Math.ceil(count / 2);
  const hw = v.hall.w / 2;
  const face = hw + T;
  const runOf = (from: number, to: number): number =>
    planned.slice(from, to).reduce((s, p, i) => s + p.plan.width + (i > 0 ? v.roomGap : 0), 0);
  const westRun = runOf(0, westCount);
  const eastRun = runOf(westCount, count);
  const L = ceilTo(
    Math.max(v.hall.minLength, v.hall.front + Math.max(westRun, eastRun) + v.hall.back),
    unitM,
  );
  const frames: Frame2[] = [];
  let zw = v.hall.front;
  for (let i = 0; i < westCount; i++) {
    frames.push({ origin: [-face, zw], ax: [0, 1], ay: [-1, 0] });
    zw += planned[i]!.plan.width + v.roomGap;
  }
  // 동쪽 날개는 안쪽 끝을 서쪽 날개 안쪽 끝에 맞춘다 — 동쪽 첫 관이 서쪽 마지막 관 맞은편(홀을 가로질러 바로)
  let ze = v.hall.front + Math.max(westRun, eastRun);
  for (let i = westCount; i < count; i++) {
    frames.push({ origin: [face, ze], ax: [0, -1], ay: [1, 0] });
    ze -= planned[i]!.plan.width + v.roomGap;
  }
  const built: BuiltRoomV4[] = planned.map((p, i) => {
    const west = i < westCount;
    const first = west ? 0 : westCount;
    const last = west ? westCount - 1 : count - 1;
    return buildRoomV4({
      partId: `${p.roomId}:${p.partIndex}`,
      roomId: p.roomId,
      partIndex: p.partIndex,
      partCount: p.partCount,
      plan: p.plan,
      frame: frames[i]!,
      featuredIds: new Set([p.featuredId]),
      prev: i > first,
      next: i < last,
      g,
    });
  });

  // ── 메인홀 ─────────────────────────────────────────────────────
  const modules: LayoutModule[] = [];
  const kit = hallKit(g);
  const hallRect = rectOf([-hw, 0], [hw, L]);
  // 옆벽: 2m 칸, 관 포털 자리(4m)는 홀 쪽 포털 조각
  const portalCells = (side: 1 | -1): { z0: number; z1: number }[] =>
    built
      .filter(b => Math.sign(b.portal.center[0]) === side)
      .map(b => ({ z0: b.portal.center[1] - v.portal.w / 2, z1: b.portal.center[1] + v.portal.w / 2 }))
      .sort((a, b) => a.z0 - b.z0);
  for (const side of [-1, 1] as const) {
    const x = side * hw;
    const interior: P2 = [-side, 0];
    cornerIn(modules, wallRun([x, side === -1 ? L : 0], [x, side === -1 ? 0 : L], interior), kit, null);
    let z = 0;
    for (const cell of portalCells(side)) {
      if (cell.z0 > z + 1e-6) fillWall(modules, wallRun([x, z], [x, cell.z0], interior), kit, null);
      single(modules, wallRun([x, cell.z0], [x, cell.z1], interior), g.modules.hallPortal, null);
      z = cell.z1;
    }
    if (L > z + 1e-6) fillWall(modules, wallRun([x, z], [x, L], interior), kit, null);
  }
  // 앞 벽(정문) · 끝 벽
  const ent = v.hall.entrance / 2;
  cornerIn(modules, wallRun([-hw, 0], [hw, 0], [0, 1]), kit, null);
  fillWall(modules, wallRun([-hw, 0], [-ent, 0], [0, 1]), kit, null);
  single(modules, wallRun([-ent, 0], [ent, 0], [0, 1]), g.modules.hallEntrance, null);
  fillWall(modules, wallRun([ent, 0], [hw, 0], [0, 1]), kit, null);
  const back = wallRun([hw, L], [-hw, L], [0, -1]);
  cornerIn(modules, back, kit, null);
  fillWall(modules, back, kit, null);
  // 바닥·천장(축 가운데 4m 줄은 천창)
  tiles(modules, hallRect, g.modules.hallFloor, null, kit.tileM);
  tiles(modules, rectOf([-hw, 0], [-unitM, L]), g.modules.hallCeiling, null, kit.tileM);
  tiles(modules, rectOf([-unitM, 0], [unitM, L]), g.modules.hallSkylight, null, kit.tileM);
  tiles(modules, rectOf([unitM, 0], [hw, L]), g.modules.hallCeiling, null, kit.tileM);
  // 벽기둥: 옆벽 베이 리듬(포털 칸과 그 양옆 1m는 비움)
  for (const side of [-1, 1] as const) {
    const cells = portalCells(side);
    for (let z = v.bay; z < L - 1e-6; z += v.bay) {
      if (cells.some(cell => z > cell.z0 - unitM / 2 - 1e-6 && z < cell.z1 + unitM / 2 + 1e-6)) continue;
      modules.push({
        type: g.modules.hallPilaster,
        partId: null,
        pos: [side * hw, 0, z],
        rotY: facing([-side, 0]),
      });
    }
  }

  // ── 외관(v4 치수): 정문 벽 안쪽 면 z = 0 ─────────────────────────────
  const buildingHalfX = Math.max(
    hw,
    ...built.flatMap(b => [Math.abs(b.part.bounds.min[0]), Math.abs(b.part.bounds.max[0])]),
  );
  const ext = buildExterior(g.base, 0, buildingHalfX);
  const groundY = ext.exterior.groundY;
  const plaza = ext.exterior.plaza;
  const zf = ext.exterior.facadeZ;
  const e = g.base.exterior;
  const ph = e.porticoW / 2;
  const zPF = zf - e.porticoD;
  const zSB = zPF - e.steps * e.stepRunM;
  const zg = plaza.min[1] + v.gate.insetM;
  modules.push({ type: g.modules.gate, partId: null, pos: [0, groundY, zg], rotY: facing([0, 1]) });
  const m = c.WALKABLE_WALL_MARGIN_M;
  const spawn = { pos: [0, groundY, zg + v.gate.spawnInsideM] as P3, yaw: 0 };

  // ── 장식·안내판·도슨트 ─────────────────────────────────────────
  const decor: DecorSlotDraft[] = [...built.flatMap(b => b.decor)];
  const signs: SignDraft[] = [...built.flatMap(b => b.signs)];
  const fixtures: Fixture[] = [...ext.fixtures, ...built.flatMap(b => b.fixtures)];
  // 광장: 분수(축 위) · 계단 아래 양옆 화분 · 옆 벤치
  const fountainZ = zSB - Math.min(6, (zSB - zg) / 2);
  decor.push({ kind: 'fountain', pos: [0, groundY, fountainZ], rotY: 0, zone: 'plaza' });
  for (const s of [-1, 1] as const) {
    decor.push({ kind: 'planter', pos: [s * (ph + 1), groundY, zSB - 1], rotY: 0, zone: 'plaza' });
    for (const z of [zg + 6, fountainZ])
      fixtures.push({
        kind: 'bench',
        partId: null,
        pos: [s * (plaza.max[0] - 3), groundY, z],
        rotY: facing([-s, 0]),
      });
  }
  // 현관: 전시 이름 프리즈 · 정면 날개 벽 현수막 둘
  signs.push({
    kind: 'frieze',
    ref: null,
    zone: 'portico',
    pos: [0, e.signY, zPF - e.signOutM],
    rotY: facing([0, -1]),
    w: e.porticoW * 0.7,
    h: 1.2,
  });
  for (const s of [-1, 1] as const)
    signs.push({
      kind: 'banner',
      ref: null,
      zone: 'plaza',
      pos: [s * (ph + 3), groundY + 6, zf - 0.1],
      rotY: facing([0, -1]),
      w: 2.4,
      h: 6,
    });
  // 홀: 포털 위 레터링 · 포털 옆 돌출 사인(정문 쪽에서 걸어오며 보이게) · 섬(관 사이 틈 앞) · 끝 벽 조형 · 펜던트
  for (const b of built) {
    const px = b.portal.center[0];
    const pz = b.portal.center[1];
    const side = Math.sign(px);
    const wallX = side * hw;
    const into: P2 = [-side, 0];
    signs.push({
      kind: 'portalLettering',
      ref: b.part.partId,
      zone: 'hall',
      pos: [wallX - side * g.base.fixtures.wallOffsetM, v.portalLetteringY, pz],
      rotY: facing(into),
      w: v.portal.w + 1.6,
      h: 0.9,
    });
    signs.push({
      kind: 'blade',
      ref: b.part.partId,
      zone: 'hall',
      pos: [wallX - side * 0.7, v.bladeY, pz - v.portal.w / 2 - 0.6],
      rotY: facing([0, -1]),
      w: 1.2,
      h: 0.8,
    });
  }
  for (const side of [-1, 1] as const) {
    const cells = portalCells(side);
    for (let i = 0; i + 1 < cells.length; i++) {
      const z = (cells[i]!.z1 + cells[i + 1]!.z0) / 2;
      decor.push({
        kind: i % 2 === 0 ? 'sculpture' : 'bust',
        pos: [side * (hw - 4), 0, z],
        rotY: facing([-side, 0]),
        zone: 'hall',
      });
    }
  }
  decor.push({ kind: 'sculpture', pos: [0, 0, L - v.hall.back / 2], rotY: facing([0, -1]), zone: 'hall' });
  for (let z = v.hall.front + v.bay; z < L - v.hall.back / 2 - 1e-6; z += 2 * v.bay)
    decor.push({ kind: 'pendant', pos: [0, v.hall.h - c.DECOR.pendant.rodM, z], rotY: 0, zone: 'hall' });
  // 정문 안: 안내 데스크(+ 홀 도슨트) · 안내 토템 · 출구 레터링
  const deskP: P3 = [-(hw - 5), 0, v.hall.front / 2 + 1];
  decor.push({ kind: 'desk', pos: deskP, rotY: facing([1, 0]), zone: 'hall' });
  signs.push({
    kind: 'totem',
    ref: null,
    zone: 'hall',
    pos: [hw - 5, 0, v.hall.front / 2 + 1],
    rotY: facing([0, -1]),
    w: 1,
    h: 2.2,
  });
  signs.push({
    kind: 'exit',
    ref: null,
    zone: 'hall',
    pos: [0, 5.2, g.base.fixtures.wallOffsetM],
    rotY: facing([0, 1]),
    w: 3,
    h: 0.8,
  });
  signs.push({
    kind: 'exit',
    ref: null,
    zone: 'plaza',
    pos: [0, groundY + 3.4, zg],
    rotY: facing([0, 1]),
    w: 2.4,
    h: 0.6,
  });

  const npcSpots: NonNullable<Layout['npcSpots']> = [];
  npcSpots.push({
    id: 'docent-plaza',
    zone: 'plaza',
    pos: [v.npcPlazaSideM + 2, groundY, zg + v.gate.spawnInsideM + 4],
    yaw: facing(unit([-1, -0.6])),
  });
  npcSpots.push({ id: 'docent-hall', zone: 'hall', pos: [deskP[0] - 1.2, 0, deskP[2]], yaw: facing([1, 0]) });
  const roomDocent = built[Math.floor((westCount - 1) / 2)];
  if (roomDocent && westCount > 0)
    npcSpots.push({
      id: 'docent-room',
      zone: roomDocent.part.partId,
      pos: roomDocent.npc.pos,
      yaw: roomDocent.npc.yaw,
    });

  // ── 정지 지점(외관 → 홀 → 관마다 소개·작품 → 대문) ─────────────────
  const stops: Stop[] = [];
  const zone: string[] = [];
  const push = (s: Omit<Stop, 'anchor'> & { anchor: StopAnchor }, z: string): void => {
    stops.push(s);
    zone.push(z);
  };
  const plain = { partId: null, artworkId: null, index: null, count: null } as const;
  push({ id: 'exterior', kind: 'exterior', ...plain, anchor: ext.stop }, 'exterior');
  const hallCamZ = c.HALL_STOP_INSIDE_M + 1.5;
  push(
    {
      id: 'hall',
      kind: 'hall',
      ...plain,
      anchor: {
        target: [0, c.EYE_HEIGHT_M + 1.5, L / 2],
        normal: [0, -1],
        outer: { w: v.hall.w, h: v.hall.h * 0.8 },
        maxDistance: L / 2 - hallCamZ,
        floorY: 0,
      },
    },
    'hall',
  );
  for (const b of built) {
    const pid = b.part.partId;
    push(
      {
        id: `intro:${pid}`,
        kind: 'roomIntro',
        partId: pid,
        artworkId: null,
        index: null,
        count: null,
        anchor: b.intro,
      },
      pid,
    );
    b.artworkStops.forEach((s, i) =>
      push(
        {
          id: `art:${s.artworkId}`,
          kind: 'artwork',
          partId: pid,
          artworkId: s.artworkId,
          index: i + 1,
          count: b.artworkStops.length,
          anchor: s.anchor,
        },
        pid,
      ),
    );
  }
  push(
    {
      id: 'exit',
      kind: 'exit',
      ...plain,
      anchor: {
        target: [0, groundY + 2.2, zg],
        normal: [0, 1],
        outer: { w: v.gate.w * 2, h: 4 },
        maxDistance: Math.max(2, fountainZ - 3 - zg),
        floorY: groundY,
      },
    },
    'exit',
  );

  // ── 이동 경로점 ────────────────────────────────────────────────
  const y = c.CAMERA_HEIGHT_M;
  const at = (p: P2, yy: number): P3 => [p[0], yy, p[1]];
  const axis = (p: P2): P3 => [0, y, p[1]];
  const byPart = new Map(built.map(b => [b.part.partId, b]));
  const entranceDoor: DoorPoints = {
    inner: [0, c.DOOR_PATH_OFFSET_M],
    center: [0, -T / 2],
    outer: [0, -T - c.DOOR_PATH_OFFSET_M],
  };
  const outPortal = (d: DoorPoints): P3[] => [at(d.inner, y), at(d.center, y), at(d.outer, y), axis(d.outer)];
  const inPortal = (d: DoorPoints): P3[] => [axis(d.outer), at(d.outer, y), at(d.center, y), at(d.inner, y)];
  const toPlaza = (): P3[] => [
    axis(entranceDoor.inner),
    at(entranceDoor.center, y),
    at(entranceDoor.outer, y),
    ...[...ext.approach].reverse(),
    [0, groundY + y, zg + v.gate.spawnInsideM],
  ];
  const legs: Layout['legs'] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const za = zone[i]!;
    const zb = zone[i + 1]!;
    let waypoints: P3[] = [];
    if (za === 'exterior') {
      waypoints = [
        ...ext.approach,
        at(entranceDoor.outer, y),
        at(entranceDoor.center, y),
        at(entranceDoor.inner, y),
      ];
    } else if (za !== zb) {
      const from = byPart.get(za);
      const to = byPart.get(zb);
      if (from && to && from.doorNext && to.doorPrev) {
        // 같은 날개 이웃 관: 방 사이 문으로 곧장
        waypoints = [at(from.doorNext.inner, y), at(from.doorNext.center, y), at(to.doorPrev.inner, y)];
      } else {
        waypoints = [...(from ? outPortal(from.portal) : []), ...(to ? inPortal(to.portal) : [])];
        if (zb === 'exit') waypoints = [...waypoints, ...toPlaza()];
      }
      waypoints = waypoints.filter(
        (p, k) =>
          k === 0 || Math.abs(p[0] - waypoints[k - 1]![0]) + Math.abs(p[2] - waypoints[k - 1]![2]) > 1e-6,
      );
    }
    legs.push({ from: stops[i]!.id, to: stops[i + 1]!.id, waypoints });
  }

  // ── 지도 ───────────────────────────────────────────────────────
  const outline: P2[][] = [rectPolygon(hallRect)];
  const entranceMapDoor = { pos: entranceDoor.center, normal: [0, 1] as P2, width: v.portal.clear };
  const portalDoors = built.map(b => ({
    pos: b.portal.center,
    normal: unit([b.portal.inner[0] - b.portal.center[0], b.portal.inner[1] - b.portal.center[1]]),
    width: v.portal.clear,
  }));
  const passageDoors = built.flatMap(b =>
    b.doorNext
      ? [
          {
            pos: b.doorNext.center,
            normal: unit([
              b.doorNext.outer[0] - b.doorNext.inner[0],
              b.doorNext.outer[1] - b.doorNext.inner[1],
            ]),
            width: v.enfilade.clear,
          },
        ]
      : [],
  );
  const xs = [...outline.flat(), ...built.flatMap(b => [b.part.bounds.min, b.part.bounds.max])];
  const map: Layout['map'] = {
    outline,
    parts: built.map(b => ({
      partId: b.part.partId,
      polygon: rectPolygon({ min: b.part.bounds.min, max: b.part.bounds.max }),
      labelPos: [
        (b.part.bounds.min[0] + b.part.bounds.max[0]) / 2,
        (b.part.bounds.min[1] + b.part.bounds.max[1]) / 2,
      ],
    })),
    doors: [entranceMapDoor, ...portalDoors, ...passageDoors],
    bounds: {
      min: [Math.min(...xs.map(p => p[0])), Math.min(...xs.map(p => p[1]))],
      max: [Math.max(...xs.map(p => p[0])), Math.max(...xs.map(p => p[1]))],
    },
  };

  // ── 걸을 수 있는 곳 ────────────────────────────────────────────
  const doorRect = (d: { pos: P2; normal: P2; width: number }): Rect | null => {
    const along: P2 = [-d.normal[1], d.normal[0]];
    const halfW = d.width / 2 - m;
    if (halfW <= 0) return null;
    const reach = T / 2 + m + 0.05;
    return rectOf(
      [d.pos[0] + along[0] * halfW + d.normal[0] * reach, d.pos[1] + along[1] * halfW + d.normal[1] * reach],
      [d.pos[0] - along[0] * halfW - d.normal[0] * reach, d.pos[1] - along[1] * halfW - d.normal[1] * reach],
    );
  };
  const area = (r: Rect, ceiling: number): WalkArea => ({ min: r.min, max: r.max, y: 0, ceiling });
  const interior: WalkArea[] = [
    area(shrink(hallRect, m), v.hall.h),
    ...built.map(b => area(shrink({ min: b.part.bounds.min, max: b.part.bounds.max }, m), v.roomHeight)),
    ...[entranceMapDoor, ...portalDoors].flatMap(d => {
      const r = doorRect(d);
      return r ? [area(r, v.portal.h)] : [];
    }),
    ...built.flatMap(b => (b.passage ? [area(b.passage, v.enfilade.h)] : [])),
  ];
  const fp = v.decorFootprint;
  // 분수는 낮은 물받이라 카메라가 넘어 본다(외관 정지 지점이 분수 앞에 갇히지 않게)
  const decorObstacles = decor
    .filter(d => d.kind !== 'pendant')
    .map(d => ({
      ...footprintRect(d.pos, d.rotY, fp[d.kind as keyof typeof fp], m),
      tall: d.kind !== 'fountain',
    }));
  const totemObstacles = signs
    .filter(s => s.kind === 'totem')
    .map(s => ({ ...footprintRect(s.pos, s.rotY, { w: s.w, d: 0.5 }, m), tall: true }));
  const fixtureObstacles = fixtures.flatMap(f => {
    if (!(f.kind in g.base.footprints)) return [];
    const r = footprintRect(
      f.pos,
      f.rotY,
      g.base.footprints[f.kind as keyof TemplateGeometry['footprints']],
      m,
    );
    return [{ ...r, tall: f.kind !== 'bench' }];
  });
  const npcObstacles = npcSpots.map(s => ({ ...footprintRect(s.pos, 0, { w: 0.6, d: 0.6 }, m), tall: true }));
  const walk: Layout['walk'] = {
    areas: [...ext.areas, ...interior],
    obstacles: [
      ...ext.obstacles.map(r => ({ min: r.min, max: r.max, tall: true })),
      ...fixtureObstacles,
      ...decorObstacles,
      ...totemObstacles,
      ...npcObstacles,
    ],
    spawn,
  };
  const tall = walk.obstacles.filter(o => o.tall);
  const limited = stops.map(s => {
    const hit = rayEntry([s.anchor.target[0], s.anchor.target[2]], s.anchor.normal, tall);
    const maxDistance = Math.min(s.anchor.maxDistance, hit - 2 * c.ROUTE_CORNER_OFFSET_M);
    return maxDistance < s.anchor.maxDistance ? { ...s, anchor: { ...s.anchor, maxDistance } } : s;
  });

  // ── 구역·경계 ─────────────────────────────────────────────────
  const zones: NonNullable<Layout['zones']> = [
    { id: 'plaza', kind: 'plaza', min: plaza.min, max: [plaza.max[0], zPF] },
    { id: 'portico', kind: 'portico', min: [-ph, zPF], max: [ph, zf] },
    { id: 'hall', kind: 'hall', min: hallRect.min, max: hallRect.max },
    ...built.map(b => ({
      id: b.part.partId,
      kind: 'gallery' as const,
      min: b.part.bounds.min,
      max: b.part.bounds.max,
    })),
  ];
  const bx = plaza.max[0] - m;
  const bz0 = plaza.min[1] + m;
  const bz1 = zf - m;
  const boundary: NonNullable<Layout['boundary']> = [
    { a: [-bx, bz0], b: [bx, bz0] },
    { a: [-bx, bz0], b: [-bx, bz1] },
    { a: [bx, bz0], b: [bx, bz1] },
  ];

  const sortedDecor = [...decor].sort((a, b) =>
    a.kind < b.kind
      ? -1
      : a.kind > b.kind
        ? 1
        : a.pos[0] - b.pos[0] || a.pos[2] - b.pos[2] || a.pos[1] - b.pos[1],
  );
  const body = roundDeep({
    schemaVersion: 3 as const,
    algoVersion: input.algoVersion,
    templateId: input.templateId,
    units: 'm' as const,
    parts: built.map(b => b.part),
    modules: [...ext.modules, ...modules, ...built.flatMap(b => b.modules)],
    frames: built.flatMap(b => b.frames),
    labels: built.flatMap(b => b.labels),
    fixtures,
    stops: limited,
    legs,
    map,
    walk,
    exterior: ext.exterior,
    zones,
    signs,
    npcSpots,
    decorSlots: sortedDecor,
    gate: { pos: [0, groundY, zg] as P3, radius: c.GATE_RADIUS_M, rotY: facing([0, 1]) },
    boundary,
  });
  return { ...body, hash: layoutHash(body) };
};
