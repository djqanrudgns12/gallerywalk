import { STATUS_CODES, type IncomingMessage } from 'node:http';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { Duplex } from 'node:stream';
import { config } from '@gallery/core/config';
import { errorCatalog } from '@gallery/core/errors';
import { EntryCodeSchema } from '@gallery/core/types';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { LogStats } from '../log.ts';
import { CLOSE, type LiveHub, type LiveSocket } from './hub.ts';
import { clientIp, createIpKeyer, createWindowLimiter, type KeySource } from './ip.ts';

/**
 * 함께 관람 연결부(ADR-057): Node HTTP 서버의 `upgrade`에서 `/api/e/{code}/live`만 웹소켓으로 받아 허브에 넘긴다.
 *
 * - 다른 경로·형식이 틀린 입장 코드는 404, 믿는 IP 머리가 없으면(운영) 400, IP 칸(`LIVE_CONNECT_PER_IP_MIN`/분)이
 *   넘치면 429, 끝내는 중이면 503 — 웹소켓을 열지 않고 HTTP 답만 쓰고 소켓을 닫는다(상태는 `errorCatalog`).
 * - `ws`: `noServer`, `maxPayload = LIVE_MAX_MESSAGE_BYTES`(넘치면 `ws`가 1009로 닫음), `perMessageDeflate: false`.
 * - `LIVE_PING_SEC`마다 핑, 그 사이 퐁이 없으면 끊는다. 1분마다 IP 칸을 치우고 허브의 수를 기록에 남긴다.
 * - 1분 서버 수(HS-00, 세기만): 이벤트 루프 지연 p50·p99·최대(`monitorEventLoopDelay`, `STATS_LOOP_RESOLUTION_MS` —
 *   재기 간격을 뺀 늦어진 시간)와
 *   이용률(`eventLoopUtilization`), 그 1분 동안 보낸 메시지 수·바이트·보내기 직전 본 가장 큰 `bufferedAmount`,
 *   RSS·힙(MB), `minuteStats`가 주는 수(진단 받은 수). 읽은 뒤 비운다. 토큰·IP·별명은 들어갈 자리가 없다.
 * - 느린 기기(HS-04, ADR-072): 여럿에게 같은 위치 글(`sendShared`)은 보낼 줄(`bufferedAmount`)이 `LIVE_SEND_BUFFER_MAX_BYTES`를
 *   넘으면 보내지 않는다(위치는 마지막 것만 뜻이 있다). `LIVE_SLOW_CLOSE_SEC` 동안 계속 밀리면 1013으로 닫는다 — 기기는 다시 잇는다.
 *   루프 지연 p99는 1분마다 허브에 알린다(`setLoad`, HS-10).
 */

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60 * MS_PER_SEC;
const NS_PER_MS = 1e6;
const BYTES_PER_MB = 1024 * 1024;
/** 기록 자릿수: ms·MB는 소수 첫째, 이용률은 셋째 */
const ROUND_TENTH = 10;
const ROUND_THOUSANDTH = 1000;
const P50 = 50;
const P99 = 99;
const round = (value: number, scale: number): number => Math.round(value * scale) / scale;
const LIVE_PATH = /^\/api\/e\/([^/]+)\/live$/;

/** HTTP `upgrade` 사건을 내는 서버(`node:http` `Server`, `@hono/node-server`의 `serve()` 결과) */
type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
export interface UpgradeSource {
  on(event: 'upgrade', listener: UpgradeListener): unknown;
  off(event: 'upgrade', listener: UpgradeListener): unknown;
}

export interface AttachLiveOptions {
  /** 운영이면 `CLIENT_IP_HEADER` 머리가 없을 때 거절, 아니면 소켓 주소로 센다 */
  readonly production: boolean;
  /** IP 칸 키를 만드는 비밀(HMAC) — `env.secrets.rateKey`를 그대로 */
  readonly rateKey: KeySource;
  /** 1분 기록에 곁들일 수(진단 받은 수 등). 부를 때마다 그 1분 수를 꺼내고 비워야 한다 */
  readonly minuteStats?: () => LogStats;
}

