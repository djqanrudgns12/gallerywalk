import { config } from '@gallery/core/config';
import { footFloorAt, type P2, standable } from '@gallery/core/layout';
import type { Walk } from '@gallery/core/types';
import type { MoveState } from '@gallery/core/types';
import { JUMP_IDLE, jumpBusy, type JumpState, jumpStart, stepJump } from './jumpPose.ts';

/**
 * 캐릭터 걷기(ADR-057 자유 관람). three에 기대지 않는 순수 상태 기계 — 매 프레임 `step(dt, 입력)`.
 *
 * - 입력은 카메라 기준 앞·옆(−1..1)과 뛰기. 세계 방향으로 돌려 가속·감속하고, 몸은 가는 방향으로 돈다.
 * - 충돌: 다음 자리가 설 수 없으면(걸을 수 있는 곳 밖·설비 바닥 안) 축마다 나눠 미끄러지고, 그래도 안 되면 멈춘다.
 *   걸을 수 있는 곳은 벽에서 캐릭터 반지름만큼 안쪽이라 몸이 벽을 뚫지 않는다(배치 엔진 `walk`).
 * - 높이: 발 바닥 높이(`footFloorAt`, 계단은 디딤판마다 평평)를 빨리 따라간다 — 단 사이에 파묻히거나 경사 위에 뜨지 않게.
 *   (카메라는 부드러운 경사 `floorAt`을 따로 쓴다.)
 * - 사람끼리: `setCrowd(둘레 사람 자리, 도슨트)`를 주면 몸 반지름 두 배보다 가까운 사람에게서 밀려나고, 가는 중이면 옆으로 비켜 돈다.
 *   닿은 채 다가가는 빠르기(나 − 상대, 상대 쪽 성분)가 `CROWD_BUMP_MPS` 이상이면 부딪힘(W-07): 손 입력을 잠깐 멈추고
 *   `CROWD_BUMP_PUSH_SEC` 동안 `CROWD_BUMP_PUSH_M` 뒤로 밀려난다(몸 연출은 벽 부딪힘을 약하게). 안내 이동 중에는 비켜 가기만.
 *   상대 빠르기는 앞 프레임 자리에서 가장 가까운 점으로 어림한다(받은 보간 자리 그대로). 도슨트는 움직이지 않는 사람.
 * - 광장 경계(W-06): 하늘 아래 걸을 수 있는 곳(`ceiling` 없음)을 감싼 사각형의 바깥 변 중 실내 영역이 닿지 않은 변이 경계다.
 *   그 `BOUNDARY_SOFT_M` 앞부터 바깥 쪽 손 입력을 거리에 비례해 줄이고, 닿으면 `BOUNDARY_PUSH_SEC` 동안 `BOUNDARY_PUSH_M`
 *   안쪽으로 부드럽게 민다(몸 눌림 없음). 정면 벽·실내 벽은 그대로 벽 부딪힘.
 * - 안내 이동: `follow(경로)`를 주면 손 입력이 없는 동안 그 꺾은선을 따라 걷고, 끝에서 `faceYaw`로 돌아선다.
 *   손 입력이 들어오면 안내는 바로 끝난다(아이가 언제든 스스로 움직일 수 있게).
 * - 벽 부딪힘: 거의 정면으로 세게 막히면 잠깐 멈추고(손 입력 무시) 살짝 뒤로 밀려난다(`CHAR_BUMP_*`). 비스듬하면 미끄러짐.
 * - 점프(놀이): `jump()` — 웅크림(`CHAR_JUMP_SQUASH.crouchSec`) 뒤 바닥 높이 위 `air`만큼 떠오르고 중력으로 내려온다.
 *   떠 있는 동안에도 앞뒤로는 움직인다. 몸 연출 단계는 `pose.jump`(`jumpPose.ts`).
 * - 뛰기 잠금: `lockRun(초)` 동안은 뛰기 입력을 걷기로(관람 예절 알림 뒤).
 * - 일어난 일(`bump`·`jump`·`land`·`crowd`·`boundary`)은 `drainEvents()`로 꺼내 간다(소리·말풍선·흔들림·먼지).
 */

export interface WalkInput {
  /** 카메라 기준 앞(+)·뒤(−) */
  readonly forward: number;
  /** 카메라 기준 오른쪽(+)·왼쪽(−) */
  readonly strafe: number;
  readonly run: boolean;
  /** 카메라가 바라보는 방향(rad, 0 = +Z) — 입력을 세계 방향으로 돌릴 때 */
  readonly cameraYaw: number;
}

