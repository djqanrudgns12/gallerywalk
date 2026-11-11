import { config } from '../../config.ts';
import type { Walk } from '../../types/layout.ts';
import { inRect, length, type P2, type Rect, sub } from './geom.ts';

/**
 * 걷는 길 찾기(ADR-057): 두 점 사이를 걸을 수 있는 곳 안에서, 설비 바닥(`walk.obstacles`)을 돌아서 잇는다.
 * 곧게 갈 수 있으면 그대로, 아니면 설비 사각형 모서리(바깥으로 `ROUTE_CORNER_OFFSET_M`)와 걸을 수 있는 사각형 모서리(안쪽으로)를 꼭짓점으로 하는
 * 보이는 점 그래프에서 A*. 결정적(같은 입력 → 같은 길) — 투어 카메라·"다음 작품으로" 걷기·배치 시험이 함께 쓴다.
 *
 * `tallOnly`: 카메라 길. 벤치처럼 낮은 설비는 카메라가 위로 지나가도 되므로 키 큰 설비(이젤·화분·기둥·가로등)만 피한다.
 */

export interface RouteOptions {
  readonly tallOnly?: boolean;
}

type Obstacle = Walk['obstacles'][number];

const blocks = (o: Obstacle, tallOnly: boolean): boolean => !tallOnly || o.tall;

const bboxOf = (a: P2, b: P2, pad: number): Rect => ({
  min: [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad],
  max: [Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad],
});

const overlaps = (a: Rect, b: Rect): boolean =>
  a.min[0] <= b.max[0] && b.min[0] <= a.max[0] && a.min[1] <= b.max[1] && b.min[1] <= a.max[1];

/** 점이 설 수 있는가(영역 안 · 피할 설비 밖) */
const free = (areas: readonly Rect[], obstacles: readonly Obstacle[], p: P2): boolean =>
  areas.some(a => inRect(p, a)) && !obstacles.some(o => inRect(p, o));

/**
 * 선분 a→b(매개 t ∈ [0, 1])가 사각형 안에 있는 t 구간(Liang–Barsky). 안 지나면 null.
 */
const clip = (a: P2, b: P2, r: Rect): [number, number] | null => {
  let t0 = 0;
  let t1 = 1;
  for (const k of [0, 1] as const) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) {
      if (a[k] < r.min[k] || a[k] > r.max[k]) return null;
      continue;
    }
    let u0 = (r.min[k] - a[k]) / d;
    let u1 = (r.max[k] - a[k]) / d;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t0 > t1) return null;
  }
  return [t0, t1];
};

/**
 * 선분 전체가 걸을 수 있는 곳(사각형들의 합) 안이고 피할 설비를 지나지 않는가 — 점을 촘촘히 찍지 않고 구간으로 바로 계산한다
 * (넓은 전시에서 길 찾기가 휴대폰에서도 즉시 끝나게).
 */
const segmentFree = (areas: readonly Rect[], obstacles: readonly Obstacle[], a: P2, b: P2): boolean => {
  const len = length(sub(b, a));
  const eps = len > 0 ? 1e-6 / len : 0;
  for (const o of obstacles) {
    const c = clip(a, b, o);
    if (c && c[1] - c[0] > eps) return false;
    if (c && len === 0) return false;
  }
  const spans: [number, number][] = [];
  for (const r of areas) {
    const c = clip(a, b, r);
    if (c) spans.push(c);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let reach = 0;
  for (const [s0, s1] of spans) {
    if (s0 > reach + eps) return false;
    reach = Math.max(reach, s1);
    if (reach >= 1 - eps) return true;
  }
  return reach >= 1 - eps;
};

/** from → to 꺾은선(양 끝 포함). 길이 없으면 null(시작·끝이 설 수 없는 곳이거나 막힘) */
export const route = (walk: Walk, from: P2, to: P2, options: RouteOptions = {}): P2[] | null => {
  const c = config();
  const tallOnly = options.tallOnly ?? false;
  // 둘레만 본다: 두 점을 감싼 사각형 + 여유 안의 영역·설비(먼 관의 설비는 이 길과 상관없음)
  const box = bboxOf(from, to, c.ROUTE_SEARCH_PAD_M);
  const areas = walk.areas.filter(a => overlaps(a, box));
  // 카메라 길: 걷기 여유(캐릭터 반지름)를 빼고 카메라 여유만 — 몸이 없어 설비에 더 가까이 지나가도 된다
  const shrinkBy = tallOnly ? c.WALKABLE_WALL_MARGIN_M - c.ROUTE_CAMERA_CLEARANCE_M : 0;
  const obstacles = walk.obstacles
    .filter(o => blocks(o, tallOnly) && overlaps(o, box))
    .map(o =>
      shrinkBy > 0
        ? {
            min: [o.min[0] + shrinkBy, o.min[1] + shrinkBy] as P2,
            max: [o.max[0] - shrinkBy, o.max[1] - shrinkBy] as P2,
            tall: o.tall,
          }
        : o,
    );
  if (!free(areas, obstacles, from) || !free(areas, obstacles, to)) return null;
  if (segmentFree(areas, obstacles, from, to)) return [from, to];

  const off = c.ROUTE_CORNER_OFFSET_M;
  const nodes: P2[] = [from, to];
  for (const o of obstacles)
    for (const p of [
      [o.min[0] - off, o.min[1] - off],
      [o.max[0] + off, o.min[1] - off],
      [o.max[0] + off, o.max[1] + off],
      [o.min[0] - off, o.max[1] + off],
    ] as P2[])
      if (free(areas, obstacles, p)) nodes.push(p);
  // 걸을 수 있는 사각형의 모서리(안쪽으로 조금) — 홀 → 회랑 열림처럼 영역이 꺾이는 곳을 돌아가는 꼭짓점(Codex 검토 P1)
  for (const r of areas)
    for (const p of [
      [r.min[0] + off, r.min[1] + off],
      [r.max[0] - off, r.min[1] + off],
      [r.max[0] - off, r.max[1] - off],
      [r.min[0] + off, r.max[1] - off],
    ] as P2[])
      if (free(areas, obstacles, p)) nodes.push(p);

  // A*(꼭짓점 수가 작아 완전 그래프 + 지연 간선 검사)
  const dist = (i: number, j: number): number => length(sub(nodes[j]!, nodes[i]!));
  const g = new Array<number>(nodes.length).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<number>(nodes.length).fill(-1);
  const done = new Array<boolean>(nodes.length).fill(false);
  g[0] = 0;
  for (;;) {
    let cur = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < nodes.length; i++) {
      if (done[i]) continue;
      const f = g[i]! + dist(i, 1);
      if (f < best - 1e-12) {
        best = f;
        cur = i;
      }
    }
    if (cur === -1 || !Number.isFinite(best)) return null;
    if (cur === 1) break;
    done[cur] = true;
    for (let j = 0; j < nodes.length; j++) {
      if (done[j] || j === cur) continue;
      const cand = g[cur]! + dist(cur, j);
      if (cand >= g[j]! - 1e-12) continue;
      if (!segmentFree(areas, obstacles, nodes[cur]!, nodes[j]!)) continue;
      g[j] = cand;
      prev[j] = cur;
    }
  }
  const path: P2[] = [];
  for (let i = 1; i !== -1; i = prev[i]!) path.push(nodes[i]!);
  return path.reverse();
};
