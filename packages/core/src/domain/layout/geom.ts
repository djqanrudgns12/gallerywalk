/**
 * 바닥 평면 기하(three 세계 좌표의 [X, Z]). 배치 엔진 안에서만 쓰는 작은 도우미.
 */

export type P2 = [number, number];

/** 1mm 반올림(§4.10). −0은 0으로 — 정규 JSON이 같은 글이 되게. */
export const mm = (v: number): number => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

export const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: P2, s: number): P2 => [a[0] * s, a[1] * s];
export const dot = (a: P2, b: P2): number => a[0] * b[0] + a[1] * b[1];
export const length = (a: P2): number => Math.hypot(a[0], a[1]);
export const unit = (a: P2): P2 => {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
};

/** 논리 (x, y) → 세계. 관의 `frame`(§4.1) */
export interface Frame2 {
  readonly origin: P2;
  readonly ax: P2;
  readonly ay: P2;
}

export const toWorld = (f: Frame2, x: number, y: number): P2 => [
  f.origin[0] + x * f.ax[0] + y * f.ay[0],
  f.origin[1] + x * f.ax[1] + y * f.ay[1],
];

export const dirToWorld = (f: Frame2, dx: number, dy: number): P2 => [
  dx * f.ax[0] + dy * f.ay[0],
  dx * f.ax[1] + dy * f.ay[1],
];

/**
 * 조각 회전(three `rotation.y`): 지역 +X가 세계 방향 d로 간다. 그때 지역 +Z(조각의 방 안쪽)는 (−d_z, d_x).
 * (회전 θ의 지역 +X = (cos θ, −sin θ), 지역 +Z = (sin θ, cos θ))
 */
export const rotYFor = (d: P2): number => {
  const r = Math.atan2(-d[1], d[0]);
  return Object.is(r, -0) ? 0 : r;
};

/** 방향 d로 놓인 조각의 방 안쪽 */
export const interiorOf = (d: P2): P2 => [-d[1], d[0]];

/**
 * 벽 한 줄: 시작·끝·방 안쪽이 주어지면, 조각이 방 안쪽을 보도록 걷는 방향을 고른다(필요하면 끝에서 시작).
 */
export interface WallRun {
  readonly origin: P2;
  readonly dir: P2;
  readonly length: number;
  readonly rotY: number;
}

export const wallRun = (a: P2, b: P2, interior: P2): WallRun => {
  const d = unit(sub(b, a));
  const flip = dot(interiorOf(d), interior) < 0;
  const origin = flip ? b : a;
  const dir: P2 = flip ? [-d[0], -d[1]] : d;
  return { origin, dir, length: length(sub(b, a)), rotY: rotYFor(dir) };
};

/** 축에 나란한 사각형 */
export interface Rect {
  readonly min: P2;
  readonly max: P2;
}

export const rectOf = (a: P2, b: P2): Rect => ({
  min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
  max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
});

export const inRect = (p: P2, r: Rect): boolean =>
  p[0] >= r.min[0] && p[0] <= r.max[0] && p[1] >= r.min[1] && p[1] <= r.max[1];

export const shrink = (r: Rect, m: number): Rect => ({
  min: [r.min[0] + m, r.min[1] + m],
  max: [r.max[0] - m, r.max[1] - m],
});

export const rectPolygon = (r: Rect): P2[] => [
  [r.min[0], r.min[1]],
  [r.max[0], r.min[1]],
  [r.max[0], r.max[1]],
  [r.min[0], r.max[1]],
];
