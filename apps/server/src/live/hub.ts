import { createHash } from 'node:crypto';
import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import type { ErrorCode } from '@gallery/core/errors';
import {
  PEER_NUMBER_MAX,
  bubbleAllowed,
  prepareBubbleText,
  pushPose,
  recordBubble,
} from '@gallery/core/live';
import { isGone } from '@gallery/core/retention';
import {
  LiveClientMessageSchema,
  PeerSchema,
  bodyOf,
  isLegacyCharacterAlias,
  normalizeCharacterId,
  type BubbleSettings,
  type CharacterId,
  type VisitorCharacterId,
  type LiveClientMessage,
  type LiveServerMessage,
  type Peer,
  type Pose,
} from '@gallery/core/types';
import type { LogStats, Logger } from '../log.ts';
import type { Deps } from '../ports/index.ts';

/**
 * 함께 관람 허브(ADR-057, 약속 `types/live.ts`). 전시마다 방 하나를 메모리에 두고 위치를 중계한다 — 저장하지 않는다.
 *
 * - 별명·역할은 서버 값: 교사 세션이면 `copy.live.teacher`, 방문자는 방문자 기록의 별명(없거나 익명 방식이면
 *   `copy.live.anonymous`, n = 그 방에서 비어 있는 가장 작은 번호 — 같은 토큰의 연결은 같은 번호).
 * - 캐릭터(M4-9): 학생은 학생 ID, 교사는 교사 ID만. 옛 별칭(`student-m`·`student-f`)은 01번으로 바꿔 두고, 옛 ID만 아는
 *   기기(`Member.oldIds`)에는 남의 캐릭터를 몸 틀 열쇠로 낮춰 보낸다.
 * - 위치: 늦은 `seq`는 버리고, 받은 것 중 마지막 것만 남긴다. 방마다 `LIVE_BROADCAST_HZ`로 바뀐 사람만 `peers`
 *   (자기 자신 제외), 한 사람은 초당 `LIVE_POSE_HZ`번까지만 나간다.
 * - 닫기: 거절은 `bye` 다음 1008(꽉 참은 1013). `hello`를 기다리다 넘치면 1008, 위치가 `LIVE_IDLE_TIMEOUT_SEC` 동안
 *   없으면 1000, 끝내기는 1001.
 * - 기록: 1분마다 모은 수(지금 연결·들어온 수·거절 코드별 수·시간 초과 수)만. 토큰·해시·IP·위치·별명은 넣지 않는다.
 *   attach가 서버 수(이벤트 루프·보낸 양·메모리·진단, HS-00)를 넘기면 방·사람 수를 붙여 `server_stats` 한 줄을 더 남긴다.
 *
 * 웹소켓·HTTP는 모른다(`attach.ts`가 `LiveSocket`으로 감싸 넘긴다).
 *
 * 판 2 기기(G-25 HS-02~HS-05·HS-10, ADR-072) — 판 1 기기는 위 그대로:
 * - 위치는 `p`(작은 정수 배열, `poseCodec.ts`). 받는 사람마다 따로 만들지 않고 **무리마다 한 번** 글을 만들어 `Buffer` 하나를
 *   같은 무리 모두에게 보낸다(자기 것도 들어 있음 — 기기가 건너뜀).
 * - 무리 = 바닥 `LIVE_AOI_CELL_M` 칸. 자기 칸과 둘레 8칸의 바뀐 사람은 매 차례, `LIVE_FAR_EVERY` 차례마다 그동안 바뀐 모두를
 *   한 번에(그 차례는 모든 무리가 같은 글이라 한 번만 만든다). 칸을 옮겨 다녀도 1초 안에 모두의 지금 자리를 받는다.
 * - 보낼 줄이 밀린 기기는 그 차례를 건너뛰고(`sendShared`가 false), 다음 차례에 모두의 지금 자리를 한 번에 받는다.
 * - 넘칠 때: 서버 전체 방문자 `LIVE_MAX_TOTAL`이면 `E_LIVE_FULL`(혼자 관람으로 이어짐), 1분 루프 지연이 높으면(`setLoad`)
 *   한 사람 위치를 `LIVE_DEGRADE_EVERY` 차례에 한 번으로 줄인다.
 * - 점프 시작(PRD_V2 W-05): 판 2 기기의 `jump`를 받은 즉시 같은 방 다른 판 2 기기에 `{t:'jump', sid, at}`로 넘긴다(꼭 가야
 *   하는 것이라 `send`). 한 연결은 `JUMP_RELAY_WINDOW_MS` 안에 `LIVE_JUMP_MAX_PER_SEC`번까지, 넘는 것은 조용히 버린다. 판 1 연결이
 *   보내면 형식 틀림으로 닫는다(판 1 기기는 이 종류를 모른다).
 * - 말풍선(PRD_V2 W-02): 판 2 기기의 `bubble`을 그 전시의 **지금** 설정(`settings.bubbles`, 저장소에서 그때 읽음)이 켜져 있을 때만
 *   같은 방 다른 판 2 기기에 `{t:'bubble', sid, at, b}`로 넘긴다(`send`). 한 사람은 `BUBBLE_RATE`까지, 짧은 글은 `text`가 켜졌을
 *   때만 `prepareBubbleText`로 다듬고 거른 것을 넘긴다. 걸리는 것은 조용히 버리고, 저장하지 않으며 기록에 내용을 남기지 않는다.
 *   판 2 기기의 `welcome`에 지금 설정을 붙이고, 교사가 설정을 바꾸면(`settingsChanged`) 판 2 기기 모두에게 `cfg`를 보낸다.
 *   판 1 연결이 보내면 형식 틀림으로 닫는다.
 */

