import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyRequest } from './routes.ts';
import { rangeResponse } from './range.ts';
import { createWorker, exhibitionCacheName } from './runtime.ts';
import { EX, ORIGIN, fakeCaches, fakeStore, json, mediaUrl, ok, view } from './testSupport.ts';

const api = () => new Request(`${ORIGIN}/api/e/123456`);
const request = (range?: string) => new Request(mediaUrl, range ? { headers: { Range: range } } : {});
const setup = () => {
  const caches = fakeCaches();
  const store = fakeStore();
  const pending: Promise<unknown>[] = [];
  const fetch = vi.fn<(req: Request) => Promise<Response>>(async () => ok());
  let now = 1000;
  const worker = createWorker({
    origin: ORIGIN,
    caches,
    store,
    fetch,
    now: () => now,
    shellVersion: 'test',
    shellUrls: ['/', '/assets/g/app-test.js'],
  });
  return {
    caches,
    store,
    fetch,
    worker,
    pending,
    advance: (t: number) => {
      now = t;
    },
    get: (req: Request) =>
      worker.handle(req, p => {
        pending.push(p);
      }),
  };
};
afterEach(() => vi.useRealTimers());

describe('주소와 Range', () => {
  it('공개 GET만 다루며 교사·쓰기·함께 관람·개발·다른 출처는 지나간다', () => {
    expect(classifyRequest(api(), ORIGIN)).toEqual({ kind: 'exhibition', code: '123456' });
    expect(classifyRequest(request(), ORIGIN)).toEqual({ kind: 'media', exhibitionId: EX, audio: true });
    expect(classifyRequest(new Request(`${ORIGIN}/assets/g/core-hash.glb`), ORIGIN)).toEqual({
      kind: 'asset',
    });
    expect(classifyRequest(new Request(`${ORIGIN}/123456`), ORIGIN)).toEqual({ kind: 'shell' });
    for (const path of [
      '/api/teacher/me',
      '/api/e/123456/live',
      '/api/e/123456/v',
      '/dev/seam',
      '/sw.js',
      '/unknown',
    ])
      expect(classifyRequest(new Request(`${ORIGIN}${path}`), ORIGIN)).toEqual({ kind: 'pass' });
    expect(classifyRequest(new Request(api(), { method: 'POST' }), ORIGIN)).toEqual({ kind: 'pass' });
    expect(classifyRequest(new Request('https://other.test/assets/g/a.js'), ORIGIN)).toEqual({
      kind: 'pass',
    });
  });
  it.each([
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-99', '89', 'bytes 8-9/10'],
  ])('%s는 실제 바이트와 길이·Content-Range를 맞춘다', async (header, body, contentRange) => {
    const result = await rangeResponse(
      new Response('0123456789', { headers: { 'Content-Type': 'audio/mp4' } }),
      header,
    );
    expect(result?.status).toBe(206);
    expect(result?.headers.get('Content-Range')).toBe(contentRange);
    expect(result?.headers.get('Content-Length')).toBe(String(body.length));
    expect(result?.headers.get('Content-Type')).toBe('audio/mp4');
    expect(await result?.text()).toBe(body);
  });
  it.each(['bytes=10-', 'bytes=6-2', 'bytes=-0'])('%s는 416', async header => {
    const result = await rangeResponse(new Response('0123456789'), header);
    expect(result?.status).toBe(416);
    expect(result?.headers.get('Content-Range')).toBe('bytes */10');
  });
  it('다중·깨진 Range는 네트워크가 판단한다', async () => {
    expect(await rangeResponse(new Response('abc'), 'bytes=0-1,2-3')).toBeNull();
    expect(await rangeResponse(new Response('abc'), 'oops')).toBeNull();
  });
});

