import { config } from '@gallery/core/config';
import {
  type CameraPose,
  frameAnchorOf,
  frameCameraWithSide,
  type FramingOptions,
  type P2,
  roundedPath,
  type SideReach,
  route,
  standable,
} from '@gallery/core/layout';
import type { Layout, Stop } from '@gallery/core/types';
import { labelAwayOf } from '../scene/labelAway.ts';
import { yawOf } from './walker.ts';
import type { WalkMode } from './walkStore.ts';

/**
 * 안내 이동(ADR-057 "다음 작품으로 걸어가기")과 화면에서 누른 곳까지 걷기.
 *
 * 길은 두 층으로 찾는다: ① 구역(광장·홀과 회랑·관마다) 사이는 문을 지나야 하므로 문 경로점(바깥 → 가운데 → 안쪽)을 잇고,
 * ② 한 구역 안의 두 점 사이는 `route`(설비 돌기). 구역 수가 적어 휴대폰에서도 누르는 즉시 계산된다.
 */

type Region = 'exterior' | 'spine' | string;

interface Portal {
  /** 이 문이 잇는 관(없으면 정문: 광장 ↔ 홀) */
  readonly partId: string | null;
  /** 관(또는 광장) 쪽 점 · 벽 두께 가운데 · 회랑(또는 홀) 쪽 점 */
  readonly inside: P2;
  readonly center: P2;
  readonly outside: P2;
}

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: P2): number => Math.hypot(a[0], a[1]);

export interface GuideMap {
  readonly layout: Layout;
  readonly portals: readonly Portal[];
  readonly regionOf: (p: P2) => Region;
}

export const buildGuideMap = (layout: Layout): GuideMap => {
  const c = config();
  const off = c.DOOR_PATH_OFFSET_M;
  const portals: Portal[] = [];
  for (const part of layout.parts)
    for (const d of part.doors) {
      const center: P2 = [d.center[0], d.center[2]];
      portals.push({
        partId: part.partId,
        inside: [center[0] + d.normal[0] * off, center[1] + d.normal[1] * off],
        center,
        outside: [center[0] - d.normal[0] * off, center[1] - d.normal[1] * off],
      });
    }
  // 정문: 지도 문 중 홀 뒷벽(바깥 면보다 앞, x = 0)의 것. 안쪽 = 광장 쪽(이 문을 "광장 구역의 문"으로 본다)
  const facadeZ = layout.exterior.facadeZ;
  const entrance = layout.map.doors.find(d => d.pos[1] < 0 && d.pos[1] > facadeZ - 1e-6 && d.normal[1] > 0);
  if (entrance) {
    const center: P2 = [entrance.pos[0], entrance.pos[1]];
    portals.push({
      partId: null,
      inside: [center[0], center[1] - off],
      center,
      outside: [center[0], center[1] + off],
    });
  }
  const regionOf = (p: P2): Region => {
    if (p[1] < facadeZ + c.WALL_THICKNESS_M / 2) return 'exterior';
    for (const part of layout.parts) {
      const b = part.bounds;
      if (p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1]) return part.partId;
    }
    return 'spine';
  };
  return { layout, portals, regionOf };
};

const portalsOf = (map: GuideMap, region: Region): Portal[] =>
  map.portals.filter(p => (region === 'exterior' ? p.partId === null : p.partId === region));

/** 구역 안의 두 점을 설비를 돌아 잇는다. 못 찾으면 곧은 선(걷기가 벽을 따라 미끄러진다) */
const local = (map: GuideMap, a: P2, b: P2): P2[] => route(map.layout.walk, a, b) ?? [a, b];