/** 웹소켓 닫기 코드(RFC 6455 §7.4) */
export const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  policy: 1008,
  tooBig: 1009,
  tryAgain: 1013,
} as const;

const MS_PER_SEC = 1000;
/** `PeerIdSchema`(소문자·숫자 8자) */
const SID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SID_LENGTH = 8;
const SID_ATTEMPTS = 32;
/** 점프 중계 상한 창(ms): 이 안에 `LIVE_JUMP_MAX_PER_SEC`번까지(넘는 것은 조용히 버림) */
const JUMP_RELAY_WINDOW_MS = 1000;

type Role = Peer['role'];

/**
 * 역할마다 고를 수 있는 캐릭터(학생은 들어올 때 10명 중, 선생님은 교사 화면에서 둘 중 — ADR-057, M4-9).
 * 학생의 옛 별칭(`student-m`·`student-f`)도 `student-`로 시작한다.
 */
const CHARACTER_PREFIX: Record<Role, string> = { visitor: 'student-', teacher: 'teacher-' };
const characterFits = (role: Role, character: CharacterId): boolean =>
  character.startsWith(CHARACTER_PREFIX[role]);

/** 허브가 쓰는 소켓(attach가 `ws`를 감싼다). 닫힌 뒤 부르면 아무 일도 하지 않아야 한다. */
export interface LiveSocket {
  send(text: string): void;
  /**
   * 여럿에게 같은 것을 보내는 위치 글(UTF-8 `Buffer`, 글 프레임으로). 건너뛰어도 되는 것이라 보낼 줄이 밀렸으면 보내지 않고
   * false(허브가 다음 차례에 모두의 지금 자리를 보낸다). 닫혔으면 아무 일도 하지 않고 true
   */
  sendShared(data: Buffer): boolean;
  close(code: number, reason: string): void;
}

/** 연결 하나의 손잡이(attach가 소켓 사건을 알린다) */
export interface LiveConnection {
  /** 글 메시지 하나(UTF-8로 푼 것) */
  receive(text: string): void;
  /** 글이 아닌 메시지(바이너리) — 형식 틀림으로 닫는다 */
  invalid(): void;
  /** 소켓이 닫혔다(어느 쪽이 닫았든). 여러 번 불러도 된다 */
  closed(): void;
}

export interface LiveSize {
  readonly rooms: number;
  /** `hello`를 마치고 방에 든 연결 */
  readonly peers: number;
  /** `hello`를 기다리는 연결 */
  readonly pending: number;
}

/** 전시 하나에 지금 이어진 수(교사 화면, FIELD_PLAN HT-07) — 연결 수라 같은 기기의 두 탭은 둘로 센다 */
export interface LiveAudience {
  readonly visitors: number;
  readonly teachers: number;
}

/**
 * 전시 하나의 학생 바닥 위치(교사 수업 지도, HT-16·ADR-074). 누구인지(sid·별명·토큰·캐릭터)는 싣지 않고, 차례에도 뜻이 없다.
 * 세기(관 → 전시실)는 `application/liveRooms.ts`가 한다. 교사 연결은 빠진다(교사 수는 `exhibitionCounts`).
 */
export interface LiveFloor {
  /** 위치를 보낸 학생마다 마지막으로 받은 바닥 위치(m, 세계 x·z) */
  readonly positions: readonly { readonly x: number; readonly z: number }[];
  /**
   * 들어온 뒤 위치를 한 번도 보내지 않은 학생 연결. 기기는 3D 걷기 화면이 돌 때만 위치를 보내므로(`hello`의 위치는 출발점일 뿐)
   * 3D가 아직 뜨지 않았거나 가벼운 화면인 연결이다.
   */
  readonly noPose: number;
}

