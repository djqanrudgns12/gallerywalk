import { config } from '@gallery/core/config';
import { fnv1a32, mulberry32 } from '@gallery/core/layout';
import type { FramePlacement, Layout } from '@gallery/core/types';

/**
 * 교사 작업 화면 v3의 축측 지도(FIELD_PLAN §5.4 ③, HT-04). 배치 결과(`layout.map`·`frames`)를 방위·고도 정사영으로 옮겨
 * SVG 한 장으로 그릴 모양을 만든다. 3D 엔진은 쓰지 않는다. 스타일(색)은 화면(`FloorPlan`)이 토큰으로 정한다.
 *
 * - 큰 전시실은 배치가 여러 관(part)으로 나눈다. 이 지도는 관을 전시실로 합쳐 다룬다(밝힘·번호·학생 점·놓기 판정).
 * - 그리는 차례: 바닥(복도 → 문 자리 → 전시실) → 벽 조각·작품 자리·이젤(먼 것부터) → 학생 점 → 번호 → 핀.
 * - 모든 함수는 순수하다. 같은 입력이면 같은 출력(점 흩기도 전시실 ID로 시드).
 */

type V2 = readonly [number, number];

export interface AxoSource {
  readonly map: Layout['map'];
  /** 관 → 전시실(`layout.parts`의 `partId`·`roomId`) */
  readonly parts: readonly { readonly partId: string; readonly roomId: string }[];
  readonly frames: readonly FramePlacement[];
  /** 정면 바깥 면 z(`layout.exterior.facadeZ`). 입구 화살표 자리 */
  readonly facadeZ: number;
  /** 보드의 전시실 차례(번호 01부터). 배치에 없는 전시실(게시 작품 없음)은 지도에 없다 */
  readonly roomOrder: readonly string[];
}

export interface AxoBox {
  readonly width: number;
  readonly height: number;
  /** 작은 지도(살펴보기 칸 "걸린 자리"): 입구 글자·핀 위 여백 없음 */
  readonly mini?: boolean;
}

export type AxoWallFace = 'sideA' | 'sideB' | 'top';

export type AxoShape =
  | { readonly kind: 'wall'; readonly face: AxoWallFace; readonly points: string }
  | {
      readonly kind: 'art' | 'easel';
      readonly artworkId: string;
      readonly roomId: string;
      readonly featured: boolean;
      readonly points: string;
    };

export interface AxoRoom {
  readonly roomId: string;
  /** 보드 차례(0부터). 번호 글자는 `index + 1` */
  readonly index: number;
  /** 관마다 바닥 다각형 하나 */
  readonly floors: readonly string[];
  readonly label: { readonly x: number; readonly y: number; readonly size: number };
}

export interface AxoModel {
  readonly width: number;
  readonly height: number;
  /** px / m */
  readonly scale: number;
  /** 복도·홀 윤곽과 문 자리 바닥 */
  readonly corridor: readonly string[];
  readonly rooms: readonly AxoRoom[];
  /** 먼 것부터 그릴 차례 */
  readonly shapes: readonly AxoShape[];
  readonly entry: {
    readonly arrow: string;
    readonly label: { readonly x: number; readonly y: number };
  } | null;
  /** 아래 함수들이 쓰는 값(화면은 쓰지 않음) */
  readonly internal: AxoInternal;
}

interface AxoInternal {
  readonly ox: number;
  readonly oy: number;
  readonly polygons: readonly { readonly roomId: string; readonly polygon: readonly V2[] }[];
  readonly frames: ReadonlyMap<string, FramePlacement>;
  readonly roomOf: ReadonlyMap<string, string>;
}

export interface AxoPin {
  readonly ring: string;
  readonly stem: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
  readonly head: { readonly x: number; readonly y: number; readonly r: number };
}

