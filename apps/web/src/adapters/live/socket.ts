import { config } from '@gallery/core/config';
import { decodePoses, roundPose } from '@gallery/core/live';
import {
  type LiveClientMessage,
  type LiveServerMessage,
  LiveServerMessageSchema,
  type Pose,
} from '@gallery/core/types';
import type { LiveChannel, LiveHandlers, LiveJoin } from '../../ports/index.ts';

/**
 * 함께 관람 통로의 브라우저 구현(ADR-057, 포트 `LiveChannel`). 웹소켓 하나 `/api/e/{code}/live`.
 * - 토큰은 첫 메시지 `hello`에만 싣는다(주소·기록에 넣지 않음).
 * - 끊기면 `LIVE_RETRY_MIN_MS`부터 두 배씩 `LIVE_RETRY_MAX_MS`까지(±50% 흔들기) 다시 잇는다. 한 반이 같은 무선 공유기에서
 *   함께 끊기면 같은 때 몰려 다시 붙으므로 흔들기 폭을 넓게 둔다(G-25 HS-12 — ±20%보다 2.5배 넓게 흩어짐). 꽉 참은 `full`, 인증·전시 거절은
 *   `refused`로 멈춘다(혼자 관람은 그대로).
 * - 위치는 초당 `LIVE_POSE_HZ`번까지, 바뀌었을 때만. 그보다 잦으면 마지막 것만 다음 칸에 보낸다. 1cm·0.001rad로 반올림해 보낸다.
 * - 판 2(G-25 HS-02, ADR-072): `hello`에 `v:2`. 위치는 작은 정수 배열 `p`로 오고(자기 것 포함), 이 통로가 방 안 번호를 sid로
 *   바꿔 예전 `peers` 모양으로 넘긴다(받는 쪽 `PeerBuffer`는 그대로). `p`는 초당 여러 번 오는 뜨거운 길이라 zod 대신
 *   `decodePoses`로 손으로 본다. 나머지(`welcome`·`join`·`leave`·`bye`·`jump`)는 스키마로.
 * - 점프 시작(PRD_V2 W-05): `sendJump()`가 `{t:'jump'}`를 한 번 보낸다. 판 2 서버(welcome에 방 안 번호가 온 연결)에만 —
 *   그 전·끊긴 동안·판 1 서버에는 보내지 않고 버린다(지난 점프를 다시 이은 뒤 보내지 않음). 받은 `jump`는 스키마 갈래로 넘긴다.
 * - 머리 위 말풍선(PRD_V2 W-02): `sendBubble()`도 같은 규칙(판 2 연결만, 끊긴 동안 버림). 받은 `bubble`도 스키마 갈래로.
 */

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface LiveSocketDeps {
  readonly open: (url: string) => SocketLike;
  /** 주소: 입장 코드 → ws(s)://…/api/e/{code}/live */
  readonly urlFor: (code: string) => string;
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
  readonly random: () => number;
}

/** 함께 관람 통로(점프 보내기 포함 — 포트 `LiveChannel`과 같음) */
export type LiveJumpChannel = LiveChannel;

const OPEN = 1;
/** 판 2 위치 글의 앞머리(서버가 늘 이 차례로 쓴다 — `hub.ts` `packed`) */
const PACKED_HEAD = '{"t":"p",';
/** 다시 잇기 흔들기: 기본 간격의 0.5~1.5배(가운데 1배) */
const RETRY_JITTER_LOW = 0.5;
const RETRY_JITTER_SPAN = 1;
const STOP_CODES = new Set([
  'E_AUTH',
  'E_NOT_FOUND',
  'E_EXHIBITION_CLOSED',
  'E_EXHIBITION_DRAFT',
  'E_VALIDATION',
]);

