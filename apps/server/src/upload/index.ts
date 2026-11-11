import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileTypeFromFile } from 'file-type';
import { z } from 'zod';
import { config } from '@gallery/core/config';
import { classifyForm, guessTextHeavy } from '@gallery/core/classify';
import { AppError } from '@gallery/core/errors';
import { isGone } from '@gallery/core/retention';
import { CreateFileArtworkMetaSchema, MediaVariantSchema } from '@gallery/core/types';
import { bump, createHashOf, liveExhibition } from '../application/common.ts';
import type { ProcessedImage } from '../media/index.ts';
import { runMedia } from './process.ts';
import type { AssetRecord, EventLog, FileUploads, UploadTarget } from '../ports/index.ts';
import { ProcessQueue } from './queue.ts';
import { receiveFile, type ReceivedFile } from './receive.ts';
import {
  assertUniqueFile,
  checkTarget,
  fileReplay,
  newArtwork,
  ownPdf,
  ownRoom,
  pageReplay,
  type FileMeta,
  type UploadDeps,
} from './records.ts';
import { BYTES_PER_MB, readDiskUsage, SpaceReservations, type DiskUsage } from './space.ts';

interface ActiveUpload {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

export interface UploadOptions {
  readonly deps: UploadDeps;
  readonly log: EventLog;
  readonly mediaDir: string;
  readonly tmpDir: string;
  /** deps.ts의 안전한 MEDIA_DIR/exh/{UUID} 경로 검사 */
  readonly exhibitionDir: (exhibitionId: string) => string;
  /** 결정적인 공간·중단 시험에서도 운영 예약 로직을 그대로 쓴다. */
  readonly diskUsage?: (exhibitionId: string) => Promise<DiskUsage>;
  readonly processMedia?: typeof runMedia;
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'png', 'webp', 'gif', 'heic', 'heif']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav']);
const EmptyMetaSchema = z.strictObject({});

/** 파일 크기 한도 외 1MiB는 PLAN §9.3의 multipart 봉투 여유(25→26MB, 20→21MB). */
const bodyLimit = (fileBytes: number): number => fileBytes + BYTES_PER_MB;
const fileLimit = (audio: boolean): number =>
  (audio ? config().MAX_AUDIO_MB : config().MAX_IMAGE_MB) * BYTES_PER_MB;

const contentLengthOf = (incoming: IncomingMessage, max: number): number => {
  const raw = incoming.headers['content-length'];
  const length = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(length) || length <= 0 || length > max) throw new AppError('E_FILE_TOO_LARGE');
  return length;
};

const typeOf = async (file: ReceivedFile, audio: boolean): Promise<void> => {
  let type: Awaited<ReturnType<typeof fileTypeFromFile>>;
  try {
    type = await fileTypeFromFile(file.path);
  } catch (cause) {
    throw new AppError('E_FILE_BROKEN', { cause });
  }
  if (!type) throw new AppError('E_FILE_BROKEN');
  if (type.mime.startsWith('video/')) throw new AppError('E_VIDEO_UNSUPPORTED');
  if (!(audio ? AUDIO_EXTENSIONS : IMAGE_EXTENSIONS).has(type.ext)) throw new AppError('E_FILE_TYPE');
};

const asAppError = (cause: unknown): AppError =>
  cause instanceof AppError ? cause : new AppError('E_SERVER', { cause });

/** 한 Node 프로세스의 수신 칸·예약·FIFO 대기열·삭제 기다리기를 공유한다. */
export class UploadManager implements FileUploads {
  private readonly queue = new ProcessQueue();
  private readonly reservations: SpaceReservations;
  private receiving = 0;
  private readonly receivingByExhibition = new Map<string, number>();
  private readonly active = new Map<string, Set<ActiveUpload>>();
  private readonly pendingMedia = new Set<string>();
  private readonly pendingTmp = new Set<string>();

  private readonly options: UploadOptions;

  constructor(options: UploadOptions) {
    this.options = options;
    this.reservations = new SpaceReservations(
      options.diskUsage ??
        (id =>
          readDiskUsage(options.mediaDir, options.tmpDir, options.exhibitionDir(id), {
            media: this.pendingMedia,
            tmp: this.pendingTmp,
          })),
    );
  }

  queueLength(): number {
    return this.queue.length;
  }

  isTemporaryPathActive(path: string): boolean {
    const target = resolve(path);
    const contains = (parent: string, child: string): boolean => {
      const tail = relative(parent, child);
      return tail === '' || (tail !== '..' && !tail.startsWith('../') && !isAbsolute(tail));
    };
    return [...this.pendingTmp].some(active => contains(target, active) || contains(active, target));
  }

