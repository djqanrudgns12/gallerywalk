import { config } from '../../config.ts';
import type { Fixture, Layout, LayoutInput, Stop } from '../../types/layout.ts';
import { type TemplateGeometry, templateGeometry } from '../templates/geometry.ts';
import { frameSize } from './artworkSize.ts';
import { mm, type P2, rectOf, rectPolygon } from './geom.ts';
import { buildExterior } from './grammar/exterior.ts';
import { buildShell, outlineOf, placeParts } from './grammar/modernHistory.ts';
import { layoutHash } from './hash.ts';
import { type BuiltPart, buildPart, type DoorPoints, type P3, type StopAnchor } from './part.ts';
import { interiorWalkRects } from './paths.ts';
import { type PartPlan, planPart, type SizedItem } from './roomSizing.ts';
import { evenChunks, featuredIndex, partCountFor, type SplitItem } from './split.ts';
import { computeLayoutV4 } from './v4/museum.ts';

/**
 * 배치 엔진(PLAN §4): `computeLayout(input) → Layout`. 순수 함수 — 같은 입력이면 같은 출력·같은 해시(§4.10).
 * 서버가 게시 작품이 바뀔 때 계산해 저장하고(`layouts`), 기기는 받은 배치로 장면을 조립한다.
 */

type Artwork = LayoutInput['artworks'][number];

const byOrderId = (a: { order: number; id: string }, b: { order: number; id: string }): number =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

interface PlannedPart {
  readonly roomId: string;
  readonly plan: PartPlan;
  readonly featuredId: string;
}

/** 관 하나로 계획한다. 어느 크기로도 벽이 넘치면 §4.3 규칙(고르게)으로 둘로 나눠 각각 처음부터. */
const planChunk = (chunk: readonly Artwork[], roomId: string, border: number): PlannedPart[] => {
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
  const plan = planPart(sized, f);
  if (plan) return [{ roomId, plan, featuredId: chunk[f]!.id }];
  return evenChunks(chunk, 2).flatMap(half => planChunk(half, roomId, border));
};

/** 1mm 반올림(회전은 1e-4 rad). 정규 JSON·해시가 런타임마다 같게. */
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

const at = (p: P2, y: number): P3 => [p[0], y, p[1]];

/** 반직선 o + t·d(t > 0)가 처음 들어가는 사각형까지의 t. 시작점을 품은 사각형(이젤 자기 바닥)은 뺀다 */
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

/** 설비 바닥(걸을 때 피함): 앞 = 지역 +Z, 회전은 90° 배수. 여유만큼 넓힌다 */
const fixtureObstacles = (fixtures: readonly Fixture[], g: TemplateGeometry): Layout['walk']['obstacles'] => {
  const m = config().WALKABLE_WALL_MARGIN_M;
  const out: Layout['walk']['obstacles'] = [];
  for (const f of fixtures) {
    if (!(f.kind in g.footprints)) continue;
    const fp = g.footprints[f.kind as keyof TemplateGeometry['footprints']];
    const turned = Math.abs(Math.sin(f.rotY)) > 0.5;
    const hx = (turned ? fp.d : fp.w) / 2 + m;
    const hz = (turned ? fp.w : fp.d) / 2 + m;
    const r = rectOf([f.pos[0] - hx, f.pos[2] - hz], [f.pos[0] + hx, f.pos[2] + hz]);
    out.push({ min: r.min, max: r.max, tall: f.kind !== 'bench' });
  }
  return out;
};

