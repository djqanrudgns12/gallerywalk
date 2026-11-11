import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { config } from '@gallery/core/config';
import { expiresAt } from '@gallery/core/retention';
import {
  ExhibitionSettingsSchema,
  LiveServerMessageSchema,
  type CharacterId,
  type ExhibitionStatus,
  type LiveServerMessage,
  type Pose,
} from '@gallery/core/types';
import { WebSocket, type ClientOptions } from 'ws';
import { attachLive, type LiveAttachment } from '../../src/live/attach.ts';
import { createLiveHub, type LiveHub } from '../../src/live/hub.ts';
import { createLogger } from '../../src/log.ts';
import type { ExhibitionRecord } from '../../src/ports/index.ts';
import { makeTempDir } from '../helpers/server.ts';
import { testDeps } from '../support/memoryStore.ts';

/**
 * 함께 관람 시험 도구: 실제 HTTP 서버(임시 포트) + `attachLive` + `ws` 클라이언트.
 * 시험 자료는 모두 여기서 만든 가상 값(토큰은 시험마다 새 난수, 별명·IP는 문서용 주소).
 */

export type TestClock = ReturnType<typeof testDeps>;

export interface LiveRig {
  readonly t: TestClock;
  readonly hub: LiveHub;
  readonly live: LiveAttachment;
  readonly server: Server;
  readonly base: string;
  /** 지금까지 쓴 기록 전체 */
  readonly logText: () => Promise<string>;
  readonly stop: () => Promise<void>;
}