  private takeSlot(exhibitionId: string): () => void {
    const count = this.receivingByExhibition.get(exhibitionId) ?? 0;
    if (this.receiving >= config().UPLOAD_SLOTS_GLOBAL || count >= config().UPLOAD_SLOTS_PER_EXHIBITION)
      throw new AppError('E_BUSY');
    this.receiving++;
    this.receivingByExhibition.set(exhibitionId, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.receiving--;
      const remaining = (this.receivingByExhibition.get(exhibitionId) ?? 0) - 1;
      if (remaining === 0) this.receivingByExhibition.delete(exhibitionId);
      else this.receivingByExhibition.set(exhibitionId, remaining);
    };
  }

  drain(exhibitionId: string, timeoutMs: number): Promise<void> {
    return this.waitForUploads(
      [...(this.active.get(exhibitionId) ?? [])],
      timeoutMs,
      new AppError('E_NOT_FOUND'),
    );
  }

  drainAll(timeoutMs: number): Promise<void> {
    return this.waitForUploads(
      [...this.active.values()].flatMap(jobs => [...jobs]),
      timeoutMs,
      new AppError('E_BUSY'),
    );
  }

  private async waitForUploads(
    jobs: readonly ActiveUpload[],
    timeoutMs: number,
    reason: AppError,
  ): Promise<void> {
    if (jobs.length === 0) return;
    const finished = Promise.all(jobs.map(job => job.done));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = await Promise.race([
        finished.then(() => false),
        new Promise<boolean>(resolve => {
          timer = setTimeout(() => resolve(true), timeoutMs);
        }),
      ]);
      if (timedOut) for (const job of jobs) job.controller.abort(reason);
      // 진행 중 코덱도 정리된 다음 돌아온다. 취소 뒤에는 행을 쓰거나 폴더를 되살리지 않는다.
      await finished;
    } finally {
      clearTimeout(timer);
    }
  }

  private replay(
    exhibitionId: string,
    target: UploadTarget,
    file: ReceivedFile,
    meta: FileMeta | undefined,
    hash: string,
  ): string | null {
    const { deps } = this.options;
    checkTarget(deps, exhibitionId, target);
    if (target.kind === 'ARTWORK' && meta) {
      ownRoom(deps, exhibitionId, meta.roomId);
      return fileReplay(deps, exhibitionId, meta, hash)?.id ?? null;
    }
    if (target.kind === 'PAGE')
      return pageReplay(deps, exhibitionId, target.artworkId, target.idx, file.contentHash)?.id ?? null;
    const assetId =
      target.kind === 'POSTER'
        ? liveExhibition(deps, exhibitionId).posterAssetId
        : target.kind === 'BGM'
          ? ownRoom(deps, exhibitionId, target.roomId).bgmAssetId
          : null;
    const asset = assetId === null ? null : deps.store.assets.get(assetId);
    return asset?.contentHash === file.contentHash ? asset.id : null;
  }

  private failed(
    exhibitionId: string,
    target: UploadTarget,
    meta: FileMeta | undefined,
    hash: string,
    error: AppError,
  ): void {
    const { deps } = this.options;
    deps.store.transaction(() => {
      const ex = deps.store.exhibitions.get(exhibitionId);
      if (!ex || isGone(ex, deps.clock.now())) return;
      const prior =
        target.kind === 'PAGE'
          ? deps.store.artworks.get(target.artworkId)
          : meta
            ? deps.store.artworks.get(meta.id)
            : null;
      if (
        prior &&
        (prior.exhibitionId !== ex.id ||
          prior.deletedAt !== null ||
          (prior.status !== 'PROCESSING' && prior.status !== 'FAILED'))
      )
        return;
      if (target.kind === 'ARTWORK' && meta) {
        if (prior && prior.createHash !== hash) return;
        const room = deps.store.rooms.get(meta.roomId);
        if (room?.exhibitionId !== ex.id) return;
        if (prior)
          deps.store.artworks.update(prior.id, {
            status: 'FAILED',
            failCode: error.code,
            rev: prior.rev + 1,
            updatedAt: deps.clock.now(),
          });
        else
          deps.store.artworks.insert({
            ...newArtwork(deps, ex.id, meta, hash),
            status: 'FAILED',
            failCode: error.code,
          });
      } else if (target.kind === 'PAGE' && prior)
        deps.store.artworks.update(prior.id, {
          status: 'FAILED',
          failCode: error.code,
          rev: prior.rev + 1,
          updatedAt: deps.clock.now(),
        });
    });
  }

  private save(
    exhibitionId: string,
    target: UploadTarget,
    file: ReceivedFile,
    meta: FileMeta | undefined,
    hash: string,
    asset: AssetRecord,
    image: ProcessedImage | null,
  ): { readonly id: string; readonly used: boolean } {
    const { deps } = this.options;
    return deps.store.transaction(() => {
      const ex = liveExhibition(deps, exhibitionId);
      const prior = this.replay(ex.id, target, file, meta, hash);
      if (prior !== null) return { id: prior, used: false };
      if (target.kind === 'ARTWORK' || target.kind === 'PAGE')
        assertUniqueFile(deps, ex.id, file.contentHash, target.kind === 'PAGE' ? target.artworkId : meta?.id);
      deps.store.assets.insert(asset);
      let id = asset.id;
      if (target.kind === 'ARTWORK' && meta) {
        const existing = deps.store.artworks.get(meta.id);
        const base = existing ?? newArtwork(deps, ex.id, meta, hash);
        if (base.deletedAt !== null) throw new AppError('E_NOT_FOUND');
        const form = classifyForm({
          kind: meta.kind,
          w: asset.width ?? 0,
          h: asset.height ?? 0,
          pageCount: 1,
        });
        const art = {
          ...base,
          sourceAssetId: asset.id,
          form,
          textHeavy: guessTextHeavy({
            kind: meta.kind,
            form,
            fileName: `${meta.title} ${file.filename}`,
            linePitchPx: image?.analysis.linePitchPx ?? null,
          }),
          warnings: image?.lowRes ? ['LOW_RES' as const] : [],
          status: 'PUBLISHED' as const,
          failCode: null,
          updatedAt: deps.clock.now(),
          rev: existing ? existing.rev + 1 : base.rev,
        };
        if (existing) deps.store.artworks.update(art.id, art);
        else deps.store.artworks.insert(art);
        id = art.id;
      } else if (target.kind === 'PAGE') {
        const art = ownPdf(deps, ex.id, target.artworkId);
        if (art.status !== 'PROCESSING' && art.status !== 'FAILED') throw new AppError('E_CONFLICT');
        deps.store.pages.put({ artworkId: art.id, idx: target.idx, assetId: asset.id });
        deps.store.artworks.update(art.id, {
          status: 'PROCESSING',
          failCode: null,
          warnings: image?.lowRes ? ['LOW_RES'] : art.warnings,
          rev: art.rev + 1,
          updatedAt: deps.clock.now(),
        });
      } else if (target.kind === 'POSTER')
        deps.store.exhibitions.update(ex.id, { posterAssetId: asset.id, rev: ex.rev + 1 });
      else if (target.kind === 'BGM') {
        const room = ownRoom(deps, ex.id, target.roomId);
        deps.store.rooms.update(room.id, {
          bgmAssetId: asset.id,
          rev: room.rev + 1,
          updatedAt: deps.clock.now(),
        });
      }
      bump(deps, ex, { content: true, layout: target.kind === 'ARTWORK' });
      return { id, used: true };
    });
  }

  async receive(exhibitionId: string, target: UploadTarget, incoming: IncomingMessage): Promise<string> {
    const { deps, tmpDir, mediaDir, exhibitionDir, log } = this.options;
    // 인증·속도 칸은 HTTP 경로가 먼저 확인한다. 경계·상태는 수신 칸을 잡기 전에 확인한다.
    checkTarget(deps, exhibitionId, target);
    const releaseSlot = this.takeSlot(exhibitionId);
    const controller = new AbortController();
    const { signal } = controller;
    let finish = () => {};
    const done = new Promise<void>(resolve => {
      finish = resolve;
    });
    const job: ActiveUpload = { controller, done };
    const jobs = this.active.get(exhibitionId) ?? new Set<ActiveUpload>();
    jobs.add(job);
    this.active.set(exhibitionId, jobs);
    const disconnect = () => controller.abort(new AppError('E_BUSY'));
    incoming.socket.on('close', disconnect);
    let releaseReservation: (() => void) | undefined;
    let releaseExtra: (() => void) | undefined;
    let temp: string | undefined;
    let stage: string | undefined;
    let destination: string | undefined;
    let published = false;
    let used = false;
    let meta: FileMeta | undefined;
    let hash = '';
    const releaseSpace = (): void => {
      releaseExtra?.();
      releaseReservation?.();
      releaseExtra = undefined;
      releaseReservation = undefined;
      if (destination !== undefined) this.pendingMedia.delete(destination);
    };
    const clearFiles = async (): Promise<void> => {
      let failure: unknown;
      const paths = [stage, temp, ...(published && !used ? [destination] : [])];
      for (const path of paths) {
        if (path === undefined) continue;
        try {
          await rm(path, { recursive: true, force: true });
        } catch (cause) {
          failure ??= cause;
        } finally {
          this.pendingMedia.delete(path);
          this.pendingTmp.delete(path);
        }
      }
      stage = undefined;
      temp = undefined;
      if (failure !== undefined) throw failure;
    };
    try {
      const maxFileBytes =
        target.kind === 'ARTWORK'
          ? Math.max(fileLimit(false), fileLimit(true))
          : fileLimit(target.kind === 'BGM');
      const length = contentLengthOf(incoming, bodyLimit(maxFileBytes));
      await mkdir(tmpDir, { recursive: true, mode: 0o700 });
      await mkdir(mediaDir, { recursive: true, mode: 0o700 });
      const reserved = length * config().UPLOAD_RESERVE_FACTOR;
      releaseReservation = await this.reservations.reserve(exhibitionId, reserved, signal);
      checkTarget(deps, exhibitionId, target);
      temp = await mkdtemp(join(tmpDir, 'upload-'));
      this.pendingTmp.add(temp);
      const file = await receiveFile(incoming, join(temp, 'input'), length, maxFileBytes, signal);
      releaseSlot();
      if (target.kind === 'ARTWORK') meta = CreateFileArtworkMetaSchema.parse(file.meta);
      else if (file.meta !== undefined) EmptyMetaSchema.parse(file.meta);
      const audio = target.kind === 'BGM' || meta?.kind === 'AUDIO';
      hash = meta ? createHashOf({ meta, contentHash: file.contentHash }) : file.contentHash;
      if (file.bytes > fileLimit(audio) || length > bodyLimit(fileLimit(audio)))
        throw new AppError('E_FILE_TOO_LARGE');
      const prior = this.replay(exhibitionId, target, file, meta, hash);
      if (prior !== null) return prior;
      await typeOf(file, audio);
      return await this.queue.run(signal, async () => {
        const replay = this.replay(exhibitionId, target, file, meta, hash);
        if (replay !== null) return replay;
        if (target.kind === 'ARTWORK' || target.kind === 'PAGE')
          assertUniqueFile(
            deps,
            exhibitionId,
            file.contentHash,
            target.kind === 'PAGE' ? target.artworkId : meta?.id,
          );
        const assetId = randomUUID();
        const parent = exhibitionDir(exhibitionId);
        await mkdir(parent, { recursive: true, mode: 0o700 });
        stage = await mkdtemp(join(parent, '.upload-'));
        this.pendingMedia.add(stage);
        const outputDir = join(stage, 'asset');
        const finalDir = join(parent, assetId);
        destination = finalDir;
        const result = await (this.options.processMedia ?? runMedia)(
          audio ? 'AUDIO' : 'IMAGE',
          file.path,
          outputDir,
          signal,
          target.kind === 'PAGE',
        );
        const image = result.kind === 'IMAGE' ? result.result : null;
        const sound = result.kind === 'AUDIO' ? result.result : null;
        signal.throwIfAborted();
        checkTarget(deps, exhibitionId, target);
        const processed = image ?? sound;
        if (!processed) throw new AppError('E_SERVER');
        const variants = processed.variants.map(v => MediaVariantSchema.parse(v));
        const bytesTotal = variants.reduce((sum, v) => sum + v.bytes, 0);
        if (bytesTotal > reserved)
          releaseExtra = await this.reservations.reserve(exhibitionId, bytesTotal - reserved, signal);
        signal.throwIfAborted();
        return this.reservations.settle(async () => {
          signal.throwIfAborted();
          this.pendingMedia.add(finalDir);
          await rename(outputDir, finalDir);
          published = true;
          signal.throwIfAborted();
          const asset: AssetRecord = {
            id: assetId,
            exhibitionId,
            kind:
              target.kind === 'POSTER'
                ? 'POSTER'
                : target.kind === 'PAGE'
                  ? 'PAGE'
                  : audio
                    ? 'AUDIO'
                    : 'IMAGE',
            width: image?.w ?? null,
            height: image?.h ?? null,
            durationMs: sound ? Math.round(sound.durationMs) : null,
            variants,
            analysis: image?.analysis ?? sound?.analysis ?? null,
            bytesTotal,
            contentHash: file.contentHash,
            createdAt: deps.clock.now(),
          };
          const saved = this.save(exhibitionId, target, file, meta, hash, asset, image);
          used = saved.used;
          await clearFiles();
          releaseSpace();
          return saved.id;
        });
      });
    } catch (cause) {
      const error = asAppError(cause);
      // 검증되지 않은 meta와 다른 전시의 참조는 행으로 남기지 않는다.
      if (hash !== '') this.failed(exhibitionId, target, meta, hash, error);
      if (error.code === 'E_SERVER')
        log.warn('upload_failed', { exhibitionId, code: error.code, err: error });
      throw cause;
    } finally {
      incoming.socket.removeListener('close', disconnect);
      try {
        await this.reservations.settle(async () => {
          try {
            await clearFiles();
          } finally {
            releaseSpace();
          }
        });
      } finally {
        releaseSlot();
        jobs.delete(job);
        if (jobs.size === 0) this.active.delete(exhibitionId);
        finish();
      }
    }
  }
}
