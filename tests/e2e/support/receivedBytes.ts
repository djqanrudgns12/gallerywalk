import type { BrowserContext, Request } from '@playwright/test';
import { config } from '../../../packages/core/src/config.ts';

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
      const size = await request.sizes();
      if (
        !Number.isFinite(size.responseBodySize) ||
        !Number.isFinite(size.responseHeadersSize) ||
        size.responseBodySize < 0 ||
        size.responseHeadersSize < 0
      )
        throw new Error('크기 형식');
      result.bodyBytes += size.responseBodySize;
      result.headerBytes += size.responseHeadersSize;
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
