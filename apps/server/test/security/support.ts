import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnv, type ServerEnv } from '../../src/env.ts';
import { isWeakPin } from '../../src/security/pin.ts';
import type { Db } from '../../src/store/db.ts';
import { makeTempDir, openTestDb, testEnvSource } from '../helpers/server.ts';

/**
 * 보안 시험 도구. 비밀값·토큰·PIN·기기 ID는 모두 시험 안에서 만든 난수, IP는 문서용 주소(RFC 5737·3849)만 쓴다.
 */

/** 시험마다 새 32바이트 비밀(`Secret`과 같은 모양) */
export const randomKey = () => {
  const bytes = randomBytes(32);
  return { bytes: () => Buffer.from(bytes) };
};

/** 기기가 만드는 모양의 토큰(256비트 base64url 43자) */
export const randomToken = (): string => randomBytes(32).toString('base64url');

/** 쉬운 PIN 규칙에 걸리지 않는 임의 8자리 PIN */
export const randomStrongPin = (): string => {
  for (;;) {
    const pin = String(randomInt(10_000_000, 100_000_000));
    if (!isWeakPin(pin)) return pin;
  }
};

export const randomDeviceId = (): string => randomUUID();

/** 가짜 시계(앞으로 돌릴 수 있음) */
export const fakeClock = (start = Date.UTC(2026, 10, 11, 1, 0, 0)) => {
  let now = start;
  return {
    clock: { now: () => now },
    advance: (ms: number) => void (now += ms),
    at: () => now,
  };
};

export interface TempDb {
  readonly db: Db;
  readonly root: string;
  readonly env: ServerEnv;
  readonly close: () => Promise<void>;
}

/** 임시 폴더 + 마이그레이션한 SQLite + 그 폴더를 가리키는 시험 환경 값(비밀값 난수) */
export const tempDb = async (overrides: Record<string, string> = {}): Promise<TempDb> => {
  const root = await makeTempDir();
  const db = openTestDb(root);
  const env = loadEnv(testEnvSource(root, overrides));
  return {
    db,
    root,
    env,
    close: async () => {
      if (db.open) db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
};

/** 폴더 안 기록 파일 전체 */
export const readLogs = async (dir: string): Promise<string> => {
  const names = (await readdir(dir)).sort();
  const parts = await Promise.all(names.map(name => readFile(join(dir, name), 'utf8')));
  return parts.join('');
};

/** `rate_buckets`·`teacher_devices`·`meta`의 모든 글 칸 */
export const storedText = (db: Db): string =>
  [
    ...db.prepare('SELECT key FROM rate_buckets').pluck().all(),
    ...db.prepare('SELECT device_hash FROM teacher_devices').pluck().all(),
    ...db.prepare('SELECT key || value FROM meta').pluck().all(),
  ].join('\n');
