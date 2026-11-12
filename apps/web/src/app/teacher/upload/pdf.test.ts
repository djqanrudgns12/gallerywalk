import { config } from '@gallery/core/config';
import { copy, errorCopy } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeviceStore } from '../../../adapters/deviceStore.ts';
import { createApiClient } from '../../../adapters/api/client.ts';
import { createHttp } from '../../../adapters/api/http.ts';
import { createTokenTools } from '../../../adapters/tokens.ts';
import { fakeXhrFactory, okEnvelopeOf } from '../../../dev/fakeXhr.ts';
import { memoryStorage } from '../../../dev/studentFixtures.ts';
import {
  fakeTeacherServer,
  SYNTH_FILE_NAMES as N,
  teacherArtwork,
  T_EX,
} from '../../../dev/teacherFixtures.ts';
import { testRoomId, uuid } from '../../../dev/testView.ts';
import type { UploadCallOptions, UploadFile } from '../../../ports/index.ts';
import {
  pageRenderSize,
  PdfOpenError,
  pagesSent,
  renderPdfPages,
  type PdfEngine,
  type PdfRenderDeps,
} from './pdfPages.ts';
import { precheckFile } from './precheck.ts';
import { createUploadQueue, type UploadJob, type UploadTask } from './uploadQueue.ts';
import { problemFix, problemText } from './UploadTray.tsx';

/** 가짜 pdf.js: 쪽 크기(pt) 목록. 무엇을 했는지 `log`에 남긴다 */
const fakeEngine = (
  pages: readonly { w: number; h: number }[] | 'PASSWORD' | 'BROKEN',
  log: string[] = [],
) => {
  let rendering = 0;
  const engine: PdfEngine = {
    async open(data) {
      log.push(`open ${data.byteLength}`);
      if (pages === 'PASSWORD' || pages === 'BROKEN') throw new PdfOpenError(pages);
      return {
        pageCount: pages.length,
        async page(n) {
          const p = pages[n - 1];
          if (!p) throw new Error('no page');
          return {
            width: p.w,
            height: p.h,
            async render(canvas, scale) {
              rendering++;
              // 한 번에 한 쪽만(겹치면 기록)
              if (rendering > 1) log.push('overlap');
              log.push(`render ${n} ${canvas.width}x${canvas.height} @${scale.toFixed(3)}`);
              await Promise.resolve();
              rendering--;
            },
            release: () => void log.push(`release ${n}`),
          };
        },
        close: async () => void log.push('close'),
      };
    },
  };
  return engine;
};

const deps = (engine: PdfEngine, log: string[] = []): PdfRenderDeps => ({
  engine,
  canvas: () => document.createElement('canvas'),
  toJpeg: async (canvas, quality) => {
    log.push(`jpeg ${quality}`);
    return new Blob([new Uint8Array(10 + (canvas.width % 7))], { type: 'image/jpeg' });
  },
});

const pdfFile = (name: string = N.pdf, size = 64): File => {
  const b = new Uint8Array(size);
  b.set(Array.from('%PDF-1.7\n', c => c.charCodeAt(0)));
  return new File([b], name, { type: 'application/pdf' });
};
const A4 = { w: 595, h: 842 };
const sha = async () => 'h';

