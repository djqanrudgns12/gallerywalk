import { createHash } from 'node:crypto';
import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import type { ErrorCode } from '@gallery/core/errors';
import { isGone } from '@gallery/core/retention';
import {
  LiveClientMessageSchema,
  PeerSchema,
  type CharacterId,
  type LiveClientMessage,
  type LiveServerMessage,
  type Peer,
  type Pose,
} from '@gallery/core/types';
import type { Logger } from '../log.ts';
import type { Deps } from '../ports/index.ts';

/**
 * 함께 관람 허브(ADR-057, 약속 `types/live.ts`). 전시마다 방 하나를 메모리에 두고 위치를 중계한다 — 저장하지 않는다.
 *
 * - 별명·역할은 서버 값: 교사 세션이면 `copy.live.teacher`, 방문자는 방문자 기록의 별명(없거나 익명 방식이면
 *   `copy.live.anonymous`, n = 그 방에서 비어 있는 가장 작은 번호 — 같은 토큰의 연결은 같은 번호).
 * - 위치: 늦은 `seq`는 버리고, 받은 것 중 마지막 것만 남긴다. 방마다 `LIVE_BROADCAST_HZ`로 바뀐 사람만 `peers`
 *   (자기 자신 제외), 한 사람은 초당 `LIVE_POSE_HZ`번까지만 나간다.
 * - 닫기: 거절은 `bye` 다음 1008(꽉 참은 1013). `hello`를 기다리다 넘치면 1008, 위치가 `LIVE_IDLE_TIMEOUT_SEC` 동안
 *   없으면 1000, 끝내기는 1001.
 * - 기록: 1분마다 모은 수(지금 연결·들어온 수·거절 코드별 수·시간 초과 수)만. 토큰·해시·IP·위치·별명은 넣지 않는다.
 *
 * 웹소켓·HTTP는 모른다(`attach.ts`가 `LiveSocket`으로 감싸 넘긴다).
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

type Role = Peer['role'];

/** 역할마다 고를 수 있는 캐릭터(학생은 들어올 때, 선생님은 교사 화면에서 — ADR-057) */
const CHARACTER_PREFIX: Record<Role, string> = { visitor: 'student-', teacher: 'teacher-' };
const characterFits = (role: Role, character: CharacterId): boolean =>
  character.startsWith(CHARACTER_PREFIX[role]);

/** 허브가 쓰는 소켓(attach가 `ws`를 감싼다). 닫힌 뒤 부르면 아무 일도 하지 않아야 한다. */
export interface LiveSocket {
  send(text: string): void;
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
  /** 연결 앞단(attach)의 거절·시간 초과도 같은 칸에서 센다 */
  countReject(code: ErrorCode): void;
  countTimeout(): void;
  /** 모은 수를 기록에 남기고 비운다(attach가 1분마다·끝낼 때). 바뀐 것이 없으면 남기지 않는다 */
  flushStats(): void;
  /** 허브의 시계(ms) — attach의 IP 칸도 같은 시계를 쓴다 */
  now(): number;
}

export interface LiveHubOptions {
  /** 저장소(전시·교사 세션·방문자 조회)·난수(sid)·시계 */
  readonly deps: Pick<Deps, 'store' | 'random' | 'clock'>;
  readonly log: Logger;
  /** 기본 `deps.clock.now` */
  readonly now?: () => number;
}

interface Member {
  readonly conn: Conn;
  readonly sid: string;
  readonly role: Role;
  readonly nickname: string;
  readonly character: CharacterId;
  /** 익명 번호를 나눠 쓰는 키(방문자 토큰 해시, 메모리에만). 별명이 있거나 교사면 null */
  readonly anonKey: string | null;
  pose: Pose;
  seq: number;
  dirty: boolean;
  /** 이 방 차례(tick)부터 다시 방송할 수 있음(`LIVE_POSE_HZ`) */
  nextTick: number;
  lastPoseAt: number;
}

interface Room {
  readonly exhibitionId: string;
  readonly members: Map<string, Member>;
  readonly anon: Map<string, { readonly n: number; refs: number }>;
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
}

/** 들여보낼 때 정한 것: 별명(서버 값)이 있거나, 익명 번호를 나눠 쓸 키가 있다 */
type Admission = { readonly exhibitionId: string; readonly role: Role } & (
  { readonly nickname: string } | { readonly anonKey: string }
);

