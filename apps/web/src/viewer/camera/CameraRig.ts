import { config } from '@gallery/core/config';
import { type CameraPose, roundedPath, type Vec3 } from '@gallery/core/layout';
import { cubicBezier } from '@gallery/core/motion';
import gsap from 'gsap';
import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';

/**
 * 카메라 리그(PLAN §6.7, ADR-009). GSAP 타임라인 하나가 진행률 0→1을 움직이고, 갱신마다 위치·목표·화각을
 * 보간한 뒤 `invalidate()`를 부른다 — 정지 상태에서는 아무것도 그리지 않는다(PRD 10.1, `frameloop="demand"`).
 *
 * 이어받기: 새 이동은 지금 보간된 자세에서 시작하므로 중간에 방향을 바꿔도 튀지 않는다(PRD 8.1).
 * 입력을 쌓지 않는 규칙(연타해도 한 칸)은 리그가 아니라 컨트롤러가 `busy`를 보고 지킨다.
 */

export type RigState = 'idle' | 'moving' | 'zooming' | 'zoomed' | 'unzooming';

interface MutablePose {
  position: Vector3;
  target: Vector3;
  fov: number;
}

const toVector = (v: Vec3): Vector3 => new Vector3(v.x, v.y, v.z);

export class CameraRig {
  state: RigState = 'idle';
  private readonly current: MutablePose;
  private readonly look = { yaw: 0, pitch: 0 };
  private tween: gsap.core.Tween | null = null;
  private lookTween: gsap.core.Tween | null = null;
  private readonly ease: (t: number) => number;
  private readonly camera: PerspectiveCamera;
  private readonly invalidate: () => void;

  constructor(camera: PerspectiveCamera, invalidate: () => void) {
    this.camera = camera;
    this.invalidate = invalidate;
    const [x1, y1, x2, y2] = config().MOVE_EASE;
    this.ease = cubicBezier(x1, y1, x2, y2);
    this.current = { position: camera.position.clone(), target: new Vector3(0, 1.5, -5), fov: camera.fov };
  }

  get busy(): boolean {
    return this.state === 'moving' || this.state === 'zooming' || this.state === 'unzooming';
  }

  /** 애니메이션 없이 바로(첫 배치, 화면 크기·방향 변경, 동작 줄이기) */
  jumpTo(pose: CameraPose, state: RigState = this.state): void {
    this.tween?.kill();
    this.tween = null;
    this.current.position.copy(toVector(pose.position));
    this.current.target.copy(toVector(pose.target));
    this.current.fov = pose.fov;
    this.state = state;
    this.apply();
  }

  /** 거리에 비례한 시간(같은 관 안, PRD 8.2 "0.9~1.4초") */
  stopMoveSeconds(to: CameraPose): number {
    const c = config();
    const distance = this.current.position.distanceTo(toVector(to.position));
    return MathUtils.clamp(c.T_STOP_MIN + c.T_STOP_PER_M * distance, c.T_STOP_MIN, c.T_STOP_MAX);
  }

  /**
   * 지금 자세에서 `to`로 간다. 진행 중인 이동이 있으면 그 자리에서 끊고 이어받는다.
   * 끝나면 `endState`로 바뀌고 약속이 풀린다. 끊기면 약속은 `false`로 풀린다.
   */
  animateTo(to: CameraPose, seconds: number, during: RigState, endState: RigState): Promise<boolean> {
    this.tween?.kill();
    this.releaseLook(true);
    const from: MutablePose = {
      position: this.current.position.clone(),
      target: this.current.target.clone(),
      fov: this.current.fov,
    };
    const toPos = toVector(to.position);
    const toTarget = toVector(to.target);
    const progress = { t: 0 };
    this.state = during;
    return new Promise(resolve => {
      this.tween = gsap.to(progress, {
        t: 1,
        duration: seconds,
        ease: this.ease,
        onUpdate: () => {
          const t = progress.t;
          this.current.position.lerpVectors(from.position, toPos, t);
          this.current.target.lerpVectors(from.target, toTarget, t);
          this.current.fov = MathUtils.lerp(from.fov, to.fov, t);
          this.apply();
        },
        onComplete: () => {
          this.tween = null;
          this.state = endState;
          this.apply();
          resolve(true);
        },
        onInterrupt: () => resolve(false),
      });
    });
  }

  /** 관 사이 이동 시간(PLAN §4.8): 1.6 + 0.04 × 거리, 1.6~2.2초 */
  roomMoveSeconds(lengthM: number): number {
    const c = config();
    return MathUtils.clamp(c.T_ROOM_MIN + c.T_ROOM_PER_M * lengthM, c.T_ROOM_MIN, c.T_ROOM_MAX);
  }

