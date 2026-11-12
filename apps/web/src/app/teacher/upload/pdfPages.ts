import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import type { UploadFile } from '../../../ports/index.ts';

/**
 * PDF → 쪽 그림(PLAN §5.1·§5.3, ADR-056). PDF 원본은 서버에 보내지 않고, 기기에서 쪽마다 JPEG를 만들어 3단계로 올린다.
 *
 * - 크기: 긴 변 `PDF_RENDER_PX`(2400). 서버가 쪽마다 긴 변 2048 WebP로 다시 만든다.
 *   짧은 변이 서버의 최소(`MIN_SHORT_SIDE_PX`)보다 작아지는 가늘고 긴 쪽은 짧은 변에 맞춰 키운다(서버가 `E_FILE_TOO_SMALL`로
 *   거절하지 않게). 비율이 `MAX_ASPECT`를 넘으면 서버도 받지 않으므로 `E_ASPECT`.
 * - 형식: JPEG(`PDF_RENDER_JPEG_Q`). 모든 브라우저가 인코딩하고 PNG보다 훨씬 작다(쪽당 2~6MB → 수백 KB).
 * - 한 쪽씩 차례로 그리고, 그린 캔버스는 바로 비운다(태블릿 메모리).
 * - pdf.js는 여기서 직접 가져오지 않는다(`PdfEngine` — 실제 구현은 `pdfjs.ts`, 시험은 가짜). 교사 묶음에서도 PDF를 놓을 때만 받는다.
 */

export interface PdfPage {
  /** 크기(pt, 회전 반영) */
  readonly width: number;
  readonly height: number;
  render(canvas: HTMLCanvasElement, scale: number, signal?: AbortSignal): Promise<void>;
  release(): void;
}

export interface PdfDocument {
  readonly pageCount: number;
  /** 1부터 */
  page(n: number): Promise<PdfPage>;
  close(): Promise<void>;
}

export interface PdfEngine {
  /** 열지 못하면 `PdfOpenError`(암호·깨짐) */
  open(data: Uint8Array): Promise<PdfDocument>;
}

export class PdfOpenError extends Error {
  readonly reason: 'PASSWORD' | 'BROKEN';
  constructor(reason: 'PASSWORD' | 'BROKEN') {
    super(`pdf ${reason}`);
    this.name = 'PdfOpenError';
    this.reason = reason;
  }
}

export interface PdfRenderDeps {
  readonly engine: PdfEngine;
  readonly canvas: () => HTMLCanvasElement;
  readonly toJpeg: (canvas: HTMLCanvasElement, quality: number) => Promise<Blob>;
}

export interface PdfRenderOptions {
  readonly signal?: AbortSignal | undefined;
  /** 쪽 하나를 다 그릴 때마다(`done`/`total`) */
  readonly onPage?: ((done: number, total: number) => void) | undefined;
}

/** 쪽 크기(pt) → 그릴 크기(px)·배율. 서버가 받을 수 없는 비율이면 null */
export const pageRenderSize = (
  w: number,
  h: number,
): { readonly scale: number; readonly width: number; readonly height: number } | null => {
  const cfg = config();
  if (!(w > 0) || !(h > 0)) return null;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (long / short > cfg.MAX_ASPECT) return null;
  let scale = cfg.PDF_RENDER_PX / long;
  if (short * scale < cfg.MIN_SHORT_SIDE_PX) scale = cfg.MIN_SHORT_SIDE_PX / short;
  return { scale, width: Math.round(w * scale), height: Math.round(h * scale) };
};

/** 보낸 바이트 → 다 보낸 쪽 수와 전체 비율(쪽 크기 목록 기준) */
export const pagesSent = (
  loaded: number,
  sizes: readonly number[],
): { readonly done: number; readonly fraction: number } => {
  const total = sizes.reduce((n, s) => n + s, 0);
  let done = 0;
  let acc = 0;
  for (const s of sizes) {
    if (acc + s > loaded) break;
    acc += s;
    done++;
  }
  return { done, fraction: total > 0 ? Math.min(1, loaded / total) : 0 };
};

/** PDF를 열어 쪽 수만 센다. 열지 못하면 null(암호·깨짐) */
export const countPdfPages = async (file: Blob, engine: PdfEngine): Promise<number | null> => {
  let doc: PdfDocument;
  try {
    doc = await engine.open(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
  const n = doc.pageCount;
  await doc.close().catch(() => undefined);
  return n;
};

const toAppError = (err: unknown): AppError =>
  err instanceof AppError ? err : new AppError('E_FILE_BROKEN', { cause: err });

/**
 * 쪽마다 JPEG. 한 번에 한 쪽, 차례로. 멈추면(`signal`) 그 자리에서 그만두고 문서를 닫는다.
 * 열지 못함·그리기 실패는 `E_FILE_BROKEN`, 쪽 수 초과는 `E_PDF_PAGES`, 너무 긴 쪽은 `E_ASPECT`.
 */
export const renderPdfPages = async (
  file: Blob,
  deps: PdfRenderDeps,
  opts: PdfRenderOptions = {},
): Promise<UploadFile[]> => {
  const cfg = config();
  const { signal } = opts;
  signal?.throwIfAborted();
  let doc: PdfDocument;
  try {
    doc = await deps.engine.open(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    throw new AppError('E_FILE_BROKEN', { cause: err });
  }
  try {
    const total = doc.pageCount;
    if (total < 1) throw new AppError('E_FILE_BROKEN');
    if (total > cfg.PDF_MAX_PAGES) throw new AppError('E_PDF_PAGES');
    const out: UploadFile[] = [];
    for (let n = 1; n <= total; n++) {
      signal?.throwIfAborted();
      const page = await doc.page(n).catch((err: unknown) => {
        throw toAppError(err);
      });
      try {
        const size = pageRenderSize(page.width, page.height);
        if (!size) throw new AppError('E_ASPECT');
        const canvas = deps.canvas();
        canvas.width = size.width;
        canvas.height = size.height;
        try {
          await page.render(canvas, size.scale, signal);
          signal?.throwIfAborted();
          const blob = await deps.toJpeg(canvas, cfg.PDF_RENDER_JPEG_Q);
          out.push({ blob, name: `page-${n}.jpg` });
        } finally {
          // 쪽 그림을 만든 캔버스는 바로 비운다(Safari는 캔버스 메모리를 늦게 돌려준다)
          canvas.width = 0;
          canvas.height = 0;
        }
      } finally {
        page.release();
      }
      opts.onPage?.(n, total);
    }
    return out;
  } catch (err) {
    if (signal?.aborted) throw err;
    throw toAppError(err);
  } finally {
    await doc.close().catch(() => undefined);
  }
};

/** 기본 캔버스·JPEG(브라우저) */
export const browserCanvas = (): HTMLCanvasElement => document.createElement('canvas');

export const canvasToJpeg = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new AppError('E_FILE_BROKEN'))),
      'image/jpeg',
      quality,
    );
  });

/** 실제 pdf.js로 그리기(처음 PDF를 놓을 때 pdf.js를 받는다) */
export const renderWithPdfjs = async (file: Blob, opts: PdfRenderOptions): Promise<UploadFile[]> => {
  const { loadPdfEngine } = await import('./pdfjs.ts');
  const engine = await loadPdfEngine();
  return renderPdfPages(file, { engine, canvas: browserCanvas, toJpeg: canvasToJpeg }, opts);
};

/** 실제 pdf.js 엔진(사전 검사의 쪽 세기용) */
export const pdfjsEngine = async (): Promise<PdfEngine> => (await import('./pdfjs.ts')).loadPdfEngine();
