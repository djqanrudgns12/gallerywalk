import { z } from 'zod';

/**
 * 함께 관람(ADR-057): 전시마다 웹소켓 하나 `GET /api/e/{code}/live`. 서버는 위치를 저장하지 않는다(메모리에만).
 * 브라우저 웹소켓은 머리(`Authorization`)를 못 보내므로 첫 메시지 `hello`에 토큰 원문을 싣는다(주소에는 절대 넣지 않음).
 * 서버는 토큰 해시로 방문자(또는 교사 세션)를 찾아 별명·역할을 **서버 값으로** 정한다 — 기기가 보낸 별명은 받지 않는다.
 *
 * 흐름: 기기 `hello` → 서버 `welcome`(나·지금 사람들) → 기기 `pose`(초당 `LIVE_POSE_HZ`번까지) ↔ 서버 `peers`(초당
 * `LIVE_BROADCAST_HZ`번, 바뀐 사람만) + `join`·`leave`. 끊기면 기기는 혼자 관람을 이어 가며 `LIVE_RETRY_*`로 다시 잇는다.
 */

export const CharacterIdSchema = z.enum(['student-m', 'student-f', 'teacher-m', 'teacher-f']);
export type CharacterId = z.infer<typeof CharacterIdSchema>;

/** 걸음 상태: 0 가만히 · 1 걷기 · 2 뛰기 · 3 손 흔들기 */
export const MoveStateSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type MoveState = z.infer<typeof MoveStateSchema>;

const coord = z.number().finite().min(-500).max(500);

/** 위치(m, 세계 좌표)·바라보는 방향(rad, 0 = +Z) */
export const PoseSchema = z.strictObject({
  x: coord,
  y: z.number().finite().min(-20).max(20),
  z: coord,
  yaw: z.number().finite().min(-10).max(10),
  move: MoveStateSchema,
});
export type Pose = z.infer<typeof PoseSchema>;

// ── 기기 → 서버 ─────────────────────────────────────────────
export const LiveHelloSchema = z.strictObject({
  t: z.literal('hello'),
  /** 프로토콜 판 */
  v: z.literal(1),
  /** 방문자 토큰 또는 교사 세션 토큰 원문(base64url 43자) */
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  as: z.enum(['visitor', 'teacher']),
  character: CharacterIdSchema,
  pose: PoseSchema,
});

export const LivePoseSchema = z.strictObject({
  t: z.literal('pose'),
  /** 기기 쪽 차례 번호(늦게 온 옛 위치 버리기) */
  seq: z.number().int().nonnegative(),
  pose: PoseSchema,
});

export const LiveClientMessageSchema = z.discriminatedUnion('t', [LiveHelloSchema, LivePoseSchema]);
export type LiveClientMessage = z.infer<typeof LiveClientMessageSchema>;

// ── 서버 → 기기 ─────────────────────────────────────────────
/** 연결마다 서버가 정하는 짧은 이름(방문자 ID·토큰과 무관, 다시 이으면 바뀜) */
export const PeerIdSchema = z.string().regex(/^[a-z0-9]{8}$/);

export const PeerSchema = z.strictObject({
  sid: PeerIdSchema,
  /** 서버가 정한 별명(익명 방식이면 copy의 "관람객 n", 교사는 "선생님") — 화면에는 그대로 */
  nickname: z.string().min(1).max(40),
  role: z.enum(['visitor', 'teacher']),
  character: CharacterIdSchema,
  pose: PoseSchema,
});
export type Peer = z.infer<typeof PeerSchema>;

export const LiveServerMessageSchema = z.discriminatedUnion('t', [
  z.strictObject({
    t: z.literal('welcome'),
    you: PeerIdSchema,
    nickname: z.string().min(1).max(40),
    peers: z.array(PeerSchema),
    /** 서버 시각(ms) — 보간 기준 */
    at: z.number().int().nonnegative(),
  }),
  z.strictObject({
    t: z.literal('peers'),
    at: z.number().int().nonnegative(),
    /** 지난 방송 뒤 위치가 바뀐 사람만 */
    poses: z.array(z.strictObject({ sid: PeerIdSchema, pose: PoseSchema })),
  }),
  z.strictObject({ t: z.literal('join'), peer: PeerSchema }),
  z.strictObject({ t: z.literal('leave'), sid: PeerIdSchema }),
  /** 닫기 직전 이유(오류 코드는 errors.ts) */
  z.strictObject({ t: z.literal('bye'), code: z.string().regex(/^E_[A-Z_]+$/) }),
]);
export type LiveServerMessage = z.infer<typeof LiveServerMessageSchema>;
