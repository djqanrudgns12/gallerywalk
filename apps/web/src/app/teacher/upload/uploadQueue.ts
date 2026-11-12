import { config } from '@gallery/core/config';
import type { FileKind } from '@gallery/core/classify';
import { AppError } from '@gallery/core/errors';
import type { ArtworkTeacher, RoomTeacher } from '@gallery/core/types';
import type { TeacherApi, UploadFile } from '../../../ports/index.ts';
import { pagesSent, renderWithPdfjs, type PdfRenderOptions } from './pdfPages.ts';
import { precheckFile, type PrecheckResult, type UploadProblem } from './precheck.ts';

/**
 * 올리기 줄(P5-3, PLAN §5.3 "사전 검사는 한 번에 하나, 올리기는 동시 3개").
 *
 * 한 파일의 길: 검사 중 → (막힘 | 같은 파일 | 기다림) → 보내는 중(진행률) → 끝 | 실패 | 이미 올린 작품.
 * - 동시 수는 서버의 전시당 수신 칸(`UPLOAD_SLOTS_PER_EXHIBITION`)과 같다. 넘게 보내면 서버가 `E_BUSY`로 돌려보낸다.
 * - `E_BUSY`·`E_RATE_LIMITED`(서버가 바쁨): 같은 ID로 조금 뒤 다시(`UPLOAD_RETRY_MAX`번까지). 기다리는 동안 카드에 그 문구.
 * - `E_OFFLINE`·`E_SERVER`(결과를 모름): **처리 상태 확인** — 교사 보기를 새로 받아 그 작품 ID가 이미 있는지 본다.
 *   있으면 그 결과(게시·숨김 = 끝, 실패 = 그 사유), 없으면 같은 ID·같은 파일로 다시(서버가 멱등으로 처음 결과를 준다).
 * - `E_DUPLICATE`: 이 전시에 같은 내용이 이미 있음. 이번에 함께 놓은 같은 파일은 기기가 해시로 먼저 거른다.
 * - PDF: 차례가 오면 쪽 그림을 만들고(한 번에 PDF 하나, 한 쪽씩) `uploadPdf`(3단계)로 보낸다. 진행률은 그리기 반·보내기 반이고
 *   쪽 수(`pages`)로 보인다. 다시 보낼 때는 이미 만든 쪽 그림을 그대로 쓴다(같은 작품 ID라 서버는 받은 쪽을 처음 결과로 넘긴다).
 */

/** 같은 일을 다시 보내는 횟수 상한(처음 포함). 설정 키 후보 — 보고 */
export const UPLOAD_RETRY_MAX = config().UPLOAD_RETRY_MAX;
/** 다시 보내기 전 기다림(ms) × 몇 번째인지. 설정 키 후보 — 보고 */
export const UPLOAD_RETRY_DELAY_MS = config().UPLOAD_RETRY_DELAY_MS;

export type UploadTarget =
  | {
      readonly type: 'ARTWORK';
      readonly artworkId: string;
      readonly roomId: string;
      readonly order: number;
      readonly title: string;
    }
  | { readonly type: 'BGM'; readonly roomId: string };

export interface UploadJob {
  /** 이 줄 안에서 하나(카드 열쇠) */
  readonly key: string;
  readonly file: Blob;
  readonly name: string;
  /** 폴더 규칙이 확장자로 가른 종류 */
  readonly kind: FileKind;
  readonly target: UploadTarget;
}

export type UploadPhase =
  | 'checking'
  | 'waiting'
  | 'rendering'
  | 'sending'
  | 'confirming'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'duplicate';

