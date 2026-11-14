import { z } from 'zod';
import { ACCEPTED_CHARACTER_IDS } from '../domain/characters.ts';
import { config } from '../config.ts';
import { bubbleIndexOk } from '../domain/live/bubble.ts';
import { charCount } from '../domain/text/normalize.ts';
import { BubbleSettingsSchema } from './settings.ts';

/**
 * 함께 관람(ADR-057): 전시마다 웹소켓 하나 `GET /api/e/{code}/live`. 서버는 위치를 저장하지 않는다(메모리에만).
 * 브라우저 웹소켓은 머리(`Authorization`)를 못 보내므로 첫 메시지 `hello`에 토큰 원문을 싣는다(주소에는 절대 넣지 않음).
 * 서버는 토큰 해시로 방문자(또는 교사 세션)를 찾아 별명·역할을 **서버 값으로** 정한다 — 기기가 보낸 별명은 받지 않는다.
 *
 * 흐름: 기기 `hello` → 서버 `welcome`(나·지금 사람들) → 기기 `pose`(초당 `LIVE_POSE_HZ`번까지) ↔ 서버 `peers`(초당
 * `LIVE_BROADCAST_HZ`번, 바뀐 사람만) + `join`·`leave`. 끊기면 기기는 혼자 관람을 이어 가며 `LIVE_RETRY_*`로 다시 잇는다.
 *
 * 판 2(G-25 HS-02, ADR-072): `hello`에 `v:2`를 보낸 기기에는 `welcome`·`join`에 방 안 번호 `n`이 붙고, 위치는 `peers` 대신
 * 작은 정수 배열 `p`(`domain/live/poseCodec.ts`)로 온다. `p`에는 받는 사람 자신도 들어 있다(서버가 무리마다 한 번만 만들어
 * 모두에게 같은 것을 보내기 때문 — 기기가 자기 번호를 건너뛴다). 가까운 사람은 매 차례, 먼 사람은 `LIVE_FAR_EVERY` 차례마다.
 * 서버는 판 1 기기(서비스 워커가 옛 앱을 줄 수 있음)도 한 판 동안 예전 그대로 받는다.
 */

/**
 * 관람객 캐릭터(목록은 `domain/characters.ts` 한 곳): 새 ID 12개 + 옛 별칭 `student-m`·`student-f`(판 1 옛 앱·기기 저장 값,
 * 받는 쪽이 `normalizeCharacterId`로 01번으로 읽는다). 도슨트는 관람객이 아니라 없다.
 */
export const CharacterIdSchema = z.enum(ACCEPTED_CHARACTER_IDS);
export type CharacterId = z.infer<typeof CharacterIdSchema>;
export * from '../domain/characters.ts';

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
  /** 프로토콜 판(1 처음 · 2 작은 위치 배열) */
  v: z.union([z.literal(1), z.literal(2)]),
  /** 방문자 토큰 또는 교사 세션 토큰 원문(base64url 43자) */
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  as: z.enum(['visitor', 'teacher']),
  character: CharacterIdSchema,
  pose: PoseSchema,
  /**
   * 캐릭터 판(M4-9): 2 = 학생 10종 ID(`student-m-01` 등)를 안다. 없으면 옛 4종만 아는 앱이라 서버가 남의 캐릭터를 몸 틀로 낮춰 보낸다
   * (옛 앱은 모르는 ID가 든 `welcome`·`join`을 통째로 버리므로 — 교사 ID는 판이 바뀌어도 같아 이 칸으로만 가린다)
   */
  chars: z.literal(2).optional(),
});

export const LivePoseSchema = z.strictObject({
  t: z.literal('pose'),
  /** 기기 쪽 차례 번호(늦게 온 옛 위치 버리기) */
  seq: z.number().int().nonnegative(),
  pose: PoseSchema,
});

/**
 * 점프 시작(판 2 기기만, PRD_V2 W-05): 내 캐릭터가 뛰기 시작한 순간 한 번. 서버는 같은 전시의 다른 판 2 기기에 `jump`로
 * 넘기고(초당 몇 번까지만), 받는 쪽이 같은 포물선을 자기 시계로 재생한다. 판 1 연결이 보내면 거절한다.
 */
export const LiveJumpSchema = z.strictObject({ t: z.literal('jump') });

/**
 * 말풍선 내용(PRD_V2 W-02): 스티커 번호(`s`) · 정해진 말 번호(`p`) · 짧은 글(`x`). 번호의 그림·글은 기기가 가진다
 * (`copy.bubble`). 글은 기기가 `prepareBubbleText`로 다듬어 보낸 것이라 여기서는 `BUBBLE_TEXT_MAX`자만 보고, 서버가 같은 함수로
 * 다시 다듬고 거른다(정규화·욕설).
 */
export const BubbleContentSchema = z.discriminatedUnion('k', [
  z.strictObject({
    k: z.literal('s'),
    i: z
      .number()
      .int()
      .min(0)
      .refine(i => bubbleIndexOk('s', i)),
  }),
  z.strictObject({
    k: z.literal('p'),
    i: z
      .number()
      .int()
      .min(0)
      .refine(i => bubbleIndexOk('p', i)),
  }),
  z.strictObject({
    k: z.literal('x'),
    text: z
      .string()
      .min(1)
      .refine(t => charCount(t) <= config().BUBBLE_TEXT_MAX),
  }),
]);

