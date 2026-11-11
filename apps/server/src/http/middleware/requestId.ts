import type { MiddlewareHandler } from 'hono';
import type { Logger } from '../../log.ts';
import type { AppEnv } from '../types.ts';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * 맨 바깥 미들웨어(PLAN §9.3 첫째): 요청 ID를 만들고, 끝나면 접근 기록 한 줄을 남긴다.
 * 들어온 `X-Request-Id`는 믿지 않는다(기록에 남의 글이 섞이지 않게) — 늘 서버가 새로 만든다.
 */
export const requestId =
  (log: Logger): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const id = crypto.randomUUID();
    const started = performance.now();
    c.set('requestId', id);
    await next();
    c.header(REQUEST_ID_HEADER, id);
    log.info('request', {
      requestId: id,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
      exhibitionId: c.get('exhibitionId'),
      code: c.get('errorCode'),
    });
  };
