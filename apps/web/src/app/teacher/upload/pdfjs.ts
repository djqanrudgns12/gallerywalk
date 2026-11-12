import { PdfOpenError, type PdfDocument, type PdfEngine } from './pdfPages.ts';

/**
 * pdf.js 연결(PLAN §5.3, F-10). 이 파일은 PDF를 처음 놓을 때 지연 로드된다 — 학생 묶음은 물론 교사 관리 화면 첫 묶음에도 없다.
 *
 * - legacy 빌드: 학교 태블릿의 오래된 Safari에서도 돌게(modern 빌드는 최신 브라우저만).
 * - 워커는 따로 묶인 파일(`?url`, `assets/g/pdf.worker.min-*.mjs`)을 같은 출처에서 띄운다(CSP `worker-src 'self'`).
 * - CMap·표준 글꼴·wasm(이미지 해독)·ICC는 자체 배포한다(`/assets/g/pdfjs/{판}/…`, `vite.config.ts`의 `pdfjsAssets`).
 *   외부 주소는 쓰지 않는다. 한글 글꼴을 넣지 않은 PDF도 CMap으로 글자가 깨지지 않는다.
 * - 쪽 그리기는 메인 스레드(renderer worker는 켜지 않음 — Safari 호환이 불확실하고 캔버스를 넘기면 `toBlob`을 못 쓴다, F-10).
 */

type PdfjsLib = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/** 자체 배포한 pdf.js 자원 폴더(끝에 `/`) */
export const pdfjsAssetBase = (version: string): string =>
  new URL(`/assets/g/pdfjs/${version}/`, globalThis.location?.href ?? 'http://localhost/').href;

const wrap = (lib: PdfjsLib): PdfEngine => ({
  async open(data) {
    const base = pdfjsAssetBase(lib.version);
    const task = lib.getDocument({
      data,
      cMapUrl: `${base}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`,
      iccUrl: `${base}iccs/`,
      enableXfa: false,
      verbosity: lib.VerbosityLevel.ERRORS,
    });
    let pdf: Awaited<typeof task.promise>;
    try {
      pdf = await task.promise;
    } catch (err) {
      await task.destroy().catch(() => undefined);
      throw new PdfOpenError(err instanceof lib.PasswordException ? 'PASSWORD' : 'BROKEN');
    }
    const doc: PdfDocument = {
      pageCount: pdf.numPages,
      async page(n) {
        const p = await pdf.getPage(n);
        const base1 = p.getViewport({ scale: 1 });
        return {
          width: base1.width,
          height: base1.height,
          async render(canvas, scale, signal) {
            const job = p.render({ canvas, viewport: p.getViewport({ scale }), intent: 'display' });
            const stop = () => job.cancel();
            signal?.addEventListener('abort', stop, { once: true });
            try {
              await job.promise;
            } finally {
              signal?.removeEventListener('abort', stop);
            }
          },
          release: () => void p.cleanup(),
        };
      },
      close: () => task.destroy(),
    };
    return doc;
  },
});

let loading: Promise<PdfEngine> | null = null;

/** pdf.js와 워커 주소를 한 번만 받는다 */
export const loadPdfEngine = (): Promise<PdfEngine> => {
  loading ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return wrap(lib);
    },
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
};
