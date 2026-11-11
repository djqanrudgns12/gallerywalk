import { AppError } from '@gallery/core/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createHttp, dispositionFilename, type HttpFailure } from './http.ts';

const DEVICE = '00000000-0000-4000-8000-0000000000dd';
const TIMEOUT = 5000;

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** 전역 fetch를 가짜로(요청 기록) */
const stubFetch = (respond: (call: Call) => Response | Promise<Response>): Call[] => {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: String(input), init: init ?? {} };
      calls.push(call);
      return respond(call);
    }),
  );
  return calls;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const ok = (data: unknown) => json(200, { data, requestId: 'req-1' });
const errorEnvelope = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  json(status, { error: { code, message: 'x', retryable: false, ...extra }, requestId: 'req-2' });

const header = (call: Call | undefined, name: string) => new Headers(call?.init.headers).get(name);

const http = (over: Partial<Parameters<typeof createHttp>[0]> = {}) =>
  createHttp({ timeoutMs: TIMEOUT, deviceId: () => DEVICE, ...over });

/** 약속이 AppError로 거절되면 그것 */
const appError = async (p: Promise<unknown>): Promise<AppError> => {
  const err: unknown = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
};

const Thing = z.object({ n: z.number(), name: z.string().transform(s => s.toUpperCase()) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('성공 봉투', () => {
  it('data를 스키마로 검사해 출력 모양으로 돌려준다', async () => {
    stubFetch(() => ok({ n: 1, name: 'abc' }));
    await expect(http().json({ method: 'GET', path: '/x' }, Thing)).resolves.toEqual({ n: 1, name: 'ABC' });
  });

  it('data 모양이 틀림 · requestId 없음 · JSON 아님 → E_SERVER', async () => {
    stubFetch(() => ok({ n: 'one', name: 'abc' }));
    expect((await appError(http().json({ method: 'GET', path: '/x' }, Thing))).code).toBe('E_SERVER');

    stubFetch(() => json(200, { data: { n: 1, name: 'a' } }));
    expect((await appError(http().json({ method: 'GET', path: '/x' }, Thing))).code).toBe('E_SERVER');

    stubFetch(() => new Response('<html>ok</html>', { status: 200 }));
    const e = await appError(http().json({ method: 'GET', path: '/x' }, Thing));
    expect(e.code).toBe('E_SERVER');
    expect(e.retryable).toBe(true);
  });

  it('성공 상태인데 오류 봉투면 E_SERVER(모양 틀림)', async () => {
    stubFetch(() => errorEnvelope(200, 'E_AUTH'));
    expect((await appError(http().json({ method: 'GET', path: '/x' }, Thing))).code).toBe('E_SERVER');
  });
});

describe('오류 봉투', () => {
  it('code·fields를 AppError로, cause에 상태·requestId·retryable', async () => {
    stubFetch(() =>
      errorEnvelope(400, 'E_VALIDATION', { fields: { title: 'too_long', 'pin.0': 'pin_format' } }),
    );
    const e = await appError(http().json({ method: 'POST', path: '/x', body: {} }, Thing));
    expect(e.code).toBe('E_VALIDATION');
    expect(e.fields).toEqual({ title: 'too_long', 'pin.0': 'pin_format' });
    expect(e.retryable).toBe(false);
    expect(e.cause as HttpFailure).toEqual({ status: 400, requestId: 'req-2', retryable: false });
  });

  it('fields가 없으면 undefined, 다시 시도 가능한 코드는 retryable', async () => {
    stubFetch(() =>
      json(409, { error: { code: 'E_CONFLICT', message: 'conflict', retryable: true }, requestId: 'r' }),
    );
    const e = await appError(http().send({ method: 'PATCH', path: '/x', body: { a: 1 }, ifMatch: 3 }));
    expect(e.code).toBe('E_CONFLICT');
    expect(e.fields).toBeUndefined();
    expect(e.retryable).toBe(true);
  });

  it('봉투가 아닌 오류 응답(앞단 HTML 502 · 모르는 코드 · 빈 본문) → E_SERVER', async () => {
    stubFetch(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    const e = await appError(http().json({ method: 'GET', path: '/x' }, Thing));
    expect(e.code).toBe('E_SERVER');
    expect(e.retryable).toBe(true);

    stubFetch(() => errorEnvelope(400, 'E_SOMETHING_NEW'));
    expect((await appError(http().send({ method: 'GET', path: '/x' }))).code).toBe('E_SERVER');

    stubFetch(() => new Response(null, { status: 500 }));
    expect((await appError(http().send({ method: 'GET', path: '/x' }))).code).toBe('E_SERVER');
  });
});

describe('연결', () => {
  it('fetch가 거절(네트워크) → E_OFFLINE(다시 시도 가능)', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const e = await appError(http().json({ method: 'GET', path: '/x' }, Thing));
    expect(e.code).toBe('E_OFFLINE');
    expect(e.retryable).toBe(true);
    expect(e.cause).toBeInstanceOf(TypeError);
  });

  it('본문을 읽다 끊김 → E_OFFLINE', async () => {
    stubFetch(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.error(new TypeError('network'));
            },
          }),
          { status: 200 },
        ),
    );
    expect((await appError(http().json({ method: 'GET', path: '/x' }, Thing))).code).toBe('E_OFFLINE');
  });

  /** 신호가 멈출 때까지 답하지 않는 fetch(이미 멈춘 신호면 바로 거절 — 브라우저 fetch와 같게) */
  const hangingFetch = () =>
    stubFetch(
      ({ init }) =>
        new Promise<Response>((_, reject) => {
          const signal = init.signal;
          if (signal?.aborted) reject(signal.reason);
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
    );

  it('시간 제한(timeoutMs)을 넘기면 요청을 멈추고 E_OFFLINE(cause timeout)', async () => {
    vi.useFakeTimers();
    const calls = hangingFetch();
    const p = appError(http().json({ method: 'GET', path: '/x' }, Thing));
    await vi.advanceTimersByTimeAsync(TIMEOUT - 1);
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const e = await p;
    expect(e.code).toBe('E_OFFLINE');
    expect(e.cause).toBe('timeout');
    expect(calls[0]?.init.signal?.aborted).toBe(true);
  });

  it('부른 쪽이 signal로 멈추면 AppError가 아니라 그 AbortError', async () => {
    hangingFetch();
    const ctrl = new AbortController();
    const p = http().json({ method: 'GET', path: '/x', signal: ctrl.signal }, Thing);
    ctrl.abort();
    const err: unknown = await p.catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AppError);
    expect((err as DOMException).name).toBe('AbortError');

    const already = new AbortController();
    already.abort();
    const err2: unknown = await http()
      .send({ method: 'GET', path: '/x', signal: already.signal })
      .catch((e: unknown) => e);
    expect((err2 as DOMException).name).toBe('AbortError');
  });
});

