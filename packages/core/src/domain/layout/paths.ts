import { config } from '../../config.ts';
import type { Layout, Part, Walk } from '../../types/layout.ts';
import { add, dot, inRect, length, mul, type P2, type Rect, rectOf, shrink, sub, unit } from './geom.ts';

/**
 * 이동 경로(PLAN §4.8). 꺾은선의 꺾이는 곳을 반지름 ≤ min(`PATH_FILLET_MAX_M`, 이웃 선분의 40%) 원호로 둥글린다
 * (Catmull-Rom은 곡선이 바깥으로 부풀어 벽을 지날 수 있어 쓰지 않음). 기기(관람 엔진)와 배치 시험이 함께 쓴다.
 */

/** 꺾은선 → 둥글린 경로 위의 점들(간격 ≤ `PATH_SAMPLE_M`) */
export const roundedPath = (points: readonly P2[]): P2[] => {
  const c = config();
  const step = c.PATH_SAMPLE_M;
  const pts = points.filter((p, i) => i === 0 || length(sub(p, points[i - 1]!)) > 1e-6);
  if (pts.length < 2) return [...pts];
  // 꺾이는 곳마다 [원호 시작, 원호 점들..., 원호 끝]을 만든다
  const corners: P2[][] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const d = pts[i + 1]!;
    const lin = length(sub(b, a));
    const lout = length(sub(d, b));
    const u1 = unit(sub(b, a));
    const u2 = unit(sub(d, b));
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
    if (turn < 1e-4) {
      corners.push([b]);
      continue;
    }
    const half = Math.tan(turn / 2);
    const shortSide = Math.min(lin, lout);
    let r = Math.min(c.PATH_FILLET_MAX_M, c.PATH_FILLET_SEGMENT_RATIO * shortSide);
    // 아주 날카롭게 꺾이면 접선 길이가 선분을 넘지 않게 반지름을 줄인다
    const tMax = c.PATH_FILLET_TANGENT_RATIO * shortSide;
    if (r * half > tMax) r = tMax / half;
    const t = r * half;
    const p1 = sub(b, mul(u1, t));
    const p2 = add(b, mul(u2, t));
    const bis = unit(sub(u2, u1));
    const center = add(b, mul(bis, r / Math.cos(turn / 2)));
    const a1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    let a2 = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
    // 짧은 쪽으로 돈다(돌아가는 각 = turn)
    let delta = a2 - a1;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    a2 = a1 + delta;
    const n = Math.max(2, Math.ceil((Math.abs(delta) * r) / step) + 1);
    const arc: P2[] = [];
    for (let k = 0; k < n; k++) {
      const ang = a1 + ((a2 - a1) * k) / (n - 1);
      arc.push([center[0] + r * Math.cos(ang), center[1] + r * Math.sin(ang)]);
    }
    corners.push(arc);
  }
  // 직선 구간을 간격 step 이하로 채운다
  const out: P2[] = [];
  const line = (p: P2, q: P2): void => {
    const l = length(sub(q, p));
    const n = Math.max(1, Math.ceil(l / step));
    for (let k = out.length === 0 ? 0 : 1; k <= n; k++) out.push(add(p, mul(sub(q, p), k / n)));
  };
  let cursor = pts[0]!;
  for (const arc of corners) {
    line(cursor, arc[0]!);
    for (let k = 1; k < arc.length; k++) out.push(arc[k]!);
    cursor = arc[arc.length - 1]!;
  }
  line(cursor, pts[pts.length - 1]!);
  return out;
};

type LayoutMap = Layout['map'];

/**
 * 실내의 걸을 수 있는 영역(§4.8): 관 안쪽·회랑·홀·문 구간, 벽에서 `WALKABLE_WALL_MARGIN_M` 안쪽.
 * 문 구간은 맑은 폭에서 여유를 뺀 폭으로 벽 두께를 건너 양쪽 영역에 겹치게 둔다. 배치 엔진이 `walk.areas`를 만들 때 쓴다.
 */
export const interiorWalkRects = (
  parts: readonly Pick<Part, 'bounds'>[],
  outline: LayoutMap['outline'],
  doors: LayoutMap['doors'],
): Rect[] => {
  const c = config();
  const m = c.WALKABLE_WALL_MARGIN_M;
  const rects: Rect[] = [];
  for (const p of parts) rects.push(shrink({ min: p.bounds.min, max: p.bounds.max }, m));
  for (const poly of outline) {
    const xs = poly.map(p => p[0]);
    const zs = poly.map(p => p[1]);
    rects.push(shrink(rectOf([Math.min(...xs), Math.min(...zs)], [Math.max(...xs), Math.max(...zs)]), m));
  }
  const reach = c.WALL_THICKNESS_M / 2 + m + 0.05;
  for (const d of doors) {
    const along: P2 = [-d.normal[1], d.normal[0]];
    const halfW = d.width / 2 - m;
    if (halfW <= 0) continue;
    const a = add(add(d.pos, mul(along, halfW)), mul(d.normal, reach));
    const b = sub(sub(d.pos, mul(along, halfW)), mul(d.normal, reach));
    rects.push(rectOf(a, b));
  }
  return rects;
};

/** 걸을 수 있는 사각형들(높이 무시) — 경로 시험(`pathClear`)용 */
export const walkableRects = (layout: Layout): Rect[] =>
  layout.walk.areas.map(a => ({ min: a.min, max: a.max }));

const floorOf = (walk: Walk, p: P2, stepped: boolean): number | null => {
  let best: number | null = null;
  for (const a of walk.areas) {
    if (!inRect(p, a)) continue;
    let y = a.y;
    if (a.slope) {
      const s = a.slope;
      const v = s.axis === 'x' ? p[0] : p[1];
      const t = Math.max(0, Math.min(1, (v - s.from) / (s.to - s.from)));
      if (stepped && s.steps) {
        // 위 끝(to)에서부터 단 깊이마다 한 단씩: 위 끝 단은 y1, 아래 끝 너머는 y0
        const k = Math.min(s.steps, Math.floor((1 - t) * s.steps + 1e-9));
        y = s.y1 - ((s.y1 - s.y0) * k) / s.steps;
      } else y = s.y0 + (s.y1 - s.y0) * t;
    }
    if (best === null || y > best) best = y;
  }
  return best;
};

/**
 * 그 점의 바닥 높이(겹치면 가장 높은 값). 걸을 수 없는 곳이면 null.
 * 계단은 부드러운 경사 — 카메라 길(투어·정지 지점·따라가는 카메라)이 단마다 덜컹이지 않게.
 */
export const floorAt = (walk: Walk, p: P2): number | null => floorOf(walk, p, false);

/**
 * 발이 딛는 바닥 높이: `floorAt`과 같되 계단(`slope.steps`)은 디딤판마다 평평하다 — 캐릭터가 단 사이에 파묻히거나
 * 경사 위에 떠서 걷지 않게(ADR-057 보충). 단이 없는 경사는 `floorAt`과 같다.
 */
export const footFloorAt = (walk: Walk, p: P2): number | null => floorOf(walk, p, true);

/** 캐릭터 한가운데가 설 수 있는가(영역 안 · 설비 바닥 밖) */
export const standable = (walk: Walk, p: P2): boolean =>
  walk.areas.some(a => inRect(p, a)) && !walk.obstacles.some(o => inRect(p, o));

/** 모든 점이 걸을 수 있는 영역 안인가 */
export const pathClear = (samples: readonly P2[], rects: readonly Rect[]): boolean =>
  samples.every(p => rects.some(r => inRect(p, r)));
