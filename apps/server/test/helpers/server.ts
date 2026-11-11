import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { EnvSource } from '../../src/env.ts';
import { createApp } from '../../src/http/app.ts';
import { createLifecycle, type Lifecycle } from '../../src/http/lifecycle.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import { migrate, openDb, type Db } from '../../src/store/db.ts';

/** 시험 DB·기록도 git 제외된 .local 안에(시험마다 새 폴더) */
export async function makeTempDir(): Promise<string> {
  const root = resolve(import.meta.dirname, '../../../..', '.local', 'test-server');
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, 'case-'));
}

/** 시험 안에서만 만드는 임의 비밀값(32바이트) */
export const randomSecretHex = (bytes = 32): string => randomBytes(bytes).toString('hex');

export function testEnvSource(root: string, overrides: Record<string, string | undefined> = {}): EnvSource {
  return {
    NODE_ENV: 'test',
    PORT: '4521',
    DATA_DIR: join(root, 'data'),
    MEDIA_DIR: join(root, 'media'),
    TMP_DIR: join(root, 'tmp'),
    PIN_HMAC_SECRET: randomSecretHex(),
    RATE_KEY_SECRET: randomSecretHex(),
    START_CODE_HMAC: randomSecretHex(),
    ...overrides,
  };
}

export const TEST_BUSY_TIMEOUT_MS = 5000;

export function openTestDb(root: string): Db {
  const db = openDb(join(root, 'gallery.sqlite'), { busyTimeoutMs: TEST_BUSY_TIMEOUT_MS });
  migrate(db);
  return db;
}

export const TEST_JSON_LIMIT_BYTES = 64 * 1024;

export interface TestApp {
  readonly app: ReturnType<typeof createApp>;
  readonly db: Db;
  readonly log: Logger;
  readonly lifecycle: Lifecycle;
  readonly logDir: string;
  /** 지금까지 쓴 기록 전체(모든 날짜 파일) */
  readonly logText: () => Promise<string>;
}

export async function makeTestApp(root: string, queueLength: () => number = () => 0): Promise<TestApp> {
  const logDir = join(root, 'logs');
  const mediaDir = join(root, 'media');
  await mkdir(mediaDir, { recursive: true });
  const db = openTestDb(root);
  const log = createLogger({ dir: logDir, keepFiles: 7 });
  const lifecycle = createLifecycle();
  const app = createApp({
    db,
    log,
    mediaDir,
    queueLength,
    lifecycle,
    limits: { jsonBodyMaxBytes: TEST_JSON_LIMIT_BYTES, hstsMaxAgeSec: 31_536_000 },
  });
  const logText = async (): Promise<string> => {
    const names = (await readdir(logDir)).sort();
    const parts = await Promise.all(names.map(name => readFile(join(logDir, name), 'utf8')));
    return parts.join('');
  };
  return { app, db, log, lifecycle, logDir, logText };
}
