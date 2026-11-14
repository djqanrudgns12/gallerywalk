import type { MoveState, Pose } from '../../types/live.ts';

/**
 * 함께 관람 위치 v2 부호(G-25 HS-02, ADR-072): 위치를 작은 정수 여섯 개로 —
 * `[방 안 번호, x(cm), y(cm), z(cm), 방향(0.001rad, -π~π로 감음), 걸음 상태]`. 여러 사람은 이어 붙인 평평한 배열 하나.
 * JSON 숫자 글자 수가 줄어 한 사람 조각이 약 100바이트에서 약 25바이트가 된다(gafferongames "Snapshot Compression").
 * 순수 함수 — 서버(만들기)와 기기(풀기)가 같은 것을 쓴다.
 */

/** 한 사람 칸 수 */
export const POSE_FIELDS = 6;
/** 방 안 번호 범위(서버가 비어 있는 가장 작은 수부터) */
export const PEER_NUMBER_MAX = 65_535;

/** 좌표·방향 단위(형식에 묶인 값 — 바꾸면 판이 바뀐다) */
const CM_PER_M = 100;
const MRAD_PER_RAD = 1000;
/** 약속 범위(`PoseSchema`): x·z ±500m, y ±20m */
const XZ_MAX_CM = 50_000;
const Y_MAX_CM = 2_000;
const YAW_MAX_MRAD = Math.round(Math.PI * MRAD_PER_RAD);
const MOVE_MAX = 3;
const TWO_PI = 2 * Math.PI;

/** 방향을 -π~π로 */
export const wrapYaw = (yaw: number): number => {
  const r = (((yaw + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI;
  return r - Math.PI;
};

/** 보낼 때 반올림한 자리(1cm·0.001rad) — 기기 → 서버 글도 짧게 */
export const roundPose = (p: Pose): Pose => ({
  x: Math.round(p.x * CM_PER_M) / CM_PER_M,
  y: Math.round(p.y * CM_PER_M) / CM_PER_M,
  z: Math.round(p.z * CM_PER_M) / CM_PER_M,
  yaw: Math.round(wrapYaw(p.yaw) * MRAD_PER_RAD) / MRAD_PER_RAD,
  move: p.move,
});

/** 사람 하나를 배열 끝에 붙인다 */
export const pushPose = (out: number[], n: number, p: Pose): void => {
  out.push(
    n,
    Math.round(p.x * CM_PER_M),
    Math.round(p.y * CM_PER_M),
    Math.round(p.z * CM_PER_M),
    Math.round(wrapYaw(p.yaw) * MRAD_PER_RAD),
    p.move,
  );
};

const intIn = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * 평평한 배열 → 사람마다 위치. 모양·범위가 하나라도 틀리면 null(그 메시지는 버린다).
 * 받은 메시지마다 도는 뜨거운 길이라 zod 대신 손으로 본다(HS-06).
 */
export const decodePoses = (flat: unknown): { readonly n: number; readonly pose: Pose }[] | null => {
  if (!Array.isArray(flat) || flat.length % POSE_FIELDS !== 0) return null;
  const out: { n: number; pose: Pose }[] = [];
  for (let i = 0; i < flat.length; i += POSE_FIELDS) {
    const [n, x, y, z, yaw, move] = flat.slice(i, i + POSE_FIELDS) as unknown[];
    if (
      !intIn(n, 1, PEER_NUMBER_MAX) ||
      !intIn(x, -XZ_MAX_CM, XZ_MAX_CM) ||
      !intIn(y, -Y_MAX_CM, Y_MAX_CM) ||
      !intIn(z, -XZ_MAX_CM, XZ_MAX_CM) ||
      !intIn(yaw, -YAW_MAX_MRAD, YAW_MAX_MRAD) ||
      !intIn(move, 0, MOVE_MAX)
    )
      return null;
    out.push({
      n,
      pose: {
        x: x / CM_PER_M,
        y: y / CM_PER_M,
        z: z / CM_PER_M,
        yaw: yaw / MRAD_PER_RAD,
        move: move as MoveState,
      },
    });
  }
  return out;
};