export interface LiveAttachment {
  /**
   * 끝내기: 새 연결을 받지 않고(`upgrade` 듣기를 뗌) 모든 연결을 1001로 닫는다. 다 닫히면 끝나고,
   * `graceMs`(기본 `SHUTDOWN_WAIT_SEC`) 안에 닫히지 않은 소켓은 끊는다. 마지막 수를 기록에 남긴다.
   */
  close(graceMs?: number): Promise<void>;
}

type RefuseCode = 'E_NOT_FOUND' | 'E_VALIDATION' | 'E_RATE_LIMITED' | 'E_BUSY';

const entryCodeOf = (url: string | undefined): string | null => {
  const path = (url ?? '').split('?', 1)[0] ?? '';
  const match = LIVE_PATH.exec(path);
  const parsed = EntryCodeSchema.safeParse(match?.[1]);
  return parsed.success ? parsed.data : null;
};

const textOf = (data: RawData): string =>
  (Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)).toString(
    'utf8',
  );

const noop = (): void => undefined;

/**
 * 보낼 줄이 밀린 기기 판정(HS-04): `LIVE_SEND_BUFFER_MAX_BYTES` 넘으면 건너뜀, 처음 밀린 때부터 `LIVE_SLOW_CLOSE_SEC`가
 * 지나도록 계속 밀리면 닫음. 한 번이라도 풀리면 처음부터 다시 잰다.
 */
export const createSlowGuard = (now: () => number) => {
  let since: number | null = null;
  return {
    check(buffered: number): 'send' | 'skip' | 'close' {
      const c = config();
      if (buffered <= c.LIVE_SEND_BUFFER_MAX_BYTES) {
        since = null;
        return 'send';
      }
      const t = now();
      since ??= t;
      return t - since >= c.LIVE_SLOW_CLOSE_SEC * MS_PER_SEC ? 'close' : 'skip';
    },
  };
};