export interface AxoDot {
  readonly roomId: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

const DEG = Math.PI / 180;

/** 투영 상수(설정이 바뀌면 다시 계산) */
const basis = (): { cosT: number; sinT: number; sinP: number; cosP: number } => {
  const { azimuthDeg, elevationDeg } = config().AXO;
  return {
    cosT: Math.cos(azimuthDeg * DEG),
    sinT: Math.sin(azimuthDeg * DEG),
    sinP: Math.sin(elevationDeg * DEG),
    cosP: Math.cos(elevationDeg * DEG),
  };
};

/** 세계 (x, z, 높이 h) → 투영 평면(단위 m, 화면 y는 아래로). 복도(z)는 거의 가로, 전시실(x)은 위아래로 벌어진다 */
export const project = (x: number, z: number, h = 0): V2 => {
  const { cosT, sinT, sinP, cosP } = basis();
  return [cosT * z - sinT * x, -sinP * (sinT * z + cosT * x) - h * cosP];
};

/** 바깥 법선 (fx, fz)인 세운 면이 보는 사람 쪽을 향하는가 */
export const facesViewer = (fx: number, fz: number): boolean => {
  const { cosT, sinT } = basis();
  return sinT * fz + cosT * fx < -config().AXO.faceTol;
};

/** 투영의 거꾸로(h = 0 바닥): 투영 평면 (u, v) → 세계 (x, z) */
export const unproject = (u: number, w: number): V2 => {
  const { cosT, sinT, sinP } = basis();
  const v = -w / sinP;
  return [-sinT * u + cosT * v, cosT * u + sinT * v];
};

const edges = (poly: readonly V2[]): [V2, V2][] => poly.map((p, i) => [p, poly[(i + 1) % poly.length] ?? p]);

/** 벽선 a→b에서 같은 방향으로 놓인 문 폭만큼 잘라 낸 조각들 */
export const cutSegment = (a: V2, b: V2, doors: Layout['map']['doors']): [V2, V2][] => {
  const { doorAlignTol, doorSnapM, minPieceM } = config().AXO;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < minPieceM) return [];
  const dx = (b[0] - a[0]) / len;
  const dz = (b[1] - a[1]) / len;
  let pieces: [number, number][] = [[0, len]];
  for (const door of doors) {
    const alx = -door.normal[1];
    const alz = door.normal[0];
    if (Math.abs(dx * alz - dz * alx) > doorAlignTol) continue;
    const perp = Math.abs((door.pos[0] - a[0]) * -dz + (door.pos[1] - a[1]) * dx);
    if (perp > doorSnapM) continue;
    const t = (door.pos[0] - a[0]) * dx + (door.pos[1] - a[1]) * dz;
    const c0 = t - door.width / 2;
    const c1 = t + door.width / 2;
    pieces = pieces.flatMap(([s0, s1]): [number, number][] => {
      if (c1 <= s0 || c0 >= s1) return [[s0, s1]];
      const out: [number, number][] = [];
      if (c0 > s0) out.push([s0, c0]);
      if (c1 < s1) out.push([c1, s1]);
      return out;
    });
  }
  return pieces
    .filter(([s0, s1]) => s1 - s0 > minPieceM)
    .map(([s0, s1]) => [
      [a[0] + dx * s0, a[1] + dz * s0],
      [a[0] + dx * s1, a[1] + dz * s1],
    ]);
};

/** 전시실 관·홀·복도의 모든 벽선을 문에서 자르고, 이웃이 같은 벽을 내면 한 번만 둔다 */
export const buildSlabs = (map: Layout['map']): [V2, V2][] => {
  const { dedupeM } = config().AXO;
  const out: [V2, V2][] = [];
  const same = (p: V2, q: V2): boolean =>
    Math.abs(p[0] - q[0]) <= dedupeM && Math.abs(p[1] - q[1]) <= dedupeM;
  const polys = [...map.parts.map(p => p.polygon), ...map.outline];
  for (const poly of polys) {
    for (const [a, b] of edges(poly)) {
      for (const [sa, sb] of cutSegment(a, b, map.doors)) {
        if (out.some(([p, q]) => (same(p, sa) && same(q, sb)) || (same(p, sb) && same(q, sa)))) continue;
        out.push([sa, sb]);
      }
    }
  }
  return out;
};

