import { closeSync, mkdirSync, openSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/**
 * JSON 한 줄 기록(PLAN §9.8). `DATA_DIR/logs/gallery-YYYY-MM-DD.log`(UTC 날짜)로 날마다 바꾸고 최근 N개만 남긴다.
 *
 * 개인정보: 받는 칸은 아래 `LogFields`뿐이다(별명·메모·PIN·토큰·IP 칸이 없다). 타입을 우회해 다른 칸을 넣어도
 * 쓰지 않는다. 경로는 쿼리를 떼고 `/t/` 뒤를 `***`로, 글 칸은 `/t/…`·`Bearer …`를 가린다.
 * 1분 서버 기록(`server_stats`, HS-00)의 숫자는 `stats`로 받되 `STAT_KEYS` 이름의 유한한 수만 남긴다(글이 들어갈 자리가 없다).
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'fatal';

/**
 * 1분 서버 기록의 숫자 칸(G-25 FIELD_PLAN HS-00). 이 차례로 줄 끝에 붙는다.
 * 이벤트 루프 지연 p50·p99·최대(ms)·이용률(0~1) · 함께 관람 방·사람 수, 1분 동안 보낸 메시지 수·바이트·보낼 때 본 가장 큰
 * `bufferedAmount`(바이트) · 판 2 위치 글을 만든 수·밀려 건너뛴 수·느려서 닫은 연결 수·빈도 줄임(0/1, HS-03~HS-10) ·
 * RSS·힙 사용(MB) · 1분 동안 받은 진단 `fail`·`report` 수.
 */
export const STAT_KEYS = [
  'loopP50Ms',
  'loopP99Ms',
  'loopMaxMs',
  'elu',
  'liveRooms',
  'livePeers',
  'liveMsgs',
  'liveBytes',
  'liveBufMax',
  'liveBuilt',
  'liveSkipped',
  'liveSlowClosed',
  'liveDegraded',
  'rssMb',
  'heapMb',
  'diagFail',
  'diagReport',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type LogStats = Readonly<Partial<Record<StatKey, number>>>;

export interface LogFields {
  readonly requestId?: string | undefined;
  readonly method?: string | undefined;
  readonly path?: string | undefined;
  readonly status?: number | undefined;
  readonly ms?: number | undefined;
  readonly exhibitionId?: string | undefined;
  /** 오류 코드(`E_…`) */
  readonly code?: string | undefined;
  readonly count?: number | undefined;
  readonly port?: number | undefined;
  /** 설정 키 이름 목록(값은 넣지 않는다) */
  readonly keys?: readonly string[] | undefined;
  /** 1분 서버 기록의 숫자(`STAT_KEYS`만) */
  readonly stats?: LogStats | undefined;
  /** 원인. 이름·메시지·스택·`code`·`cause`만 남는다. */
  readonly err?: unknown;
}

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  fatal(msg: string, fields?: LogFields): void;
  close(): void;
}

export interface LoggerOptions {
  readonly dir: string;
  /** 남길 날짜 파일 수(오늘 포함) */
  readonly keepFiles: number;
  readonly now?: () => Date;
  /** 개발에서 화면에도 찍을 때 */
  readonly echo?: (line: string) => void;
}

const LOG_FILE = /^gallery-\d{4}-\d{2}-\d{2}\.log$/;
const STRING_FIELDS = ['requestId', 'method'] as const;
const NUMBER_FIELDS = ['status', 'ms'] as const;
const TAIL_STRING_FIELDS = ['exhibitionId', 'code'] as const;
const TAIL_NUMBER_FIELDS = ['count', 'port'] as const;
const CAUSE_DEPTH = 2;

/** 기록·오류 보고용 경로: 쿼리·조각을 떼고 `/t/` 뒤를 `***`로(PLAN §9.8) */
export const redactPath = (path: string): string =>
  (path.split(/[?#]/, 1)[0] ?? '').replace(/(^|\/)t\/.*$/s, '$1t/***');

/** 자유 글(메시지·스택)에 섞인 `/t/…` 경로와 Bearer 토큰을 가린다. */
export const redactText = (text: string): string =>
  text.replace(/\/t\/[^\s"'<>]*/g, '/t/***').replace(/\b(Bearer)\s+[^\s"']+/gi, '$1 ***');

function serializeError(value: unknown, depth = 0): Record<string, unknown> {
  if (!(value instanceof Error)) return { type: typeof value };
  const out: Record<string, unknown> = { name: value.name, message: redactText(value.message) };
  if ('code' in value && typeof value.code === 'string') out['code'] = value.code;
  if (value.stack !== undefined) out['stack'] = redactText(value.stack);
  if (value.cause !== undefined && depth < CAUSE_DEPTH) out['cause'] = serializeError(value.cause, depth + 1);
  return out;
}

/** 허용한 칸만, 정해진 순서로 한 줄 JSON을 만든다. */
export function formatLine(time: Date, level: LogLevel, msg: string, fields: LogFields = {}): string {
  const record: Record<string, unknown> = { t: time.toISOString(), level, msg: redactText(msg) };
  for (const key of STRING_FIELDS) {
    const value = fields[key];
    if (typeof value === 'string') record[key] = redactText(value);
  }
  if (typeof fields.path === 'string') record['path'] = redactPath(fields.path);
  for (const key of NUMBER_FIELDS) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value)) record[key] = value;
  }
  for (const key of TAIL_STRING_FIELDS) {
    const value = fields[key];
    if (typeof value === 'string') record[key] = redactText(value);
  }
  for (const key of TAIL_NUMBER_FIELDS) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value)) record[key] = value;
  }
  if (Array.isArray(fields.keys)) {
    record['keys'] = fields.keys.filter((key): key is string => typeof key === 'string').map(redactText);
  }
  if (typeof fields.stats === 'object' && fields.stats !== null) {
    for (const key of STAT_KEYS) {
      const value = fields.stats[key];
      if (typeof value === 'number' && Number.isFinite(value)) record[key] = value;
    }
  }
  if (fields.err !== undefined) record['err'] = serializeError(fields.err);
  return JSON.stringify(record);
}