export const attachLive = (server: UpgradeSource, hub: LiveHub, opts: AttachLiveOptions): LiveAttachment => {
  const c = config();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: c.LIVE_MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
    clientTracking: true,
  });
  const ipKey = createIpKeyer(opts.rateKey);
  const limiter = createWindowLimiter(MS_PER_MIN);
  const alive = new WeakMap<WebSocket, boolean>();
  let closing: Promise<void> | undefined;

  // 1분 서버 수(HS-00): 세기만 한다 — 보내는 방식은 그대로
  const sent = { msgs: 0, bytes: 0, bufMax: 0, slowClosed: 0 };
  const resolutionMs = c.STATS_LOOP_RESOLUTION_MS;
  const loop = monitorEventLoopDelay({ resolution: resolutionMs });
  loop.enable();
  // 이 히스토그램은 재기 타이머 사이 시간 전체를 담는다(쉬는 루프도 ≈ 재기 간격) — 간격을 빼고 늦어진 만큼만 남긴다
  const lateMs = (ns: number): number => round(Math.max(0, ns / NS_PER_MS - resolutionMs), ROUND_TENTH);
  let elu = performance.eventLoopUtilization();
  const sample = (): LogStats => {
    const eluNow = performance.eventLoopUtilization();
    const used = performance.eventLoopUtilization(eluNow, elu).utilization;
    elu = eluNow;
    const mem = process.memoryUsage();
    const stats: LogStats = {
      loopP50Ms: lateMs(loop.percentile(P50)),
      loopP99Ms: lateMs(loop.percentile(P99)),
      loopMaxMs: lateMs(loop.max),
      elu: round(used, ROUND_THOUSANDTH),
      liveMsgs: sent.msgs,
      liveBytes: sent.bytes,
      liveBufMax: sent.bufMax,
      liveSlowClosed: sent.slowClosed,
      rssMb: round(mem.rss / BYTES_PER_MB, ROUND_TENTH),
      heapMb: round(mem.heapUsed / BYTES_PER_MB, ROUND_TENTH),
      ...opts.minuteStats?.(),
    };
    loop.reset();
    sent.msgs = 0;
    sent.bytes = 0;
    sent.bufMax = 0;
    sent.slowClosed = 0;
    return stats;
  };

  const refuse = (socket: Duplex, code: RefuseCode): void => {
    hub.countReject(code);
    const status = errorCatalog[code].http;
    socket.on('error', noop);
    socket.once('finish', () => socket.destroy());
    socket.end(
      `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  };

  const connect = (ws: WebSocket, entryCode: string): void => {
    alive.set(ws, true);
    const slow = createSlowGuard(() => hub.now());
    const socket: LiveSocket = {
      send: text => {
        if (ws.readyState !== WebSocket.OPEN) return;
        sent.msgs += 1;
        sent.bytes += Buffer.byteLength(text, 'utf8');
        if (ws.bufferedAmount > sent.bufMax) sent.bufMax = ws.bufferedAmount;
        ws.send(text);
      },
      sendShared: data => {
        if (ws.readyState !== WebSocket.OPEN) return true;
        const buffered = ws.bufferedAmount;
        if (buffered > sent.bufMax) sent.bufMax = buffered;
        const verdict = slow.check(buffered);
        if (verdict === 'close') {
          sent.slowClosed += 1;
          ws.close(CLOSE.tryAgain, 'slow');
          return false;
        }
        if (verdict === 'skip') return false;
        sent.msgs += 1;
        sent.bytes += data.length;
        // 같은 Buffer를 여러 소켓에 — 문자열처럼 소켓마다 다시 인코딩하지 않는다. 기기는 글 프레임으로 받는다
        ws.send(data, { binary: false });
        return true;
      },
      close: (code, reason) => {
        if (ws.readyState === WebSocket.OPEN) ws.close(code, reason);
      },
    };
    const conn = hub.open(socket, entryCode);
    ws.on('message', (data, isBinary) => (isBinary ? conn.invalid() : conn.receive(textOf(data))));
    ws.on('pong', () => alive.set(ws, true));
    // 너무 큰 메시지(1009)·틀린 프레임: `ws`가 닫고 'close'가 뒤따른다. 원인 글은 기록하지 않는다
    ws.on('error', () => hub.countReject('E_VALIDATION'));
    ws.on('close', () => conn.closed());
  };

  const onUpgrade: UpgradeListener = (req, socket, head) => {
    if (closing) return refuse(socket, 'E_BUSY');
    const entryCode = entryCodeOf(req.url);
    if (entryCode === null) return refuse(socket, 'E_NOT_FOUND');
    const ip = clientIp(req, config().CLIENT_IP_HEADER, opts.production);
    const key = ip === null ? null : ipKey(ip);
    if (key === null) return refuse(socket, 'E_VALIDATION');
    if (!limiter.take(key, hub.now(), config().LIVE_CONNECT_PER_IP_MIN))
      return refuse(socket, 'E_RATE_LIMITED');
    wss.handleUpgrade(req, socket, head, ws => {
      if (closing) ws.close(CLOSE.goingAway, 'shutdown');
      else connect(ws, entryCode);
    });
  };

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        hub.countTimeout();
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }
  }, c.LIVE_PING_SEC * MS_PER_SEC);
  ping.unref();

  const minute = setInterval(() => {
    limiter.sweep(hub.now());
    const stats = sample();
    hub.setLoad(stats.loopP99Ms ?? 0);
    hub.flushStats(stats);
  }, MS_PER_MIN);
  minute.unref();

  server.on('upgrade', onUpgrade);

  return {
    close(graceMs = config().SHUTDOWN_WAIT_SEC * MS_PER_SEC) {
      closing ??= new Promise<void>(resolve => {
        server.off('upgrade', onUpgrade);
        clearInterval(ping);
        clearInterval(minute);
        // 끝내기 직전의 수(지금 연결 포함, 마지막 1분 조각)를 남기고 닫는다
        hub.flushStats(sample());
        loop.disable();
        hub.shutdown();
        const remaining = new Set(wss.clients);
        for (const ws of remaining)
          if (ws.readyState === WebSocket.OPEN) ws.close(CLOSE.goingAway, 'shutdown');
        const done = (): void => {
          clearTimeout(timer);
          wss.close();
          resolve();
        };
        const timer = setTimeout(() => {
          for (const ws of remaining) ws.terminate();
        }, graceMs);
        timer.unref();
        if (remaining.size === 0) {
          done();
          return;
        }
        for (const ws of remaining) {
          ws.once('close', () => {
            remaining.delete(ws);
            if (remaining.size === 0) done();
          });
        }
      });
      return closing;
    },
  };
};
