import { config } from '@gallery/core/config';
import {
  type CameraPose,
  frameAnchorOf,
  frameCamera,
  type P2,
  roundedPath,
  route,
  stopFraming,
  type Vec3,
} from '@gallery/core/layout';
import { cubicBezier } from '@gallery/core/motion';
import type { TourInput, TourMusic, TourPlan, TourSegment } from '@gallery/core/tour';
import type { Layout, Stop, TourSettings } from '@gallery/core/types';
import { faceOffsetOf } from '../scene/types.ts';

/**
 * 자동 투어 카메라(P5-9, PLAN §6.13, G-16). 시각 t → 카메라 자세·화면 밝기를 돌려주는 **순수 함수**.
 * 시간표(`planTour`)는 구간만 정하고, 여기서 배치의 정지 지점·경로점에 얹는다. 멈춤·건너뛰기·되감기는 t만 바꾸면 된다.
 *
 * - 홀: 머물다가 끝 `TOUR_TRANSITION_SEC` 동안 첫 전시실 소개 자리로 걸어감. 처음은 검은 화면에서 밝아짐.
 * - 이름판: 소개 자리(문 안쪽 1.2m에서 대표 벽).
 * - 작품: 정지 지점보다 `TOUR_PATH_DISTANCE_SCALE`배 물러선 자리로 다가가 머무름 — 머무는 동안 `TOUR_LINGER_PUSH`만큼
 *   천천히 다가가며 옆으로 살짝 흐름, 가까이 가기가 있으면 그 시각에 `scale`배까지 다가갔다 물러남.
 * - 문: 경로점을 따라 다음 소개 자리(또는 출구)로, 지나는 동안 노출을 `TOUR_VISUAL_DIP`만큼 낮췄다 되돌림.
 * - 출구: 머물다가 마지막에 어두워짐.
 */

export interface TourFrame {
  readonly pose: CameraPose;
  /** 장면 밝기 곱(0 = 검정, 1 = 그대로) */
  readonly dim: number;
}

export interface TourCamera {
  readonly totalSec: number;
  at(t: number): TourFrame;
}

/** 배치 → 시간표 입력(전시실 순서·관마다 작품 수). 곡은 전시실 ID로 찾는다. */
export const tourInputOf = (
  layout: Layout,
  musicOf: (roomId: string) => TourMusic | null,
  settings: TourSettings,
): TourInput => {
  const roomIds: string[] = [];
  for (const p of layout.parts) if (!roomIds.includes(p.roomId)) roomIds.push(p.roomId);
  return {
    settings,
    rooms: roomIds.map(roomId => ({
      roomId,
      music: musicOf(roomId),
      parts: layout.parts
        .filter(p => p.roomId === roomId)
        .sort((a, b) => a.partIndex - b.partIndex)
        .map(p => layout.stops.filter(s => s.kind === 'artwork' && s.partId === p.partId).length),
    })),
  };
};

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const lerpV = (a: Vec3, b: Vec3, u: number): Vec3 =>
  v3(lerp(a.x, b.x, u), lerp(a.y, b.y, u), lerp(a.z, b.z, u));
const clamp01 = (u: number): number => Math.min(1, Math.max(0, u));
const smooth = (u: number): number => {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};
const unit2 = (x: number, z: number): P2 => {
  const l = Math.hypot(x, z);
  return l > 1e-9 ? [x / l, z / l] : [0, 0];
};

interface Walk {
  readonly path: P2[];
  readonly cum: number[];
  readonly total: number;
}

const walkOf = (points: P2[]): Walk => {
  const path = roundedPath(points);
  const cum = [0];
  for (let i = 1; i < path.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]));
  return { path, cum, total: cum[cum.length - 1] ?? 0 };
};

/** 호 길이 s의 점과 진행 방향 */
const along = (w: Walk, s: number): { p: P2; dir: P2 } => {
  let i = 1;
  while (i < w.cum.length - 1 && w.cum[i]! < s) i++;
  const a = w.path[i - 1] ?? w.path[0]!;
  const b = w.path[i] ?? a;
  const seg = Math.max(1e-9, w.cum[i]! - w.cum[i - 1]!);
  const u = clamp01((s - w.cum[i - 1]!) / seg);
  return { p: [lerp(a[0], b[0], u), lerp(a[1], b[1], u)], dir: unit2(b[0] - a[0], b[1] - a[1]) };
};

