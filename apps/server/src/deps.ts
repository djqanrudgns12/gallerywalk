import { randomInt } from 'node:crypto';
import { lstat, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { UuidSchema } from '@gallery/core/types';
import type { ServerEnv } from './env.ts';
import type { Deps, EventLog, FileUploads, MediaFiles } from './ports/index.ts';
import { createSecurity, type ServerSecurity } from './security/index.ts';
import type { Db } from './store/db.ts';
import { createSqliteStore } from './store/repos.ts';
import { UploadManager } from './upload/index.ts';

/**
 * 운영 의존성 묶기(PLAN §2.4): 유스케이스 포트(`Deps`)의 실제 구현 — SQLite 저장소·벽시계·암호학적 난수·보안 모듈·
 * 미디어 폴더(node:fs)·업로드 기다리기·기록.
 * 라우트가 쓰는 칸·기기 등록은 `security`(ServerSecurity)로 따로 넘긴다(포트 `Security`는 유스케이스가 쓰는 것만).
 */
export interface ServerDeps {
  readonly deps: Deps;
  readonly security: ServerSecurity;
  readonly uploads: FileUploads;
}

/** 작품 파일이 쌓이는 곳: `MEDIA_DIR/exh/{exhibitionId}/{assetId}/{variant}.{ext}`(PLAN §10.3, ADR-006 보충) */
const EXHIBITIONS_DIR = 'exh';

/**
 * 전시 폴더 경로. 전시 ID가 UUID 모양이 아니거나(`..`·`/`·빈 글자) 풀어 쓴 경로가 `MEDIA_DIR/exh/{id}` 바로 그 자리가
 * 아니면 거절한다(던짐) — 어떤 입력으로도 `exh/` 밖이나 `exh/` 자체를 지우지 못하게.
 */
export const exhibitionMediaDir = (mediaDir: string, exhibitionId: string): string => {
  const root = resolve(mediaDir, EXHIBITIONS_DIR);
  const target = resolve(root, exhibitionId);
  if (!UuidSchema.safeParse(exhibitionId).success || relative(root, target) !== exhibitionId)
    throw new Error('exhibition media path escapes MEDIA_DIR/exh');
  return target;
};

const isMissing = (err: unknown): boolean =>
  err instanceof Error && 'code' in err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');

const assetMediaDir = (mediaDir: string, exhibitionId: string, assetId: string): string => {
  const root = exhibitionMediaDir(mediaDir, exhibitionId);
  const target = resolve(root, assetId);
  if (!UuidSchema.safeParse(assetId).success || relative(root, target) !== assetId)
    throw new Error('asset media path escapes MEDIA_DIR/exh');
  return target;
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
};

/** 미디어 폴더 포트의 node:fs 구현 */
export const createMediaFiles = (mediaDir: string): MediaFiles => ({
  // 따라가지 않는다: 깨진 링크도 "남아 있음"
  exists: async exhibitionId => pathExists(exhibitionMediaDir(mediaDir, exhibitionId)),
  async removeExhibition(exhibitionId) {
    // 링크는 따라가지 않고 링크만 지운다(node `rm`). 이미 없으면 `force`가 성공으로
    await rm(exhibitionMediaDir(mediaDir, exhibitionId), { recursive: true, force: true });
  },
  assetExists: async (exhibitionId, assetId) => pathExists(assetMediaDir(mediaDir, exhibitionId, assetId)),
  async removeAsset(exhibitionId, assetId) {
    await rm(assetMediaDir(mediaDir, exhibitionId, assetId), { recursive: true, force: true });
  },
});

const silentLog: EventLog = { info: () => undefined, warn: () => undefined };

/**
 * `log`: 유스케이스 기록(운영은 `log.ts` Logger). 넘기지 않으면 남기지 않는다 — `index.ts`가 기록기를 넘겨야
 * "지금 삭제"·보관 정리의 개수 기록이 파일에 남는다.
 */
export const createServerDeps = (
  db: Db,
  env: Pick<ServerEnv, 'nodeEnv' | 'secrets' | 'mediaDir' | 'tmpDir'> &
    Partial<Pick<ServerEnv, 'retentionTestMinutes'>>,
  log: EventLog = silentLog,
): ServerDeps => {
  const clock = { now: () => Date.now() };
  const security = createSecurity(env, { db, clock });
  const store = createSqliteStore(db);
  const uploads = new UploadManager({
    deps: { store, clock },
    log,
    mediaDir: env.mediaDir,
    tmpDir: env.tmpDir,
    exhibitionDir: id => exhibitionMediaDir(env.mediaDir, id),
  });
  return {
    uploads,
    deps: {
      store,
      clock,
      // randomInt의 끝은 열린 구간 → 포트는 닫힌 구간
      random: { int: (min, max) => randomInt(min, max + 1) },
      security,
      media: createMediaFiles(env.mediaDir),
      uploads,
      log,
      ...(env.retentionTestMinutes === undefined ? {} : { retentionTestMinutes: env.retentionTestMinutes }),
    },
    security,
  };
};
