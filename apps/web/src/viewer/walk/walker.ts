import { config } from '@gallery/core/config';
import { footFloorAt, type P2, standable } from '@gallery/core/layout';
import type { Walk } from '@gallery/core/types';
import type { MoveState } from '@gallery/core/types';

/**
 * 캐릭터 걷기(ADR-057 자유 관람). three에 기대지 않는 순수 상태 기계 — 매 프레임 `step(dt, 입력)`.
 *
 * - 입력은 카메라 기준 앞·옆(−1..1)과 뛰기. 세계 방향으로 돌려 가속·감속하고, 몸은 가는 방향으로 돈다.
 * - 충돌: 다음 자리가 설 수 없으면(걸을 수 있는 곳 밖·설비 바닥 안) 축마다 나눠 미끄러지고, 그래도 안 되면 멈춘다.
 *   걸을 수 있는 곳은 벽에서 캐릭터 반지름만큼 안쪽이라 몸이 벽을 뚫지 않는다(배치 엔진 `walk`).
 * - 높이: 발 바닥 높이(`footFloorAt`, 계단은 디딤판마다 평평)를 빨리 따라간다 — 단 사이에 파묻히거나 경사 위에 뜨지 않게.
 *   (카메라는 부드러운 경사 `floorAt`을 따로 쓴다.)
 * - 사람끼리: `setCrowd(둘레 사람 자리)`를 주면 몸 반지름 두 배보다 가까운 사람에게서 밀려나고, 가는 중이면 옆으로 비켜 돈다.
 * - 안내 이동: `follow(경로)`를 주면 손 입력이 없는 동안 그 꺾은선을 따라 걷고, 끝에서 `faceYaw`로 돌아선다.
 *   손 입력이 들어오면 안내는 바로 끝난다(아이가 언제든 스스로 움직일 수 있게).
 * - 벽 부딪힘: 거의 정면으로 세게 막히면 잠깐 멈추고(손 입력 무시) 살짝 뒤로 밀려난다(`CHAR_BUMP_*`). 비스듬하면 미끄러짐.
 * - 점프(놀이): `jump()` — 바닥 높이 위 `air`만큼 떠오르고 중력으로 내려온다. 떠 있는 동안에도 앞뒤로는 움직인다.
 * - 뛰기 잠금: `lockRun(초)` 동안은 뛰기 입력을 걷기로(관람 예절 알림 뒤).
 * - 일어난 일(`bump`·`jump`·`land`)은 `drainEvents()`로 꺼내 간다(소리·말풍선·흔들림).
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
}

export type WalkerEvent = 'arrived' | 'cancelled';
export type WalkerFx = 'bump' | 'jump' | 'land';

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
  private bumpLeft = 0;
  private recoilX = 0;
  private recoilZ = 0;
  private runLockLeft = 0;
  private events: WalkerFx[] = [];
  private crowd: readonly P2[] = [];

  constructor(walk: Walk, start: { x: number; z: number; yaw: number }) {
    this.walk = walk;
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
    };
  }

  /** 땅에 있고 부딪혀 멈춘 중이 아니면 뛰어오른다 */
  jump(): boolean {
    if (this.air > 0 || this.vy !== 0 || this.bumpLeft > 0) return false;
    this.vy = config().CHAR_JUMP_SPEED_MPS;
    this.events.push('jump');
    return true;
  }

  /** 둘레 다른 사람들의 자리(x, z) — 매 프레임 준다. 겹치지 않게 밀려난다 */
  setCrowd(points: readonly P2[]): void {
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
    this.bumpLeft = 0;
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
    this.crowd = [];
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
    const c = config();
    const dt = Math.min(dtIn, 0.1); // 탭이 멈췄다 돌아오면 큰 dt — 벽을 건너뛰지 않게 자른다
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
      const taken = this.crowd.some(
        q => Math.hypot(q[0] - target[0], q[1] - target[1]) < 2 * c.CHAR_BODY_RADIUS_M,
      );
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
    const pushed = this.separate(dt);
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
    return speedNow > 0 || this.guide !== null || floorMoving || manual || airMoving || pushed;
  }

  /**
   * 사람끼리 겹치지 않게: 두 반지름보다 가까운 사람마다 겹친 깊이만큼 밀어낼 방향을 모으고, 가는 중이면 가는 쪽에 가까운 옆으로
   * 비켜 도는 몫을 더한다. 밀리는 빠르기 = 깊이 × `CHAR_CROWD_PUSH_PER_S`(상한 있음), 벽은 그대로 막는다. 밀렸으면 true
   */
  private separate(dt: number): boolean {
    if (this.crowd.length === 0) return false;
    const c = config();
    const minD = 2 * c.CHAR_BODY_RADIUS_M;
    let px = 0;
    let pz = 0;
    for (const p of this.crowd) {
      const dx = this.x - p[0];
      const dz = this.z - p[1];
      const d = Math.hypot(dx, dz);
      if (d >= minD) continue;
      // 같은 자리면 몸의 오른쪽으로(정해진 쪽 — 결정적)
      const ux = d > 1e-4 ? dx / d : -Math.cos(this.yaw);
      const uz = d > 1e-4 ? dz / d : Math.sin(this.yaw);
      const depth = minD - d;
      px += ux * depth;
      pz += uz * depth;
      if (Math.hypot(this.vx, this.vz) > 0.05) {
        const side = this.vx * -uz + this.vz * ux >= 0 ? 1 : -1;
        px += -uz * side * depth * c.CHAR_CROWD_SIDESTEP;
        pz += ux * side * depth * c.CHAR_CROWD_SIDESTEP;
      }
    }
    const len = Math.hypot(px, pz);
    if (len === 0) return false;
    const v = Math.min(len * c.CHAR_CROWD_PUSH_PER_S, c.CHAR_CROWD_PUSH_MAX_MPS);
    this.moveBy((px / len) * v * dt, (pz / len) * v * dt);
    return true;
  }

  /** 점프 높이(바닥 위). 떠 있거나 막 내려앉았으면 true */
  private stepAir(dt: number): boolean {
    if (this.air === 0 && this.vy === 0) return false;
    this.vy -= config().CHAR_GRAVITY_MPS2 * dt;
    this.air += this.vy * dt;
    if (this.air <= 0) {
      this.air = 0;
      this.vy = 0;
      this.events.push('land');
    }
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
