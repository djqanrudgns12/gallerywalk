import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { overrideConfig, resetConfig } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { ApiErrorSchema, okEnvelope } from '@gallery/core/types';
import { readJson } from '../../src/http/validate.ts';
import {
  makeTempDir,
  makeTestApp,
  randomSecretHex,
  TEST_JSON_LIMIT_BYTES,
  type TestApp,
} from '../helpers/server.ts';

let root: string;
let t: TestApp;

beforeEach(async () => {
  root = await makeTempDir();
  t = await makeTestApp(root);
});
afterEach(async () => {
  resetConfig();
  t.log.close();
  if (t.db.open) t.db.close();
  await rm(root, { recursive: true, force: true });
});

const HealthSchema = okEnvelope(
  z.object({
    ok: z.boolean(),
    db: z.boolean(),
    diskOk: z.boolean(),
    queueLength: z.number().int().nonnegative(),
  }),
);

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob: data:; " +
  "media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function expectSecurityHeaders(res: Response): void {
  expect(res.headers.get('content-security-policy')).toBe(EXPECTED_CSP);
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('permissions-policy')).toBe(
    'camera=(), microphone=(), geolocation=(), fullscreen=(self), screen-wake-lock=(self)',
  );
  expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
}

async function errorOf(res: Response) {
  const body: unknown = await res.json();
  const parsed = ApiErrorSchema.parse(body);
  expect(parsed.requestId).toBe(res.headers.get('x-request-id'));
  return parsed;
}

describe('건강 확인', () => {
  it('DB 열림·디스크 남은 공간·대기열 길이를 돌려준다', async () => {
    const res = await t.app.request('/api/health');
    expect(res.status).toBe(200);
    const body = HealthSchema.parse(await res.json());
    expect(body.data).toMatchObject({ ok: true, db: true, diskOk: true, queueLength: 0 });
    expect(body.data.diskOk).toBe(true);
    // 공개 경로라 남은 바이트 수는 내지 않는다
    expect(Object.keys(body.data)).not.toContain('diskFreeBytes');
    expect(body.requestId).toBe(res.headers.get('x-request-id'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expectSecurityHeaders(res);
  });

  it('대기열 길이는 주입한 값을 그대로 보인다', async () => {
    const other = await makeTestApp(root, () => 4);
    const body = HealthSchema.parse(await (await other.app.request('/api/health')).json());
    expect(body.data.queueLength).toBe(4);
    other.log.close();
    other.db.close();
  });

  it('DB가 닫혔거나 디스크 여유가 기준보다 적으면 503', async () => {
    overrideConfig({ DISK_FREE_MIN_GB: Number.MAX_SAFE_INTEGER });
    const lowDisk = await t.app.request('/api/health');
    expect(lowDisk.status).toBe(503);
    expect(HealthSchema.parse(await lowDisk.json()).data).toMatchObject({
      ok: false,
      db: true,
      diskOk: false,
    });
    resetConfig();

    t.db.close();
    const closed = await t.app.request('/api/health');
    expect(closed.status).toBe(503);
    expect(HealthSchema.parse(await closed.json()).data).toMatchObject({ ok: false, db: false });
  });
});

describe('오류 봉투', () => {
  beforeEach(() => {
    t.app.get('/api/test/app-error', () => {
      throw new AppError('E_CONFLICT');
    });
    t.app.get('/api/test/app-error-fields', () => {
      throw new AppError('E_PIN_INVALID', { fields: { pin: 'mismatch' } });
    });
    t.app.post('/api/test/zod', async c => {
      const body = await readJson(c, z.object({ title: z.string().min(1), order: z.number().int() }));
      return c.json({ data: body, requestId: c.get('requestId') });
    });
    t.app.get('/api/test/crash', () => {
      throw new Error('database file /private/cause-detail is locked');
    });
    t.app.get('/api/test/http-exception', () => {
      throw new HTTPException(401);
    });
    t.app.get('/api/test/device-only', () => {
      throw new AppError('E_OFFLINE');
    });
  });

  it('AppError → errorCatalog의 http·retryable', async () => {
    const res = await t.app.request('/api/test/app-error');
    expect(res.status).toBe(409);
    expect((await errorOf(res)).error).toEqual({ code: 'E_CONFLICT', message: 'conflict', retryable: true });
    expectSecurityHeaders(res);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const withFields = await t.app.request('/api/test/app-error-fields');
    expect(withFields.status).toBe(401);
    expect((await errorOf(withFields)).error).toEqual({
      code: 'E_PIN_INVALID',
      message: 'pin invalid',
      retryable: true,
      fields: { pin: 'mismatch' },
    });
  });

  it('zod 오류 → E_VALIDATION + issueFields, 깨진 JSON → E_VALIDATION(_: json)', async () => {
    const res = await t.app.request('/api/test/zod', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '', order: 1.5 }),
    });
    expect(res.status).toBe(400);
    const { error } = await errorOf(res);
    expect(error.code).toBe('E_VALIDATION');
    expect(error.retryable).toBe(false);
    expect(Object.keys(error.fields ?? {}).sort()).toEqual(['order', 'title']);

    const broken = await t.app.request('/api/test/zod', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"title":',
    });
    expect(broken.status).toBe(400);
    expect((await errorOf(broken)).error.fields).toEqual({ _: 'json' });

    const ok = await t.app.request('/api/test/zod', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '가상 제목', order: 2 }),
    });
    expect(ok.status).toBe(200);
  });

  it('그 밖의 오류 → E_SERVER, 원인은 기록에만 있고 응답에는 없다', async () => {
    const res = await t.app.request('/api/test/crash');
    expect(res.status).toBe(500);
    const text = await res.clone().text();
    expect((await errorOf(res)).error).toEqual({ code: 'E_SERVER', message: 'server', retryable: true });
    expect(text).not.toContain('cause-detail');
    expect(text).not.toContain('stack');
    expectSecurityHeaders(res);

    const lines = (await t.logText())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    const unhandled = lines.find(line => line['msg'] === 'unhandled_error');
    expect(unhandled).toMatchObject({ level: 'error', code: 'E_SERVER', path: '/api/test/crash' });
    expect(JSON.stringify(unhandled)).toContain('cause-detail');
    expect(lines.find(line => line['msg'] === 'request')).toMatchObject({ status: 500, code: 'E_SERVER' });
  });

  it('Hono HTTPException 4xx는 가까운 코드로, 기기 전용 코드는 E_SERVER로', async () => {
    const auth = await t.app.request('/api/test/http-exception');
    expect(auth.status).toBe(401);
    expect((await errorOf(auth)).error.code).toBe('E_AUTH');

    const device = await t.app.request('/api/test/device-only');
    expect(device.status).toBe(500);
    expect((await errorOf(device)).error.code).toBe('E_SERVER');
  });

  it('없는 경로 → E_NOT_FOUND 봉투 + 보안 머리', async () => {
    const res = await t.app.request('/api/nope');
    expect(res.status).toBe(404);
    expect((await errorOf(res)).error).toEqual({
      code: 'E_NOT_FOUND',
      message: 'not found',
      retryable: false,
    });
    expectSecurityHeaders(res);

    const page = await t.app.request('/somewhere');
    expect(page.status).toBe(404);
    expectSecurityHeaders(page);
    expect(page.headers.get('cache-control')).toBeNull();
  });
});

