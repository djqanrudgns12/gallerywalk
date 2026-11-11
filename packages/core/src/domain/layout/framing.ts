import { config } from '../../config.ts';

/**
 * 액자에 맞춘 카메라 자세(PRD 5.5, PLAN §4.7). 기기에서 화면 비율마다 계산한다 — 배치에는 저장하지 않는다.
 *
 * 순서: 기본 세로 화각에서 거리를 구함 → 물러설 수 있는 거리를 넘으면 화각을 넓힘(상한) → 그래도 넘으면
 * 거리를 상한에 두고 채움이 줄어드는 것을 받아들임(액자가 조금 작게 보일 뿐).
 *
 * **잘리지 않음을 보장하는 범위**: 물러설 거리 ≥ `ROOM_MIN_D_M − CAMERA_WALL_CLEARANCE_M`(배치 엔진이 방을
 * 그보다 작게 만들지 않음), 화면 비율 ≥ 0.4, 바깥 크기 ≤ 3.66×2.6m(배치 엔진의 최대 = 대표작 파노라마 3.652×2.482m). 이 범위 밖
 * (예: 2.5m 공간에서 3.4m 액자를 비율 0.4 화면으로)은 `VFOV_HARD_MAX_DEG`로도 다 담지 못할 수 있다.
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FrameAnchor {
  /** 액자 바깥 사각형 한가운데(세계 좌표, m) */
  readonly center: Vec3;
  /** 벽에서 방 안쪽을 향하는 수평 단위 벡터 */
  readonly normal: Vec3;
  /** 바깥 크기(그림 + 매트 + 테, m) */
  readonly outer: { readonly w: number; readonly h: number };
  /** 법선 방향으로 물러설 수 있는 거리(맞은편 벽까지 − 여유, m) */
  readonly maxDistance: number;
}

export interface FramingView {
  /** 화면 가로 ÷ 세로 */
  readonly aspect: number;
  /** 화면 위·아래에서 UI가 가리는 비율(0~1). 줌의 캡션 카드 자리 등 */
  readonly insetTop?: number;
  readonly insetBottom?: number;
}

export interface FramingOptions {
  /** 액자가 남은 영역의 세로에서 차지할 비율 */
  readonly fillHeight: number;
  /** 액자가 남은 영역의 가로에서 차지할 수 있는 최대 비율 */
  readonly fillWidth: number;
  /** 카메라 높이(m). 생략하면 액자 한가운데 높이(정면 줌) */
  readonly cameraHeight?: number;
}

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  /** 세로 화각(도) */
  readonly fov: number;
  /** 실제로 얻은 세로 채움(상한 때문에 줄었을 수 있음) */
  readonly achievedFill: number;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

export const frameCamera = (anchor: FrameAnchor, view: FramingView, options: FramingOptions): CameraPose => {
  const c = config();
  const insetTop = view.insetTop ?? 0;
  const insetBottom = view.insetBottom ?? 0;
  const usable = Math.max(0.1, 1 - insetTop - insetBottom);
  const fillH = options.fillHeight * usable;
  const fillW = options.fillWidth;
  const { w, h } = anchor.outer;

  // 거리 d에서 보이는 세로 = 2·d·tan(v/2), 가로 = 그 × aspect.
  const distanceFor = (vfovDeg: number): number => {
    const t = Math.tan(rad(vfovDeg) / 2);
    return Math.max(h / (2 * t * fillH), w / (2 * t * view.aspect * fillW));
  };

  let fov: number = c.VFOV_DEG;
  let distance = distanceFor(fov);
  if (distance > anchor.maxDistance) {
    const maxD = anchor.maxDistance;
    const neededTan = Math.max(h / (2 * maxD * fillH), w / (2 * maxD * view.aspect * fillW));
    fov = Math.min(c.VFOV_MAX_DEG, deg(2 * Math.atan(neededTan)));
    distance = Math.min(maxD, distanceFor(fov));
    // 마지막 수단: 상한 화각·상한 거리에서도 액자가 화면 밖으로 나가면, 잘리지 않을 만큼만 화각을 더 넓힌다.
    const fitTan = Math.max(h / (2 * maxD * usable * FIT_MARGIN), w / (2 * maxD * view.aspect * FIT_MARGIN));
    if (Math.tan(rad(fov) / 2) < fitTan) {
      fov = Math.min(c.VFOV_HARD_MAX_DEG, deg(2 * Math.atan(fitTan)));
      distance = maxD;
    }
  }

  const visibleH = 2 * distance * Math.tan(rad(fov) / 2);
  const achievedFill = h / visibleH / usable;

  // UI가 아래를 가리면 액자를 남은 영역 한가운데로 올린다: 카메라와 목표를 같은 만큼 내려 정면을 유지.
  const shiftUp = ((insetBottom - insetTop) / 2) * visibleH;
  const n = normalizeFlat(anchor.normal);
  const eyeY = (options.cameraHeight ?? anchor.center.y) - shiftUp;
  const targetY = anchor.center.y - shiftUp;
  return {
    position: { x: anchor.center.x + n.x * distance, y: eyeY, z: anchor.center.z + n.z * distance },
    target: { x: anchor.center.x, y: targetY, z: anchor.center.z },
    fov,
    achievedFill,
  };
};

/** 마지막 수단에서 액자 둘레에 남길 여유(화면의 2%) */
const FIT_MARGIN = 0.98;

const normalizeFlat = (v: Vec3): Vec3 => {
  const len = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / len, y: 0, z: v.z / len };
};

/** 정지 지점(채움 0.55)과 줌(채움 0.85) 설정. 카메라 높이 = 그 정지 지점의 바닥(`anchor.floorY`) + 카메라 높이 */
export const stopFraming = (floorY = 0): FramingOptions => {
  const c = config();
  return { fillHeight: c.STOP_FILL, fillWidth: c.STOP_FILL_WIDTH, cameraHeight: floorY + c.CAMERA_HEIGHT_M };
};

export const zoomFraming = (): FramingOptions => {
  const c = config();
  return { fillHeight: c.ZOOM_FILL, fillWidth: c.ZOOM_FILL };
};

/** 배치의 정지 지점 자리(`Stop.anchor`, 바닥 평면 법선) → 화면 맞춤 입력 */
export const frameAnchorOf = (a: {
  readonly target: readonly [number, number, number];
  readonly normal: readonly [number, number];
  readonly outer: { readonly w: number; readonly h: number };
  readonly maxDistance: number;
}): FrameAnchor => ({
  center: { x: a.target[0], y: a.target[1], z: a.target[2] },
  normal: { x: a.normal[0], y: 0, z: a.normal[1] },
  outer: a.outer,
  maxDistance: a.maxDistance,
});
