import { randomInt } from 'node:crypto';
import { appendFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { config } from '@gallery/core/config';
import { UuidSchema } from '@gallery/core/types';
import { createDeviceDiag } from './application/diag.ts';
import type { ServerEnv } from './env.ts';
import type {
  Deps,
  DeviceDiag,
  DeviceReportFiles,
  EventLog,
  FileUploads,
  MediaFiles,
} from './ports/index.ts';
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
  /** 기기 진단(HW-02) — `deps.diag`와 같은 것. 1분 기록이 받은 수를 꺼낸다 */
  readonly diag: DeviceDiag;
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

/** 기기 보고 파일이 쌓이는 곳: `DATA_DIR/reports/device-YYYY-MM-DD.jsonl`(HW-02, ADR-070) */
export const DEVICE_REPORTS_DIR = 'reports';
const REPORT_FILE = /^device-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const MS_PER_DAY = 86_400_000;
/** 한국 표준시(UTC+9, 일광 절약 없음). 학교 하루(아침~오후)가 한 파일에 들게 보고 파일 날짜는 KST로 정한다 */
const KST_OFFSET_MS = 9 * 3_600_000;
const kstDay = (ms: number): string => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);

export interface DeviceReportFilesOptions {
  /** 지울 날 셈의 시계(기본 벽시계) */
  readonly now?: () => number;
  readonly log?: EventLog;
}

/** 운영 보고 파일 쓰기 + 시험이 쓰기를 기다리는 손잡이 */
export interface DeviceReportFileWriter extends DeviceReportFiles {
  /** 지금까지 맡은 쓰기(와 지우기)가 끝나면 풀린다 */
  settled(): Promise<void>;
}

/**
 * 기기 보고 파일의 node:fs 구현. 한 줄 = JSON 한 줄(`DeviceReportLine`), 파일 날짜는 그 줄의 `at`을 KST로 바꾼 날.
 * 쓰기는 작은 비동기 `appendFile`을 차례로(줄이 섞이지 않게) — 부른 쪽은 기다리지 않고, 실패는 개수만 기록한다.
 * 날짜가 바뀐 뒤 처음 쓸 때(다시 시작한 뒤 처음 포함) 오늘 포함 `DEVICE_REPORT_KEEP_DAYS`일보다 오래된 파일을 지운다
 * (`log.ts`가 날짜 파일을 바꿀 때 정리하는 것과 같은 방식).
 */
export const createDeviceReportFiles = (
  dir: string,
  options: DeviceReportFilesOptions = {},
): DeviceReportFileWriter => {
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? silentLog;
  let tail: Promise<void> = Promise.resolve();
  let prunedDay: string | undefined;

  const prune = async (): Promise<void> => {
    const cutoff = kstDay(now() - config().DEVICE_REPORT_KEEP_DAYS * MS_PER_DAY);
    let removed = 0;
    for (const name of await readdir(dir)) {
      const day = REPORT_FILE.exec(name)?.[1];
      if (day === undefined || day > cutoff) continue;
      await rm(join(dir, name), { force: true });
      removed += 1;
    }
    if (removed > 0) log.info('device_reports_pruned', { count: removed });
  };

  const write = async (text: string, day: string): Promise<void> => {
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    await appendFile(join(dir, `device-${day}.jsonl`), text, { mode: FILE_MODE });
    if (prunedDay === day) return;
    prunedDay = day;
    // 지우기 실패는 쓰기 실패와 따로 센다(줄은 이미 남았다). 다음 날 다시 본다
    await prune().catch(() => log.warn('device_reports_prune_failed', { count: 1 }));
  };

  return {
    append(line) {
      const at = Date.parse(line.at);
      const day = kstDay(Number.isFinite(at) ? at : now());
      const text = `${JSON.stringify(line)}\n`;
      tail = tail
        .then(() => write(text, day))
        .catch(() => log.warn('device_report_write_failed', { count: 1 }));
    },
    settled: () => tail,
  };
};

/**
 * `log`: 유스케이스 기록(운영은 `log.ts` Logger). 넘기지 않으면 남기지 않는다 — `index.ts`가 기록기를 넘겨야
 * "지금 삭제"·보관 정리의 개수 기록이 파일에 남는다.
 */
export const createServerDeps = (
  db: Db,
  env: Pick<ServerEnv, 'nodeEnv' | 'secrets' | 'mediaDir' | 'tmpDir'> &
    Partial<Pick<ServerEnv, 'retentionTestMinutes' | 'dataDir'>>,
  log: EventLog = silentLog,
): ServerDeps => {
  const clock = { now: () => Date.now() };
  const security = createSecurity(env, { db, clock });
  // 보고 파일은 DATA_DIR이 있을 때만(없으면 까닭별 수만 세고 보고는 버린다)
  const reportFiles: DeviceReportFiles =
    env.dataDir === undefined
      ? { append: () => undefined }
      : createDeviceReportFiles(join(env.dataDir, DEVICE_REPORTS_DIR), { now: clock.now, log });
  const diag = createDeviceDiag({ clock, files: reportFiles });
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
      diag,
      ...(env.retentionTestMinutes === undefined ? {} : { retentionTestMinutes: env.retentionTestMinutes }),
    },
    security,
    diag,
  };
};