describe('본문 크기 제한(JSON 64KB)', () => {
  const big = (bytes: number): string => JSON.stringify({ title: 'x'.repeat(bytes) });

  beforeEach(() => {
    t.app.post('/api/test/echo', async c => {
      const body = await readJson(c, z.object({ title: z.string() }));
      return c.json({ data: { length: body.title.length }, requestId: c.get('requestId') });
    });
    // 업로드 경로 자리(P3-4가 Node 요청을 직접 읽는다). 여기서는 본문을 읽지 않고 답한다.
    t.app.post('/api/teacher/exhibitions/:id/artworks', c =>
      c.json({ data: { reached: true }, requestId: c.get('requestId') }),
    );
  });

  it('Content-Length가 한도를 넘으면 본문을 읽기 전에 E_VALIDATION(_: body_too_large)', async () => {
    const body = big(TEST_JSON_LIMIT_BYTES);
    const res = await t.app.request('/api/test/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      body,
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error).toEqual({
      code: 'E_VALIDATION',
      message: 'validation',
      retryable: false,
      fields: { _: 'body_too_large' },
    });
  });

  it('Content-Length 없이(chunked) 흘려 보내도 세어서 막는다', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > TEST_JSON_LIMIT_BYTES * 2) controller.close();
        else {
          sent += chunk.length;
          controller.enqueue(chunk);
        }
      },
    });
    const request = new Request('http://localhost/api/test/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    });
    expect(request.headers.get('content-length')).toBeNull();
    const res = await t.app.request(request);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error.fields).toEqual({ _: 'body_too_large' });
  });

  it('한도 안의 JSON은 그대로 지나간다', async () => {
    const body = big(TEST_JSON_LIMIT_BYTES - 100);
    const res = await t.app.request('/api/test/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      body,
    });
    expect(res.status).toBe(200);
  });

  it('업로드 경로의 multipart만 건너뛰고(스트리밍 한도는 그 경로 몫), 같은 경로의 JSON과 다른 경로의 multipart는 막는다', async () => {
    const body = 'y'.repeat(TEST_JSON_LIMIT_BYTES * 2);
    const multipart = {
      'content-type': 'multipart/form-data; boundary=gw',
      'content-length': String(body.length),
    };
    const upload = await t.app.request('/api/teacher/exhibitions/exh-1/artworks', {
      method: 'POST',
      headers: multipart,
      body,
    });
    expect(upload.status).toBe(200);

    const jsonOnUpload = await t.app.request('/api/teacher/exhibitions/exh-1/artworks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
      body,
    });
    expect(jsonOnUpload.status).toBe(400);

    const multipartElsewhere = await t.app.request('/api/test/echo', {
      method: 'POST',
      headers: multipart,
      body,
    });
    expect(multipartElsewhere.status).toBe(400);
    expect((await errorOf(multipartElsewhere)).error.fields).toEqual({ _: 'body_too_large' });
  });
});