  /**
   * 경로점을 따라 걷는다(관 사이, PLAN §4.8): 지금 위치 → 경로점 → 도착 위치를 둥글린 꺾은선(`roundedPath`)으로,
   * 호 길이로 같은 속도 + 출발 가속 짧게·도착 감속 길게. 시선은 처음 15% 동안 보던 곳에서 "진행 방향 0.6 + 도착 목표 0.4"로
   * 옮겨 가고(걸으며 고개를 돌림, PRD 8.2), 마지막 30%에서 도착 목표로 모은다.
   */
  animateAlong(
    waypoints: readonly (readonly [number, number, number])[],
    to: CameraPose,
    during: RigState,
    endState: RigState,
  ): Promise<boolean> {
    this.tween?.kill();
    this.releaseLook(true);
    const fromPos = this.current.position.clone();
    const fromTarget = this.current.target.clone();
    const fromFov = this.current.fov;
    const toPos = toVector(to.position);
    const toTarget = toVector(to.target);
    const pts: [number, number][] = [
      [fromPos.x, fromPos.z],
      ...waypoints.map(w => [w[0], w[2]] as [number, number]),
      [toPos.x, toPos.z],
    ];
    const path = roundedPath(pts);
    const cum: number[] = [0];
    for (let i = 1; i < path.length; i++)
      cum.push(cum[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]));
    const total = cum[cum.length - 1] ?? 0;
    const seconds = this.roomMoveSeconds(total);
    const at = (s: number, out: Vector3, tangent: Vector3): void => {
      let i = 1;
      while (i < cum.length - 1 && cum[i]! < s) i++;
      const a = path[i - 1] ?? path[0]!;
      const b = path[i] ?? a;
      const seg = Math.max(1e-9, cum[i]! - cum[i - 1]!);
      const u = MathUtils.clamp((s - cum[i - 1]!) / seg, 0, 1);
      out.set(a[0] + (b[0] - a[0]) * u, 0, a[1] + (b[1] - a[1]) * u);
      tangent.set(b[0] - a[0], 0, b[1] - a[1]).normalize();
    };
    const pos = new Vector3();
    const tangent = new Vector3();
    const dirFrom = new Vector3();
    const dirTo = new Vector3();
    const walking = new Vector3();
    const progress = { t: 0 };
    this.state = during;
    return new Promise(resolve => {
      this.tween = gsap.to(progress, {
        t: 1,
        duration: seconds,
        ease: this.ease,
        onUpdate: () => {
          const t = progress.t;
          at(t * total, pos, tangent);
          pos.y = MathUtils.lerp(fromPos.y, toPos.y, t);
          dirFrom.subVectors(fromTarget, pos).normalize();
          dirTo.subVectors(toTarget, pos).normalize();
          walking.copy(tangent).multiplyScalar(0.6).addScaledVector(dirTo, 0.4).normalize();
          const start = MathUtils.smoothstep(t, 0, 0.15);
          const end = MathUtils.smoothstep(t, 0.7, 1);
          const dir = dirFrom.lerp(walking, start).lerp(dirTo, end).normalize();
          this.current.position.copy(pos);
          this.current.target.copy(pos).addScaledVector(dir, 3);
          this.current.fov = MathUtils.lerp(fromFov, to.fov, t);
          this.apply();
        },
        onComplete: () => {
          this.tween = null;
          this.current.position.copy(toPos);
          this.current.target.copy(toTarget);
          this.current.fov = to.fov;
          this.state = endState;
          this.apply();
          resolve(true);
        },
        onInterrupt: () => resolve(false),
      });
    });
  }

  /** 끌어 둘러보기: 좌우 ±20°, 위아래 ±8°(PRD G-02) */
  setLook(yawDeg: number, pitchDeg: number): void {
    const c = config();
    this.lookTween?.kill();
    this.look.yaw = MathUtils.clamp(yawDeg, -c.LOOK_YAW_DEG, c.LOOK_YAW_DEG);
    this.look.pitch = MathUtils.clamp(pitchDeg, -c.LOOK_PITCH_DEG, c.LOOK_PITCH_DEG);
    this.apply();
  }

  /** 놓으면 제자리로(0.6초). 이동이 시작되면 바로 0으로 */
  releaseLook(immediate = false): void {
    this.lookTween?.kill();
    if (immediate || (this.look.yaw === 0 && this.look.pitch === 0)) {
      this.look.yaw = 0;
      this.look.pitch = 0;
      return;
    }
    this.lookTween = gsap.to(this.look, {
      yaw: 0,
      pitch: 0,
      duration: config().T_LOOK_RETURN,
      ease: 'power3.out',
      onUpdate: () => this.apply(),
    });
  }

  dispose(): void {
    this.tween?.kill();
    this.lookTween?.kill();
  }

  private readonly scratchDir = new Vector3();
  private readonly scratchUp = new Vector3(0, 1, 0);
  private readonly scratchRight = new Vector3();

  private apply(): void {
    const cam = this.camera;
    cam.position.copy(this.current.position);
    const dir = this.scratchDir.subVectors(this.current.target, this.current.position);
    if (this.look.yaw !== 0 || this.look.pitch !== 0) {
      dir.applyAxisAngle(this.scratchUp, MathUtils.degToRad(this.look.yaw));
      this.scratchRight.crossVectors(dir, this.scratchUp).normalize();
      dir.applyAxisAngle(this.scratchRight, MathUtils.degToRad(this.look.pitch));
    }
    cam.lookAt(
      this.current.position.x + dir.x,
      this.current.position.y + dir.y,
      this.current.position.z + dir.z,
    );
    if (cam.fov !== this.current.fov) {
      cam.fov = this.current.fov;
      cam.updateProjectionMatrix();
    }
    this.invalidate();
  }
}