export interface UploadTask {
  readonly key: string;
  readonly name: string;
  readonly target: UploadTarget;
  readonly phase: UploadPhase;
  /** 0~1(보내는 중일 때) */
  readonly progress: number;
  /** 막힘·실패 사유, 또는 기다리는 이유(`E_BUSY`) */
  readonly problem: UploadProblem | null;
  /** 흐림 경고(올리기는 함) */
  readonly lowRes: boolean;
  /** PDF인가(해결법 문구가 다름) */
  readonly pdf: boolean;
  /** PDF: 그린 쪽 수(그리는 중) 또는 다 보낸 쪽 수(보내는 중) / 전체 쪽 수 */
  readonly pages: { readonly done: number; readonly total: number } | null;
}

export interface UploadQueueOptions {
  readonly api: TeacherApi;
  readonly exhibitionId: string;
  /** 처리가 끝난 작품(격자에 넣기) */
  readonly onArtwork: (artwork: ArtworkTeacher) => void;
  /** 배경음악이 붙은 전시실 */
  readonly onRoom: (room: RoomTeacher) => void;
  readonly precheck?: (file: Blob, kind: FileKind) => Promise<PrecheckResult>;
  readonly concurrency?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** PDF → 쪽 그림. 기본은 pdf.js(처음 쓸 때 받음) */
  readonly renderPdf?: (file: Blob, opts: PdfRenderOptions) => Promise<readonly UploadFile[]>;
}

export interface UploadQueue {
  add(jobs: readonly UploadJob[]): void;
  tasks(): readonly UploadTask[];
  subscribe(listener: () => void): () => void;
  /** 끝난 것(끝·막힘·실패·같은 파일)을 목록에서 뺀다 */
  clearFinished(): void;
  /** 보내는 중인 것을 모두 멈춘다(화면을 떠날 때) */
  stop(): void;
  /** 멈춘 뒤 다시 받기 시작(React StrictMode가 효과를 두 번 돌려도 줄이 살아 있게) */
  resume(): void;
  /** 지금 넣은 것이 모두 끝날 때까지(시험·화면 알림용) */
  idle(): Promise<void>;
}

const FINISHED: ReadonlySet<UploadPhase> = new Set(['done', 'blocked', 'failed', 'duplicate']);
const BUSY_CODES = new Set(['E_BUSY', 'E_RATE_LIMITED']);
const UNKNOWN_CODES = new Set(['E_OFFLINE', 'E_SERVER']);

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export const isFinished = (phase: UploadPhase): boolean => FINISHED.has(phase);