export interface WalkerPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 몸이 바라보는 방향(rad, 0 = +Z) */
  readonly yaw: number;
  /** 지금 빠르기(m/s) */
  readonly speed: number;
  readonly move: MoveState;
  /** 바닥 위로 떠 있는 높이(m, 점프) — `y`에 이미 더해져 있다 */
  readonly air: number;
  /** 벽에 부딪혀 멈춘 동안 0..1(1 = 막 부딪힘) */
  readonly bump: number;
  /** 사람과 부딪혀 밀려나는 동안 0..1(1 = 막 부딪힘) */
  readonly crowdBump: number;
  /** 점프 몸 연출 단계 */
  readonly jump: JumpState;
}

export type WalkerEvent = 'arrived' | 'cancelled';
/** `crowd` = 사람과 부딪힘, `boundary` = 광장 경계에 닿음 */
export type WalkerFx = 'bump' | 'jump' | 'land' | 'crowd' | 'boundary';

/** 바깥으로 향하는 단위 방향과 그 변의 자리. axis 0 = x, 1 = z */
interface OpenEdge {
  readonly axis: 0 | 1;
  readonly sign: 1 | -1;
  readonly at: number;
}

interface Outdoor {
  readonly edges: readonly OpenEdge[];
  readonly indoor: Walk['areas'];
}

/** 같은 사람으로 다룰 둘레 점(도슨트 포함) */
type Spot = readonly [number, number];
const ZERO: Spot = [0, 0];

/**
 * 광장 경계 변: 하늘 아래(`ceiling` 없음) 걸을 수 있는 곳을 감싼 사각형의 네 변 중, 실내(`ceiling` 있음) 영역이
 * 그 변까지(또는 너머로) 닿지 않은 변. 정면(현관이 닿음)은 벽으로 남는다.
 */
const outdoorOf = (walk: Walk): Outdoor => {
  const sky = walk.areas.filter(a => a.ceiling === undefined);
  const indoor = walk.areas.filter(a => a.ceiling !== undefined);
  if (sky.length === 0) return { edges: [], indoor };
  const lo: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const hi: [number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const a of sky)
    for (const k of [0, 1] as const) {
      lo[k] = Math.min(lo[k], a.min[k]);
      hi[k] = Math.max(hi[k], a.max[k]);
    }
  const eps = 1e-6;
  const edges: OpenEdge[] = [];
  for (const axis of [0, 1] as const) {
    if (!indoor.some(a => a.max[axis] >= hi[axis] - eps)) edges.push({ axis, sign: 1, at: hi[axis] });
    if (!indoor.some(a => a.min[axis] <= lo[axis] + eps)) edges.push({ axis, sign: -1, at: lo[axis] });
  }
  return { edges, indoor };
};

/** 앞 프레임 점들에서 가장 가까운 점으로 빠르기 어림(못 찾으면 0) */
const matchVelocities = (prev: readonly Spot[], next: readonly Spot[], dt: number): Spot[] => {
  // 이보다 빠른 움직임은 같은 사람이 아니라고 본다(끊겼다 다시 이어진 자리 등)
  const reach = config().CHAR_RUN_MPS * config().CROWD_PEER_MATCH_RUN_RATIO * dt;
  return next.map(q => {
    let best: Spot | null = null;
    let bestD = reach;
    for (const p of prev) {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= bestD) {
        best = p;
        bestD = d;
      }
    }
    return best ? [(q[0] - best[0]) / dt, (q[1] - best[1]) / dt] : ZERO;
  });
};

interface Guide {
  readonly points: readonly P2[];
  index: number;
  /** 거의 움직이지 못한 시간(s) — 막히면 안내를 끝낸다 */
  stuck: number;
  readonly faceYaw: number | null;
  readonly onDone: (e: WalkerEvent) => void;
}

const wrap = (a: number): number => {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
};

/** 0 = +Z를 보는 방향 기준으로 (x, z) 방향의 각 */
export const yawOf = (dx: number, dz: number): number => Math.atan2(dx, dz);