describe('PDF 사전 검사(PLAN §5.3)', () => {
  it('쪽 수만 센다: 30쪽까지 통과, 31쪽이면 `E_PDF_PAGES`', async () => {
    const max = config().PDF_MAX_PAGES;
    const ok = await precheckFile(pdfFile(), 'PDF', {
      pdf: async () => fakeEngine(Array.from({ length: max }, () => A4)),
      sha256Hex: sha,
    });
    expect(ok).toMatchObject({ ok: true, kind: 'PDF', pageCount: max, hash: 'h' });
    const many = await precheckFile(pdfFile(), 'PDF', {
      pdf: async () => fakeEngine(Array.from({ length: max + 1 }, () => A4)),
      sha256Hex: sha,
    });
    expect(many).toEqual({ ok: false, problem: 'E_PDF_PAGES' });
    expect(problemText('E_PDF_PAGES')).toBe(errorCopy.E_PDF_PAGES);
  });

  it('암호 걸린 PDF·깨진 PDF·속이 PDF가 아닌 파일은 `E_FILE_BROKEN`(+ PDF 해결법)', async () => {
    for (const bad of ['PASSWORD', 'BROKEN'] as const) {
      expect(
        await precheckFile(pdfFile(), 'PDF', { pdf: async () => fakeEngine(bad), sha256Hex: sha }),
      ).toEqual({
        ok: false,
        problem: 'E_FILE_BROKEN',
      });
    }
    const notPdf = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], N.pdf);
    const log: string[] = [];
    expect(await precheckFile(notPdf, 'PDF', { pdf: async () => fakeEngine([A4], log) })).toEqual({
      ok: false,
      problem: 'E_FILE_BROKEN',
    });
    expect(log).toEqual([]);
    expect(problemFix('E_FILE_BROKEN', { pdf: true })).toBe(copy.teacher.upload.fix.pdfBroken);
    expect(problemFix('E_FILE_BROKEN')).toBe(copy.teacher.upload.fix.broken);
  });

  it('문서는 25MB까지(그림과 같은 한도)', async () => {
    const big = pdfFile(N.pdf, config().MAX_IMAGE_MB * 1024 * 1024 + 1);
    expect(await precheckFile(big, 'PDF', { pdf: async () => fakeEngine([A4]) })).toEqual({
      ok: false,
      problem: 'E_FILE_TOO_LARGE',
    });
  });
});

describe('쪽 그림 크기', () => {
  it('긴 변을 `PDF_RENDER_PX`(2400)로 — A4 세로·가로', () => {
    const px = config().PDF_RENDER_PX;
    expect(pageRenderSize(595, 842)).toEqual({
      scale: px / 842,
      width: Math.round((595 * px) / 842),
      height: px,
    });
    expect(pageRenderSize(842, 595)).toMatchObject({ width: px, height: Math.round((595 * px) / 842) });
  });

  it('짧은 변이 서버의 최소(300px)보다 작아지면 짧은 변에 맞춰 키운다, 비율 30 초과는 null', () => {
    const min = config().MIN_SHORT_SIDE_PX;
    const strip = pageRenderSize(100, 1500);
    expect(strip?.width).toBe(min);
    expect(strip?.height).toBe(min * 15);
    expect(pageRenderSize(100, 100 * (config().MAX_ASPECT + 1))).toBeNull();
    expect(pageRenderSize(0, 842)).toBeNull();
  });
});