export function createLogger(options: LoggerOptions): Logger {
  if (!Number.isInteger(options.keepFiles) || options.keepFiles < 1) {
    throw new Error('keepFiles must be a positive integer');
  }
  const now = options.now ?? (() => new Date());
  let fd: number | undefined;
  let day: string | undefined;

  const prune = (): void => {
    const files = readdirSync(options.dir)
      .filter(name => LOG_FILE.test(name))
      .sort()
      .reverse();
    for (const name of files.slice(options.keepFiles)) rmSync(join(options.dir, name), { force: true });
  };

  const fileFor = (today: string): number => {
    if (fd !== undefined && day === today) return fd;
    if (fd !== undefined) closeSync(fd);
    fd = undefined;
    mkdirSync(options.dir, { recursive: true, mode: 0o700 });
    fd = openSync(join(options.dir, `gallery-${today}.log`), 'a', 0o600);
    day = today;
    prune();
    return fd;
  };

  const write = (level: LogLevel, msg: string, fields?: LogFields): void => {
    const time = now();
    const line = formatLine(time, level, msg, fields);
    try {
      writeSync(fileFor(time.toISOString().slice(0, 10)), `${line}\n`);
    } catch {
      // 디스크가 차도 요청 처리는 멈추지 않는다. 기록은 표준 오류로 돌린다.
      process.stderr.write(`${line}\n`);
    }
    options.echo?.(line);
  };

  return {
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    fatal: (msg, fields) => write('fatal', msg, fields),
    close: () => {
      if (fd !== undefined) closeSync(fd);
      fd = undefined;
      day = undefined;
    },
  };
}