/**
 * 말풍선 보내기(판 2 기기만). 서버는 교사 설정(`bubbles`) → 속도 제한(`BUBBLE_RATE`) → 글이면 `prepareBubbleText` 순으로 보고
 * 같은 전시 다른 판 2 기기에 `bubble`로 넘긴다. 걸리면 조용히 버린다(보낸 기기는 같은 규칙으로 미리 막는다). 저장하지 않는다.
 * 판 1 연결이 보내면 형식 틀림으로 닫는다.
 */
export const LiveBubbleSchema = z.strictObject({ t: z.literal('bubble'), b: BubbleContentSchema });

export const LiveClientMessageSchema = z.discriminatedUnion('t', [
  LiveHelloSchema,
  LivePoseSchema,
  LiveJumpSchema,
  LiveBubbleSchema,
]);
export type LiveClientMessage = z.infer<typeof LiveClientMessageSchema>;

// ── 서버 → 기기 ─────────────────────────────────────────────
/** 연결마다 서버가 정하는 짧은 이름(방문자 ID·토큰과 무관, 다시 이으면 바뀜) */
export const PeerIdSchema = z.string().regex(/^[a-z0-9]{8}$/);

/** 방 안 번호(판 2): 1~65535, 그 방에서 비어 있는 가장 작은 수 — 연결마다, 다시 이으면 바뀔 수 있음 */
export const PeerNumberSchema = z.number().int().min(1).max(65_535);

export const PeerSchema = z.strictObject({
  sid: PeerIdSchema,
  /** 서버가 정한 별명(익명 방식이면 copy의 "관람객 n", 교사는 "선생님") — 화면에는 그대로 */
  nickname: z.string().min(1).max(40),
  role: z.enum(['visitor', 'teacher']),
  character: CharacterIdSchema,
  pose: PoseSchema,
  /** 방 안 번호(판 2 기기에만, `p` 배열의 첫 칸) */
  n: PeerNumberSchema.optional(),
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
    /** 내 방 안 번호(판 2 기기에만 — `p`에서 자기 것을 건너뛸 때) */
    n: PeerNumberSchema.optional(),
    /** 이 전시의 말풍선 설정(판 2 기기에만, W-02) — 서랍을 보일지·짧은 글 칸을 열지 */
    bubbles: BubbleSettingsSchema.optional(),
  }),
  z.strictObject({
    t: z.literal('peers'),
    at: z.number().int().nonnegative(),
    /** 지난 방송 뒤 위치가 바뀐 사람만 */
    poses: z.array(z.strictObject({ sid: PeerIdSchema, pose: PoseSchema })),
  }),
  /**
   * 판 2 위치 묶음: `p` = 사람마다 여섯 칸 `[n, x(cm), y(cm), z(cm), 방향(0.001rad), 걸음]`. 기기는 뜨거운 길이라 이 스키마 대신
   * `decodePoses`로 손으로 본다(시험·서버 타입용으로 둔다)
   */
  z.strictObject({
    t: z.literal('p'),
    at: z.number().int().nonnegative(),
    p: z.array(z.number().int()).refine(a => a.length % 6 === 0),
  }),
  z.strictObject({ t: z.literal('join'), peer: PeerSchema }),
  /**
   * 다른 사람이 뛰기 시작함(판 2 기기에만, PRD_V2 W-05). `at` = 서버가 받은 시각(ms, 위치와 같은 시계) — 받는 쪽은 위치 보간처럼
   * `LIVE_INTERP_DELAY_MS` 늦춰 그 순간부터 포물선을 그린다. 옛 앱은 모르는 종류라 조용히 버린다.
   */
  z.strictObject({ t: z.literal('jump'), sid: PeerIdSchema, at: z.number().int().nonnegative() }),
  /**
   * 다른 사람의 말풍선(판 2 기기에만, W-02). `at` = 서버가 받은 시각(ms). 글(`x`)은 서버가 다듬은 것. 받는 쪽은 그 사람 머리 위의
   * 이전 말풍선을 바꿔 친다. 보낸 사람에게는 돌려보내지 않는다(기기가 보낼 때 바로 제 머리 위에 띄운다).
   */
  z.strictObject({
    t: z.literal('bubble'),
    sid: PeerIdSchema,
    at: z.number().int().nonnegative(),
    b: BubbleContentSchema,
  }),
  /** 교사가 말풍선 설정을 바꿈(판 2 기기에만, 수업 중 바로 끄기 — W-02). 꺼지면 기기는 띄운 말풍선을 거두고 서랍을 닫는다 */
  z.strictObject({ t: z.literal('cfg'), bubbles: BubbleSettingsSchema }),
  z.strictObject({ t: z.literal('leave'), sid: PeerIdSchema }),
  /** 닫기 직전 이유(오류 코드는 errors.ts) */
  z.strictObject({ t: z.literal('bye'), code: z.string().regex(/^E_[A-Z_]+$/) }),
]);
export type LiveServerMessage = z.infer<typeof LiveServerMessageSchema>;