export class Walker {
  private x: number;
  private z: number;
  private y: number;
  private yaw: number;
  private vx = 0;
  private vz = 0;
  private guide: Guide | null = null;
  private walk: Walk;
  private air = 0;
  private vy = 0;
  /** 뜬 뒤 지난 시간(s) — 높이를 해석식으로(화면 빈도와 상관없이 같은 곡선, 남의 점프 재생 `peerJumpAt`과 같음) */
  private flyT = 0;
  private bumpLeft = 0;
  private recoilX = 0;
  private recoilZ = 0;
  private runLockLeft = 0;
  private events: WalkerFx[] = [];
  private crowd: readonly Spot[] = [];
  private crowdVel: readonly Spot[] = [];
  /** 빠르기 어림의 기준(앞 프레임 점·그 시각) */
  private crowdRef: readonly Spot[] = [];
  private crowdRefAt = 0;
  private fixed: readonly { readonly pos: Spot }[] = [];
  private clock = 0;
  private jumpState: JumpState = JUMP_IDLE;
  /** 사람 부딪힘 밀림: 남은 시간 · 처음 빠르기(방향 포함) */
  private crowdLeft = 0;
  private crowdPushX = 0;
  private crowdPushZ = 0;
  /** 광장 경계 밀림: 남은 시간 · 처음 빠르기 · 그 변의 바깥 방향 */
  private edgeLeft = 0;
  private edgePushX = 0;
  private edgePushZ = 0;
  private edgeOut: OpenEdge | null = null;
  private outdoor: Outdoor;

  constructor(walk: Walk, start: { x: number; z: number; yaw: number }) {
    this.walk = walk;
    this.outdoor = outdoorOf(walk);
    this.x = start.x;
    this.z = start.z;
    this.yaw = start.yaw;
    this.y = footFloorAt(walk, [start.x, start.z]) ?? 0;
  }

  get pose(): WalkerPose {
    const speed = Math.hypot(this.vx, this.vz);
    const c = config();
    const move: MoveState = speed < 0.05 ? 0 : speed > (c.CHAR_WALK_MPS + c.CHAR_RUN_MPS) / 2 ? 2 : 1;
    return {
      x: this.x,
      y: this.y + this.air,
      z: this.z,
      yaw: this.yaw,
      speed,
      move,
      air: this.air,
      bump: this.bumpLeft > 0 ? this.bumpLeft / c.CHAR_BUMP_PAUSE_SEC : 0,
      crowdBump: this.crowdLeft > 0 ? this.crowdLeft / c.CROWD_BUMP_PUSH_SEC : 0,
      jump: this.jumpState,
    };
  }

  /** 땅에 있고 부딪혀 멈춘 중이 아니면 웅크렸다가 뛰어오른다(웅크림 동안 다시 눌러도 한 번) */
  jump(): boolean {
    if (this.air > 0 || this.vy !== 0 || this.bumpLeft > 0 || this.crowdLeft > 0 || jumpBusy(this.jumpState))
      return false;
    this.jumpState = jumpStart();
    this.events.push('jump');
    return true;
  }

  /**
   * 둘레 다른 사람들의 자리(x, z)와 도슨트(움직이지 않는 사람) — 매 프레임 준다. 겹치지 않게 밀려나고, 세게 닿으면 부딪힘.
   * 상대 빠르기는 앞 프레임 점과의 차로 어림한다(같은 시각에 두 번 주면 앞 어림을 그대로 둔다).
   */
  setCrowd(points: readonly Spot[], fixed: readonly { readonly pos: Spot }[] = []): void {
    this.fixed = fixed;
    const dt = this.clock - this.crowdRefAt;
    if (dt > 1e-4) {
      this.crowdVel = matchVelocities(this.crowdRef, points, dt);
      this.crowdRef = points;
      this.crowdRefAt = this.clock;
    } else if (this.crowdVel.length !== points.length) this.crowdVel = points.map(() => ZERO);
    this.crowd = points;
  }

  /** 이 시간 동안 뛰기 입력을 걷기로 */
  lockRun(sec: number): void {
    this.runLockLeft = Math.max(this.runLockLeft, sec);
  }

  get runLocked(): boolean {
    return this.runLockLeft > 0;
  }