describe('전시 캐시 정책', () => {
  it('CacheStorage가 막혀도 네트워크 앱 파일을 돌려준다', async () => {
    const worker = createWorker({
      origin: ORIGIN,
      caches: {
        open: async () => {
          throw new Error('storage blocked');
        },
        keys: async () => [],
        delete: async () => false,
      },
      store: fakeStore(),
      fetch: async () => new Response('script'),
      now: () => 1000,
      shellVersion: 'test',
      shellUrls: [],
    });
    expect(await (await worker.handle(new Request(`${ORIGIN}/assets/g/app.js`))).text()).toBe('script');
  });
  it('전체 200 소리도 캐시 쓰기를 기다리지 않고 재생 응답을 내준다', async () => {
    const caches = fakeCaches();
    const realOpen = caches.open;
    let release: (() => void) | undefined;
    caches.open = async name => {
      const bucket = await realOpen(name);
      return {
        ...bucket,
        put: async (req, res) => {
          if (req.url === mediaUrl)
            await new Promise<void>(resolve => {
              release = resolve;
            });
          await bucket.put(req, res);
        },
      };
    };
    const worker = createWorker({
      origin: ORIGIN,
      caches,
      store: fakeStore(),
      fetch: async req => (req.url === mediaUrl ? new Response('song') : ok()),
      now: () => 1000,
      shellVersion: 'test',
      shellUrls: [],
    });
    await worker.handle(api());
    const pending: Promise<unknown>[] = [];
    let delivered = false;
    const response = worker
      .handle(request(), p => {
        pending.push(p);
      })
      .then(res => {
        delivered = true;
        return res;
      });
    await vi.waitFor(() => expect(release).toBeDefined());
    try {
      expect(delivered).toBe(true);
      const cleanup = worker.message({ type: 'APP_START' });
      const result = await Promise.race([
        cleanup,
        new Promise<'blocked'>(resolve => {
          setTimeout(() => resolve('blocked'), 0);
        }),
      ]);
      expect(result).toEqual({ kind: 'DONE' });
    } finally {
      release?.();
    }
    expect(await (await response).text()).toBe('song');
    await Promise.all(pending);
    expect(await (await (await caches.open(exhibitionCacheName(EX))).match(request()))?.text()).toBe('song');
  });
  it('실제 quota 쓰기 실패를 미리 받기 NO_SPACE로 알린다', async () => {
    const worker = createWorker({
      origin: ORIGIN,
      caches: {
        open: async () => ({
          match: async () => undefined,
          delete: async () => false,
          put: async () => {
            throw new DOMException('full', 'QuotaExceededError');
          },
        }),
        keys: async () => [],
        delete: async () => false,
      },
      store: fakeStore(),
      fetch: async () => new Response('asset'),
      now: () => 1000,
      shellVersion: 'test',
      shellUrls: [],
    });
    expect(await worker.message({ type: 'PRELOAD_URL', url: '/assets/g/core.glb' })).toEqual({
      kind: 'NO_SPACE',
    });
  });
  it('삭제 뒤 오래된 화면이 보낸 미리 받기 알림으로 전시를 되살리지 않는다', async () => {
    const s = setup();
    await s.get(api());
    s.fetch.mockResolvedValue(
      json({ error: { code: 'E_NOT_FOUND', message: 'gone', retryable: false } }, 404),
    );
    await s.get(api());
    expect(
      await s.worker.message({ type: 'REMEMBER_EXHIBITION', exhibitionId: EX, expiresAt: 10_000 }),
    ).toEqual({ kind: 'FAILED' });
    expect(await s.store.list()).toEqual([]);
  });
  it('같은 입장 코드가 새 전시로 바뀌면 이전 공개 응답과 연결을 끊는다', async () => {
    const s = setup();
    await s.get(api());
    const next = view();
    next.exhibition.id = EX.replace(/1$/, '9');
    s.fetch.mockResolvedValue(json({ data: next, requestId: 'new' }));
    await s.get(api());
    s.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await s.get(api())).json()).toMatchObject({
      data: { exhibition: { id: next.exhibition.id } },
    });
    expect((await s.store.list()).find(r => r.exhibitionId === EX)?.codes).toEqual([]);
    expect(await (await s.caches.open(exhibitionCacheName(EX))).match(api())).toBeUndefined();
  });
  it('성공 응답을 보관하고 소리 전체 200으로 이후 Range 206을 만든다', async () => {
    const s = setup();
    await s.get(api());
    s.fetch.mockImplementation(async req =>
      req.headers.has('Range')
        ? new Response('23', { status: 206, headers: { 'Content-Type': 'audio/mp4' } })
        : new Response('0123456789', { headers: { 'Content-Type': 'audio/mp4' } }),
    );
    expect((await s.get(request('bytes=2-3'))).status).toBe(206);
    await Promise.all(s.pending);
    expect(s.fetch.mock.calls.map(([r]) => r.headers.get('Range'))).toEqual([null, 'bytes=2-3', null]);
    s.fetch.mockRejectedValue(new Error('offline'));
    const result = await s.get(request('bytes=4-7'));
    expect(result.status).toBe(206);
    expect(result.headers.get('Content-Range')).toBe('bytes 4-7/10');
    expect(result.headers.get('Content-Length')).toBe('4');
    expect(await result.text()).toBe('4567');
    expect((await s.get(request('bytes=50-'))).status).toBe(416);
  });
  it('받지 않은 그림 Range는 네트워크로 보내고 206은 저장하지 않는다', async () => {
    const s = setup();
    await s.get(api());
    const req = new Request(mediaUrl.replace('audio.m4a', 'wall.webp'), { headers: { Range: 'bytes=0-1' } });
    s.fetch.mockResolvedValue(new Response('ab', { status: 206 }));
    await s.get(req);
    const cache = await s.caches.open(exhibitionCacheName(EX));
    expect(await cache.match(new Request(req.url))).toBeUndefined();
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });
  it.each(['activate', 'APP_START', 'SCREEN_RESUME', 'media'] as const)(
    '%s 때 만료 응답·미디어를 지운다',
    async trigger => {
      const s = setup();
      await s.get(api());
      const cache = await s.caches.open(exhibitionCacheName(EX));
      await cache.put(request(), new Response('private copy'));
      s.advance(10_000);
      s.fetch.mockResolvedValue(
        json({ error: { code: 'E_NOT_FOUND', message: 'gone', retryable: false } }, 404),
      );
      if (trigger === 'activate') await s.worker.activate();
      else if (trigger === 'media') await s.get(request());
      else await s.worker.message({ type: trigger });
      expect(await s.caches.keys()).not.toContain(exhibitionCacheName(EX));
      expect(await s.store.list()).toEqual([]);
    },
  );
  it('E_NOT_FOUND면 그 전시만 즉시 지운다', async () => {
    const s = setup();
    await s.get(api());
    await s.caches.open('unrelated');
    s.fetch.mockResolvedValue(
      json({ error: { code: 'E_NOT_FOUND', message: 'gone', retryable: false } }, 404),
    );
    expect((await s.get(api())).status).toBe(404);
    expect(await s.caches.keys()).toEqual(['unrelated']);
    expect(await s.store.list()).toEqual([]);
  });
  it.each([404, 410])('미디어 %s면 전시 캐시를 지우고 응답을 보관하지 않는다', async status => {
    const s = setup();
    await s.get(api());
    s.fetch.mockResolvedValue(new Response(null, { status }));
    expect((await s.get(request())).status).toBe(status);
    expect(await s.caches.keys()).not.toContain(exhibitionCacheName(EX));
    expect(await s.store.list()).toEqual([]);
  });
  it('응답 본문까지 3초 제한을 적용하고 마지막 응답을 쓴다', async () => {
    const s = setup();
    await s.get(api());
    vi.useFakeTimers();
    s.fetch.mockResolvedValue(
      new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } }),
    );
    const next = s.get(api());
    await vi.advanceTimersByTimeAsync(3000);
    expect(await (await next).json()).toMatchObject({ data: { exhibition: { id: EX } } });
  });
  it('5xx·연결 실패는 대체하지만 닫힘·깨진 성공 응답은 대신하지 않는다', async () => {
    const s = setup();
    await s.get(api());
    s.fetch.mockResolvedValue(new Response(null, { status: 503 }));
    expect((await s.get(api())).status).toBe(200);
    s.fetch.mockRejectedValue(new Error('offline'));
    expect((await s.get(api())).status).toBe(200);
    s.fetch.mockResolvedValue(
      json({ error: { code: 'E_EXHIBITION_CLOSED', message: 'closed', retryable: false } }, 409),
    );
    expect((await s.get(api())).status).toBe(409);
    s.fetch.mockResolvedValue(json({ data: { bad: true }, requestId: 'bad' }));
    await s.get(api());
    s.fetch.mockRejectedValue(new Error('offline'));
    expect((await s.get(api())).type).toBe('error');
  });
  it('아직 만료를 모르는 미디어와 만료된 공개 응답은 저장하지 않는다', async () => {
    const s = setup();
    s.fetch.mockResolvedValue(new Response('image'));
    await s.get(request());
    expect(await s.caches.keys()).toEqual([]);
    s.fetch.mockResolvedValue(ok(500));
    await s.get(api());
    expect(await s.store.list()).toEqual([]);
  });
  it('삭제 중 늦게 온 미디어 응답으로 캐시를 되살리지 않는다', async () => {
    const s = setup();
    await s.get(api());
    let deliver: ((res: Response) => void) | undefined;
    s.fetch.mockImplementation(req =>
      req.url === mediaUrl
        ? new Promise(resolve => {
            deliver = resolve;
          })
        : Promise.resolve(json({ error: { code: 'E_NOT_FOUND', message: 'gone', retryable: false } }, 404)),
    );
    const late = s.get(request());
    await vi.waitFor(() => expect(deliver).toBeDefined());
    await s.get(api());
    deliver?.(new Response('late'));
    await late;
    expect(await s.caches.keys()).not.toContain(exhibitionCacheName(EX));
  });
  it('앱 껍데기와 해시 파일을 설치하고 오프라인 입장 주소에도 같은 HTML을 쓴다', async () => {
    const s = setup();
    s.fetch.mockImplementation(
      async req => new Response(req.url.endsWith('.js') ? 'script' : '<html>shell</html>'),
    );
    await s.worker.install();
    s.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await s.get(new Request(`${ORIGIN}/123456`))).text()).toBe('<html>shell</html>');
    expect(await (await s.get(new Request(`${ORIGIN}/assets/g/app-test.js`))).text()).toBe('script');
  });
});
