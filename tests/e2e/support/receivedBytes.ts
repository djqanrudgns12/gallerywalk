import type { BrowserContext, Request, Response } from '@playwright/test';
import { config } from '../../../packages/core/src/config.ts';

const validSize = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

/** CDP의 encodedDataLength 누락 시에도 0으로 성공시키지 않는다. Content-Length는 압축된 전송 본문 길이다. */
async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => null),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function responseSize(request: Request, response: Response) {
  // requestfinished가 와도 Playwright의 별도 CDP extra-info 약속(sizes)은 끝나지 않을 수 있다.
  // 종료 대기 예산의 일부만 사용하고, 실제 전송 길이를 가진 응답 머리로 복구한다.
  const size = await bounded(request.sizes(), config().API_TIMEOUT_MS / 2);
  if (size && validSize(size.responseBodySize) && validSize(size.responseHeadersSize))
    return { body: size.responseBodySize, headers: size.responseHeadersSize, fallback: false };
  const headers = await bounded(response.headersArray(), config().API_TIMEOUT_MS / 4);
  if (!headers) throw new Error('응답 머리 확인 시간 초과');
  const lengths = headers.filter(h => h.name.toLowerCase() === 'content-length');
  const length = lengths.length === 1 ? lengths[0]!.value : '';
  if (!/^\d+$/.test(length) || !validSize(Number(length))) throw new Error('전송 크기 근거 없음');
  // HTTP/1.1 머리 표현의 보수적 상계. 인증 머리·URL·본문은 반환하거나 기록하지 않는다.
  const headerBytes = Buffer.byteLength(
    `HTTP/1.1 ${response.status()} ${response.statusText()}\r\n` +
      headers.map(h => `${h.name}: ${h.value}\r\n`).join('') +
      '\r\n',
  );
  return {
    body: Number(length),
    headers: Math.max(
      headerBytes,
      size && validSize(size.responseHeadersSize) ? size.responseHeadersSize : 0,
    ),
    fallback: true,
  };
}

interface Diagnostic {
  readonly id: number;
  readonly kind: 'api' | 'media' | 'asset' | 'worker-script' | 'document';
  readonly worker: boolean;
  readonly startedMs: number;
  finishedMs: number | null;
  phase: 'request' | 'response' | 'size' | 'failed' | 'fallback';
  status: number | null;
}

/** 주소·인증·이름 대신 고정 범주와 일련번호만 기록한다. */
const requestKind = (request: Request): Diagnostic['kind'] => {
  const path = new URL(request.url()).pathname;
  if (path === '/sw.js') return 'worker-script';
  if (path.startsWith('/api/')) return 'api';
  if (path.startsWith('/media/') || path.startsWith('/assets/g/m/')) return 'media';
  if (path.startsWith('/assets/') || /\.(?:js|css|wasm|woff2|glb|ktx2)$/.test(path)) return 'asset';
  return 'document';
};

/** HTTP 응답의 인코딩된 본문과 머리. SW가 화면에 전달한 응답은 실제 네트워크 요청 쪽에서만 센다. */
export function measureReceivedBytes(context: BrowserContext) {
  const pending = new Map<Request, { done: Promise<void>; resolve: () => void; diagnostic: Diagnostic }>();
  let nextId = 0;
  let closed = false;
  const startedAt = performance.now();
  const elapsed = (): number => Math.round(performance.now() - startedAt);
  const result = {
    bodyBytes: 0,
    headerBytes: 0,
    totalBytes: 0,
    networkRequests: 0,
    workerRequests: 0,
    workerScriptRequests: 0,
    forwardedResponses: 0,
    failedRequests: 0,
    sizeFallbacks: 0,
    errors: [] as string[],
    diagnostics: [] as Diagnostic[],
  };
  const begin = (request: Request): void => {
    if (!/^https?:/.test(request.url())) return;
    let resolve = (): void => {};
    const done = new Promise<void>(finish => {
      resolve = finish;
    });
    pending.set(request, {
      done,
      resolve,
      diagnostic: {
        id: ++nextId,
        kind: requestKind(request),
        worker: !!request.serviceWorker(),
        startedMs: elapsed(),
        finishedMs: null,
        phase: 'request',
        status: null,
      },
    });
  };
  const finish = async (request: Request, failed: boolean): Promise<void> => {
    const item = pending.get(request);
    if (!item || closed) return;
    item.diagnostic.finishedMs = elapsed();
    try {
      if (failed) {
        result.failedRequests++;
        result.diagnostics.push({ ...item.diagnostic, phase: 'failed' });
        return;
      }
      item.diagnostic.phase = 'response';
      // Chromium은 SW 주 스크립트에서 response 없이 requestfinished를 내기도 한다.
      // 실제 종료와 Playwright 메타데이터 대기를 구분하고, 끝없는 약속을 남겨 기다리지 않는다.
      const response = await bounded(request.response(), config().API_TIMEOUT_MS / 4);
      if (closed) return;
      if (!response) throw new Error('응답 없음');
      if (response.fromServiceWorker()) {
        result.forwardedResponses++;
        return;
      }
      item.diagnostic.phase = 'size';
      item.diagnostic.status = response.status();
      const size = await responseSize(request, response);
      if (closed) return;
      if (size.fallback) {
        result.sizeFallbacks++;
        result.diagnostics.push({ ...item.diagnostic, phase: 'fallback' });
      }
      result.bodyBytes += size.body;
      result.headerBytes += size.headers;
      result.totalBytes = result.bodyBytes + result.headerBytes;
      result.networkRequests++;
      if (request.serviceWorker()) result.workerRequests++;
      if (new URL(request.url()).pathname === '/sw.js') result.workerScriptRequests++;
    } catch {
      // URL·본문·인증 머리는 기록하지 않는다.
      if (!closed) {
        result.errors.push(
          item.diagnostic.phase === 'response'
            ? '종료된 HTTP 요청의 응답 메타데이터 확인 실패'
            : 'HTTP 응답 크기 확인 실패',
        );
        result.diagnostics.push({ ...item.diagnostic });
      }
    } finally {
      pending.delete(request);
      item.resolve();
    }
  };
  const finished = (request: Request): void => {
    void finish(request, false);
  };
  const failed = (request: Request): void => {
    void finish(request, true);
  };
  context.on('request', begin);
  context.on('requestfinished', finished);
  context.on('requestfailed', failed);
  return {
    /** 입장 완료 전 시작된 요청은 끝까지 센다(진행 중 응답을 누락하지 않는 보수적 상계). */
    async stop() {
      context.off('request', begin);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([...pending.values()].map(item => item.done)),
          new Promise<void>(resolve => {
            timer = setTimeout(() => {
              result.errors.push('입장 전 시작된 HTTP 요청의 종료 대기 시간 초과');
              result.diagnostics.push(...[...pending.values()].map(item => ({ ...item.diagnostic })));
              resolve();
            }, config().API_TIMEOUT_MS);
          }),
        ]);
      } finally {
        closed = true;
        clearTimeout(timer);
        context.off('requestfinished', finished);
        context.off('requestfailed', failed);
      }
      return {
        ...result,
        errors: [...result.errors],
        diagnostics: result.diagnostics.map(item => ({ ...item })),
      };
    },
  };
}