describe('머리·경로·본문', () => {
  it('늘 X-Device-Id, 토큰·rev·본문이 있을 때만 Authorization·If-Match·Content-Type', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    await http().send({ method: 'GET', path: '/e/123456' });
    await http().send({
      method: 'PATCH',
      path: '/teacher/artworks/a',
      body: { title: '새 제목', author: null },
      token: 'tok',
      ifMatch: 7,
    });

    const [plain, full] = calls;
    expect(plain?.url).toBe('/api/e/123456');
    expect(plain?.init.method).toBe('GET');
    expect(header(plain, 'X-Device-Id')).toBe(DEVICE);
    expect(header(plain, 'Authorization')).toBeNull();
    expect(header(plain, 'If-Match')).toBeNull();
    expect(header(plain, 'Content-Type')).toBeNull();
    expect(plain?.init.body).toBeUndefined();

    expect(full?.url).toBe('/api/teacher/artworks/a');
    expect(full?.init.method).toBe('PATCH');
    expect(header(full, 'X-Device-Id')).toBe(DEVICE);
    expect(header(full, 'Authorization')).toBe('Bearer tok');
    expect(header(full, 'If-Match')).toBe('7');
    expect(header(full, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(String(full?.init.body))).toEqual({ title: '새 제목', author: null });
  });

  it('baseUrl을 바꿀 수 있고, 기기 ID는 부를 때마다 읽는다', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    let id = 'first';
    const h = http({ baseUrl: 'https://example.test/api', deviceId: () => id });
    await h.send({ method: 'GET', path: '/x' });
    id = 'second';
    await h.send({ method: 'GET', path: '/x' });
    expect(calls.map(c => [c.url, header(c, 'X-Device-Id')])).toEqual([
      ['https://example.test/api/x', 'first'],
      ['https://example.test/api/x', 'second'],
    ]);
  });
});

