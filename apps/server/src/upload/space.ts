import { lstat, readdir, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';

export const BYTES_PER_MB = 1024 ** 2;
const BYTES_PER_GB = 1024 ** 3;

const missing = (cause: unknown): boolean =>
  cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';

/** 링크를 따라가지 않고, 고아 asset·이전 처리 잔여물도 실제 사용량에 포함한다. */
export async function directoryBytes(
  path: string,
  pending: ReadonlySet<string> = new Set(),
): Promise<number> {
  if (pending.has(path)) return 0;
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return 0;
    if (!info.isDirectory()) return info.size;
    let total = 0;
    for (const name of await readdir(path)) total += await directoryBytes(join(path, name), pending);
    return total;
  } catch (cause) {
    if (missing(cause)) return 0;
    throw cause;
  }
}

export interface DiskUsage {
  readonly exhibitionBytes: number;
  readonly mediaBytes: number;
  readonly freeBytes: number;
  /** 살아 있는 예약이 이미 물리 디스크에 쓴 바이트. freeBytes에서 같은 양을 다시 빼지 않는다. */
  readonly pendingBytes?: number;
}

export interface PendingFiles {
  readonly media: ReadonlySet<string>;
  readonly tmp: ReadonlySet<string>;
}

const ownedBytes = async (paths: ReadonlySet<string>): Promise<number> => {
  let total = 0;
  for (const path of paths) total += await directoryBytes(path);
  return total;
};

export const readDiskUsage = async (
  mediaDir: string,
  tmpDir: string,
  exhibitionDir: string,
  pending: PendingFiles = { media: new Set(), tmp: new Set() },
): Promise<DiskUsage> => {
  // 먼저 센 사용량만 공제한다. 그 뒤 자식이 파일을 더 써도 남은 예약량을 과소평가하지 않는다.
  const [pendingMedia, pendingTmp, mediaBytes, exhibitionBytes] = await Promise.all([
    ownedBytes(pending.media),
    ownedBytes(pending.tmp),
    directoryBytes(mediaDir, pending.media),
    directoryBytes(exhibitionDir, pending.media),
  ]);
  const [mediaDisk, tmpDisk, media, tmp] = await Promise.all([
    statfs(mediaDir),
    statfs(tmpDir),
    stat(mediaDir),
    stat(tmpDir),
  ]);
  return {
    mediaBytes,
    exhibitionBytes,
    freeBytes: Math.min(mediaDisk.bavail * mediaDisk.bsize, tmpDisk.bavail * tmpDisk.bsize),
    // 서로 다른 볼륨이면 두 곳 모두에 안전한 공제량만 쓴다.
    pendingBytes: media.dev === tmp.dev ? pendingMedia + pendingTmp : Math.min(pendingMedia, pendingTmp),
  };
};

/** 공간 조회·최종 공개·정산을 직렬화한다. 처리 자체는 대기열의 동시성 설정을 따른다. */
export class SpaceReservations {
  private total = 0;
  private readonly byExhibition = new Map<string, number>();
  private pending: Promise<void> = Promise.resolve();
  private readonly usage: (exhibitionId: string) => Promise<DiskUsage>;

  constructor(usage: (exhibitionId: string) => Promise<DiskUsage>) {
    this.usage = usage;
  }

  async settle<T>(work: () => Promise<T>): Promise<T> {
    const before = this.pending;
    let unlock = () => {};
    this.pending = new Promise<void>(resolve => {
      unlock = resolve;
    });
    await before;
    try {
      return await work();
    } finally {
      unlock();
    }
  }

  reserve(exhibitionId: string, bytes: number, signal: AbortSignal): Promise<() => void> {
    return this.settle(async () => {
      signal.throwIfAborted();
      const disk = await this.usage(exhibitionId);
      signal.throwIfAborted();
      const mine = this.byExhibition.get(exhibitionId) ?? 0;
      const cfg = config();
      const unspent = Math.max(0, this.total - (disk.pendingBytes ?? 0));
      if (
        disk.exhibitionBytes + mine + bytes > cfg.EXHIBITION_MAX_MB * BYTES_PER_MB ||
        disk.mediaBytes + this.total + bytes > cfg.MEDIA_DISK_MAX_GB * BYTES_PER_GB ||
        disk.freeBytes - unspent - bytes < cfg.DISK_FREE_MIN_GB * BYTES_PER_GB
      )
        throw new AppError('E_QUOTA');
      this.total += bytes;
      this.byExhibition.set(exhibitionId, mine + bytes);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.total -= bytes;
        const remaining = (this.byExhibition.get(exhibitionId) ?? 0) - bytes;
        if (remaining === 0) this.byExhibition.delete(exhibitionId);
        else this.byExhibition.set(exhibitionId, remaining);
      };
    });
  }
}
