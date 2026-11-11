import { statfs } from 'node:fs/promises';
import { Hono } from 'hono';
import { config } from '@gallery/core/config';
import type { Db } from '../../store/db.ts';
import type { AppEnv } from '../types.ts';

export interface HealthDeps {
  readonly db: Db;
  /** 남은 공간을 잴 폴더(작품 파일이 쌓이는 `MEDIA_DIR`) */
  readonly diskPath: string;
  /** 처리 대기열 길이(P3-4가 채운다. 그 전에는 0) */
  readonly queueLength: () => number;
}

export interface HealthData {
  readonly ok: boolean;
  readonly db: boolean;
  readonly diskOk: boolean;
  readonly queueLength: number;
}

const BYTES_PER_GB = 1024 ** 3;

function dbOpen(db: Db): boolean {
  if (!db.open) return false;
  try {
    return db.prepare('SELECT 1').pluck().get() === 1;
  } catch {
    return false;
  }
}

async function freeBytes(path: string): Promise<number | null> {
  try {
    const stats = await statfs(path);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

/**
 * `GET /api/health`(PLAN §9.8): DB 열림·디스크 남은 공간·대기열 길이. 감시 스크립트가 1분마다 본다(§19).
 * DB가 닫혔거나 남은 공간이 `DISK_FREE_MIN_GB`보다 적으면 503(봉투는 같은 `{data, requestId}`).
 */
export const healthRoutes = (deps: HealthDeps): Hono<AppEnv> =>
  new Hono<AppEnv>().get('/api/health', async c => {
    const db = dbOpen(deps.db);
    const diskFreeBytes = await freeBytes(deps.diskPath);
    const diskOk = diskFreeBytes !== null && diskFreeBytes >= config().DISK_FREE_MIN_GB * BYTES_PER_GB;
    // 남은 바이트 수는 공개 경로에 내지 않는다(괜찮은지만, 감시는 이 값으로 충분)
    const data: HealthData = { ok: db && diskOk, db, diskOk, queueLength: deps.queueLength() };
    return c.json({ data, requestId: c.get('requestId') }, data.ok ? 200 : 503);
  });
