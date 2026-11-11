import { STATUS_CODES, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { config } from '@gallery/core/config';
import { errorCatalog } from '@gallery/core/errors';
import { EntryCodeSchema } from '@gallery/core/types';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { CLOSE, type LiveHub, type LiveSocket } from './hub.ts';
import { clientIp, createIpKeyer, createWindowLimiter, type KeySource } from './ip.ts';

/**
 * 함께 관람 연결부(ADR-057): Node HTTP 서버의 `upgrade`에서 `/api/e/{code}/live`만 웹소켓으로 받아 허브에 넘긴다.
 *
 * - 다른 경로·형식이 틀린 입장 코드는 404, 믿는 IP 머리가 없으면(운영) 400, IP 칸(`LIVE_CONNECT_PER_IP_MIN`/분)이
 *   넘치면 429, 끝내는 중이면 503 — 웹소켓을 열지 않고 HTTP 답만 쓰고 소켓을 닫는다(상태는 `errorCatalog`).
 * - `ws`: `noServer`, `maxPayload = LIVE_MAX_MESSAGE_BYTES`(넘치면 `ws`가 1009로 닫음), `perMessageDeflate: false`.
 * - `LIVE_PING_SEC`마다 핑, 그 사이 퐁이 없으면 끊는다. 1분마다 IP 칸을 치우고 허브의 수를 기록에 남긴다.
 */

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60 * MS_PER_SEC;
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
    const socket: LiveSocket = {
      send: text => {
        if (ws.readyState === WebSocket.OPEN) ws.send(text);
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
    hub.flushStats();
  }, MS_PER_MIN);
  minute.unref();

  server.on('upgrade', onUpgrade);

  return {
    close(graceMs = config().SHUTDOWN_WAIT_SEC * MS_PER_SEC) {
      closing ??= new Promise<void>(resolve => {
        server.off('upgrade', onUpgrade);
        clearInterval(ping);
        clearInterval(minute);
        // 끝내기 직전의 수(지금 연결 포함)를 남기고 닫는다
        hub.flushStats();
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
