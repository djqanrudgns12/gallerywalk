import { ApiErrorSchema, ExhibitionViewSchema, okEnvelope } from '@gallery/core/types';
import { z } from 'zod';
import { SW_API_TIMEOUT_MS, SW_EXHIBITION_PREFIX, SW_SHELL_PREFIX } from './constants.ts';
import { WorkerMessageSchema, type WorkerReply } from './protocol.ts';
import { rangeResponse } from './range.ts';
import { classifyRequest } from './routes.ts';
import type { ExhibitionRecord, ExhibitionStore } from './store.ts';

export interface CacheBucket {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}
export interface CacheBackend {
  open(name: string): Promise<CacheBucket>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}
export interface WorkerDeps {
  readonly origin: string;
  readonly caches: CacheBackend;
  readonly store: ExhibitionStore;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly now: () => number;
  readonly shellVersion: string;
  readonly shellUrls: readonly string[];
}
export const exhibitionCacheName = (id: string): string => `${SW_EXHIBITION_PREFIX}${id}`;
const ViewEnvelope = okEnvelope(ExhibitionViewSchema);
const isGone = (res: Response): boolean => res.status === 404 || res.status === 410;
const QuotaErrorSchema = z.object({ name: z.literal('QuotaExceededError') });
const isQuotaError = (error: unknown): boolean => QuotaErrorSchema.safeParse(error).success;