const fmt = (n: number): string => n.toFixed(1);
const toPoints = (ps: readonly V2[]): string => ps.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');

/** 다각형 안인가(짝홀 규칙) */
export const insidePolygon = (p: V2, poly: readonly V2[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
};

const roomIdOf = (source: AxoSource): Map<string, string> =>
  new Map(source.parts.map(p => [p.partId, p.roomId] as const));

/** 지도 모양을 만든다. 상자(px)에 맞춰 축척과 원점을 정한다 */
export const buildAxo = (source: AxoSource, box: AxoBox): AxoModel => {
  const a = config().AXO;
  const mini = box.mini === true;
  const roomOf = roomIdOf(source);
  const order = new Map(source.roomOrder.map((id, i) => [id, i] as const));
  const { map } = source;

  const entryTip: V2 = [0, source.facadeZ + a.entryTipInM];
  const entryTail = source.facadeZ - a.entryTailOutM;
  const entryArrow: V2[] = [
    [-a.entryHalfWidthM, entryTail],
    entryTip,
    [a.entryHalfWidthM, entryTail],
    [0, entryTail + a.entryNotchM],
  ];
  const entryLabel: V2 = [0, source.facadeZ - a.entryLabelOutM];

  // 상자에 맞추기: 바닥과 벽 위, 입구 자리를 모두 담는다
  const extent: V2[] = [];
  for (const poly of [...map.parts.map(p => p.polygon), ...map.outline]) {
    for (const [x, z] of poly) extent.push(project(x, z), project(x, z, a.wallHeightM));
  }
  if (!mini) for (const [x, z] of [...entryArrow, entryLabel]) extent.push(project(x, z));
  const xs = extent.map(p => p[0]);
  const ys = extent.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const topExtra = mini ? 0 : a.pinTopPx;
  const innerW = box.width - 2 * a.padPx;
  const innerH = box.height - 2 * a.padPx - topExtra;
  const scale = Math.max(0, Math.min(innerW / (maxX - minX || 1), innerH / (maxY - minY || 1)));
  const ox = a.padPx + (innerW - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = a.padPx + topExtra + (innerH - (maxY - minY) * scale) / 2 - minY * scale;
  const P = (x: number, z: number, h = 0): V2 => {
    const [sx, sy] = project(x, z, h);
    return [ox + sx * scale, oy + sy * scale];
  };
  const floorPoints = (poly: readonly V2[]): string => toPoints(poly.map(([x, z]) => P(x, z)));

  // 바닥: 복도·홀 → 문 자리
  const corridor = map.outline.map(floorPoints);
  for (const door of map.doors) {
    const [nx, nz] = door.normal;
    const alx = -nz;
    const alz = nx;
    const [px, pz] = door.pos;
    const hw = door.width / 2;
    const d = a.doorFloorM;
    corridor.push(
      floorPoints([
        [px - alx * hw - nx * d, pz - alz * hw - nz * d],
        [px + alx * hw - nx * d, pz + alz * hw - nz * d],
        [px + alx * hw + nx * d, pz + alz * hw + nz * d],
        [px - alx * hw + nx * d, pz - alz * hw + nz * d],
      ]),
    );
  }

  // 전시실(관을 합침)
  const easelRooms = new Set(
    source.frames.filter(f => f.mount === 'EASEL').map(f => roomOf.get(f.partId) ?? ''),
  );
  const byRoom = new Map<string, { polys: (readonly V2[])[]; label: V2 }>();
  const polygons: { roomId: string; polygon: readonly V2[] }[] = [];
  for (const part of map.parts) {
    const roomId = roomOf.get(part.partId);
    if (roomId === undefined || !order.has(roomId)) continue;
    polygons.push({ roomId, polygon: part.polygon });
    const entry = byRoom.get(roomId);
    if (entry) entry.polys.push(part.polygon);
    else byRoom.set(roomId, { polys: [part.polygon], label: part.labelPos });
  }
  const labelSize = Math.max(a.labelMinPx, scale * a.labelPerM);
  const rooms: AxoRoom[] = [...byRoom.entries()]
    .map(([roomId, { polys, label }]) => {
      const shifted: V2 = [label[0], label[1] - a.labelShiftM];
      const useShift = easelRooms.has(roomId) && polys.some(poly => insidePolygon(shifted, poly));
      const [lx, ly] = useShift ? P(shifted[0], shifted[1]) : P(label[0], label[1]);
      return {
        roomId,
        index: order.get(roomId) ?? 0,
        floors: polys.map(floorPoints),
        label: { x: Number(fmt(lx)), y: Number(fmt(ly)), size: Number(fmt(labelSize)) },
      };
    })
    .sort((p, q) => p.index - q.index);

  // 벽 조각과 거기 붙은 작품 자리, 이젤 — 투영 y가 작은(먼) 것부터
  const slabs = buildSlabs(map);
  const onSlab = new Map<number, FramePlacement[]>();
  const items: { y: number; draw: () => AxoShape[] }[] = [];
  const frameShape = (f: FramePlacement): AxoShape | null => {
    const roomId = roomOf.get(f.partId);
    if (roomId === undefined) return null;
    const [nx, nz] = f.normal;
    const featured = f.featured;
    if (f.mount === 'EASEL') {
      const [bx, by] = P(f.center[0], f.center[2]);
      const w = a.easelHalfWidthM * scale;
      const h = a.easelHeightM * scale;
      return {
        kind: 'easel',
        artworkId: f.artworkId,
        roomId,
        featured,
        points: toPoints([
          [bx - w, by],
          [bx + w, by],
          [bx + w * a.easelTopRatio, by - h],
          [bx - w * a.easelTopRatio, by - h],
        ]),
      };
    }
    const alx = -nz;
    const alz = nx;
    const w = (f.outer.w * a.frameWidthRatio) / 2;
    const cx = f.center[0] + nx * a.frameInsetM;
    const cz = f.center[2] + nz * a.frameInsetM;
    const d = a.frameHalfDepthM;
    const h = a.wallHeightM + a.frameLiftM;
    return {
      kind: 'art',
      artworkId: f.artworkId,
      roomId,
      featured,
      points: toPoints([
        P(cx - alx * w + nx * d, cz - alz * w + nz * d, h),
        P(cx + alx * w + nx * d, cz + alz * w + nz * d, h),
        P(cx + alx * w - nx * d, cz + alz * w - nz * d, h),
        P(cx - alx * w - nx * d, cz - alz * w - nz * d, h),
      ]),
    };
  };
  for (const f of source.frames) {
    if (!roomOf.has(f.partId)) continue;
    if (f.mount === 'EASEL') {
      items.push({
        y: project(f.center[0], f.center[2])[1],
        draw: () => [frameShape(f)].flatMap(s => (s ? [s] : [])),
      });
      continue;
    }
    const index = slabs.findIndex(([p, q]) => {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const dx = (q[0] - p[0]) / len;
      const dz = (q[1] - p[1]) / len;
      const t = (f.center[0] - p[0]) * dx + (f.center[2] - p[1]) * dz;
      const perp = Math.abs((f.center[0] - p[0]) * -dz + (f.center[2] - p[1]) * dx);
      return perp < a.frameSnapM && t >= -a.frameSnapM && t <= len + a.frameSnapM;
    });
    if (index < 0) {
      items.push({
        y: project(f.center[0], f.center[2])[1],
        draw: () => [frameShape(f)].flatMap(s => (s ? [s] : [])),
      });
      continue;
    }
    const list = onSlab.get(index);
    if (list) list.push(f);
    else onSlab.set(index, [f]);
  }
  slabs.forEach(([p, q], index) => {
    const mid = project((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    items.push({
      y: mid[1],
      draw: () => [
        ...slabShapes(p, q, P),
        ...(onSlab.get(index) ?? []).map(frameShape).flatMap(s => (s ? [s] : [])),
      ],
    });
  });
  items.sort((p, q) => p.y - q.y);
  const shapes = items.flatMap(item => item.draw());

  const entry = mini
    ? null
    : {
        arrow: toPoints(entryArrow.map(([x, z]) => P(x, z))),
        label: (() => {
          const [x, y] = P(entryLabel[0], entryLabel[1]);
          return { x: Number(fmt(x)), y: Number(fmt(y)) };
        })(),
      };

  return {
    width: box.width,
    height: box.height,
    scale,
    corridor,
    rooms,
    shapes,
    entry,
    internal: {
      ox,
      oy,
      polygons,
      frames: new Map(source.frames.map(f => [f.artworkId, f] as const)),
      roomOf,
    },
  };
};

/** 두께 있는 벽 조각: 보이는 옆면(두 밝기)과 윗면. 끝을 두께 절반만큼 늘려 모서리를 메운다 */
const slabShapes = (a: V2, b: V2, P: (x: number, z: number, h?: number) => V2): AxoShape[] => {
  const { wallThickM, wallHeightM } = config().AXO;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / len;
  const dz = (b[1] - a[1]) / len;
  const nx = -dz;
  const nz = dx;
  const ht = wallThickM / 2;
  const ax = a[0] - dx * ht;
  const az = a[1] - dz * ht;
  const bx = b[0] + dx * ht;
  const bz = b[1] + dz * ht;
  const p1: V2 = [ax + nx * ht, az + nz * ht];
  const p2: V2 = [bx + nx * ht, bz + nz * ht];
  const p3: V2 = [bx - nx * ht, bz - nz * ht];
  const p4: V2 = [ax - nx * ht, az - nz * ht];
  const faces: [V2, V2, number, number][] = [
    [p1, p2, nx, nz],
    [p3, p4, -nx, -nz],
    [p4, p1, -dx, -dz],
    [p2, p3, dx, dz],
  ];
  const out: AxoShape[] = [];
  for (const [q1, q2, fx, fz] of faces) {
    if (!facesViewer(fx, fz)) continue;
    out.push({
      kind: 'wall',
      face: Math.abs(fx) > Math.abs(fz) ? 'sideA' : 'sideB',
      points: toPoints([
        P(q1[0], q1[1]),
        P(q2[0], q2[1]),
        P(q2[0], q2[1], wallHeightM),
        P(q1[0], q1[1], wallHeightM),
      ]),
    });
  }
  out.push({
    kind: 'wall',
    face: 'top',
    points: toPoints([p1, p2, p3, p4].map(([x, z]) => P(x, z, wallHeightM))),
  });
  return out;
};

const screen = (model: AxoModel, x: number, z: number, h = 0): V2 => {
  const [sx, sy] = project(x, z, h);
  return [model.internal.ox + sx * model.scale, model.internal.oy + sy * model.scale];
};

/** 고른 작품의 핀(벽 앞 바닥 고리 + 세운 선 + 머리). 배치에 없는 작품이면 null */
export const axoPin = (model: AxoModel, artworkId: string): AxoPin | null => {
  const f = model.internal.frames.get(artworkId);
  if (!f || !model.internal.roomOf.has(f.partId)) return null;
  const a = config().AXO;
  const [nx, nz] = f.normal;
  const off = f.mount === 'EASEL' ? 0 : a.pinOffsetM;
  const px = f.center[0] + nx * off;
  const pz = f.center[2] + nz * off;
  const ring = Array.from({ length: a.pinRingSegments }, (_, i): V2 => {
    const t = (2 * Math.PI * i) / a.pinRingSegments;
    return screen(model, px + a.pinRingM * Math.cos(t), pz + a.pinRingM * Math.sin(t));
  });
  const [bx, by] = screen(model, px, pz);
  const [tx, ty] = screen(model, px, pz, a.pinHeightM);
  return {
    ring: toPoints(ring),
    stem: { x1: Number(fmt(bx)), y1: Number(fmt(by)), x2: Number(fmt(tx)), y2: Number(fmt(ty)) },
    head: { x: Number(fmt(tx)), y: Number(fmt(ty)), r: a.pinHeadPx },
  };
};

/** 화면 좌표(지도 SVG의 px)가 가리키는 전시실 — 투영을 거꾸로 풀어 바닥 다각형 안인지 본다. 끄는 작품을 지도에 놓을 때 */
export const axoRoomAt = (model: AxoModel, sx: number, sy: number): string | null => {
  if (model.scale <= 0) return null;
  const p = unproject((sx - model.internal.ox) / model.scale, (sy - model.internal.oy) / model.scale);
  return model.internal.polygons.find(entry => insidePolygon(p, entry.polygon))?.roomId ?? null;
};

/**
 * 전시실별 학생 수만큼 점을 흩는다. 개인 위치가 아니다. 전시실 ID로 시드해 같은 수면 같은 자리.
 * 번호 글자 둘레(화면 좌표)는 비우고, 점끼리 겹치지 않게 하되 좁으면 간격을 차례로 푼다.
 * 끝까지 못 놓은 점은 간격 없이 놓는다(수는 늘 맞다).
 */
export const axoDots = (model: AxoModel, counts: ReadonlyMap<string, number>): AxoDot[] => {
  const a = config().AXO;
  const r = Math.max(a.dotMinPx, model.scale * a.dotPerM);
  const out: (AxoDot & { depth: number })[] = [];
  for (const room of model.rooms) {
    const n = counts.get(room.roomId) ?? 0;
    if (n <= 0) continue;
    const polys = model.internal.polygons.filter(p => p.roomId === room.roomId).map(p => p.polygon);
    const all = polys.flat();
    const minX = Math.min(...all.map(p => p[0])) + a.dotMarginM;
    const maxX = Math.max(...all.map(p => p[0])) - a.dotMarginM;
    const minZ = Math.min(...all.map(p => p[1])) + a.dotMarginM;
    const maxZ = Math.max(...all.map(p => p[1])) - a.dotMarginM;
    const rnd = mulberry32(fnv1a32(room.roomId));
    const halfW = room.label.size * a.labelHalfW + r + a.labelClearPx;
    const halfH = room.label.size * a.labelHalfH + r + a.labelClearPx;
    const mine: V2[] = [];
    let tries = 0;
    while (mine.length < n && tries < a.dotMaxTries) {
      tries += 1;
      const x = minX + (maxX - minX) * rnd();
      const z = minZ + (maxZ - minZ) * rnd();
      if (!polys.some(poly => insidePolygon([x, z], poly))) continue;
      const [sx, sy] = screen(model, x, z);
      if (Math.abs(sx - room.label.x) < halfW && Math.abs(sy - r - room.label.y) < halfH) continue;
      const tier = Math.min(a.dotGapM.length - 1, Math.floor(tries / a.dotRelaxEvery));
      const gap = a.dotGapM[tier] ?? 0;
      if (mine.some(([ox, oz]) => Math.hypot(x - ox, z - oz) < gap)) continue;
      mine.push([x, z]);
    }
    while (mine.length < n) {
      const x = minX + (maxX - minX) * rnd();
      const z = minZ + (maxZ - minZ) * rnd();
      mine.push([x, z]);
    }
    for (const [x, z] of mine) {
      const [sx, sy] = screen(model, x, z);
      out.push({
        roomId: room.roomId,
        x: Number(fmt(sx)),
        y: Number(fmt(sy - r)),
        r: Number(fmt(r)),
        depth: sy,
      });
    }
  }
  return out.sort((p, q) => p.depth - q.depth).map(({ depth: _depth, ...dot }) => dot);
};