describe('기록 가리기(HTTP)', () => {
  it('토큰이 든 경로·쿼리·머리가 기록에 남지 않는다', async () => {
    const token = randomSecretHex();
    const deviceId = crypto.randomUUID();
    await t.app.request(`/t/${token}?k=${token}`, {
      headers: {
        authorization: `Bearer ${token}`,
        'x-device-id': deviceId,
        'x-gw-viewer-ip': '203.0.113.9',
        'x-request-id': `forged-${token}`,
      },
    });
    await t.app.request(`/api/e/123456?token=${token}`);
    const text = await t.logText();
    expect(text).not.toContain(token);
    expect(text).not.toContain(deviceId);
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toContain('forged');
    const paths = text
      .trim()
      .split('\n')
      .map(line => (JSON.parse(line) as { path?: string }).path);
    expect(paths).toEqual(['/t/***', '/api/e/123456']);
  });

  it('응답의 요청 ID는 서버가 새로 만든 것(들어온 X-Request-Id를 믿지 않음)', async () => {
    const res = await t.app.request('/api/health', { headers: { 'x-request-id': 'forged-id' } });
    const id = res.headers.get('x-request-id');
    expect(id).not.toBe('forged-id');
    expect(z.uuid().safeParse(id).success).toBe(true);
  });
});

describe('끝내기(새 요청 거부 → 처리 중인 것은 기다림)', () => {
  it('끝내는 중에 온 요청은 E_BUSY + Connection: close, 처리 중이던 요청은 끝까지 간다', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    t.app.get('/api/test/slow', async c => {
      await gate;
      return c.json({ data: { done: true }, requestId: c.get('requestId') });
    });

    const slow = t.app.request('/api/test/slow');
    await Promise.resolve();
    expect(t.lifecycle.inFlight()).toBe(1);

    t.lifecycle.beginDrain();
    const rejected = await t.app.request('/api/health');
    expect(rejected.status).toBe(503);
    expect(rejected.headers.get('connection')).toBe('close');
    expect((await errorOf(rejected)).error).toMatchObject({ code: 'E_BUSY', retryable: true });
    expectSecurityHeaders(rejected);

    expect(await t.lifecycle.waitIdle(10)).toBe(false);
    const idle = t.lifecycle.waitIdle(1000);
    release();
    const done = await slow;
    expect(done.status).toBe(200);
    // 요청은 본문이 다 나가야 끝난다(서버가 본문을 끝까지 써 보냄)
    await done.json();
    expect(await idle).toBe(true);
    expect(t.lifecycle.inFlight()).toBe(0);
  });

  it('흘려보내는 본문(큰 미디어)은 다 나갈 때까지 처리 중으로 센다 — 끝내기 대기가 전송 도중에 풀리지 않게', async () => {
    let push: (chunk: Uint8Array | null) => void = () => undefined;
    t.app.get('/api/test/stream', () => {
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          push = chunk => (chunk ? ctrl.enqueue(chunk) : ctrl.close());
        },
      });
      return new Response(body, { headers: { 'content-type': 'application/octet-stream' } });
    });
    const res = await t.app.request('/api/test/stream');
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    push(new Uint8Array([1, 2, 3]));
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
    // 처리기는 이미 응답을 돌려줬지만 본문이 남았다
    expect(t.lifecycle.inFlight()).toBe(1);
    expect(await t.lifecycle.waitIdle(10)).toBe(false);
    push(null);
    expect((await reader.read()).done).toBe(true);
    expect(await t.lifecycle.waitIdle(1000)).toBe(true);
    expect(t.lifecycle.inFlight()).toBe(0);
  });

  it('받는 쪽이 본문을 끊으면(연결 끊김) 그때 처리 중에서 뺀다', async () => {
    t.app.get('/api/test/stream2', () => {
      const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
      return new Response(body);
    });
    const res = await t.app.request('/api/test/stream2');
    expect(t.lifecycle.inFlight()).toBe(1);
    await res.body!.cancel('client gone');
    expect(t.lifecycle.inFlight()).toBe(0);
  });
});
