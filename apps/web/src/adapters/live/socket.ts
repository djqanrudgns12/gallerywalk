import { config } from '@gallery/core/config';
import { type LiveClientMessage, LiveServerMessageSchema, type Pose } from '@gallery/core/types';
import type { LiveChannel, LiveHandlers, LiveJoin } from '../../ports/index.ts';

/**
 * 함께 관람 통로의 브라우저 구현(ADR-057, 포트 `LiveChannel`). 웹소켓 하나 `/api/e/{code}/live`.
 * - 토큰은 첫 메시지 `hello`에만 싣는다(주소·기록에 넣지 않음).
 * - 끊기면 `LIVE_RETRY_MIN_MS`부터 두 배씩 `LIVE_RETRY_MAX_MS`까지(±20% 흔들기) 다시 잇는다. 꽉 참은 `full`, 인증·전시 거절은
 *   `refused`로 멈춘다(혼자 관람은 그대로).
 * - 위치는 초당 `LIVE_POSE_HZ`번까지, 바뀌었을 때만. 그보다 잦으면 마지막 것만 다음 칸에 보낸다.
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

const OPEN = 1;
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

export const createLiveChannel = (deps: LiveSocketDeps): LiveChannel => {
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

  const send = (msg: LiveClientMessage): void => {
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(msg));
  };

  const flushPose = (force = false): void => {
    poseTimer = null;
    if (!latest || !socket || socket.readyState !== OPEN) return;
    if (!force && lastSent && samePose(latest, lastSent)) return;
    send({ t: 'pose', seq: ++seq, pose: latest });
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
    const ms = Math.round(base * (0.8 + 0.4 * deps.random()));
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
    let finalCode: string | null = null;
    // 옛 연결(다시 입장·떠나기 전에 연 것)의 늦은 이벤트는 지금 연결에 끼어들지 않는다(Codex 검토 P1)
    const current = (): boolean => socket === ws && !stopped;
    ws.onopen = () => {
      if (!current()) return;
      send({ t: 'hello', v: 1, token: j.token, as: j.as, character: j.character, pose: latest ?? j.pose });
      lastSent = latest ?? j.pose;
      lastSentAt = deps.now();
    };
    ws.onmessage = ev => {
      if (!current() || typeof ev.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data);
      } catch {
        return;
      }
      const parsed = LiveServerMessageSchema.safeParse(raw);
      if (!parsed.success) return;
      const msg = parsed.data;
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
      connect();
    },
    sendPose(pose) {
      latest = pose;
      if (!stopped) schedulePose();
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
