import type { BrowserContext, Request, Response } from '@playwright/test';
import { config } from '../../../packages/core/src/config.ts';

const validSize = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

/** CDP의 encodedDataLength 누락 시에도 0으로 성공시키지 않는다. Content-Length는 압축된 전송 본문 길이다. */
async function responseSize(request: Request, response: Response) {
  const size = await request.sizes().catch(() => null);
  if (size && validSize(size.responseBodySize) && validSize(size.responseHeadersSize))
    return { body: size.responseBodySize, headers: size.responseHeadersSize, fallback: false };
  const headers = await response.headersArray();
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

/** HTTP 응답의 인코딩된 본문과 머리. SW가 화면에 전달한 응답은 실제 네트워크 요청 쪽에서만 센다. */
export function measureReceivedBytes(context: BrowserContext) {
  const pending = new Map<Request, { done: Promise<void>; resolve: () => void }>();
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
  };
  const begin = (request: Request): void => {
    if (!/^https?:/.test(request.url())) return;
    let resolve = (): void => {};
    const done = new Promise<void>(finish => {
      resolve = finish;
    });
    pending.set(request, { done, resolve });
  };
  const finish = async (request: Request, failed: boolean): Promise<void> => {
    const item = pending.get(request);
    if (!item) return;
    try {
      if (failed) {
        result.failedRequests++;
        return;
      }
      const response = await request.response();
      if (!response) throw new Error('응답 없음');
      if (response.fromServiceWorker()) {
        result.forwardedResponses++;
        return;
      }
      const size = await responseSize(request, response);
      if (size.fallback) result.sizeFallbacks++;
      result.bodyBytes += size.body;
      result.headerBytes += size.headers;
      result.totalBytes = result.bodyBytes + result.headerBytes;
      result.networkRequests++;
      if (request.serviceWorker()) result.workerRequests++;
      if (new URL(request.url()).pathname === '/sw.js') result.workerScriptRequests++;
    } catch {
      // URL·본문·인증 머리는 기록하지 않는다.
      result.errors.push('HTTP 응답 크기 확인 실패');
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
              resolve();
            }, config().API_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        context.off('requestfinished', finished);
        context.off('requestfailed', failed);
      }
      return { ...result, errors: [...result.errors] };
    },
  };
}