export const startRig = async (options: { readonly production?: boolean } = {}): Promise<LiveRig> => {
  const t = testDeps();
  const root = await makeTempDir();
  const logDir = join(root, 'logs');
  const log = createLogger({ dir: logDir, keepFiles: 7 });
  const hub = createLiveHub({ deps: t.deps, log });
  // 웹소켓이 아닌 요청(끝낸 뒤의 upgrade 포함)은 404
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  const key = randomBytes(32);
  const live = attachLive(server, hub, {
    production: options.production ?? false,
    rateKey: { bytes: () => Buffer.from(key) },
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const logText = async (): Promise<string> => {
    const names = (await readdir(logDir)).sort();
    const parts = await Promise.all(names.map(name => readFile(join(logDir, name), 'utf8')));
    return parts.join('');
  };
  const stop = async (): Promise<void> => {
    await live.close(0);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    log.close();
    await rm(root, { recursive: true, force: true });
  };
  return { t, hub, live, server, base: `ws://127.0.0.1:${port}`, logText, stop };
};

// ── 자료 ────────────────────────────────────────────────────────

let seq = 0;
const uuid = (kind: number): string =>
  `00000000-0000-4000-8${String(kind).padStart(3, '0')}-${String(++seq).padStart(12, '0')}`;

/** 기기가 만든 것과 같은 모양의 토큰(base64url 43자, 시험마다 새 난수) */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** 웹 `adapters/tokens.ts`와 같은 해시(토큰 글의 UTF-8 SHA-256 소문자 16진) */
export const hashOf = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

export interface SeedExhibition {
  readonly status?: ExhibitionStatus;
  readonly naming?: 'ANONYMOUS' | 'NICKNAME';
  readonly expired?: boolean;
}

let codeSeq = 0;

export const seedExhibition = (t: TestClock, over: SeedExhibition = {}): ExhibitionRecord => {
  const now = t.at();
  const digits = config().ENTRY_CODE_DIGITS;
  const rec: ExhibitionRecord = {
    id: uuid(1),
    entryCode: String(10 ** (digits - 1) + ++codeSeq),
    pinHmac: `hmac:${codeSeq}`,
    title: '가상 전시관',
    subtitle: null,
    templateId: 'modern-history',
    posterAssetId: null,
    schoolName: null,
    className: null,
    showSchool: false,
    settings: ExhibitionSettingsSchema.parse({ reactions: { naming: over.naming ?? 'NICKNAME' } }),
    status: over.status ?? 'OPEN',
    retentionDays: config().EXHIBITION_TTL_DAYS,
    rev: 1,
    createHash: 'c'.repeat(64),
    contentVersion: 1,
    settingsVersion: 1,
    layoutVersion: 0,
    layoutDirty: false,
    deleting: false,
    createdAt: now,
    expiresAt: over.expired ? now : expiresAt(now, config().EXHIBITION_TTL_DAYS),
    openedAt: now,
    closedAt: null,
  };
  t.store.exhibitions.insert(rec);
  return rec;
};

export const seedTeacher = (t: TestClock, exhibitionId: string): string => {
  const token = newToken();
  t.store.sessions.insert({
    tokenHash: hashOf(token),
    exhibitionId,
    kind: 'LINK',
    createdAt: t.at(),
    lastUsedAt: t.at(),
  });
  return token;
};

export const seedVisitor = (t: TestClock, exhibitionId: string, nickname: string | null): string => {
  const token = newToken();
  t.store.visitors.insert({
    tokenHash: hashOf(token),
    exhibitionId,
    nickname,
    nicknameNorm: nickname,
    consentVersion: 'v1',
    consentAt: t.at(),
    createdAt: t.at(),
  });
  return token;
};

export const pose = (x: number, over: Partial<Pose> = {}): Pose => ({
  x,
  y: 0,
  z: -x / 2,
  yaw: 0.5,
  move: 1,
  ...over,
});

export const hello = (
  token: string,
  over: { readonly as?: 'visitor' | 'teacher'; readonly character?: CharacterId; readonly pose?: Pose } = {},
) => ({
  t: 'hello' as const,
  v: 1 as const,
  token,
  as: over.as ?? 'visitor',
  character: over.character ?? (over.as === 'teacher' ? 'teacher-f' : 'student-m'),
  pose: over.pose ?? pose(1),
});

// ── 클라이언트 ──────────────────────────────────────────────────

const WAIT_MS = 3000;
const POLL_MS = 5;

type Of<T extends LiveServerMessage['t']> = Extract<LiveServerMessage, { t: T }>;

export interface Closed {
  readonly code: number;
  readonly reason: string;
}

/** 받은 서버 메시지를 모두 약속(`LiveServerMessageSchema`)으로 검사하며 모아 두는 `ws` 클라이언트 */
export class LiveClient {
  readonly ws: WebSocket;
  readonly inbox: LiveServerMessage[] = [];
  readonly invalid: unknown[] = [];
  readonly closed: Promise<Closed>;
  readonly opened: Promise<void>;
  private wake: (() => void) | undefined;

  constructor(url: string, options: ClientOptions = {}) {
    this.ws = new WebSocket(url, { perMessageDeflate: false, ...options });
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('unexpected-response', (_req, res) =>
        reject(new Error(`unexpected-response ${res.statusCode ?? 0}`)),
      );
      this.ws.once('error', reject);
    });
    this.closed = new Promise(resolve =>
      this.ws.once('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') })),
    );
    this.ws.on('error', () => undefined);
    this.ws.on('message', (data, isBinary) => {
      let raw: unknown;
      try {
        raw = isBinary ? undefined : JSON.parse((data as Buffer).toString('utf8'));
      } catch {
        raw = undefined;
      }
      const parsed = LiveServerMessageSchema.safeParse(raw);
      if (parsed.success) this.inbox.push(parsed.data);
      else this.invalid.push(raw);
      this.wake?.();
    });
  }

  static async open(url: string, options: ClientOptions = {}): Promise<LiveClient> {
    const client = new LiveClient(url, options);
    await client.opened;
    return client;
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /** 받은 것 중 그 종류(아직 꺼내지 않은 것) */
  received<T extends LiveServerMessage['t']>(t: T): Of<T>[] {
    return this.inbox.filter((m): m is Of<T> => m.t === t);
  }

  /** 그 종류의 다음 메시지를 꺼낸다(이미 받았으면 바로) */
  async next<T extends LiveServerMessage['t']>(t: T, timeoutMs = WAIT_MS): Promise<Of<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.inbox.findIndex(m => m.t === t);
      if (index >= 0) return this.inbox.splice(index, 1)[0] as Of<T>;
      if (Date.now() > deadline) throw new Error(`no '${t}' within ${timeoutMs}ms`);
      await new Promise<void>(resolve => {
        this.wake = resolve;
        setTimeout(resolve, POLL_MS);
      });
    }
  }

  /**
   * 핑을 보내고 퐁을 기다린다. 서버는 같은 소켓의 프레임을 차례로 처리하므로, 퐁이 오면 앞서 보낸 메시지는 모두
   * 처리됐고 그 전에 서버가 보낸 메시지도 모두 받았다.
   */
  barrier(): Promise<void> {
    return new Promise(resolve => {
      this.ws.once('pong', () => resolve());
      this.ws.ping();
    });
  }

  close(): void {
    this.ws.close();
  }
}

/** 웹소켓을 열지 못하고 받은 HTTP 상태 */
export const refusedStatus = (url: string, options: ClientOptions = {}): Promise<number> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    ws.on('error', () => undefined);
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.once('open', () => {
      ws.terminate();
      reject(new Error('opened'));
    });
  });

/** 조건이 참이 될 때까지(진짜 시간으로) 기다린다 */
export const until = async (cond: () => boolean, timeoutMs = WAIT_MS): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
};

/** 들어가서 `welcome`까지 */
export const enter = async (
  rig: LiveRig,
  code: string,
  message: ReturnType<typeof hello>,
  options: ClientOptions = {},
): Promise<{ readonly client: LiveClient; readonly welcome: Of<'welcome'> }> => {
  const client = await LiveClient.open(`${rig.base}/api/e/${code}/live`, options);
  client.send(message);
  return { client, welcome: await client.next('welcome') };
};

/** 한 번의 방송 간격(ms) */
export const tickMs = (): number => 1000 / config().LIVE_BROADCAST_HZ;