/** 이 페이지와 같은 출처의 ws 주소 */
export const sameOriginLiveUrl = (code: string): string => {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/api/e/${encodeURIComponent(code)}/live`;
};

export const browserLiveDeps = (): LiveSocketDeps => ({
  open: url => new WebSocket(url) as unknown as SocketLike,
  urlFor: sameOriginLiveUrl,
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: id => window.clearTimeout(id),
  random: Math.random,
});

const samePose = (a: Pose, b: Pose): boolean =>
  Math.abs(a.x - b.x) < 0.01 &&
  Math.abs(a.y - b.y) < 0.01 &&
  Math.abs(a.z - b.z) < 0.01 &&
  Math.abs(a.yaw - b.yaw) < 0.01 &&
  a.move === b.move;

export const createLiveChannel = (deps: LiveSocketDeps): LiveJumpChannel => {
  let socket: SocketLike | null = null;
  let joinArgs: LiveJoin | null = null;
  let handlers: LiveHandlers | null = null;
  let stopped = true;
  let attempt = 0;
  let retryTimer: number | null = null;
  let poseTimer: number | null = null;
  let latest: Pose | null = null;
  let lastSent: Pose | null = null;
  let lastSentAt = -Infinity;
  let seq = 0;
  let keepTimer: number | null = null;
  /** 판 2: 방 안 번호 → sid(이 연결의 welcome·join·leave로 채움), 내 번호 */
  const sidOf = new Map<number, string>();
  let myNumber: number | null = null;

  /** 판 2 `p` → 예전 `peers` 모양(내 것과 모르는 번호는 뺀다). 모양이 틀리면 null */
  const fromPacked = (raw: unknown): LiveServerMessage | null => {
    if (typeof raw !== 'object' || raw === null) return null;
    const { at, p } = raw as { at?: unknown; p?: unknown };
    if (typeof at !== 'number' || !Number.isInteger(at) || at < 0) return null;
    const list = decodePoses(p);
    if (!list) return null;
    const poses: { sid: string; pose: Pose }[] = [];
    for (const { n, pose } of list) {
      const sid = n === myNumber ? undefined : sidOf.get(n);
      if (sid !== undefined) poses.push({ sid, pose });
    }
    return { t: 'peers', at, poses };
  };

  /** 판 2 번호표를 서버 메시지에 맞춰 고친다 */
  const track = (msg: LiveServerMessage): void => {
    if (msg.t === 'welcome') {
      sidOf.clear();
      myNumber = msg.n ?? null;
      for (const peer of msg.peers) if (peer.n !== undefined) sidOf.set(peer.n, peer.sid);
    } else if (msg.t === 'join') {
      if (msg.peer.n !== undefined) sidOf.set(msg.peer.n, msg.peer.sid);
    } else if (msg.t === 'leave') {
      for (const [n, sid] of sidOf) if (sid === msg.sid) sidOf.delete(n);
    }
  };

  const send = (msg: LiveClientMessage): void => {
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(msg));
  };

  const flushPose = (force = false): void => {
    poseTimer = null;
    if (!latest || !socket || socket.readyState !== OPEN) return;
    if (!force && lastSent && samePose(latest, lastSent)) return;
    send({ t: 'pose', seq: ++seq, pose: roundPose(latest) });
    lastSent = latest;
    lastSentAt = deps.now();
  };

  /**
   * 가만히 작품을 오래 보면 위치가 바뀌지 않아 보내지 않는다 → 서버가 `LIVE_IDLE_TIMEOUT_SEC` 뒤 끊는다.
   * 그 전에 같은 자리를 한 번씩 다시 보내 살아 있음을 알린다(Codex 검토 P2).
   */
  const keepAlive = (): void => {
    if (keepTimer !== null) deps.clearTimeout(keepTimer);
    keepTimer = deps.setTimeout(() => {
      keepTimer = null;
      if (stopped) return;
      if (deps.now() - lastSentAt >= config().LIVE_KEEPALIVE_SEC * 1000 - 1) flushPose(true);
      keepAlive();
    }, config().LIVE_KEEPALIVE_SEC * 1000);
  };

  const schedulePose = (): void => {
    if (poseTimer !== null) return;
    const gap = 1000 / config().LIVE_POSE_HZ;
    const wait = Math.max(0, lastSentAt + gap - deps.now());
    if (wait === 0) flushPose();
    else poseTimer = deps.setTimeout(() => flushPose(), wait);
  };

  const retry = (): void => {
    const c = config();
    const base = Math.min(c.LIVE_RETRY_MAX_MS, c.LIVE_RETRY_MIN_MS * 2 ** attempt);
    const ms = Math.round(base * (RETRY_JITTER_LOW + RETRY_JITTER_SPAN * deps.random()));
    attempt++;
    handlers?.onStatus('retrying');
    retryTimer = deps.setTimeout(() => {
      retryTimer = null;
      connect();
    }, ms);
  };

  const connect = (): void => {
    if (stopped || !joinArgs) return;
    const j = joinArgs;
    handlers?.onStatus('connecting');
    const ws = deps.open(deps.urlFor(j.code));
    socket = ws;
    // 새 연결의 판은 그 welcome으로 다시 정한다(다시 이은 서버가 판 2인지 모름 — 그 전에는 점프를 보내지 않음)
    myNumber = null;
    let finalCode: string | null = null;
    // 옛 연결(다시 입장·떠나기 전에 연 것)의 늦은 이벤트는 지금 연결에 끼어들지 않는다(Codex 검토 P1)
    const current = (): boolean => socket === ws && !stopped;
    ws.onopen = () => {
      if (!current()) return;
      send({
        t: 'hello',
        v: 2,
        token: j.token,
        as: j.as,
        character: j.character,
        pose: roundPose(latest ?? j.pose),
        // 학생 10종 ID를 안다(M4-9) — 서버가 남의 캐릭터를 낮추지 않고 그대로 보낸다
        chars: 2,
      });
      lastSent = latest ?? j.pose;
      lastSentAt = deps.now();
    };
    ws.onmessage = ev => {
      if (!current() || typeof ev.data !== 'string') return;
      handlers?.onBytes?.(ev.data.length);
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data);
      } catch {
        return;
      }
      // 뜨거운 길(판 2 위치): 손으로 보고 예전 모양으로
      if (ev.data.startsWith(PACKED_HEAD)) {
        const peers = fromPacked(raw);
        if (peers) handlers?.onMessage(peers, deps.now());
        return;
      }
      const parsed = LiveServerMessageSchema.safeParse(raw);
      if (!parsed.success) return;
      const msg = parsed.data;
      track(msg);
      if (msg.t === 'welcome') {
        attempt = 0;
        handlers?.onStatus('live');
        keepAlive();
      }
      if (msg.t === 'bye') finalCode = msg.code;
      handlers?.onMessage(msg, deps.now());
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (socket !== ws || stopped) return;
      socket = null;
      if (finalCode === 'E_LIVE_FULL') {
        stopped = true;
        handlers?.onStatus('full', finalCode);
        return;
      }
      if (finalCode !== null && STOP_CODES.has(finalCode)) {
        stopped = true;
        handlers?.onStatus('refused', finalCode);
        return;
      }
      retry();
    };
  };

  return {
    join(j, h) {
      this.leave();
      joinArgs = j;
      handlers = h;
      latest = j.pose;
      stopped = false;
      attempt = 0;
      seq = 0;
      sidOf.clear();
      myNumber = null;
      connect();
    },
    sendPose(pose) {
      latest = pose;
      if (!stopped) schedulePose();
    },
    sendJump() {
      // 판 2 서버의 welcome을 받은 연결만(옛 서버는 모르는 종류를 받으면 닫는다)
      if (!stopped && myNumber !== null) send({ t: 'jump' });
    },
    sendBubble(bubble) {
      // 점프와 같은 까닭으로 판 2 서버의 welcome을 받은 연결만
      if (!stopped && myNumber !== null) send({ t: 'bubble', ...bubble });
    },
    leave() {
      stopped = true;
      if (retryTimer !== null) deps.clearTimeout(retryTimer);
      if (poseTimer !== null) deps.clearTimeout(poseTimer);
      if (keepTimer !== null) deps.clearTimeout(keepTimer);
      retryTimer = null;
      poseTimer = null;
      keepTimer = null;
      const ws = socket;
      socket = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close(1000);
      }
      if (handlers) handlers.onStatus('off');
      handlers = null;
      joinArgs = null;
      lastSent = null;
      lastSentAt = -Infinity;
    },
  };
};