describe('쪽마다 그리기(pdf.js 가짜)', () => {
  it('한 쪽씩 차례로 그려 JPEG(0.92)로 — 캔버스는 쪽 크기, 다 쓰면 닫는다', async () => {
    const log: string[] = [];
    const engine = fakeEngine([A4, { w: 842, h: 595 }, A4], log);
    const done: number[] = [];
    const pages = await renderPdfPages(pdfFile(), deps(engine, log), { onPage: n => done.push(n) });
    expect(pages.map(p => p.name)).toEqual(['page-1.jpg', 'page-2.jpg', 'page-3.jpg']);
    expect(pages.every(p => p.blob.type === 'image/jpeg')).toBe(true);
    expect(done).toEqual([1, 2, 3]);
    expect(log).not.toContain('overlap');
    expect(log.filter(l => l.startsWith('render'))).toEqual([
      `render 1 1696x2400 @${(2400 / 842).toFixed(3)}`,
      `render 2 2400x1696 @${(2400 / 842).toFixed(3)}`,
      `render 3 1696x2400 @${(2400 / 842).toFixed(3)}`,
    ]);
    expect(log.filter(l => l.startsWith('jpeg'))).toEqual(
      Array(3).fill(`jpeg ${config().PDF_RENDER_JPEG_Q}`),
    );
    expect(log.at(-1)).toBe('close');
    expect(log.filter(l => l.startsWith('release'))).toHaveLength(3);
  });

  it('너무 긴 쪽은 `E_ASPECT`, 멈추면 그 자리에서 그만두고 닫는다', async () => {
    const log: string[] = [];
    const weird = fakeEngine([A4, { w: 10, h: 10 * 40 }], log);
    const err = await renderPdfPages(pdfFile(), deps(weird)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('E_ASPECT');
    const ac = new AbortController();
    const stopLog: string[] = [];
    const p = renderPdfPages(pdfFile(), deps(fakeEngine([A4, A4, A4], stopLog)), {
      signal: ac.signal,
      onPage: n => n === 1 && ac.abort(),
    });
    await expect(p).rejects.toThrow();
    expect(stopLog.filter(l => l.startsWith('render'))).toHaveLength(1);
    expect(stopLog.at(-1)).toBe('close');
  });

  it('보낸 바이트 → 다 보낸 쪽 수', () => {
    expect(pagesSent(0, [10, 30])).toEqual({ done: 0, fraction: 0 });
    expect(pagesSent(10, [10, 30])).toEqual({ done: 1, fraction: 0.25 });
    expect(pagesSent(40, [10, 30])).toEqual({ done: 2, fraction: 1 });
  });
});

const pdfJob = (artworkId: string): UploadJob => ({
  key: `k-${artworkId}`,
  file: pdfFile(),
  name: N.pdf,
  kind: 'PDF',
  target: { type: 'ARTWORK', artworkId, roomId: testRoomId(0), order: 3, title: '가상 보고서' },
});

describe('PDF 올리기 줄', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('검사 → 쪽 그리기(쪽 수 진행) → `uploadPdf`(합친 진행) → 끝', async () => {
    const seen: UploadTask[] = [];
    let sent: { input: unknown; pages: readonly UploadFile[] } | null = null;
    const srv = fakeTeacherServer(undefined, {
      uploadPdf: async (_e, input, pages, opts?: UploadCallOptions) => {
        sent = { input, pages };
        const total = pages.reduce((n, p) => n + p.blob.size, 0);
        opts?.onProgress?.({ loaded: pages[0]!.blob.size, total });
        opts?.onProgress?.({ loaded: total, total });
        return teacherArtwork(0, 0, { id: input.id, kind: 'PDF', form: 'MULTIPAGE', status: 'PUBLISHED' });
      },
    });
    const engine = fakeEngine([A4, A4, A4]);
    const q = createUploadQueue({
      api: srv.api,
      exhibitionId: T_EX,
      onArtwork: () => {},
      onRoom: () => {},
      precheck: (f, k) => precheckFile(f, k, { pdf: async () => engine, sha256Hex: sha }),
      renderPdf: (f, o) => renderPdfPages(f, deps(engine), o),
    });
    q.subscribe(() => seen.push(q.tasks()[0]!));
    q.add([pdfJob(uuid(0x777))]);
    await q.idle();
    expect(sent!.input).toEqual({ id: uuid(0x777), roomId: testRoomId(0), order: 3, title: '가상 보고서' });
    expect(sent!.pages.map(p => p.name)).toEqual(['page-1.jpg', 'page-2.jpg', 'page-3.jpg']);
    const rendering = seen.filter(t => t.phase === 'rendering').map(t => t.pages?.done);
    expect(rendering).toEqual(expect.arrayContaining([1, 2, 3]));
    const sending = seen.filter(t => t.phase === 'sending');
    expect(sending.at(-1)?.pages).toEqual({ done: 3, total: 3 });
    expect(sending.at(-1)?.progress).toBe(1);
    // 진행률은 그리기 반, 보내기 반 — 줄지 않는다
    const ps = seen.map(t => t.progress);
    expect(ps.slice(0, ps.indexOf(1) + 1)).toEqual([...ps.slice(0, ps.indexOf(1) + 1)].sort((a, b) => a - b));
    expect(q.tasks()[0]).toMatchObject({ phase: 'done', pdf: true });
  });

  it('PDF는 한 번에 하나만 그리고, 다시 보낼 때는 다시 그리지 않는다', async () => {
    const log: string[] = [];
    let busy = 1;
    const srv = fakeTeacherServer(undefined, {
      uploadPdf: async (_e, input) => {
        if (busy-- > 0) throw new AppError('E_BUSY');
        return teacherArtwork(0, 0, { id: input.id, kind: 'PDF', status: 'PUBLISHED' });
      },
    });
    const engine = fakeEngine([A4, A4], log);
    const q = createUploadQueue({
      api: srv.api,
      exhibitionId: T_EX,
      onArtwork: () => {},
      onRoom: () => {},
      precheck: (f, k) =>
        precheckFile(f, k, { pdf: async () => engine, sha256Hex: async f2 => String(f2.size) }),
      renderPdf: (f, o) => renderPdfPages(f, deps(engine), o),
      sleep: async () => {},
    });
    q.add([pdfJob(uuid(0x781)), { ...pdfJob(uuid(0x782)), file: pdfFile(N.pdf, 80) }]);
    await q.idle();
    expect(q.tasks().map(t => t.phase)).toEqual(['done', 'done']);
    expect(log).not.toContain('overlap');
    // 두 PDF × 2쪽 = 그리기 4번(다시 보낸 것은 그린 쪽을 그대로)
    expect(log.filter(l => l.startsWith('render'))).toHaveLength(4);
    expect(srv.named('uploadPdf')).toHaveLength(3);
  });

  it('실제 어댑터로: 만들기(쪽 수) → 쪽 PUT 1..n 차례로 → complete', async () => {
    const ART = uuid(0x790);
    const storage = memoryStorage();
    const device = createDeviceStore({ storage: () => storage, newDeviceId: () => uuid(0x99) });
    const tokens = createTokenTools();
    const token = tokens.newToken();
    device.setTeacherSession(T_EX, { kind: 'LINK', token, linkToken: token, pendingLinkToken: null });
    const xhrs = fakeXhrFactory();
    const api = createApiClient({
      http: createHttp({ timeoutMs: 5000, deviceId: () => device.deviceId(), xhr: xhrs.create }),
      device,
      tokens,
    });
    const order: string[] = [];
    const art = { ...teacherArtwork(0, 0), id: ART, kind: 'PDF', form: 'MULTIPAGE', image: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        order.push(`${init?.method} ${url}`);
        if (url.endsWith('/artworks')) {
          expect(JSON.parse(String(init?.body))).toMatchObject({ id: ART, kind: 'PDF', pageCount: 3 });
          return new Response(JSON.stringify(okEnvelopeOf({ ...art, status: 'PROCESSING' })), {
            status: 201,
          });
        }
        return new Response(JSON.stringify(okEnvelopeOf({ ...art, status: 'PUBLISHED' })), { status: 200 });
      }),
    );
    const engine = fakeEngine([A4, A4, A4]);
    const q = createUploadQueue({
      api: api.teacher,
      exhibitionId: T_EX,
      onArtwork: () => {},
      onRoom: () => {},
      precheck: (f, k) => precheckFile(f, k, { pdf: async () => engine, sha256Hex: sha }),
      renderPdf: (f, o) => renderPdfPages(f, deps(engine), o),
    });
    q.add([pdfJob(ART)]);
    let answered = 0;
    for (let i = 0; i < 500 && answered < 3; i++) {
      await new Promise(r => setTimeout(r, 0));
      const x = xhrs.made.at(-1);
      if (x && x.sent && x.status === 0) {
        order.push(`${x.method} ${x.url}`);
        x.respond(204);
        answered++;
      }
    }
    await q.idle();
    expect(order).toEqual([
      `POST /api/teacher/exhibitions/${T_EX}/artworks`,
      `PUT /api/teacher/artworks/${ART}/pages/1`,
      `PUT /api/teacher/artworks/${ART}/pages/2`,
      `PUT /api/teacher/artworks/${ART}/pages/3`,
      `POST /api/teacher/artworks/${ART}/complete`,
    ]);
    expect(q.tasks()[0]?.phase).toBe('done');
  });
});