/** 꺾은선을 `PATH_SAMPLE_M` 간격 점으로 */
const densify = (pts: readonly P2[]): P2[] => {
  const step = config().PATH_SAMPLE_M;
  const out: P2[] = pts.length > 0 ? [pts[0]!] : [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(len(sub(b, a)) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
};

const chainLength = (pts: readonly P2[]): number =>
  pts.reduce((s, p, i) => (i === 0 ? 0 : s + len(sub(p, pts[i - 1]!))), 0);

/**
 * from → to 걷는 길(첫 점 = from). 다른 구역이면 문을 지난다(관 ↔ 관은 회랑을 거쳐, 문은 더 짧은 쪽).
 * 결과는 둥글린 꺾은선(`roundedPath`) — 걷기가 모퉁이에서 부드럽게 돈다.
 */
export const pathBetween = (map: GuideMap, from: P2, to: P2): P2[] => {
  const ra = map.regionOf(from);
  const rb = map.regionOf(to);
  let marks: P2[];
  if (ra === rb) marks = local(map, from, to);
  else {
    // 나가는 문(from 구역 → 회랑) · 들어가는 문(회랑 → to 구역). 회랑이면 문이 없다.
    const outs: (Portal | null)[] = ra === 'spine' ? [null] : portalsOf(map, ra);
    const ins: (Portal | null)[] = rb === 'spine' ? [null] : portalsOf(map, rb);
    let best: P2[] | null = null;
    for (const o of outs)
      for (const i of ins) {
        const pts: P2[] = [from];
        if (o) pts.push(o.inside, o.center, o.outside);
        if (i) pts.push(i.outside, i.center, i.inside);
        pts.push(to);
        if (!best || chainLength(pts) < chainLength(best)) best = pts;
      }
    const chain = best ?? [from, to];
    marks = [chain[0]!];
    for (let k = 1; k < chain.length; k++) marks.push(...local(map, chain[k - 1]!, chain[k]!).slice(1));
  }
  // 둥글린 모퉁이가 설비 여유 안으로 들어가면 둥글리지 않은 꺾은선(점마다 설 수 있음 — route가 보장)
  const rounded = roundedPath(marks);
  if (rounded.every(p => standable(map.layout.walk, p))) return rounded;
  return densify(marks);
};

/** 작품 앞에 도착했을 때 화면 맞춤(정지 지점보다 크게 — `VIEW_FILL`) */
export const viewFraming = (floorY: number): FramingOptions => {
  const c = config();
  return { fillHeight: c.VIEW_FILL, fillWidth: c.STOP_FILL_WIDTH, cameraHeight: floorY + c.CAMERA_HEIGHT_M };
};

export interface StandSpot {
  readonly at: P2;
  /** 서서 바라볼 방향 */
  readonly yaw: number;
  /** 도착했을 때 카메라 */
  readonly camera: CameraPose;
}

/**
 * 작품 정지 지점의 벽 명판: 액자 가운데 → 명판 쪽 벽 방향과 명판 먼 끝까지의 거리(그리기와 같은 띄움 `LABEL_FRAME_GAP_M`·
 * 판 폭 `LABEL_PLATE_M`). 이젤(받침 아래 명판)·명판 없음은 null
 */
export const labelReachOf = (layout: Layout, stop: Stop): SideReach | null => {
  if (stop.kind !== 'artwork' || !stop.artworkId) return null;
  const label = layout.labels.find(l => l.artworkId === stop.artworkId);
  const frame = layout.frames.find(f => f.artworkId === stop.artworkId);
  if (!label || !frame || frame.mount === 'EASEL') return null;
  const c = config();
  const [cx, , cz] = stop.anchor.target;
  const away = labelAwayOf(label.pos, { x: cx, z: cz }, label.normal, false);
  if (away[0] === 0 && away[1] === 0) return null;
  const along = (label.pos[0] - cx) * away[0] + (label.pos[2] - cz) * away[1];
  return {
    along: { x: away[0], y: 0, z: away[1] },
    reach: along + c.LABEL_FRAME_GAP_M + c.LABEL_PLATE_M.w / 2,
  };
};

/**
 * 정지 지점 앞에 설 자리: 화면 맞춤 카메라 자리에서 작품 쪽으로 조금, 옆으로 조금(카메라에 캐릭터가 화면 오른쪽 아래에 보이게).
 * 그 자리가 설 수 없으면 옆 비킴 없이 → 카메라 자리 → 법선 위를 작품 쪽으로 당기며 찾는다.
 */
export const standSpot = (layout: Layout, stop: Stop, aspect: number): StandSpot => {
  const c = config();
  const a = stop.anchor;
  const camera = frameCameraWithSide(
    frameAnchorOf(a),
    { aspect },
    viewFraming(a.floorY),
    labelReachOf(layout, stop),
  );
  const p: P2 = [camera.position.x, camera.position.z];
  const fwd: P2 = [-a.normal[0], -a.normal[1]];
  // 작품을 볼 때 화면 오른쪽(+Z를 볼 때 −X)
  const right: P2 = [-fwd[1], fwd[0]];
  const yaw = yawOf(fwd[0], fwd[1]);
  const candidates: P2[] = [
    [
      p[0] + fwd[0] * c.VIEW_STAND_FORWARD_M + right[0] * c.VIEW_STAND_SIDE_M,
      p[1] + fwd[1] * c.VIEW_STAND_FORWARD_M + right[1] * c.VIEW_STAND_SIDE_M,
    ],
    [p[0] + fwd[0] * c.VIEW_STAND_FORWARD_M, p[1] + fwd[1] * c.VIEW_STAND_FORWARD_M],
    p,
  ];
  for (let t = 0.25; t < a.maxDistance; t += 0.25) candidates.push([p[0] + fwd[0] * t, p[1] + fwd[1] * t]);
  const at = candidates.find(q => standable(layout.walk, q)) ?? p;
  return { at, yaw, camera };
};

/**
 * `다음·이전 작품으로`의 목표(PRD 15.1-2 "연타해도 한 칸씩만"): 안내 걷기 중에 다시 누르면 목표를 바꾸지 않는다
 * (전에는 누를 때마다 목표가 한 칸씩 쌓여 여러 정지 지점을 건너뛰었다). 끝을 넘으면 null.
 */
export const stepTarget = (
  mode: WalkMode,
  stopIndex: number,
  delta: 1 | -1,
  stopCount: number,
): number | null => {
  if (mode === 'guiding') return null;
  const next = stopIndex + delta;
  return next < 0 || next >= stopCount ? null : next;
};