export interface LiveHub {
  /** 새 연결(경로의 입장 코드). `hello`를 `LIVE_HELLO_TIMEOUT_MS`까지 기다린다 */
  open(socket: LiveSocket, entryCode: string): LiveConnection;
  /**
   * 전시 하나의 연결을 `bye {code}`로 닫는다(교사가 전시를 닫거나 지울 때). 상태 코드(`E_EXHIBITION_CLOSED`·
   * `E_EXHIBITION_DRAFT`)면 방문자만 닫고 교사는 남긴다(교사는 상태와 상관없이 들어옴) — 그 밖의 코드는 모두 닫는다.
   */
  closeExhibition(exhibitionId: string, code: ErrorCode): void;
  /** 끝내기: 모든 연결을 1001로 닫고 방·타이머를 치운다. 그 뒤 `open()`은 바로 1001로 닫는다 */
  shutdown(): void;
  size(): LiveSize;
  /** 그 전시 방에 든 학생·교사 수(방이 없으면 0) */
  exhibitionCounts(exhibitionId: string): LiveAudience;
  /** 그 전시 방 학생들의 바닥 위치와 위치 없는 학생 수(읽기만, 방이 없으면 비어 있음) */
  exhibitionFloor(exhibitionId: string): LiveFloor;
  /** 연결 앞단(attach)의 거절·시간 초과도 같은 칸에서 센다 */
  countReject(code: ErrorCode): void;
  countTimeout(): void;
  /**
   * 모은 수를 기록에 남기고 비운다(attach가 1분마다·끝낼 때). 바뀐 것이 없으면 연결 기록은 남기지 않는다.
   * `server`(서버 수)를 주면 방·사람 수를 붙여 `server_stats` 한 줄을 늘 남긴다.
   */
  flushStats(server?: LogStats): void;
  /** 허브의 시계(ms) — attach의 IP 칸도 같은 시계를 쓴다 */
  now(): number;
  /** 1분 이벤트 루프 지연 p99(ms)를 알린다 — `LIVE_DEGRADE_LOOP_MS` 넘으면 위치 빈도를 줄이고, 아래면 되돌린다(HS-10) */
  setLoad(loopP99Ms: number): void;
  /**
   * 교사가 전시 설정을 바꿨다(W-02, 수업 중 바로 끄기). 방이 있으면 저장소의 지금 말풍선 설정을 판 2 기기 모두에게 `cfg`로
   * 보낸다(판 1 기기는 모르는 종류라 건너뜀). 방이 없거나 전시가 없으면 아무 일도 하지 않는다
   */
  settingsChanged(exhibitionId: string): void;
}

export interface LiveHubOptions {
  /** 저장소(전시·교사 세션·방문자 조회)·난수(sid)·시계 */
  readonly deps: Pick<Deps, 'store' | 'random' | 'clock'>;
  readonly log: Logger;
  /** 기본 `deps.clock.now` */
  readonly now?: () => number;
}

type Version = Hello['v'];

/** 받는 기기의 형식: 프로토콜 판 · 옛 캐릭터 ID만 아는가(`Member.oldIds`) */
interface Audience {
  readonly version: Version;
  readonly oldIds: boolean;
}

interface Member {
  readonly conn: Conn;
  readonly sid: string;
  /** 방 안 번호(판 2 `p` 배열) */
  readonly n: number;
  /** 이 기기의 프로토콜 판 */
  readonly version: Version;
  readonly role: Role;
  readonly nickname: string;
  /** 옛 별칭은 받을 때 01번으로 바꿔 둔다 */
  readonly character: VisitorCharacterId;
  /**
   * 옛 캐릭터 ID만 아는 기기(M4-9): 판 1이거나 hello에 옛 별칭을 보낸 기기(판 1 앱·캐릭터 12종 전 앱의 학생).
   * 그 앱의 약속 검사는 새 ID가 든 `welcome`·`join`을 통째로 버리므로 남의 캐릭터를 몸 틀 열쇠(옛 ID 넷과 같은 이름)로 낮춰 보낸다.
   * 12종 전 앱의 교사는 교사 ID가 그대로라 hello만으로는 가려낼 수 없다.
   */
  readonly oldIds: boolean;
  /** 익명 번호를 나눠 쓰는 키(방문자 토큰 해시, 메모리에만). 별명이 있거나 교사면 null */
  readonly anonKey: string | null;
  pose: Pose;
  seq: number;
  dirty: boolean;
  /** 이 방 차례(tick)부터 다시 방송할 수 있음(`LIVE_POSE_HZ`) */
  nextTick: number;
  /** 마지막으로 위치를 내보낸 차례(먼 사람 묶음이 "그동안 바뀐 사람"을 고를 때) */
  sentTick: number;
  lastPoseAt: number;
  /** 최근 넘긴 점프 시각(ms, 오래된 것부터 — 속도 제한용, 길이 ≤ `LIVE_JUMP_MAX_PER_SEC`) */
  readonly jumps: number[];
  /** 최근 속도 제한을 통과한 말풍선 시각(ms, 오래된 것부터 — `bubbleAllowed`·`recordBubble`, 길이 ≤ `BUBBLE_RATE.per10Sec`) */
  readonly bubbles: number[];
}

