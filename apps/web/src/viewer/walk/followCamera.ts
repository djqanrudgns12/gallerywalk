import { config } from '@gallery/core/config';
import type { P2, Vec3 } from '@gallery/core/layout';
import type { Walk } from '@gallery/core/types';

/**
 * 따라가는 카메라(3인칭, ADR-057). 캐릭터 머리 쪽 한 점을 중심으로 도는 궤도(yaw·pitch·거리).
 * 벽 뒤로 넘어가지 않게: 카메라 자리가 "걸을 수 있는 곳 + 여유" 밖이면 중심 쪽으로 당긴다(벽 메시와 광선 검사를 하지 않아
 * 휴대폰에서도 가볍다 — 걸을 수 있는 곳은 벽에서 캐릭터 반지름만큼 안쪽이므로 여유만큼 넓혀도 벽 면에 닿지 않는다).
 * 천장이 있는 곳(실내·현관)에서는 천장 아래로 누른다.
 */

export interface Orbit {
  /** 카메라가 바라보는 방향(rad, 0 = +Z) */
  readonly yaw: number;
  /** 내려다보는 각(+ = 위에서) */
  readonly pitch: number;
  readonly distance: number;
}

export const defaultOrbit = (yaw: number): Orbit => {
  const c = config();
  return { yaw, pitch: c.CAM_PITCH_RAD.default, distance: c.CAM_DISTANCE_M.default };
};

export const clampOrbit = (o: Orbit): Orbit => {
  const c = config();
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    yaw: o.yaw,
    pitch: clamp(o.pitch, c.CAM_PITCH_RAD.min, c.CAM_PITCH_RAD.max),
    distance: clamp(o.distance, c.CAM_DISTANCE_M.min, c.CAM_DISTANCE_M.max),
  };
};

interface Space {
  readonly inside: (p: P2) => { ceiling: number | null } | null;
}

/**
 * 카메라가 있을 수 있는 곳: 걸을 수 있는 곳을 여유만큼 넓힌 것에서 키 큰 설비(기둥·이젤·화분 — 실제 바닥 + 카메라 여유)를 뺀 것.
 * 겹치면 천장은 낮은 쪽.
 */
export const cameraSpace = (walk: Walk): Space => {
  const c = config();
  const s = c.CAM_WALL_SLACK_M;
  const shrink = c.WALKABLE_WALL_MARGIN_M - c.ROUTE_CAMERA_CLEARANCE_M;
  const tall = walk.obstacles
    .filter(o => o.tall)
    .map(o => ({
      x0: o.min[0] + shrink,
      z0: o.min[1] + shrink,
      x1: o.max[0] - shrink,
      z1: o.max[1] - shrink,
    }));
  const boxes = walk.areas.map(a => ({
    x0: a.min[0] - s,
    z0: a.min[1] - s,
    x1: a.max[0] + s,
    z1: a.max[1] + s,
    ceiling: a.ceiling ?? null,
  }));
  return {
    inside: p => {
      if (tall.some(t => p[0] > t.x0 && p[0] < t.x1 && p[1] > t.z0 && p[1] < t.z1)) return null;
      let hit = false;
      let ceiling: number | null = null;
      for (const b of boxes) {
        if (p[0] < b.x0 || p[0] > b.x1 || p[1] < b.z0 || p[1] > b.z1) continue;
        hit = true;
        if (b.ceiling !== null) ceiling = ceiling === null ? b.ceiling : Math.min(ceiling, b.ceiling);
      }
      return hit ? { ceiling } : null;
    },
  };
};

export interface FollowPose {
  readonly position: Vec3;
  readonly target: Vec3;
  /** 벽 때문에 당긴 뒤의 거리 */
  readonly distance: number;
}

/** 중심점(캐릭터 머리 쪽)과 궤도 → 카메라 자리. 중심에서 바깥으로 걸어 나가며 처음 막히는 곳 바로 앞까지 */
export const followPose = (space: Space, center: Vec3, orbit: Orbit): FollowPose => {
  const c = config();
  const cp = Math.cos(orbit.pitch);
  const dir = { x: -Math.sin(orbit.yaw) * cp, y: Math.sin(orbit.pitch), z: -Math.cos(orbit.yaw) * cp };
  const step = c.PATH_SAMPLE_M;
  let d = 0;
  let ceilingAt: number | null = space.inside([center.x, center.z])?.ceiling ?? null;
  while (d + step <= orbit.distance + 1e-9) {
    const t = d + step;
    const p: P2 = [center.x + dir.x * t, center.z + dir.z * t];
    const hit = space.inside(p);
    if (!hit) break;
    const y = center.y + dir.y * t;
    if (hit.ceiling !== null && y > hit.ceiling - c.CAM_CEILING_MARGIN_M) {
      ceilingAt = hit.ceiling;
      // 천장에 닿으면 더 물러서지 않고, 높이만 천장 아래로
      d = t;
      break;
    }
    d = t;
  }
  // 벽에 바짝 붙으면 거리가 아주 짧아질 수 있다(벽 밖으로 밀어내지 않음) — 그리는 쪽이 캐릭터를 흐리게(`distance`)
  const distance = d;
  let y = center.y + dir.y * distance;
  if (ceilingAt !== null) y = Math.min(y, ceilingAt - c.CAM_CEILING_MARGIN_M);
  return {
    position: { x: center.x + dir.x * distance, y, z: center.z + dir.z * distance },
    target: center,
    distance,
  };
};

/** 지수 감쇠(프레임 빠르기와 상관없이 같은 느낌): 남은 거리 × e^(−k·dt) */
export const damp = (current: number, target: number, k: number, dt: number): number =>
  target + (current - target) * Math.exp(-k * dt);

export const dampAngle = (current: number, target: number, k: number, dt: number): number => {
  let d = target - current;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return target - d * Math.exp(-k * dt);
};
