import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@gallery/core/config';
import { deleteExhibition } from '../application/deleteExhibition.ts';
import type { Deps, EventLog } from '../ports/index.ts';

const MS_PER_SEC = 1_000;
const MS_PER_HOUR = 3_600_000;

export interface CleanupOptions {
  readonly tmpDir: string;
  /** 스냅숏을 받지 않고 지우기 직전에 실제 관리자를 조회한다. */
  readonly isTemporaryPathActive: (path: string) => boolean;
  readonly onExhibitionGone?: (exhibitionId: string) => void;
}

export interface CleanupJobs {
  /** 듣기 시작한 뒤 한 번. 시작 직후 남은 정리를 이어서 하고 이후 60초마다 확인한다. */
  start(): Promise<boolean>;
  /** 진행 중이면 건너뛰고 false. 시계를 주입한 시험과 수동 실행도 같은 진입점을 쓴다. */
  runCycle(): Promise<boolean>;
  /** 새 주기를 막고 현재 작업의 파일·DB 정리가 끝나기를 기다린다. 다시 시작하지 않는다. */
  stop(): Promise<void>;
}

const missing = (cause: unknown): boolean =>
  cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';

/** 모든 작업의 기록에는 개수만 전달한다. 파일 경로·오류 원문도 기록하지 않는다(PLAN §9.8). */
const countLog = (log: EventLog): EventLog => ({
  info: (msg, fields) => log.info(msg, { count: fields?.count ?? 0 }),
  warn: (msg, fields) => log.warn(msg, { count: fields?.count ?? 1 }),
});