export const buildTourCamera = (layout: Layout, plan: TourPlan, aspect: number): TourCamera => {
  const c = config();
  const [x1, y1, x2, y2] = c.MOVE_EASE;
  const ease = cubicBezier(x1, y1, x2, y2);
  /** 투어 걷기(홀·문): 호 길이로 거의 같은 속도 + 양 끝만 부드럽게(§6.13, 최고 속도 = 평균 × π/2) */
  const walkEase = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(u));
  const view = { aspect };
  const mountOf = new Map(layout.frames.map(f => [f.artworkId, f.mount]));
  const stopPose = (s: Stop): CameraPose => {
    const a = frameAnchorOf(s.anchor);
    if (s.kind !== 'artwork') return frameCamera(a, view, stopFraming(s.anchor.floorY));
    const face = faceOffsetOf({ mount: mountOf.get(s.artworkId ?? '') ?? 'WALL' });
    const anchor = {
      ...a,
      center: v3(a.center.x + a.normal.x * face, a.center.y, a.center.z + a.normal.z * face),
      maxDistance: a.maxDistance - face,
    };
    const pose = frameCamera(anchor, view, stopFraming(s.anchor.floorY));
    // 투어는 정지 지점보다 물러서서 지나간다(벽 맞은편 여유 안에서)
    const dx = pose.position.x - pose.target.x;
    const dz = pose.position.z - pose.target.z;
    const d = Math.hypot(dx, dz);
    const d2 = Math.min(d * c.TOUR_PATH_DISTANCE_SCALE, anchor.maxDistance);
    const k = d > 1e-9 ? d2 / d : 1;
    return { ...pose, position: v3(pose.target.x + dx * k, pose.position.y, pose.target.z + dz * k) };
  };

  const stops = new Map(layout.stops.map(s => [s.id, s]));
  const poses = new Map(layout.stops.map(s => [s.id, stopPose(s)]));
  const legOf = (from: string, to: string) => layout.legs.find(l => l.from === from && l.to === to);
  const roomIds = plan.rooms.map(r => r.roomId);
  const partIdOf = (roomIndex: number, partIndex: number): string =>
    layout.parts.find(p => p.roomId === roomIds[roomIndex] && p.partIndex === partIndex)?.partId ?? '';
  const artStops = (partId: string): Stop[] =>
    layout.stops.filter(s => s.kind === 'artwork' && s.partId === partId);
  const hall = layout.stops.find(s => s.kind === 'hall')!;
  const exit = layout.stops.find(s => s.kind === 'exit')!;

  /** 정지 지점 a → b를 경로점 따라 걷는 자세(u: 0..1, 이미 감속 곡선을 거친 값) */
  const walk = (fromId: string, toId: string) => {
    const from = poses.get(fromId)!;
    const to = poses.get(toId)!;
    const leg = legOf(fromId, toId);
    const marks: P2[] = [
      [from.position.x, from.position.z],
      ...(leg?.waypoints ?? []).map(p => [p[0], p[2]] as P2),
      [to.position.x, to.position.z],
    ];
    // 마디마다 키 큰 설비(이젤·화분·기둥)를 돌아서(ADR-057 보충) — 못 찾으면 곧게
    const pts: P2[] = [marks[0]!];
    for (let i = 1; i < marks.length; i++)
      pts.push(
        ...(
          route(layout.walk, marks[i - 1]!, marks[i]!, { tallOnly: true }) ?? [marks[i - 1]!, marks[i]!]
        ).slice(1),
      );
    const w = walkOf(pts);
    const at = (u: number): CameraPose => {
      const { p, dir } = along(w, u * w.total);
      const y = lerp(from.position.y, to.position.y, u);
      const toT = unit2(to.target.x - p[0], to.target.z - p[1]);
      const fromT = unit2(from.target.x - p[0], from.target.z - p[1]);
      const walking = unit2(0.6 * dir[0] + 0.4 * toT[0], 0.6 * dir[1] + 0.4 * toT[1]);
      const a = smooth(u / 0.15);
      const b = smooth((u - 0.7) / 0.3);
      const lx = lerp(lerp(fromT[0], walking[0], a), toT[0], b);
      const lz = lerp(lerp(fromT[1], walking[1], a), toT[1], b);
      const ty = lerp(from.target.y, to.target.y, u);
      const look = u >= 1 ? to.target : v3(p[0] + lx * 3, ty, p[1] + lz * 3);
      return {
        position: v3(p[0], y, p[1]),
        target: look,
        fov: lerp(from.fov, to.fov, u),
        achievedFill: to.achievedFill,
      };
    };
    return { at, length: w.total };
  };

  type Piece = (t: number) => TourFrame;
  const pieces: { seg: TourSegment; at: Piece }[] = []; // `at`은 문 구간이 앞 작품의 떠나기 구간을 덮어쓸 때 바뀐다
  let last: CameraPose = poses.get(hall.id)!;
  const hold =
    (pose: CameraPose): Piece =>
    () => ({ pose, dim: 1 });

  for (let i = 0; i < plan.segments.length; i++) {
    const seg = plan.segments[i]!;
    const len = Math.max(1e-6, seg.endSec - seg.startSec);
    switch (seg.kind) {
      case 'HALL': {
        const first = plan.segments.find(s => s.kind === 'NAMEPLATE');
        const nextId =
          first && first.kind === 'NAMEPLATE'
            ? `intro:${partIdOf(first.roomIndex, first.partIndex)}`
            : exit.id;
        const hallWalk = walk(hall.id, nextId);
        const go = hallWalk.at;
        // 걸음 속도 상한에 맞춰 일찍 떠나되, 검은 화면에서 밝아지기가 끝나기 전에는 떠나지 않는다
        const moveSec = Math.min(
          seg.endSec - seg.fadeInEndSec,
          Math.max(c.TOUR_TRANSITION_SEC, hallWalk.length / c.TOUR_WALK_SPEED_MPS),
        );
        const hallPose = poses.get(hall.id)!;
        pieces.push({
          seg,
          at: t => {
            const dim = smooth((t - seg.startSec) / Math.max(1e-6, seg.fadeInEndSec - seg.startSec));
            const u = (t - (seg.endSec - moveSec)) / moveSec;
            return { pose: u <= 0 ? hallPose : go(walkEase(u)), dim };
          },
        });
        last = poses.get(nextId)!;
        break;
      }
      case 'NAMEPLATE': {
        const pose = poses.get(`intro:${partIdOf(seg.roomIndex, seg.partIndex)}`) ?? last;
        pieces.push({ seg, at: hold(pose) });
        last = pose;
        break;
      }
      case 'ARTWORK': {
        const partId = partIdOf(seg.roomIndex, seg.partIndex);
        const stop = artStops(partId)[seg.artworkIndex];
        const pose = stop ? poses.get(stop.id)! : last;
        const from = last;
        const approach = Math.max(1e-6, seg.approachEndSec - seg.startSec);
        const n = stop ? stops.get(stop.id)!.anchor.normal : ([0, 1] as const);
        const tangent: P2 = [-n[1], n[0]];
        const closeup = seg.closeup;
        // 같은 관 안의 다가가기도 키 큰 설비(이젤·화분)를 돌아서(ADR-057 보충)
        const a2: P2 = [from.position.x, from.position.z];
        const b2: P2 = [pose.position.x, pose.position.z];
        const approachPath = walkOf(route(layout.walk, a2, b2, { tallOnly: true }) ?? [a2, b2]);
        pieces.push({
          seg,
          at: t => {
            if (t < seg.approachEndSec) {
              const u = ease(clamp01((t - seg.startSec) / approach));
              const { p } = along(approachPath, u * approachPath.total);
              return {
                pose: {
                  position: v3(p[0], lerp(from.position.y, pose.position.y, u), p[1]),
                  target: lerpV(from.target, pose.target, smooth(u)),
                  fov: lerp(from.fov, pose.fov, u),
                  achievedFill: pose.achievedFill,
                },
                dim: 1,
              };
            }
            // 머무르기: 천천히 다가가며 옆으로 살짝 흐름 + (있으면) 한 번 가까이 갔다 물러남
            const linger = Math.max(1e-6, seg.endSec - seg.approachEndSec);
            const u = clamp01((t - seg.approachEndSec) / linger);
            let k = 1 - c.TOUR_LINGER_PUSH * smooth(u);
            if (closeup) {
              const bell = Math.sin(
                Math.PI * clamp01((t - seg.approachEndSec) / (2 * (closeup.peakSec - seg.approachEndSec))),
              );
              k *= lerp(1, 1 / closeup.scale, bell * bell);
            }
            const dx = pose.position.x - pose.target.x;
            const dz = pose.position.z - pose.target.z;
            const drift = c.TOUR_LINGER_PUSH * Math.hypot(dx, dz) * Math.sin(Math.PI * (u - 0.5));
            return {
              pose: {
                ...pose,
                position: v3(
                  pose.target.x + dx * k + tangent[0] * drift,
                  pose.position.y,
                  pose.target.z + dz * k + tangent[1] * drift,
                ),
              },
              dim: 1,
            };
          },
        });
        // 다음 구간은 머무르기 끝 자세에서 이어받는다
        last = pieces[pieces.length - 1]!.at(seg.endSec).pose;
        break;
      }
      case 'DOOR': {
        const partId = partIdOf(seg.roomIndex, seg.partIndex);
        const lastArt = artStops(partId).at(-1);
        const nextSeg = plan.segments[i + 1];
        const nextId =
          seg.to === 'EXIT' || !nextSeg || nextSeg.kind !== 'NAMEPLATE'
            ? exit.id
            : `intro:${partIdOf(nextSeg.roomIndex, nextSeg.partIndex)}`;
        const fromId = lastArt?.id ?? `intro:${partId}`;
        const go = walk(fromId, nextId);
        // 떠나는 때: 마지막 작품 머무르기 끝에서(곡 페이드아웃 4초 = 떠나기 + 문 통과, §6.13). 경로가 길면 걸음 속도
        // 상한에 맞춰 더 일찍 — 단 마지막 작품 머무르기의 60%를 넘겨 일찍 떠나지는 않는다.
        const prev = pieces[pieces.length - 1];
        const prevSeg = prev?.seg;
        const minDepart = Math.max(0, c.TOUR_FADE_OUT_SEC - c.TOUR_TRANSITION_SEC);
        const walkSec = Math.max(len + minDepart, go.length / c.TOUR_WALK_SPEED_MPS);
        const earliest =
          prevSeg?.kind === 'ARTWORK'
            ? prevSeg.endSec - 0.6 * (prevSeg.endSec - prevSeg.approachEndSec)
            : seg.startSec;
        const ws = Math.min(seg.startSec, Math.max(earliest, seg.endSec - walkSec));
        const lingerAt = prev?.at ?? hold(last);
        const startPose = lingerAt(ws).pose;
        const blendSec = Math.min(0.5, (seg.endSec - ws) / 4);
        const doorAt = (t: number): TourFrame => {
          const u = walkEase((t - ws) / (seg.endSec - ws));
          const base = go.at(u);
          // 머무르기 자세(조금 다가간 자리)에서 경로 시작점으로 부드럽게 이어 붙인다
          const join = smooth((t - ws) / blendSec);
          return {
            pose: {
              ...base,
              position: lerpV(startPose.position, base.position, join),
              target: lerpV(startPose.target, base.target, join),
            },
            dim:
              t < seg.startSec
                ? 1
                : 1 - c.TOUR_VISUAL_DIP * Math.sin(Math.PI * clamp01((t - seg.startSec) / len)),
          };
        };
        if (prev && ws < seg.startSec) prev.at = t => (t >= ws ? doorAt(t) : lingerAt(t));
        pieces.push({ seg, at: doorAt });
        last = poses.get(nextId)!;
        break;
      }
      case 'EXIT': {
        const pose = poses.get(exit.id)!;
        pieces.push({
          seg,
          at: t => ({
            pose,
            dim: 1 - smooth((t - seg.fadeOutStartSec) / Math.max(1e-6, seg.endSec - seg.fadeOutStartSec)),
          }),
        });
        last = pose;
        break;
      }
    }
  }

  return {
    totalSec: plan.totalSec,
    at: (t: number) => {
      const tt = Math.min(plan.totalSec, Math.max(0, t));
      const piece = pieces.find(p => tt < p.seg.endSec) ?? pieces[pieces.length - 1]!;
      return piece.at(tt);
    },
  };
};