/** 브라우저 전역 없이 정책을 조합한다. 저장 실패는 관람 응답을 막지 않되 미리 받기는 실패로 알린다. */
export const createWorker = (deps: WorkerDeps) => {
  const shellName = `${SW_SHELL_PREFIX}${deps.shellVersion}`;
  const key = (url: string): Request => new Request(new URL(url, deps.origin), { credentials: 'omit' });
  const generations = new Map<string, number>();
  const fullAudio = new Map<string, Promise<void>>();
  let queue: Promise<unknown> = Promise.resolve();
  const locked = <T>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const recordFor = async (id: string): Promise<ExhibitionRecord | undefined> =>
    (await deps.store.list()).find(r => r.exhibitionId === id);
  const purge = async (id: string): Promise<void> => {
    generations.set(id, (generations.get(id) ?? 0) + 1);
    await deps.caches.delete(exhibitionCacheName(id));
    await deps.store.delete(id);
  };
  const clean = async (only?: string): Promise<void> => {
    for (const record of await deps.store.list())
      if ((only === undefined || record.exhibitionId === only) && record.expiresAt <= deps.now())
        await purge(record.exhibitionId);
  };
  const safeClean = async (only?: string): Promise<void> => {
    await locked(() => clean(only)).catch(() => {});
  };
  const safeMatch = async (name: string, req: Request): Promise<Response | undefined> => {
    try {
      if (!(await deps.caches.keys()).includes(name)) return undefined;
      return await (await deps.caches.open(name)).match(req);
    } catch {
      return undefined;
    }
  };
  const remember = async (id: string, expiresAt: number, code?: string): Promise<void> => {
    if (expiresAt <= deps.now()) {
      await purge(id);
      return;
    }
    const previous = await recordFor(id);
    if (code === undefined && !previous && generations.has(id)) throw new Error('exhibition purged');
    // 오래된 화면 메시지로 만료를 연장하지 않는다. 서버 응답만 최신 값이다.
    const expiry = code === undefined && previous ? Math.min(previous.expiresAt, expiresAt) : expiresAt;
    if (code !== undefined) {
      for (const other of await deps.store.list()) {
        if (other.exhibitionId === id || !other.codes.includes(code)) continue;
        await (await deps.caches.open(exhibitionCacheName(other.exhibitionId))).delete(key(`/api/e/${code}`));
        await deps.store.put({ ...other, codes: other.codes.filter(c => c !== code) });
      }
    }
    await deps.store.put({
      exhibitionId: id,
      expiresAt: expiry,
      codes: [...new Set([...(previous?.codes ?? []), ...(code === undefined ? [] : [code])])],
    });
  };

  const cachedApi = async (req: Request, code: string): Promise<Response | undefined> =>
    locked(async () => {
      await clean();
      const record = (await deps.store.list()).find(r => r.codes.includes(code));
      if (!record) return undefined;
      return safeMatch(exhibitionCacheName(record.exhibitionId), key(req.url));
    }).catch(() => undefined);

  const exhibition = async (req: Request, code: string): Promise<Response> => {
    const controller = new AbortController();
    const abort = () => controller.abort(req.signal.reason);
    req.signal.addEventListener('abort', abort, { once: true });
    if (req.signal.aborted) abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // fetch가 머리만 준 뒤 멎는 경우도 제한한다. 시간 초과 뒤 늦은 성공은 저장하지 않는다.
      const exchange = (async () => {
        const res = await deps.fetch(new Request(req, { signal: controller.signal, cache: 'no-store' }));
        const body: unknown = await res
          .clone()
          .json()
          .catch(() => null);
        return { res, body };
      })();
      const result = await Promise.race([
        exchange,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('api timeout'));
          }, SW_API_TIMEOUT_MS);
        }),
      ]);
      const { res, body } = result;
      if (res.status >= 500) return (await cachedApi(req, code)) ?? res;
      await locked(async () => {
        const old = (await deps.store.list()).find(r => r.codes.includes(code));
        const error = ApiErrorSchema.safeParse(body);
        if (!res.ok && error.success && error.data.error.code === 'E_NOT_FOUND') {
          if (old) await purge(old.exhibitionId);
          return;
        }
        const parsed = res.status === 200 ? ViewEnvelope.safeParse(body) : null;
        if (!parsed?.success) {
          if (old) await (await deps.caches.open(exhibitionCacheName(old.exhibitionId))).delete(key(req.url));
          return;
        }
        const { id, expiresAt } = parsed.data.data.exhibition;
        await remember(id, expiresAt, code);
        if (expiresAt > deps.now())
          await (await deps.caches.open(exhibitionCacheName(id))).put(key(req.url), res.clone());
      }).catch(() => {});
      return res;
    } catch {
      if (req.signal.aborted) return Response.error();
      return (await cachedApi(req, code)) ?? Response.error();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      req.signal.removeEventListener('abort', abort);
    }
  };

  const storeMedia = async (id: string, generation: number, req: Request, res: Response): Promise<void> => {
    if (res.status !== 200) return;
    const bucket = await locked(async () => {
      const record = await recordFor(id);
      if (!record || record.expiresAt <= deps.now() || generation !== (generations.get(id) ?? 0))
        return undefined;
      return deps.caches.open(exhibitionCacheName(id));
    });
    if (!bucket) return;
    // 전체 곡을 받아 쓰는 동안 정리 알림과 다음 Range 요청을 막지 않는다.
    await bucket.put(key(req.url), res.clone());
    await locked(async () => {
      const record = await recordFor(id);
      if (!record || record.expiresAt <= deps.now() || generation !== (generations.get(id) ?? 0))
        await bucket.delete(key(req.url));
    });
  };

  const warmAudio = (req: Request, id: string, generation: number): Promise<void> => {
    const existing = fullAudio.get(req.url);
    if (existing) return existing;
    const task = (async () => {
      const res = await deps.fetch(key(req.url));
      if (isGone(res)) await locked(() => purge(id));
      else await storeMedia(id, generation, req, res);
    })()
      .catch(() => {})
      .finally(() => {
        fullAudio.delete(req.url);
      });
    fullAudio.set(req.url, task);
    return task;
  };

  const media = async (
    req: Request,
    id: string,
    audio: boolean,
    waitUntil: (p: Promise<unknown>) => void,
    strict: boolean,
  ): Promise<Response> => {
    await safeClean(id);
    const generation = generations.get(id) ?? 0;
    const record = await recordFor(id).catch(() => undefined);
    const full =
      record && record.expiresAt > deps.now()
        ? await safeMatch(exhibitionCacheName(id), key(req.url))
        : undefined;
    const range = req.headers.get('Range');
    if (full?.status === 200) {
      if (!range) return full;
      const ifRange = req.headers.get('If-Range');
      if (ifRange && ifRange !== full.headers.get('ETag') && ifRange !== full.headers.get('Last-Modified'))
        return full;
      const partial = await rangeResponse(full.clone(), range);
      if (partial) return partial;
    }
    const res = await deps.fetch(req);
    if (isGone(res)) {
      await locked(() => purge(id)).catch(() => {});
      return res;
    }
    if (res.status === 200) {
      const save = storeMedia(id, generation, req, res);
      if (strict) await save;
      else waitUntil(save.catch(() => {}));
    }
    if (audio && res.status === 206 && record) waitUntil(warmAudio(req, id, generation));
    return res;
  };

  const asset = async (
    req: Request,
    strict: boolean,
    waitUntil: (p: Promise<unknown>) => void = () => {},
  ): Promise<Response> => {
    const cached = await safeMatch(shellName, key(req.url));
    if (cached?.status === 200) return cached;
    const res = await deps.fetch(req);
    if (res.status === 200 && !req.headers.has('Range')) {
      const save = (async () => {
        await (await deps.caches.open(shellName)).put(key(req.url), res.clone());
      })();
      if (strict) await save;
      else waitUntil(save.catch(() => {}));
    }
    return res;
  };

  const handle = async (
    req: Request,
    waitUntil: (p: Promise<unknown>) => void = () => {},
  ): Promise<Response> => {
    const route = classifyRequest(req, deps.origin);
    switch (route.kind) {
      case 'exhibition':
        return exhibition(req, route.code);
      case 'media':
        return media(req, route.exhibitionId, route.audio, waitUntil, false);
      case 'asset':
        return asset(req, false, waitUntil);
      case 'shell':
        return asset(key('/'), false, waitUntil);
      default:
        return deps.fetch(req);
    }
  };

  return {
    handle,
    install: async (): Promise<void> => {
      const cache = await deps.caches.open(shellName);
      for (const url of deps.shellUrls) {
        const req = new Request(key(url), { cache: 'reload' });
        const res = await deps.fetch(req);
        if (res.status !== 200) throw new Error(`precache ${res.status}`);
        await cache.put(key(url), res);
      }
    },
    activate: async (): Promise<void> => {
      await safeClean();
      for (const name of await deps.caches.keys()) {
        if (name.startsWith(SW_SHELL_PREFIX) && name !== shellName) await deps.caches.delete(name);
        if (name.startsWith(SW_EXHIBITION_PREFIX)) {
          const id = name.slice(SW_EXHIBITION_PREFIX.length);
          if (!(await recordFor(id))) await deps.caches.delete(name);
        }
      }
    },
    message: async (data: unknown): Promise<WorkerReply> => {
      const parsed = WorkerMessageSchema.safeParse(data);
      if (!parsed.success) return { kind: 'FAILED' };
      try {
        const message = parsed.data;
        if (message.type === 'APP_START' || message.type === 'SCREEN_RESUME') {
          await locked(() => clean());
          return { kind: 'DONE' };
        }
        if (message.type === 'REMEMBER_EXHIBITION') {
          await locked(() => remember(message.exhibitionId, message.expiresAt));
          return { kind: 'DONE' };
        }
        const req = key(message.url);
        const route = classifyRequest(req, deps.origin);
        let res: Response;
        if (route.kind === 'asset') res = await asset(req, true);
        else if (route.kind === 'media') {
          res = await media(req, route.exhibitionId, route.audio, () => {}, true);
          if (res.status !== 200) return { kind: 'FAILED' };
          if (!(await safeMatch(exhibitionCacheName(route.exhibitionId), req))) return { kind: 'FAILED' };
        } else return { kind: 'FAILED' };
        if (res.status !== 200) return { kind: 'FAILED' };
        return { kind: 'CACHED', bytes: (await res.arrayBuffer()).byteLength };
      } catch (error) {
        return { kind: isQuotaError(error) ? 'NO_SPACE' : 'FAILED' };
      }
    },
  };
};