export const createCleanupJobs = (deps: Deps, options: CleanupOptions): CleanupJobs => {
  const { store, clock, media } = deps;
  const log = countLog(deps.log);
  const deletionDeps = { ...deps, log };
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: Promise<void> | undefined;
  let nextPurgeAt = clock.now();
  let exhibitionCursor = '';
  let artworkCursor = '';
  let pdfCursor = '';
  let assetCursor = '';
  let tmpCursor = '';

  const retention = async (now: number): Promise<void> => {
    const rows = store.exhibitions.listForCleanup(now, config().CLEANUP_BATCH_SIZE, exhibitionCursor);
    exhibitionCursor = rows.length === config().CLEANUP_BATCH_SIZE ? rows.at(-1)!.id : '';
    let failed = 0;
    for (const row of rows) {
      if (stopped) break;
      try {
        await deleteExhibition(deletionDeps, row.id, {
          ...(options.onExhibitionGone === undefined ? {} : { onGone: options.onExhibitionGone }),
        });
      } catch {
        failed++;
      }
    }
    if (failed > 0) log.warn('retention_cleanup_failed', { count: failed });
  };

  const purgeArtworks = (now: number): void => {
    const cutoff = now - config().PURGE_DELETED_HOURS * MS_PER_HOUR;
    const rows = store.artworks.listDeletedBefore(cutoff, config().CLEANUP_BATCH_SIZE, artworkCursor);
    artworkCursor = rows.length === config().CLEANUP_BATCH_SIZE ? rows.at(-1)!.id : '';
    let count = 0;
    for (const row of rows) {
      if (stopped) break;
      // 동기 트랜잭션에서 상태를 다시 확인한다. 되살린 작품은 지우지 않는다.
      // 쪽·반응만 연쇄 삭제하고 asset 행은 남겨 파일 삭제 실패·재시작의 재시도 근거로 쓴다.
      if (store.transaction(() => store.artworks.deleteDeletedBefore(row.id, cutoff))) count++;
    }
    if (count > 0) log.info('deleted_artworks_purged', { count });
  };

  /**
   * 마치지 못한 PDF(교사가 올리다 멈춤): 마지막으로 쪽을 받은 지 `PDF_INCOMPLETE_PURGE_HOURS`가 지나면 지운 상태로 바꾼다.
   * 그 뒤는 지운 작품과 같은 길(유예 → 행·쪽 → 고아 asset 파일, §9.7). 게시 전이라 배치는 그대로, 내용 판만 올린다.
   */
  const abandonPdfs = (now: number): void => {
    const cutoff = now - config().PDF_INCOMPLETE_PURGE_HOURS * MS_PER_HOUR;
    const rows = store.artworks.listIncompletePdfBefore(cutoff, config().CLEANUP_BATCH_SIZE, pdfCursor);
    pdfCursor = rows.length === config().CLEANUP_BATCH_SIZE ? rows.at(-1)!.id : '';
    let count = 0;
    for (const row of rows) {
      if (stopped) break;
      const done = store.transaction(() => {
        // 트랜잭션 안에서 다시 본다(그사이 쪽을 받았거나 마쳤으면 두기)
        const a = store.artworks.get(row.id);
        if (!a || a.deletedAt !== null || a.status !== 'PROCESSING' || a.updatedAt > cutoff) return false;
        store.artworks.update(a.id, { deletedAt: now, rev: a.rev + 1, updatedAt: now });
        const ex = store.exhibitions.get(a.exhibitionId);
        if (ex) store.exhibitions.update(ex.id, { contentVersion: ex.contentVersion + 1 });
        return true;
      });
      if (done) count++;
    }
    if (count > 0) log.info('incomplete_pdfs_abandoned', { count });
  };

  const purgeAssets = async (now: number): Promise<void> => {
    const rows = store.assets.listUnreferencedBefore(
      now - config().ORPHAN_ASSET_HOURS * MS_PER_HOUR,
      config().CLEANUP_BATCH_SIZE,
      assetCursor,
    );
    assetCursor = rows.length === config().CLEANUP_BATCH_SIZE ? rows.at(-1)!.id : '';
    let count = 0;
    let failed = 0;
    for (const row of rows) {
      if (stopped) break;
      try {
        if (store.assets.isReferenced(row.id)) continue;
        await media.removeAsset(row.exhibitionId, row.id);
        if (await media.assetExists(row.exhibitionId, row.id)) throw new Error('asset folder remains');
        if (store.transaction(() => store.assets.deleteUnreferenced(row.id))) count++;
      } catch {
        failed++;
      }
    }
    if (count > 0) log.info('unreferenced_assets_purged', { count });
    if (failed > 0) log.warn('asset_cleanup_failed', { count: failed });
  };

  const purgeTemporary = async (now: number): Promise<void> => {
    let names: string[];
    try {
      names = (await readdir(options.tmpDir))
        .sort()
        .filter(name => name > tmpCursor)
        .slice(0, config().CLEANUP_BATCH_SIZE);
    } catch (cause) {
      if (missing(cause)) return;
      throw cause;
    }
    tmpCursor = names.length === config().CLEANUP_BATCH_SIZE ? names.at(-1)! : '';
    let count = 0;
    let failed = 0;
    for (const name of names) {
      if (stopped) break;
      const path = join(options.tmpDir, name);
      try {
        const stat = await lstat(path);
        if (
          stat.mtimeMs > now - config().TMP_PURGE_HOURS * MS_PER_HOUR ||
          options.isTemporaryPathActive(path)
        )
          continue;
        // rm은 심볼릭 링크를 따라가지 않는다. 새 업로드는 새 mkdtemp 경로만 만들고 오래된 경로를 재사용하지 않는다.
        await rm(path, { recursive: true, force: true });
        count++;
      } catch (cause) {
        if (!missing(cause)) failed++;
      }
    }
    if (count > 0) log.info('temporary_paths_purged', { count });
    if (failed > 0) log.warn('temporary_cleanup_failed', { count: failed });
  };

  const checkpoint = (): void => {
    try {
      if (!store.checkpoint()) log.warn('wal_checkpoint_busy', { count: 1 });
    } catch {
      log.warn('wal_checkpoint_failed', { count: 1 });
    }
  };

  const work = async (): Promise<void> => {
    const now = clock.now();
    try {
      await retention(now);
    } catch {
      log.warn('retention_cleanup_failed', { count: 1 });
    }
    try {
      abandonPdfs(now);
    } catch {
      log.warn('pdf_cleanup_failed', { count: 1 });
    }
    if (stopped || now < nextPurgeAt) return;
    nextPurgeAt = now + config().PURGE_CLEANUP_INTERVAL_SEC * MS_PER_SEC;
    try {
      purgeArtworks(now);
      await purgeAssets(now);
    } catch {
      log.warn('purge_cleanup_failed', { count: 1 });
    } finally {
      // 실패한 체크포인트도 다음 시간에 다시 시도한다. 행 삭제 뒤에는 트랜잭션 밖에서만 실행한다.
      checkpoint();
    }
    if (stopped) return;
    try {
      await purgeTemporary(now);
    } catch {
      log.warn('temporary_cleanup_failed', { count: 1 });
    }
  };

  const runCycle = async (): Promise<boolean> => {
    if (stopped || active !== undefined) return false;
    active = work().finally(() => {
      active = undefined;
    });
    await active;
    return true;
  };

  return {
    runCycle,
    async start() {
      if (stopped || timer !== undefined) return false;
      timer = setInterval(() => {
        void runCycle();
      }, config().RETENTION_CLEANUP_INTERVAL_SEC * MS_PER_SEC);
      timer.unref();
      return runCycle();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      timer = undefined;
      await active;
    },
  };
};
