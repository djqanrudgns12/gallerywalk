import type { MiddlewareHandler } from 'hono';
import { AppError } from '@gallery/core/errors';
import type { AppEnv } from './types.ts';

/**
 * 끝내기용 요청 세기(PLAN §9.1 "새 요청 거부 → 처리 중인 것은 기다림").
 * `beginDrain()` 뒤에 오는 요청은 `E_BUSY`(다시 시도 가능) + `Connection: close`로 돌려보내고,
 * 이미 들어온 요청(업로드는 처리가 끝난 뒤 응답하므로 처리 중인 작품 포함)이 끝나기를 `waitIdle`로 기다린다.
 * 요청은 응답 본문이 다 나가거나(받는 쪽이 끊거나) 해야 끝난 것으로 센다(흘려보내는 미디어).
 */
export interface Lifecycle {
  readonly middleware: MiddlewareHandler<AppEnv>;
  readonly inFlight: () => number;
  readonly draining: () => boolean;
  beginDrain(): void;
  /** 처리 중인 요청이 0이 되면 true, 시간이 다 되면 false */
  waitIdle(timeoutMs: number): Promise<boolean>;
}

export function createLifecycle(): Lifecycle {
  let inFlight = 0;
  let draining = false;
  const idleWaiters = new Set<() => void>();

  const middleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (draining) {
      c.header('Connection', 'close');
      throw new AppError('E_BUSY');
    }
    inFlight += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      inFlight -= 1;
      if (inFlight === 0) for (const wake of [...idleWaiters]) wake();
    };
    try {
      await next();
    } catch (err) {
      release();
      throw err;
    }
    const body = c.res.body;
    if (!body) {
      release();
      return;
    }
    // 본문이 다 나가거나 받는 쪽이 끊을 때까지 처리 중으로 센다 — 처리기는 응답을 돌려줬어도 큰 미디어는 아직 흘러가는 중이라,
    // 여기서 빼면 끝내기 대기가 전송 도중에 풀린다(P3-7 보고)
    const reader = body.getReader();
    const counted = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            ctrl.close();
            release();
          } else ctrl.enqueue(value);
        } catch (err) {
          ctrl.error(err);
          release();
        }
      },
      async cancel(reason) {
        release();
        await reader.cancel(reason);
      },
    });
    c.res = new Response(counted, c.res);
  };

  return {
    middleware,
    inFlight: () => inFlight,
    draining: () => draining,
    beginDrain: () => {
      draining = true;
    },
    waitIdle: timeoutMs =>
      inFlight === 0
        ? Promise.resolve(true)
        : new Promise<boolean>(resolve => {
            const finish = (idle: boolean): void => {
              clearTimeout(timer);
              idleWaiters.delete(onIdle);
              resolve(idle);
            };
            const onIdle = (): void => finish(true);
            const timer = setTimeout(() => finish(false), timeoutMs);
            idleWaiters.add(onIdle);
          }),
  };
}