  /** 지난번 꺼낸 뒤 일어난 일 */
  drainEvents(): WalkerFx[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  get guiding(): boolean {
    return this.guide !== null;
  }

  /** 지금 멈춰 있고(빠르기 0) 높이도 바닥에 닿았는가 — 다시 그리기를 멈춰도 되는가 */
  get settled(): boolean {
    const floor = footFloorAt(this.walk, [this.x, this.z]) ?? this.y;
    return (
      this.guide === null &&
      this.vx === 0 &&
      this.vz === 0 &&
      this.air === 0 &&
      this.vy === 0 &&
      this.bumpLeft <= 0 &&
      this.crowdLeft <= 0 &&
      this.edgeLeft <= 0 &&
      this.jumpState.phase === 'idle' &&
      Math.abs(floor - this.y) < 1e-3
    );
  }

  /** 바로 옮긴다(처음 자리·화면에서 고른 자리). 설 수 없는 곳이면 무시 */
  place(x: number, z: number, yaw: number): boolean {
    if (!standable(this.walk, [x, z])) return false;
    this.cancel();
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.air = 0;
    this.vy = 0;
    this.flyT = 0;
    this.bumpLeft = 0;
    this.crowdLeft = 0;
    this.edgeLeft = 0;
    this.jumpState = JUMP_IDLE;
    this.y = footFloorAt(this.walk, [x, z]) ?? this.y;
    return true;
  }

  /**
   * 새 배치로 바꾼다(전시가 바뀜, P4-9): 지금 자리에 새 배치에서도 설 수 있으면 그대로 이어 가고(`kept`),
   * 못 서면 새 배치의 첫 자리로(`spawn`). 걷던 안내는 끝낸다(옛 길은 새 벽을 모른다).
   */
  rebase(walk: Walk): 'kept' | 'spawn' {
    this.cancel();
    this.walk = walk;
    this.outdoor = outdoorOf(walk);
    this.crowd = [];
    this.crowdVel = [];
    this.crowdRef = [];
    this.edgeLeft = 0;
    if (standable(walk, [this.x, this.z])) {
      this.y = footFloorAt(walk, [this.x, this.z]) ?? this.y;
      return 'kept';
    }
    this.place(walk.spawn.pos[0], walk.spawn.pos[2], walk.spawn.yaw);
    return 'spawn';
  }

  /** 꺾은선(첫 점 = 지금 자리 근처)을 따라 걷는다. 끝나면 `faceYaw`로 돌아선다 */
  follow(points: readonly P2[], faceYaw: number | null, onDone: (e: WalkerEvent) => void): void {
    this.cancel();
    if (points.length === 0) {
      onDone('arrived');
      return;
    }
    this.guide = { points, index: 0, stuck: 0, faceYaw, onDone };
  }

  cancel(): void {
    const g = this.guide;
    this.guide = null;
    g?.onDone('cancelled');
  }

  /** 한 프레임. 움직였거나 아직 멈추는 중이면 true(다시 그려야 함) */
  step(dtIn: number, input: WalkInput): boolean {
    if (!Number.isFinite(dtIn) || dtIn <= 0) return !this.settled;
    const steps = Math.ceil(dtIn / config().WALK_PHYSICS_STEP_SEC);
    const dt = dtIn / steps;
    let moving = false;
    // 시간을 버리면 저속 기기에서 걷기·안내·점프가 모두 느려진다. 벽 검사만 작은 간격으로 나눈다.
    for (let i = 0; i < steps; i++) moving = this.stepSlice(dt, input) || moving;
    return moving;
  }

  private stepSlice(dt: number, input: WalkInput): boolean {
    const c = config();
    this.clock += dt;
    this.runLockLeft = Math.max(0, this.runLockLeft - dt);
    const airMoving = this.stepAir(dt);

    // ── 벽에 부딪혀 멈춘 동안: 손 입력 무시, 앞부분만 뒤로 밀려남 ───────────────
    if (this.bumpLeft > 0) {
      const pause = c.CHAR_BUMP_PAUSE_SEC;
      const recoilT = pause * c.CHAR_BUMP_RECOIL_PART;
      const elapsed = pause - this.bumpLeft;
      // 선형으로 줄어드는 빠르기: 처음 v0 → recoilT에 0, 움직인 거리 = v0·recoilT/2 = CHAR_BUMP_RECOIL_M
      const k = elapsed < recoilT ? 1 - elapsed / recoilT : 0;
      this.vx = this.recoilX * k;
      this.vz = this.recoilZ * k;
      this.moveBy(this.vx * dt, this.vz * dt);
      this.bumpLeft = Math.max(0, this.bumpLeft - dt);
      if (this.bumpLeft === 0) {
        this.vx = 0;
        this.vz = 0;
      }
      this.settleFloor(dt);
      return true;
    }

    // ── 사람과 부딪혀 밀려나는 동안: 손 입력 무시, 줄어드는 빠르기로 뒤로(거리 = v0·T/2) ─────────
    if (this.crowdLeft > 0) {
      const span = Math.min(dt, this.crowdLeft);
      const k = (this.crowdLeft - span / 2) / c.CROWD_BUMP_PUSH_SEC;
      this.vx = 0;
      this.vz = 0;
      this.moveBy(this.crowdPushX * k * span, this.crowdPushZ * k * span);
      this.crowdLeft = Math.max(0, this.crowdLeft - dt);
      this.settleFloor(dt);
      return true;
    }

    const manual = Math.hypot(input.forward, input.strafe) > 1e-3;
    if (manual && this.guide) this.cancel();
    const running = input.run && this.runLockLeft <= 0;

    // ── 원하는 속도 ─────────────────────────────────────────
    let wantX = 0;
    let wantZ = 0;
    let faceAtEnd: number | null = null;
    if (manual) {
      const len = Math.min(1, Math.hypot(input.forward, input.strafe));
      const f = input.forward / Math.max(1, Math.hypot(input.forward, input.strafe));
      const s = input.strafe / Math.max(1, Math.hypot(input.forward, input.strafe));
      // 카메라 앞 = (sin yaw, cos yaw), 오른쪽 = (−cos yaw, sin yaw)(+Z를 볼 때 오른쪽 = −X)
      const sy = Math.sin(input.cameraYaw);
      const cy = Math.cos(input.cameraYaw);
      const dx = f * sy - s * cy;
      const dz = f * cy + s * sy;
      const n = Math.hypot(dx, dz) || 1;
      const speed = (running ? c.CHAR_RUN_MPS : c.CHAR_WALK_MPS) * len;
      wantX = (dx / n) * speed;
      wantZ = (dz / n) * speed;
    } else if (this.guide) {
      const g = this.guide;
      const speed = c.CHAR_WALK_MPS * c.GUIDE_SPEED_SCALE;
      // 지나간 점은 건너뛴다(한 프레임에 갈 거리 안이면)
      while (g.index < g.points.length - 1) {
        const p = g.points[g.index]!;
        if (Math.hypot(p[0] - this.x, p[1] - this.z) > Math.max(c.GUIDE_ARRIVE_M, speed * dt)) break;
        g.index++;
      }
      const target = g.points[g.index]!;
      const dx = target[0] - this.x;
      const dz = target[1] - this.z;
      const dist = Math.hypot(dx, dz);
      const last = g.index === g.points.length - 1;
      // 도착 자리에 다른 사람이 서 있으면 밀려나 닿지 못하므로 몸 두 개만큼 넓혀 도착으로 친다
      const near = (q: Spot): boolean =>
        Math.hypot(q[0] - target[0], q[1] - target[1]) < 2 * c.CHAR_BODY_RADIUS_M;
      const taken = this.crowd.some(near) || this.fixed.some(n => near(n.pos));
      const arriveR = c.GUIDE_ARRIVE_M + (taken ? 2 * c.CHAR_BODY_RADIUS_M : 0);
      if (last && dist <= arriveR) {
        faceAtEnd = g.faceYaw;
        this.vx = 0;
        this.vz = 0;
        this.guide = null;
        if (faceAtEnd !== null) this.yaw = faceAtEnd;
        g.onDone('arrived');
        this.settleFloor(dt);
        return true;
      }
      // 끝에서는 감속 거리 안에서 줄인다(v² = 2ad)
      const brake = last ? Math.sqrt(2 * c.CHAR_DECEL_MPS2 * dist) : Number.POSITIVE_INFINITY;
      const v = Math.min(speed, brake);
      wantX = (dx / (dist || 1)) * v;
      wantZ = (dz / (dist || 1)) * v;
    }

    // ── 광장 경계 앞: 바깥 쪽 손 입력을 거리에 비례해 줄인다(닿으면 안쪽으로 밀림) ───────────
    const edge = manual ? this.softenEdge(wantX, wantZ) : null;
    if (edge) {
      wantX = edge.wantX;
      wantZ = edge.wantZ;
    }

    // ── 가속·감속 ───────────────────────────────────────────
    const dvx = wantX - this.vx;
    const dvz = wantZ - this.vz;
    const dv = Math.hypot(dvx, dvz);
    const accel =
      Math.hypot(wantX, wantZ) > Math.hypot(this.vx, this.vz) ? c.CHAR_ACCEL_MPS2 : c.CHAR_DECEL_MPS2;
    const maxDv = accel * dt;
    if (dv <= maxDv) {
      this.vx = wantX;
      this.vz = wantZ;
    } else {
      this.vx += (dvx / dv) * maxDv;
      this.vz += (dvz / dv) * maxDv;
    }
    // 경계 쪽 빠르기도 줄인 입력보다 빠르지 않게(감속을 기다리면 뛰다가 경계에 걸려 벽 부딪힘이 된다)
    if (edge) this.clampOutward(edge.limits);

    // ── 옮기기(축마다 미끄러짐) ──────────────────────────────────
    const bx = this.x;
    const bz = this.z;
    const moved = this.moveBy(this.vx * dt, this.vz * dt);
    // 막힌 축의 빠르기 = 벽 쪽으로 들이받은 빠르기. 손으로 걷다 거의 정면으로 세게 막히면 부딪힘
    const hitX = moved.x ? 0 : this.vx;
    const hitZ = moved.z ? 0 : this.vz;
    const hit = Math.hypot(hitX, hitZ);
    const tried = Math.hypot(this.vx, this.vz);
    if (!moved.x) this.vx = 0;
    if (!moved.z) this.vz = 0;
    if (manual && hit >= c.CHAR_BUMP_MIN_MPS && hit >= c.CHAR_BUMP_MIN_RATIO * tried) {
      const recoilT = c.CHAR_BUMP_PAUSE_SEC * c.CHAR_BUMP_RECOIL_PART;
      const v0 = (2 * c.CHAR_BUMP_RECOIL_M) / recoilT;
      this.recoilX = (-hitX / hit) * v0;
      this.recoilZ = (-hitZ / hit) * v0;
      this.vx = 0;
      this.vz = 0;
      this.bumpLeft = c.CHAR_BUMP_PAUSE_SEC;
      this.events.push('bump');
      this.settleFloor(dt);
      return true;
    }
    const crowd = this.separate(dt, !this.guide);
    if (crowd === 'bump') {
      this.settleFloor(dt);
      return true;
    }
    const pushed = crowd === 'pushed';
    const edgeMoving = this.stepEdgePush(dt);
    // 안내 중인데 거의 못 움직이면(길이 막힘) 잠시 뒤 안내를 끝낸다 — 벽 앞에서 영원히 걷지 않게(Codex 검토 P1)
    if (this.guide) {
      const step = Math.hypot(this.x - bx, this.z - bz);
      this.guide.stuck = step < c.CHAR_WALK_MPS * dt * 0.1 ? this.guide.stuck + dt : 0;
      if (this.guide.stuck > c.GUIDE_STUCK_SEC) {
        this.vx = 0;
        this.vz = 0;
        this.cancel();
      }
    }

    // ── 몸 돌리기: 가는 방향으로 ───────────────────────────────
    const speedNow = Math.hypot(this.vx, this.vz);
    if (speedNow > 0.05) {
      const want = yawOf(this.vx, this.vz);
      const d = wrap(want - this.yaw);
      const turn = c.CHAR_TURN_RAD_S * dt;
      this.yaw = wrap(this.yaw + Math.max(-turn, Math.min(turn, d)));
    }
    const floorMoving = this.settleFloor(dt);
    return speedNow > 0 || this.guide !== null || floorMoving || manual || airMoving || pushed || edgeMoving;
  }

  /** 광장 경계 변마다 바깥 방향과 남은 거리(실내 영역 안이면 없음) */
  private edgesNear(): { edge: OpenEdge; d: number }[] {
    const o = this.outdoor;
    if (o.edges.length === 0) return [];
    const p: P2 = [this.x, this.z];
    if (o.indoor.some(a => p[0] >= a.min[0] && p[0] <= a.max[0] && p[1] >= a.min[1] && p[1] <= a.max[1]))
      return [];
    const soft = config().BOUNDARY_SOFT_M;
    const out: { edge: OpenEdge; d: number }[] = [];
    for (const edge of o.edges) {
      const d = Math.max(0, (edge.at - p[edge.axis]) * edge.sign);
      if (d < soft) out.push({ edge, d });
    }
    return out;
  }

  /**
   * 경계 앞 바깥 쪽 입력 성분을 남은 거리 / `BOUNDARY_SOFT_M` 배로 줄인다. 닿았는데도 바깥으로 밀면 안쪽 밀림을 시작하고 알린다.
   * 미는 동안 그 변 쪽 입력은 0. 돌려준 `limits`는 그 변 쪽으로 허락한 빠르기
   */
  private softenEdge(
    wantX: number,
    wantZ: number,
  ): { wantX: number; wantZ: number; limits: { edge: OpenEdge; max: number }[] } | null {
    const near = this.edgesNear();
    if (near.length === 0) return null;
    const c = config();
    const want: [number, number] = [wantX, wantZ];
    const limits: { edge: OpenEdge; max: number }[] = [];
    for (const { edge, d } of near) {
      const out = want[edge.axis] * edge.sign;
      if (out <= 0) {
        limits.push({ edge, max: 0 });
        continue;
      }
      const pushing = this.edgeLeft > 0 && this.edgeOut === edge;
      if (!pushing && d <= config().BOUNDARY_TOUCH_M) {
        // 닿음: 안쪽으로 v0에서 0까지 줄어드는 빠르기(거리 = v0·T/2 = BOUNDARY_PUSH_M)
        const v0 = (2 * c.BOUNDARY_PUSH_M) / c.BOUNDARY_PUSH_SEC;
        this.edgeLeft = c.BOUNDARY_PUSH_SEC;
        this.edgeOut = edge;
        this.edgePushX = edge.axis === 0 ? -edge.sign * v0 : 0;
        this.edgePushZ = edge.axis === 1 ? -edge.sign * v0 : 0;
        this.events.push('boundary');
      }
      const keep = this.edgeLeft > 0 && this.edgeOut === edge ? 0 : d / c.BOUNDARY_SOFT_M;
      const max = out * keep;
      want[edge.axis] = edge.sign * max;
      limits.push({ edge, max });
    }
    return { wantX: want[0], wantZ: want[1], limits };
  }

  private clampOutward(limits: readonly { edge: OpenEdge; max: number }[]): void {
    for (const { edge, max } of limits) {
      const v = edge.axis === 0 ? this.vx : this.vz;
      if (v * edge.sign <= max) continue;
      if (edge.axis === 0) this.vx = edge.sign * max;
      else this.vz = edge.sign * max;
    }
  }

  /** 경계 밀림 한 조각(몸 눌림 없음). 미는 중이면 true */
  private stepEdgePush(dt: number): boolean {
    if (this.edgeLeft <= 0) return false;
    const span = Math.min(dt, this.edgeLeft);
    const k = (this.edgeLeft - span / 2) / config().BOUNDARY_PUSH_SEC;
    this.moveBy(this.edgePushX * k * span, this.edgePushZ * k * span);
    this.edgeLeft = Math.max(0, this.edgeLeft - dt);
    if (this.edgeLeft === 0) this.edgeOut = null;
    return true;
  }

  /**
   * 사람끼리 겹치지 않게: 두 반지름보다 가까운 사람마다 겹친 깊이만큼 밀어낼 방향을 모으고, 가는 중이면 가는 쪽에 가까운 옆으로
   * 비켜 도는 몫을 더한다. 밀리는 빠르기 = 깊이 × `CHAR_CROWD_PUSH_PER_S`(상한 있음), 벽은 그대로 막는다.
   * `canBump`이고 닿은 채 다가가는 빠르기(나 − 상대, 상대 쪽 성분)가 `CROWD_BUMP_MPS` 이상이면 부딪힘 밀림을 시작한다.
   * 돌려주는 값: 부딪힘 · 밀림 · 없음
   */
  private separate(dt: number, canBump: boolean): 'bump' | 'pushed' | null {
    const total = this.crowd.length + this.fixed.length;
    if (total === 0) return null;
    const c = config();
    const minD = 2 * c.CHAR_BODY_RADIUS_M;
    let px = 0;
    let pz = 0;
    let hardest = 0;
    let hardX = 0;
    let hardZ = 0;
    for (let i = 0; i < total; i++) {
      const moving = i < this.crowd.length;
      const p = moving ? this.crowd[i]! : this.fixed[i - this.crowd.length]!.pos;
      const pv = moving ? (this.crowdVel[i] ?? ZERO) : ZERO;
      const dx = this.x - p[0];
      const dz = this.z - p[1];
      const d = Math.hypot(dx, dz);
      if (d >= minD) continue;
      // 같은 자리면 몸의 오른쪽으로(정해진 쪽 — 결정적)
      const ux = d > 1e-4 ? dx / d : -Math.cos(this.yaw);
      const uz = d > 1e-4 ? dz / d : Math.sin(this.yaw);
      const depth = minD - d;
      // 상대 쪽(−u)으로 다가가는 빠르기
      const closing = -((this.vx - pv[0]) * ux + (this.vz - pv[1]) * uz);
      if (closing > hardest) {
        hardest = closing;
        hardX = ux;
        hardZ = uz;
      }
      px += ux * depth;
      pz += uz * depth;
      if (Math.hypot(this.vx, this.vz) > 0.05) {
        const side = this.vx * -uz + this.vz * ux >= 0 ? 1 : -1;
        px += -uz * side * depth * c.CHAR_CROWD_SIDESTEP;
        pz += ux * side * depth * c.CHAR_CROWD_SIDESTEP;
      }
    }
    if (canBump && hardest >= c.CROWD_BUMP_MPS) {
      const v0 = (2 * c.CROWD_BUMP_PUSH_M) / c.CROWD_BUMP_PUSH_SEC;
      this.crowdPushX = hardX * v0;
      this.crowdPushZ = hardZ * v0;
      this.crowdLeft = c.CROWD_BUMP_PUSH_SEC;
      this.vx = 0;
      this.vz = 0;
      this.events.push('crowd');
      return 'bump';
    }
    const len = Math.hypot(px, pz);
    if (len === 0) return null;
    const v = Math.min(len * c.CHAR_CROWD_PUSH_PER_S, c.CHAR_CROWD_PUSH_MAX_MPS);
    this.moveBy((px / len) * v * dt, (pz / len) * v * dt);
    return 'pushed';
  }

  /**
   * 점프 높이(바닥 위)와 몸 연출 단계. 웅크림이 끝나는 순간 뜨고, 그 조각의 남은 시간만큼 포물선을 간다.
   * 웅크림·떠 있음·착지 연출 중이면 true(다시 그려야 함)
   */
  private stepAir(dt: number): boolean {
    const was = this.jumpState;
    if (was.phase === 'idle' && this.air === 0 && this.vy === 0) return false;
    const c = config();
    let fly = dt;
    if (was.phase === 'crouch') {
      const left = c.CHAR_JUMP_SQUASH.crouchSec - was.t;
      if (dt < left) fly = 0;
      else {
        this.vy = c.CHAR_JUMP_SPEED_MPS;
        this.flyT = 0;
        fly = dt - left;
      }
    }
    let landed = false;
    if (fly > 0 && (this.air > 0 || this.vy !== 0)) {
      // 해석식 포물선: 프레임 간격이 달라도(30·60·120Hz) 같은 높이 — 반암시 오일러는 30Hz에서 약 5cm 낮았다(M1b)
      const v = c.CHAR_JUMP_SPEED_MPS;
      const g = c.CHAR_GRAVITY_MPS2;
      this.flyT += fly;
      this.air = v * this.flyT - (g * this.flyT * this.flyT) / 2;
      this.vy = v - g * this.flyT;
      if (this.air <= 0) {
        this.air = 0;
        this.vy = 0;
        this.flyT = 0;
        this.events.push('land');
        landed = true;
      }
    }
    this.jumpState = stepJump(was, dt, landed);
    return true;
  }

  private settleFloor(dt: number): boolean {
    const floor = footFloorAt(this.walk, [this.x, this.z]);
    if (floor === null) return false;
    const d = floor - this.y;
    if (Math.abs(d) < 1e-3) {
      this.y = floor;
      return false;
    }
    this.y += d * Math.min(1, config().CHAR_FLOOR_FOLLOW * dt);
    return true;
  }

  /** 설 수 있는 데까지 옮긴다. 대각선이 막히면 x만·z만 따로 시도(벽을 따라 미끄러짐) */
  private moveBy(dx: number, dz: number): { x: boolean; z: boolean } {
    if (dx === 0 && dz === 0) return { x: true, z: true };
    const ok = (x: number, z: number): boolean => standable(this.walk, [x, z]);
    if (ok(this.x + dx, this.z + dz)) {
      this.x += dx;
      this.z += dz;
      return { x: true, z: true };
    }
    const canX = dx !== 0 && ok(this.x + dx, this.z);
    if (canX) this.x += dx;
    const canZ = dz !== 0 && ok(this.x, this.z + dz);
    if (canZ) this.z += dz;
    return { x: canX || dx === 0, z: canZ || dz === 0 };
  }
}