interface Room {
  readonly exhibitionId: string;
  readonly members: Map<string, Member>;
  readonly anon: Map<string, { readonly n: number; refs: number }>;
  /** 쓰는 방 안 번호 */
  readonly numbers: Set<number>;
  readonly timer: ReturnType<typeof setInterval>;
  tick: number;
}

interface Conn {
  readonly socket: LiveSocket;
  readonly entryCode: string;
  state: 'pending' | 'joined' | 'closed';
  helloTimer: ReturnType<typeof setTimeout> | undefined;
  member: Member | undefined;
  room: Room | undefined;
  /** 위치 글을 건너뛰었다 — 다음 차례에 모두의 지금 자리를 보낸다(판 2) */
  needsFull: boolean;
}

/**
 * 들여보낼 때 정한 것: 별명(서버 값)이 있거나, 익명 번호를 나눠 쓸 키가 있다. `bubbles` = 그때 읽은 말풍선 설정(판 2 `welcome`에)
 */
type Admission = { readonly exhibitionId: string; readonly role: Role; readonly bubbles: BubbleSettings } & (
  { readonly nickname: string } | { readonly anonKey: string }
);

type Hello = Extract<LiveClientMessage, { t: 'hello' }>;
type PoseMessage = Extract<LiveClientMessage, { t: 'pose' }>;
type BubbleContent = Extract<LiveClientMessage, { t: 'bubble' }>['b'];

/** 토큰 해시 = 토큰 글의 UTF-8 SHA-256 소문자 16진(웹 `adapters/tokens.ts`와 같음) */
const tokenHash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

const nicknameOk = (value: string | null | undefined): value is string =>
  typeof value === 'string' && PeerSchema.shape.nickname.safeParse(value).success;

/** 방문자에게만 걸리는 전시 상태 코드(교사는 상태와 상관없이 들어온다) */
const VISITOR_ONLY_CODES: ReadonlySet<ErrorCode> = new Set(['E_EXHIBITION_CLOSED', 'E_EXHIBITION_DRAFT']);