export const computeLayout = (input: LayoutInput): Layout => {
  // 공간 v4(ADR-071)는 판 4부터. v3 이하는 아래 그대로(결과·해시 불변)
  if (input.algoVersion >= 4) return computeLayoutV4(input);
  const c = config();
  const g = templateGeometry[input.templateId];
  const rooms = [...input.rooms].sort(byOrderId);
  const artworks = [...input.artworks].sort(byOrderId);

  // ── 전시실 → 관 ──────────────────────────────────────────
  const planned: {
    roomId: string;
    partIndex: number;
    partCount: number;
    plan: PartPlan;
    featuredId: string;
  }[] = [];
  for (const room of rooms) {
    const list = artworks.filter(a => a.roomId === room.id);
    if (list.length === 0) continue; // 비어 있는 전시실은 동선에서 빠진다(G-12)
    const parts = evenChunks(list, partCountFor(list.length)).flatMap(chunk =>
      planChunk(chunk, room.id, g.frameBorderM),
    );
    parts.forEach((p, i) => planned.push({ ...p, partIndex: i, partCount: parts.length }));
  }

  // ── 관 놓기·짓기 ──────────────────────────────────────────
  const { slots, corridorLength } = placeParts(
    planned.map(p => p.plan.width),
    g,
  );
  const built: BuiltPart[] = planned.map((p, i) =>
    buildPart({
      partId: `${p.roomId}:${p.partIndex}`,
      roomId: p.roomId,
      partIndex: p.partIndex,
      partCount: p.partCount,
      plan: p.plan,
      frame: slots[i]!.frame,
      featuredIds: new Set([p.featuredId]),
      geometry: g,
    }),
  );
  const shell = buildShell(
    built.map((b, i) => ({ slot: slots[i]!, width: b.part.width, partId: b.part.partId })),
    corridorLength,
    g,
  );

  // ── 미술관 외관(ADR-057): 정면 날개 벽은 건물이 차지하는 폭보다 넓게 ─────────
  const buildingHalfX = Math.max(
    g.hall.w / 2,
    ...built.flatMap(b => [Math.abs(b.part.bounds.min[0]), Math.abs(b.part.bounds.max[0])]),
  );
  const ext = buildExterior(g, -g.hall.d, buildingHalfX);

  // ── 정지 지점(외관 → 홀 → 관마다 소개·작품 → 출구) ───────────────
  const stops: Stop[] = [];
  const zone: string[] = [];
  const push = (s: Omit<Stop, 'anchor'> & { anchor: StopAnchor }, z: string): void => {
    stops.push(s);
    zone.push(z);
  };
  push(
    {
      id: 'exterior',
      kind: 'exterior',
      partId: null,
      artworkId: null,
      index: null,
      count: null,
      anchor: ext.stop,
    },
    'exterior',
  );
  push(
    {
      id: 'hall',
      kind: 'hall',
      partId: null,
      artworkId: null,
      index: null,
      count: null,
      anchor: shell.hallStop,
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
      partId: null,
      artworkId: null,
      index: null,
      count: null,
      anchor: shell.exitStop,
    },
    'exit',
  );

  // ── 이동 경로점(관 사이만, §4.8) ──────────────────────────────
  const y = c.CAMERA_HEIGHT_M;
  const byPart = new Map(built.map(b => [b.part.partId, b]));
  const centerline = (p: P2): P3 => [0, y, p[1]];
  const out = (d: DoorPoints): P3[] => [at(d.inner, y), at(d.center, y), at(d.outer, y), centerline(d.outer)];
  const into = (d: DoorPoints): P3[] => [
    centerline(d.outer),
    at(d.outer, y),
    at(d.center, y),
    at(d.inner, y),
  ];
  const legs: Layout['legs'] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const za = zone[i]!;
    const zb = zone[i + 1]!;
    let waypoints: P3[] = [];
    if (za === 'exterior') {
      // 광장 → 계단 → 현관 → 정문(바깥 → 벽 두께 가운데 → 홀 안쪽)
      const d = shell.entranceDoor;
      waypoints = [...ext.approach, at(d.outer, y), at(d.center, y), at(d.inner, y)];
    } else if (za !== zb) {
      const from = byPart.get(za);
      const to = byPart.get(zb);
      waypoints = [...(from ? out(from.doorOut) : []), ...(to ? into(to.doorIn) : [])];
      // 회랑 중심선의 같은 점이 겹치면 하나로
      waypoints = waypoints.filter(
        (p, k) =>
          k === 0 || Math.abs(p[0] - waypoints[k - 1]![0]) + Math.abs(p[2] - waypoints[k - 1]![2]) > 1e-6,
      );
    }
    legs.push({ from: stops[i]!.id, to: stops[i + 1]!.id, waypoints });
  }

  // ── 지도(§4.9) ──────────────────────────────────────────────
  const outline = outlineOf(shell);
  const doors = [
    shell.opening,
    shell.entrance,
    ...built.flatMap(b =>
      b.part.doors.map(d => ({ pos: [d.center[0], d.center[2]] as P2, normal: d.normal, width: d.width })),
    ),
  ];
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
    doors,
    bounds: {
      min: [Math.min(...xs.map(p => p[0])), Math.min(...xs.map(p => p[1]))],
      max: [Math.max(...xs.map(p => p[0])), Math.max(...xs.map(p => p[1]))],
    },
  };

  // ── 걸을 수 있는 곳(ADR-057 자유 관람) ────────────────────────────
  const fixtures = [...ext.fixtures, ...shell.fixtures, ...built.flatMap(b => b.fixtures)];
  const walk: Layout['walk'] = {
    areas: [
      ...ext.areas,
      ...interiorWalkRects(
        built.map(b => b.part),
        outline,
        doors,
      ).map(r => ({ min: r.min, max: r.max, y: 0, ceiling: c.WALL_HEIGHT_M })),
    ],
    obstacles: [
      ...ext.obstacles.map(r => ({ min: r.min, max: r.max, tall: true })),
      ...fixtureObstacles(fixtures, g),
    ],
    spawn: ext.spawn,
  };

  // 정지 지점 카메라는 키 큰 설비 앞까지만 물러선다(이젤·화분 뒤에 서서 가려지지 않게, 길 찾기가 설 수 있게)
  const tall = walk.obstacles.filter(o => o.tall);
  const limited = stops.map(s => {
    const hit = rayEntry([s.anchor.target[0], s.anchor.target[2]], s.anchor.normal, tall);
    const maxDistance = Math.min(s.anchor.maxDistance, hit - 2 * c.ROUTE_CORNER_OFFSET_M);
    return maxDistance < s.anchor.maxDistance ? { ...s, anchor: { ...s.anchor, maxDistance } } : s;
  });

  const body = roundDeep({
    schemaVersion: 2 as const,
    algoVersion: input.algoVersion,
    templateId: input.templateId,
    units: 'm' as const,
    parts: built.map(b => b.part),
    modules: [...ext.modules, ...shell.modules, ...built.flatMap(b => b.modules)],
    frames: built.flatMap(b => b.frames),
    labels: built.flatMap(b => b.labels),
    fixtures,
    stops: limited,
    legs,
    map,
    walk,
    exterior: ext.exterior,
  });
  return { ...body, hash: layoutHash(body) };
};