describe('send(돌려받을 값 없음)', () => {
  it('204 · 빈 본문 · data가 무엇이든 성공 봉투 → 끝', async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(http().send({ method: 'DELETE', path: '/x', ifMatch: 1 })).resolves.toBeUndefined();
    stubFetch(() => new Response('', { status: 200 }));
    await expect(http().send({ method: 'POST', path: '/x' })).resolves.toBeUndefined();
    stubFetch(() => ok({ count: 3 }));
    await expect(http().send({ method: 'POST', path: '/x' })).resolves.toBeUndefined();
    stubFetch(() => ok(null));
    await expect(http().send({ method: 'POST', path: '/x' })).resolves.toBeUndefined();
  });

  it('성공 상태인데 봉투가 아닌 본문 → E_SERVER', async () => {
    stubFetch(() => new Response('ok', { status: 200 }));
    expect((await appError(http().send({ method: 'POST', path: '/x' }))).code).toBe('E_SERVER');
    stubFetch(() => json(200, { data: 1 }));
    expect((await appError(http().send({ method: 'POST', path: '/x' }))).code).toBe('E_SERVER');
  });
});

describe('file(내려받기)', () => {
  it('본문을 Blob으로, Content-Disposition의 파일 이름(RFC 5987 먼저)', async () => {
    stubFetch(
      () =>
        new Response('\uFEFF"작품"\r\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="reactions.csv"; filename*=UTF-8''${encodeURIComponent('반응_우리 반_20261111.csv')}`,
          },
        }),
    );
    const f = await http().file({ method: 'GET', path: '/x.csv', token: 't' });
    expect(f.filename).toBe('반응_우리 반_20261111.csv');
    // 엑셀 한글용 BOM이 바이트 그대로 남는다(`Blob.text()`는 UTF-8로 풀며 BOM을 떼어 낸다)
    const bytes = new Uint8Array(await f.blob.arrayBuffer());
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(await f.blob.text()).toBe('"작품"\r\n');
  });

  it('실패 응답은 같은 오류 봉투', async () => {
    stubFetch(() => errorEnvelope(401, 'E_AUTH'));
    expect((await appError(http().file({ method: 'GET', path: '/x.csv' }))).code).toBe('E_AUTH');
  });

  it('dispositionFilename', () => {
    expect(dispositionFilename(null)).toBeNull();
    expect(dispositionFilename('attachment')).toBeNull();
    expect(dispositionFilename('attachment; filename="a b.csv"')).toBe('a b.csv');
    expect(dispositionFilename('attachment; filename=plain.csv')).toBe('plain.csv');
    expect(dispositionFilename(`attachment; filename*=utf-8''%ED%95%9C.csv`)).toBe('한.csv');
    expect(dispositionFilename(`attachment; filename*=UTF-8''%E0%A4; filename="fallback.csv"`)).toBe(
      'fallback.csv',
    );
  });
});
