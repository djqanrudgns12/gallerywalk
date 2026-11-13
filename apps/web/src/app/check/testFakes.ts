import { mediaPath } from '@gallery/core/types';
import { checkLimits } from './limits.ts';
import type { CheckDeps, CheckUrls, Fetched, SocketProbe } from './steps.ts';

/**
 * 점검 시험 도구(시험 파일에서만 가져온다): 가짜 망·가짜 소켓. 걸리는 시간은 `setTimeout`으로 흉내 내므로
 * `vi.useFakeTimers()`와 함께 쓰면 가짜 시계로, 아니면 실제 시계로 돈다. 그림·글은 모두 합성.
 */

export const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

const filled = (head: readonly number[], size: number): Uint8Array => {
  const b = new Uint8Array(size);
  b.set(head);
  return b;
};

export const GLB_BODY = filled([0x67, 0x6c, 0x54, 0x46], 1_000_000);
export const WASM_BODY = filled([0x00, 0x61, 0x73, 0x6d], 300_000);
export const WEBP_BODY = (() => {
  const b = filled([0x52, 0x49, 0x46, 0x46], 20_000);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  return b;
})();
export const SHELL_HTML =
  '<!doctype html><html lang="ko"><head><script type="module" crossorigin src="/assets/g/app-abc123.js"></script>' +
  '<link rel="modulepreload" crossorigin href="/assets/g/Icon-x.js"></head><body><div id="root"></div></body></html>';
/** 학교 필터가 막을 때 흔히 주는 200 안내 페이지 */
export const BLOCK_PAGE = '<!doctype html><html><body><h1>Blocked</h1></body></html>';

export const EXHIBITION_ID = '11111111-1111-4111-8111-111111111111';
export const ASSET_ID = '22222222-2222-4222-8222-222222222222';
export const THUMB_URL = mediaPath(EXHIBITION_ID, ASSET_ID, { name: 'thumb', ext: 'webp' });
export const CODE = '482913';

export const URLS: CheckUrls = {
  health: '/api/health',
  shell: '/',
  space: '/assets/g/exterior-abc.glb',
  decoder: ['/assets/g/basis/basis_transcoder.js', '/assets/g/basis/basis_transcoder.wasm'],
  exhibition: code => `/api/e/${code}`,
  live: code => `wss://gallery.test/api/e/${code}/live`,
};

export interface Reply {
  readonly status?: number;
  readonly type: string;
  readonly body: Uint8Array;
  readonly delayMs?: number;
  readonly wireBytes?: number | null;
  readonly redirectedTo?: string | null;
}
/** `hang`: 끝내 답하지 않음(시간 상한 시험) · `neterr`: 망 오류(TypeError) */
export type Route = Reply | 'hang' | 'neterr';

const jsonReply = (value: unknown, delayMs: number, status = 200): Reply => ({
  status,
  type: 'application/json; charset=utf-8',
  body: enc(JSON.stringify(value)),
  delayMs,
});

/** 모두 되는 망: ① 100ms ② 50+150ms ③ 1MB 200ms(40Mbps) ④ 50+100ms ⑤ 80+60ms */
export const okRoutes = (): Record<string, Route> => ({
  '/api/health': jsonReply(
    { data: { ok: true, db: true, diskOk: true, queueLength: 0 }, requestId: 'req-1' },
    100,
  ),
  '/': { type: 'text/html; charset=utf-8', body: enc(SHELL_HTML), delayMs: 50 },
  '/assets/g/app-abc123.js': {
    type: 'text/javascript; charset=utf-8',
    body: enc('export {};'),
    delayMs: 150,
  },
  '/assets/g/exterior-abc.glb': { type: 'model/gltf-binary', body: GLB_BODY, delayMs: 200 },
  '/assets/g/basis/basis_transcoder.js': { type: 'text/javascript', body: enc('var BASIS;'), delayMs: 50 },
  '/assets/g/basis/basis_transcoder.wasm': { type: 'application/wasm', body: WASM_BODY, delayMs: 100 },
  [`/api/e/${CODE}`]: jsonReply(
    {
      data: {
        exhibition: { id: EXHIBITION_ID, title: 'Synthetic show', poster: null },
        artworks: [
          {
            image: {
              asset: {
                assetId: ASSET_ID,
                variants: [
                  { name: 'thumb', ext: 'webp', w: 320, h: 240, bytes: 20_000 },
                  { name: 'wall', ext: 'webp', w: 1600, h: 1200, bytes: 300_000 },
                ],
              },
            },
            pages: null,
          },
        ],
      },
      requestId: 'req-2',
    },
    80,
  ),
  [THUMB_URL]: { type: 'image/webp', body: WEBP_BODY, delayMs: 60 },
});

const NOT_FOUND = {
  error: { code: 'E_NOT_FOUND', message: 'not found', retryable: false },
  requestId: 'req-404',
};

export const fakeFetch = (routes: Readonly<Record<string, Route>>) => {
  const calls: string[] = [];
  const fetch = (url: string, signal: AbortSignal): Promise<Fetched> => {
    calls.push(url);
    const route = routes[url] ?? jsonReply(NOT_FOUND, 0, 404);
    if (route === 'neterr') return Promise.reject(new TypeError('Failed to fetch'));
    return new Promise<Fetched>((resolve, reject) => {
      const aborted = (): void => reject(new DOMException('aborted', 'AbortError'));
      if (route === 'hang') {
        signal.addEventListener('abort', aborted);
        return;
      }
      const id = setTimeout(
        () =>
          resolve({
            status: route.status ?? 200,
            contentType: route.type,
            body: route.body,
            wireBytes: route.wireBytes ?? null,
            redirectedTo: route.redirectedTo ?? null,
          }),
        route.delayMs ?? 0,
      );
      signal.addEventListener('abort', () => {
        clearTimeout(id);
        aborted();
      });
    });
  };
  return { fetch, calls };
};

/** 소켓: `{ openMs }` 뒤 열림 · `{ closeCode }` 열리기 전에 닫힘 · `hang` 아무 일 없음 */
export type LiveMode = { readonly openMs: number } | { readonly closeCode: number } | 'hang';

export const fakeSocket = (mode: LiveMode) => {
  const opened: string[] = [];
  const closes: (number | undefined)[] = [];
  const open = (url: string): SocketProbe => {
    opened.push(url);
    const probe: SocketProbe = {
      onopen: null,
      onerror: null,
      onclose: null,
      close: code => {
        closes.push(code);
      },
    };
    if (mode !== 'hang')
      setTimeout(
        () => {
          if ('openMs' in mode) probe.onopen?.();
          else {
            probe.onerror?.();
            probe.onclose?.({ code: mode.closeCode });
          }
        },
        'openMs' in mode ? mode.openMs : 10,
      );
    return probe;
  };
  return { open, opened, closes };
};

export interface FakeOptions {
  readonly routes?: Readonly<Record<string, Route>>;
  readonly live?: LiveMode;
  readonly webgl?: boolean;
}

export const fakeDeps = ({ routes = okRoutes(), live = { openMs: 80 }, webgl = true }: FakeOptions = {}) => {
  const net = fakeFetch(routes);
  const socket = fakeSocket(live);
  const deps: CheckDeps = {
    now: () => Date.now(),
    after: (ms, fn) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    fetch: net.fetch,
    openSocket: socket.open,
    webgl2: () => webgl,
    urls: URLS,
    limits: checkLimits(),
  };
  return { deps, calls: net.calls, socket };
};