export const createUploadQueue = (opts: UploadQueueOptions): UploadQueue => {
  const { api, exhibitionId } = opts;
  const concurrency = opts.concurrency ?? config().UPLOAD_SLOTS_PER_EXHIBITION;
  const sleep = opts.sleep ?? defaultSleep;
  const check = opts.precheck ?? ((file, kind) => precheckFile(file, kind));
  const renderPdf = opts.renderPdf ?? renderWithPdfjs;

  let list: UploadTask[] = [];
  const listeners = new Set<() => void>();
  const waiting: { job: UploadJob; checked: PrecheckResult & { ok: true } }[] = [];
  /** 이 줄에서 올리는 중이거나 올린 파일(같은 파일 두 번 막기). 실패·멈춤이면 풀어 다시 고를 수 있게 */
  const seenHashes = new Set<string>();
  const hashOf = new Map<string, string>();
  const release = (key: string): void => {
    const h = hashOf.get(key);
    if (h === undefined) return;
    hashOf.delete(key);
    seenHashes.delete(h);
  };
  const controllers = new Set<AbortController>();
  let active = 0;
  let checking: Promise<void> = Promise.resolve();
  let stopped = false;
  let idleWaiters: (() => void)[] = [];
  /** PDF 쪽 그리기는 한 번에 하나(PLAN §5.3) */
  let rendering: Promise<unknown> = Promise.resolve();
  /** 다시 보낼 때 쓰려고 만든 쪽 그림(끝나면 지움) */
  const rendered = new Map<string, readonly UploadFile[]>();

  const emit = () => {
    for (const l of listeners) l();
    if (list.every(t => isFinished(t.phase)) && active === 0 && waiting.length === 0) {
      const ws = idleWaiters;
      idleWaiters = [];
      for (const w of ws) w();
    }
  };

  const update = (key: string, patch: Partial<UploadTask>) => {
    if (patch.phase === 'failed') release(key);
    list = list.map(t => (t.key === key ? { ...t, ...patch } : t));
    emit();
  };

  /** 결과를 모를 때: 교사 보기에서 그 작품을 찾는다 */
  const confirm = async (job: UploadJob): Promise<ArtworkTeacher | null> => {
    if (job.target.type !== 'ARTWORK') return null;
    const { artworkId } = job.target;
    const view = await api.exhibition(exhibitionId);
    return view.artworks.find(a => a.id === artworkId && a.deletedAt === null) ?? null;
  };

  /** PDF 쪽 그림(이미 만들었으면 그대로). 진행률 앞 절반 */
  const pdfPages = async (
    job: UploadJob,
    total: number,
    signal: AbortSignal,
  ): Promise<readonly UploadFile[]> => {
    const ready = rendered.get(job.key);
    if (ready) return ready;
    const run = rendering.then(() => {
      signal.throwIfAborted();
      update(job.key, { phase: 'rendering', progress: 0, pages: { done: 0, total } });
      return renderPdf(job.file, {
        signal,
        onPage: (done, all) =>
          update(job.key, { phase: 'rendering', progress: done / all / 2, pages: { done, total: all } }),
      });
    });
    rendering = run.catch(() => undefined);
    const pages = await run;
    rendered.set(job.key, pages);
    return pages;
  };

  const sendOnce = async (
    job: UploadJob,
    checked: PrecheckResult & { ok: true },
    signal: AbortSignal,
  ): Promise<ArtworkTeacher | RoomTeacher> => {
    const file = { blob: job.file, name: job.name };
    const onProgress = (p: { loaded: number; total: number }) =>
      update(job.key, { progress: p.total > 0 ? Math.min(1, p.loaded / p.total) : 0 });
    const t = job.target;
    if (t.type === 'BGM') return api.uploadBgm(exhibitionId, t.roomId, file, { signal, onProgress });
    const base = { id: t.artworkId, roomId: t.roomId, order: t.order, title: t.title };
    if (checked.kind === 'PDF') {
      const pages = await pdfPages(job, checked.pageCount ?? 0, signal);
      const sizes = pages.map(p => p.blob.size);
      update(job.key, { phase: 'sending', progress: 1 / 2, pages: { done: 0, total: pages.length } });
      return api.uploadPdf(exhibitionId, base, pages, {
        signal,
        onProgress: p => {
          const sent = pagesSent(p.loaded, sizes);
          update(job.key, {
            progress: (1 + sent.fraction) / 2,
            pages: { done: sent.done, total: pages.length },
          });
        },
      });
    }
    if (checked.kind === 'TEXT')
      return api.createArtwork(exhibitionId, { ...base, kind: 'TEXT', textBody: checked.text ?? '' });
    return api.uploadArtwork(exhibitionId, { ...base, kind: checked.kind }, file, { signal, onProgress });
  };

  const finishWith = (job: UploadJob, result: ArtworkTeacher | RoomTeacher) => {
    if (job.target.type === 'BGM') {
      opts.onRoom(result as RoomTeacher);
      update(job.key, { phase: 'done', progress: 1, problem: null });
      return;
    }
    const art = result as ArtworkTeacher;
    rendered.delete(job.key);
    opts.onArtwork(art);
    if (art.status === 'FAILED')
      update(job.key, { phase: 'failed', problem: art.failCode ?? 'E_FILE_BROKEN' });
    else update(job.key, { phase: 'done', progress: 1, problem: null });
  };

  const run = async (job: UploadJob, checked: PrecheckResult & { ok: true }) => {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      for (let attempt = 1; ; attempt++) {
        if (checked.kind !== 'PDF') update(job.key, { phase: 'sending', progress: 0 });
        try {
          finishWith(job, await sendOnce(job, checked, controller.signal));
          return;
        } catch (err) {
          if (controller.signal.aborted) {
            update(job.key, { phase: 'failed', problem: 'E_OFFLINE' });
            return;
          }
          const code = err instanceof AppError ? err.code : 'E_SERVER';
          if (code === 'E_DUPLICATE') {
            update(job.key, { phase: 'duplicate', problem: 'E_DUPLICATE' });
            return;
          }
          const canRetry = attempt < UPLOAD_RETRY_MAX;
          if (BUSY_CODES.has(code) && canRetry) {
            // PDF는 쪽 그림을 이미 만들었으니 진행률 절반은 남긴다
            update(job.key, {
              phase: 'waiting',
              problem: 'E_BUSY',
              progress: rendered.has(job.key) ? 1 / 2 : 0,
            });
            await sleep(UPLOAD_RETRY_DELAY_MS * attempt);
            continue;
          }
          if (UNKNOWN_CODES.has(code)) {
            update(job.key, { phase: 'confirming', problem: null });
            let found: ArtworkTeacher | null = null;
            try {
              found = await confirm(job);
            } catch {
              found = null;
            }
            if (found !== null && found.status !== 'PROCESSING') {
              finishWith(job, found);
              return;
            }
            if (canRetry) {
              update(job.key, { phase: 'waiting', problem: code });
              await sleep(UPLOAD_RETRY_DELAY_MS * attempt);
              continue;
            }
          }
          update(job.key, { phase: 'failed', problem: code });
          return;
        }
      }
    } finally {
      controllers.delete(controller);
      if (isFinished(list.find(t => t.key === job.key)?.phase ?? 'done')) rendered.delete(job.key);
    }
  };

  const pump = () => {
    while (!stopped && active < concurrency && waiting.length > 0) {
      const next = waiting.shift()!;
      active++;
      void run(next.job, next.checked).finally(() => {
        active--;
        pump();
        emit();
      });
    }
  };

  const checkOne = async (job: UploadJob) => {
    if (stopped) return;
    let result: PrecheckResult;
    try {
      result = await check(job.file, job.kind);
    } catch {
      result = { ok: false, problem: 'E_FILE_BROKEN' };
    }
    if (!result.ok) {
      update(job.key, { phase: 'blocked', problem: result.problem });
      return;
    }
    if (job.target.type === 'BGM' && result.kind !== 'AUDIO') {
      update(job.key, { phase: 'blocked', problem: 'E_FILE_TYPE' });
      return;
    }
    if (result.hash !== null && seenHashes.has(result.hash)) {
      update(job.key, { phase: 'duplicate', problem: 'E_DUPLICATE' });
      return;
    }
    if (result.hash !== null) {
      seenHashes.add(result.hash);
      hashOf.set(job.key, result.hash);
    }
    update(job.key, { phase: 'waiting', lowRes: result.lowRes });
    waiting.push({ job, checked: result });
    pump();
  };

  return {
    add(jobs) {
      if (jobs.length === 0) return;
      list = [
        ...list,
        ...jobs.map((j): UploadTask => ({
          key: j.key,
          name: j.name,
          target: j.target,
          phase: 'checking',
          progress: 0,
          problem: null,
          lowRes: false,
          pdf: j.kind === 'PDF',
          pages: null,
        })),
      ];
      emit();
      for (const job of jobs) checking = checking.then(() => checkOne(job));
    },
    tasks: () => list,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clearFinished() {
      list = list.filter(t => !isFinished(t.phase));
      emit();
    },
    resume() {
      stopped = false;
      pump();
    },
    stop() {
      stopped = true;
      for (const w of waiting) release(w.job.key);
      waiting.length = 0;
      for (const c of controllers) c.abort();
    },
    idle: () =>
      list.every(t => isFinished(t.phase)) && active === 0
        ? Promise.resolve()
        : new Promise<void>(resolve => idleWaiters.push(resolve)),
  };
};