type Hello = Extract<LiveClientMessage, { t: 'hello' }>;
type PoseMessage = Extract<LiveClientMessage, { t: 'pose' }>;

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

  const stats = { joined: 0, timeouts: 0, rejects: new Map<ErrorCode, number>(), lastPeers: 0 };
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

  const toPeer = (m: Member): Peer => ({
    sid: m.sid,
    nickname: m.nickname,
    role: m.role,
    character: m.character,
    pose: m.pose,
  });

  const broadcast = (room: Room, message: LiveServerMessage, exceptSid: string): void => {
    const text = JSON.stringify(message);
    for (const m of room.members.values()) if (m.sid !== exceptSid) m.conn.socket.send(text);
  };

  const leaveRoom = (room: Room, member: Member): void => {
    if (room.members.get(member.sid) !== member) return;
    room.members.delete(member.sid);
    if (member.anonKey !== null) {
      const slot = room.anon.get(member.anonKey);
      if (slot && --slot.refs <= 0) room.anon.delete(member.anonKey);
    }
    if (room.members.size === 0) {
      clearInterval(room.timer);
      rooms.delete(room.exhibitionId);
      return;
    }
    if (!stopped) broadcast(room, { t: 'leave', sid: member.sid }, member.sid);
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
    const every = Math.max(1, Math.ceil(c.LIVE_BROADCAST_HZ / c.LIVE_POSE_HZ));
    const parts: { readonly sid: string; readonly json: string }[] = [];
    for (const m of room.members.values()) {
      if (!m.dirty || room.tick < m.nextTick) continue;
      m.dirty = false;
      m.nextTick = room.tick + every;
      parts.push({ sid: m.sid, json: JSON.stringify({ sid: m.sid, pose: m.pose }) });
    }
    if (parts.length === 0) return;
    // 위치 조각은 한 번만 문자열로 만들고, 받는 사람마다 자기 것만 뺀다
    const head = `{"t":"peers","at":${Math.max(0, Math.floor(at))},"poses":[`;
    for (const r of room.members.values()) {
      const mine = parts.filter(p => p.sid !== r.sid).map(p => p.json);
      if (mine.length > 0) r.conn.socket.send(`${head}${mine.join(',')}]}`);
    }
  };

  const roomFor = (exhibitionId: string): Room => {
    const existing = rooms.get(exhibitionId);
    if (existing) return existing;
    const timer = setInterval(() => tick(room), MS_PER_SEC / config().LIVE_BROADCAST_HZ);
    timer.unref();
    const room: Room = { exhibitionId, members: new Map(), anon: new Map(), timer, tick: 0 };
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
    if (role === 'teacher') {
      const session = deps.store.sessions.get(hash);
      if (!session || session.exhibitionId !== ex.id) return 'E_AUTH';
      return { exhibitionId: ex.id, role, nickname: copy.live.teacher };
    }
    if (ex.status === 'DRAFT') return 'E_EXHIBITION_DRAFT';
    if (ex.status === 'CLOSED') return 'E_EXHIBITION_CLOSED';
    const visitor = deps.store.visitors.get(hash, ex.id);
    const named = ex.settings.reactions.naming === 'NICKNAME' ? visitor?.nickname : null;
    return nicknameOk(named)
      ? { exhibitionId: ex.id, role, nickname: named }
      : { exhibitionId: ex.id, role, anonKey: hash };
  };

  const hello = (conn: Conn, message: Hello): void => {
    const admission = admit(message, conn.entryCode);
    if (typeof admission === 'string') {
      reject(conn, admission);
      return;
    }
    const existing = rooms.get(admission.exhibitionId)?.members;
    // 교사는 상한에 막히지 않는다(학생이 가득 차도 안내할 수 있게) — 상한은 방문자 수
    if (admission.role !== 'teacher' && (existing?.size ?? 0) >= config().LIVE_MAX_PER_EXHIBITION) {
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
      role: admission.role,
      nickname,
      character: message.character,
      anonKey,
      pose: message.pose,
      seq: -1,
      dirty: false,
      nextTick: room.tick + 1,
      lastPoseAt: at,
    };
    if (conn.helloTimer !== undefined) clearTimeout(conn.helloTimer);
    conn.helloTimer = undefined;
    pending.delete(conn);
    conn.state = 'joined';
    conn.member = member;
    conn.room = room;
    const others = [...room.members.values()].map(toPeer);
    room.members.set(member.sid, member);
    stats.joined += 1;
    sendJson(conn.socket, {
      t: 'welcome',
      you: member.sid,
      nickname,
      peers: others,
      at: Math.max(0, Math.floor(at)),
    });
    broadcast(room, { t: 'join', peer: toPeer(member) }, member.sid);
  };

  const pose = (member: Member, message: PoseMessage): void => {
    member.lastPoseAt = now();
    if (message.seq <= member.seq) return;
    member.seq = message.seq;
    member.pose = message.pose;
    member.dirty = true;
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
    if (conn.state !== 'joined' || !conn.member) {
      reject(conn, 'E_VALIDATION');
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
    countReject,
    countTimeout: () => void (stats.timeouts += 1),
    flushStats() {
      const peers = peerCount();
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
  };
};