export const createLiveHub = (options: LiveHubOptions): LiveHub => {
  const { deps, log } = options;
  const now = options.now ?? (() => deps.clock.now());
  const rooms = new Map<string, Room>();
  const pending = new Set<Conn>();
  let stopped = false;

  const stats = {
    joined: 0,
    timeouts: 0,
    rejects: new Map<ErrorCode, number>(),
    lastPeers: 0,
    /** 판 2 위치 글을 만든 수·밀려 건너뛴 수(1분, `server_stats`에) */
    built: 0,
    skipped: 0,
  };
  /** 루프가 바빠 위치 빈도를 줄였는가(HS-10) */
  let degraded = false;
  const peerCount = (): number => {
    let n = 0;
    for (const room of rooms.values()) n += room.members.size;
    return n;
  };
  const countReject = (code: ErrorCode): void => {
    stats.rejects.set(code, (stats.rejects.get(code) ?? 0) + 1);
  };

  const sendJson = (socket: LiveSocket, message: LiveServerMessage): void =>
    socket.send(JSON.stringify(message));

  /** 받는 기기에 맞춘 사람 정보(판 2에만 방 안 번호, 옛 ID만 아는 기기에는 몸 틀 열쇠) */
  const toPeer = (m: Member, to: Audience): Peer => ({
    sid: m.sid,
    nickname: m.nickname,
    role: m.role,
    character: to.oldIds ? bodyOf(m.character) : m.character,
    pose: m.pose,
    ...(to.version === 2 ? { n: m.n } : {}),
  });

  /**
   * 받는 쪽 형식(판 × 옛 ID)마다 한 번만 글로 만들어 보낸다. `message`가 null이면 그 형식 기기에는 보내지 않는다
   * (판 2에만 있는 종류)
   */
  const broadcast = (
    room: Room,
    message: (to: Audience) => LiveServerMessage | null,
    exceptSid: string,
  ): void => {
    const texts = new Map<string, string | null>();
    for (const m of room.members.values()) {
      if (m.sid === exceptSid) continue;
      const key = `${m.version}:${m.oldIds ? 'old' : 'new'}`;
      let text = texts.get(key);
      if (text === undefined) {
        const built = message(m);
        text = built === null ? null : JSON.stringify(built);
        texts.set(key, text);
      }
      if (text !== null) m.conn.socket.send(text);
    }
  };

  const leaveRoom = (room: Room, member: Member): void => {
    if (room.members.get(member.sid) !== member) return;
    room.members.delete(member.sid);
    room.numbers.delete(member.n);
    if (member.anonKey !== null) {
      const slot = room.anon.get(member.anonKey);
      if (slot && --slot.refs <= 0) room.anon.delete(member.anonKey);
    }
    if (room.members.size === 0) {
      clearInterval(room.timer);
      rooms.delete(room.exhibitionId);
      return;
    }
    if (!stopped) broadcast(room, () => ({ t: 'leave', sid: member.sid }), member.sid);
  };

  /** 허브 쪽 정리(방에서 빼고 타이머 끄기). 소켓은 닫지 않는다 */
  const detach = (conn: Conn): void => {
    if (conn.state === 'closed') return;
    conn.state = 'closed';
    if (conn.helloTimer !== undefined) clearTimeout(conn.helloTimer);
    conn.helloTimer = undefined;
    pending.delete(conn);
    if (conn.room && conn.member) leaveRoom(conn.room, conn.member);
  };

  const end = (conn: Conn, closeCode: number, reason: string): void => {
    if (conn.state === 'closed') return;
    detach(conn);
    conn.socket.close(closeCode, reason);
  };

  const reject = (conn: Conn, code: ErrorCode): void => {
    if (conn.state === 'closed') return;
    countReject(code);
    sendJson(conn.socket, { t: 'bye', code });
    end(conn, code === 'E_LIVE_FULL' ? CLOSE.tryAgain : CLOSE.policy, code);
  };

  const tick = (room: Room): void => {
    room.tick += 1;
    const c = config();
    const at = now();
    const idleMs = c.LIVE_IDLE_TIMEOUT_SEC * MS_PER_SEC;
    for (const m of [...room.members.values()]) {
      if (at - m.lastPoseAt >= idleMs) {
        stats.timeouts += 1;
        end(m.conn, CLOSE.normal, 'idle');
      }
    }
    if (rooms.get(room.exhibitionId) !== room) return;
    const every =
      Math.max(1, Math.ceil(c.LIVE_BROADCAST_HZ / c.LIVE_POSE_HZ)) * (degraded ? c.LIVE_DEGRADE_EVERY : 1);
    const fresh: Member[] = [];
    for (const m of room.members.values()) {
      if (!m.dirty || room.tick < m.nextTick) continue;
      m.dirty = false;
      m.nextTick = room.tick + every;
      m.sentTick = room.tick;
      fresh.push(m);
    }
    const stamp = Math.max(0, Math.floor(at));
    tickV1(room, fresh, stamp);
    tickV2(room, fresh, stamp);
  };

  /** 판 1(예전 그대로): 위치 조각은 한 번만 문자열로 만들고, 받는 사람마다 자기 것만 뺀다 */
  const tickV1 = (room: Room, fresh: readonly Member[], stamp: number): void => {
    if (fresh.length === 0) return;
    const parts = fresh.map(m => ({ sid: m.sid, json: JSON.stringify({ sid: m.sid, pose: m.pose }) }));
    const head = `{"t":"peers","at":${stamp},"poses":[`;
    for (const r of room.members.values()) {
      if (r.version !== 1) continue;
      const mine = parts.filter(p => p.sid !== r.sid).map(p => p.json);
      if (mine.length > 0) r.conn.socket.send(`${head}${mine.join(',')}]}`);
    }
  };

  /** 판 2 위치 글 하나(`p`) — 고른 사람들을 한 번만 글로 만든다 */
  const packed = (who: Iterable<Member>, stamp: number): Buffer | null => {
    const flat: number[] = [];
    for (const m of who) pushPose(flat, m.n, m.pose);
    if (flat.length === 0) return null;
    stats.built += 1;
    return Buffer.from(`{"t":"p","at":${stamp},"p":[${flat.join(',')}]}`, 'utf8');
  };

  /**
   * 판 2: 무리(바닥 칸)마다 글 하나, 무리 안 모두에게 같은 `Buffer`. 먼 차례에는 그동안 바뀐 모두(모든 무리가 같은 글),
   * 건너뛴 기기에는 모두의 지금 자리(한 번만 만듦).
   */
  const tickV2 = (room: Room, fresh: readonly Member[], stamp: number): void => {
    const c = config();
    const members = [...room.members.values()];
    const readers = members.filter(m => m.version === 2);
    if (readers.length === 0) return;
    const farTick = room.tick % c.LIVE_FAR_EVERY === 0;
    const needFull = readers.some(r => r.conn.needsFull);
    if (fresh.length === 0 && !farTick && !needFull) return;
    const cell = (m: Member): readonly [number, number] => [
      Math.floor(m.pose.x / c.LIVE_AOI_CELL_M),
      Math.floor(m.pose.z / c.LIVE_AOI_CELL_M),
    ];
    let full: Buffer | null | undefined;
    const fullOnce = (): Buffer | null => (full === undefined ? (full = packed(members, stamp)) : full);
    // 먼 차례: 그동안(`LIVE_FAR_EVERY` 차례) 바뀐 모두 — 무리와 상관없이 같은 글
    const sinceFar = farTick ? members.filter(m => m.sentTick > room.tick - c.LIVE_FAR_EVERY) : [];
    const farText = farTick ? packed(sinceFar, stamp) : null;
    const groups = new Map<string, { readonly at: readonly [number, number]; readonly readers: Member[] }>();
    for (const r of readers) {
      const at = cell(r);
      const key = `${at[0]},${at[1]}`;
      const g = groups.get(key);
      if (g) g.readers.push(r);
      else groups.set(key, { at, readers: [r] });
    }
    const freshCells = fresh.map(m => ({ m, at: cell(m) }));
    for (const g of groups.values()) {
      const text = farTick
        ? farText
        : packed(
            freshCells
              .filter(f => Math.abs(f.at[0] - g.at[0]) <= 1 && Math.abs(f.at[1] - g.at[1]) <= 1)
              .map(f => f.m),
            stamp,
          );
      for (const r of g.readers) {
        if (r.conn.needsFull) {
          const all = fullOnce();
          if (all) r.conn.needsFull = !r.conn.socket.sendShared(all);
          continue;
        }
        if (text && !r.conn.socket.sendShared(text)) {
          r.conn.needsFull = true;
          stats.skipped += 1;
        }
      }
    }
  };

  const roomFor = (exhibitionId: string): Room => {
    const existing = rooms.get(exhibitionId);
    if (existing) return existing;
    const timer = setInterval(() => tick(room), MS_PER_SEC / config().LIVE_BROADCAST_HZ);
    timer.unref();
    const room: Room = {
      exhibitionId,
      members: new Map(),
      anon: new Map(),
      numbers: new Set(),
      timer,
      tick: 0,
    };
    rooms.set(exhibitionId, room);
    return room;
  };

  /** 방 안에서 겹치지 않는 sid(난수 포트) */
  const newSid = (taken: ReadonlyMap<string, Member> | undefined): string => {
    for (let attempt = 0; attempt < SID_ATTEMPTS; attempt++) {
      let sid = '';
      for (let i = 0; i < SID_LENGTH; i++)
        sid += SID_ALPHABET.charAt(deps.random.int(0, SID_ALPHABET.length - 1));
      if (!taken?.has(sid)) return sid;
    }
    throw new Error('live sid space exhausted');
  };

  /** 방 안 번호: 비어 있는 가장 작은 수(판 2 `p` 배열) */
  const peerNumber = (room: Room): number => {
    let n = 1;
    while (room.numbers.has(n)) n += 1;
    if (n > PEER_NUMBER_MAX) throw new Error('live peer numbers exhausted');
    room.numbers.add(n);
    return n;
  };

  const anonNumber = (room: Room, key: string): number => {
    const slot = room.anon.get(key);
    if (slot) {
      slot.refs += 1;
      return slot.n;
    }
    const used = new Set([...room.anon.values()].map(s => s.n));
    let n = 1;
    while (used.has(n)) n += 1;
    room.anon.set(key, { n, refs: 1 });
    return n;
  };

  /** 입장 코드·토큰·상태 확인. 거절이면 오류 코드 */
  const admit = (hello: Hello, entryCode: string): Admission | ErrorCode => {
    const role: Role = hello.as;
    if (!characterFits(role, hello.character)) return 'E_VALIDATION';
    const ex = deps.store.exhibitions.getByEntryCode(entryCode);
    if (!ex || isGone(ex, now())) return 'E_NOT_FOUND';
    const hash = tokenHash(hello.token);
    const bubbles = ex.settings.bubbles;
    if (role === 'teacher') {
      const session = deps.store.sessions.get(hash);
      if (!session || session.exhibitionId !== ex.id) return 'E_AUTH';
      return { exhibitionId: ex.id, role, bubbles, nickname: copy.live.teacher };
    }
    if (ex.status === 'DRAFT') return 'E_EXHIBITION_DRAFT';
    if (ex.status === 'CLOSED') return 'E_EXHIBITION_CLOSED';
    const visitor = deps.store.visitors.get(hash, ex.id);
    const named = ex.settings.reactions.naming === 'NICKNAME' ? visitor?.nickname : null;
    return nicknameOk(named)
      ? { exhibitionId: ex.id, role, bubbles, nickname: named }
      : { exhibitionId: ex.id, role, bubbles, anonKey: hash };
  };

  const hello = (conn: Conn, message: Hello): void => {
    const admission = admit(message, conn.entryCode);
    if (typeof admission === 'string') {
      reject(conn, admission);
      return;
    }
    const existing = rooms.get(admission.exhibitionId)?.members;
    // 교사는 상한에 막히지 않는다(학생이 가득 차도 안내할 수 있게) — 상한은 방문자 수
    if (
      admission.role !== 'teacher' &&
      ((existing?.size ?? 0) >= config().LIVE_MAX_PER_EXHIBITION || peerCount() >= config().LIVE_MAX_TOTAL)
    ) {
      reject(conn, 'E_LIVE_FULL');
      return;
    }
    // 던질 수 있는 일(sid)은 방을 만들기 전에 — 빈 방과 타이머가 남지 않게
    const sid = newSid(existing);
    const room = roomFor(admission.exhibitionId);
    const anonKey = 'anonKey' in admission ? admission.anonKey : null;
    const nickname =
      'nickname' in admission
        ? admission.nickname
        : fill(copy.live.anonymous, { n: anonNumber(room, admission.anonKey) });
    const at = now();
    const member: Member = {
      conn,
      sid,
      n: peerNumber(room),
      version: message.v,
      role: admission.role,
      nickname,
      character: normalizeCharacterId(message.character),
      oldIds: message.v === 1 || message.chars !== 2 || isLegacyCharacterAlias(message.character),
      anonKey,
      pose: message.pose,
      seq: -1,
      dirty: false,
      nextTick: room.tick + 1,
      sentTick: -1,
      lastPoseAt: at,
      jumps: [],
      bubbles: [],
    };
    if (conn.helloTimer !== undefined) clearTimeout(conn.helloTimer);
    conn.helloTimer = undefined;
    pending.delete(conn);
    conn.state = 'joined';
    conn.member = member;
    conn.room = room;
    const others = [...room.members.values()].map(m => toPeer(m, member));
    room.members.set(member.sid, member);
    stats.joined += 1;
    sendJson(conn.socket, {
      t: 'welcome',
      you: member.sid,
      nickname,
      peers: others,
      at: Math.max(0, Math.floor(at)),
      ...(member.version === 2 ? { n: member.n, bubbles: admission.bubbles } : {}),
    });
    broadcast(room, to => ({ t: 'join', peer: toPeer(member, to) }), member.sid);
  };

  const pose = (member: Member, message: PoseMessage): void => {
    member.lastPoseAt = now();
    if (message.seq <= member.seq) return;
    member.seq = message.seq;
    member.pose = message.pose;
    member.dirty = true;
  };

  /** 점프 시작을 같은 방 다른 판 2 기기에 넘긴다(판 1 기기는 모르는 종류라 건너뜀). 상한을 넘으면 조용히 버린다 */
  const jump = (room: Room, member: Member): void => {
    const at = now();
    while (member.jumps.length > 0 && at - member.jumps[0]! >= JUMP_RELAY_WINDOW_MS) member.jumps.shift();
    if (member.jumps.length >= config().LIVE_JUMP_MAX_PER_SEC) return;
    member.jumps.push(at);
    const stamp = Math.max(0, Math.floor(at));
    broadcast(room, to => (to.version === 2 ? { t: 'jump', sid: member.sid, at: stamp } : null), member.sid);
  };

  /** 전시의 지금 말풍선 설정(교사가 수업 중 바꾼 것이 바로 먹게 그때마다 저장소에서 읽는다). 전시가 없으면 null */
  const bubbleSettings = (exhibitionId: string): BubbleSettings | null =>
    deps.store.exhibitions.get(exhibitionId)?.settings.bubbles ?? null;

  /**
   * 말풍선(W-02)을 같은 방 다른 판 2 기기에 넘긴다. 교사 설정 → 속도 제한 → 짧은 글이면 설정·다듬기·거름 순으로 보고,
   * 걸리면 조용히 버린다(닫지 않음). 속도 칸은 글을 보기 전에 차므로 걸러질 글을 되풀이해 보내도 거름을 다시 돌리지 않는다.
   * 저장하지 않고 기록에 번호·글을 남기지 않는다.
   */
  const bubble = (room: Room, member: Member, content: BubbleContent): void => {
    const settings = bubbleSettings(room.exhibitionId);
    if (!settings?.enabled) return;
    const at = now();
    if (!bubbleAllowed(member.bubbles, at)) return;
    recordBubble(member.bubbles, at);
    let b: BubbleContent = content;
    if (content.k === 'x') {
      if (!settings.text) return;
      const prepared = prepareBubbleText(content.text);
      if ('error' in prepared) return;
      b = { k: 'x', text: prepared.text };
    }
    const stamp = Math.max(0, Math.floor(at));
    broadcast(
      room,
      to => (to.version === 2 ? { t: 'bubble', sid: member.sid, at: stamp, b } : null),
      member.sid,
    );
  };

  const handle = (conn: Conn, text: string): void => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      reject(conn, 'E_VALIDATION');
      return;
    }
    const parsed = LiveClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      reject(conn, 'E_VALIDATION');
      return;
    }
    const message = parsed.data;
    if (message.t === 'hello') {
      if (conn.state === 'pending') hello(conn, message);
      else reject(conn, 'E_VALIDATION');
      return;
    }
    if (conn.state !== 'joined' || !conn.member || !conn.room) {
      reject(conn, 'E_VALIDATION');
      return;
    }
    if (message.t === 'jump') {
      // 판 1 기기는 이 종류를 보내지 않는다 — 보냈으면 약속을 어긴 것
      if (conn.member.version !== 2) reject(conn, 'E_VALIDATION');
      else jump(conn.room, conn.member);
      return;
    }
    if (message.t === 'bubble') {
      // 점프와 같음: 판 1 기기는 이 종류를 모른다
      if (conn.member.version !== 2) reject(conn, 'E_VALIDATION');
      else bubble(conn.room, conn.member, message.b);
      return;
    }
    pose(conn.member, message);
  };

  /** 소켓 사건 안에서 던지면 서버가 멈추므로 여기서 받는다 */
  const receive = (conn: Conn, text: string): void => {
    if (conn.state === 'closed') return;
    try {
      handle(conn, text);
    } catch (err) {
      log.error('live_message_failed', { err });
      reject(conn, 'E_SERVER');
    }
  };

  return {
    open(socket, entryCode) {
      const conn: Conn = {
        socket,
        entryCode,
        state: 'pending',
        helloTimer: undefined,
        member: undefined,
        room: undefined,
        needsFull: false,
      };
      if (stopped) {
        conn.state = 'closed';
        socket.close(CLOSE.goingAway, 'shutdown');
      } else {
        pending.add(conn);
        conn.helloTimer = setTimeout(() => {
          if (conn.state !== 'pending') return;
          stats.timeouts += 1;
          end(conn, CLOSE.policy, 'hello_timeout');
        }, config().LIVE_HELLO_TIMEOUT_MS);
        conn.helloTimer.unref();
      }
      return {
        receive: text => receive(conn, text),
        invalid: () => reject(conn, 'E_VALIDATION'),
        closed: () => detach(conn),
      };
    },
    closeExhibition(exhibitionId, code) {
      const room = rooms.get(exhibitionId);
      if (!room) return;
      const visitorsOnly = VISITOR_ONLY_CODES.has(code);
      for (const m of [...room.members.values()])
        if (!visitorsOnly || m.role === 'visitor') reject(m.conn, code);
    },
    shutdown() {
      stopped = true;
      for (const conn of [...pending]) end(conn, CLOSE.goingAway, 'shutdown');
      for (const room of [...rooms.values()]) {
        clearInterval(room.timer);
        for (const m of [...room.members.values()]) end(m.conn, CLOSE.goingAway, 'shutdown');
      }
      rooms.clear();
    },
    size: () => ({ rooms: rooms.size, peers: peerCount(), pending: pending.size }),
    exhibitionCounts(exhibitionId) {
      let visitors = 0;
      let teachers = 0;
      for (const m of rooms.get(exhibitionId)?.members.values() ?? []) {
        if (m.role === 'teacher') teachers += 1;
        else visitors += 1;
      }
      return { visitors, teachers };
    },
    exhibitionFloor(exhibitionId) {
      const positions: { x: number; z: number }[] = [];
      let noPose = 0;
      for (const m of rooms.get(exhibitionId)?.members.values() ?? []) {
        if (m.role === 'teacher') continue;
        if (m.seq < 0) noPose += 1;
        else positions.push({ x: m.pose.x, z: m.pose.z });
      }
      return { positions, noPose };
    },
    countReject,
    countTimeout: () => void (stats.timeouts += 1),
    flushStats(server) {
      const peers = peerCount();
      if (server)
        log.info('server_stats', {
          stats: {
            ...server,
            liveRooms: rooms.size,
            livePeers: peers,
            liveBuilt: stats.built,
            liveSkipped: stats.skipped,
            liveDegraded: degraded ? 1 : 0,
          },
        });
      stats.built = 0;
      stats.skipped = 0;
      const quiet =
        stats.joined === 0 && stats.timeouts === 0 && stats.rejects.size === 0 && peers === stats.lastPeers;
      if (quiet) return;
      log.info('live_connections', { count: peers });
      if (stats.joined > 0) log.info('live_joined', { count: stats.joined });
      for (const [code, count] of stats.rejects) log.warn('live_reject', { code, count });
      if (stats.timeouts > 0) log.info('live_timeout', { count: stats.timeouts });
      stats.joined = 0;
      stats.timeouts = 0;
      stats.rejects.clear();
      stats.lastPeers = peers;
    },
    now,
    setLoad(loopP99Ms) {
      const next = loopP99Ms >= config().LIVE_DEGRADE_LOOP_MS;
      if (next === degraded) return;
      degraded = next;
      log.warn('live_degrade', { count: next ? 1 : 0 });
    },
    settingsChanged(exhibitionId) {
      const room = rooms.get(exhibitionId);
      if (!room) return;
      const bubbles = bubbleSettings(exhibitionId);
      if (!bubbles) return;
      // 빼 둘 사람이 없다(sid는 8자라 빈 글과 겹치지 않음)
      broadcast(room, to => (to.version === 2 ? { t: 'cfg', bubbles } : null), '');
    },
  };
};
