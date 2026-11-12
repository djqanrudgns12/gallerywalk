import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiErrorSchema } from '@gallery/core/types';
import { createApp } from '../../src/http/app.ts';
import { createLifecycle } from '../../src/http/lifecycle.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import type { Db } from '../../src/store/db.ts';
import { makeTempDir, openTestDb, TEST_JSON_LIMIT_BYTES } from '../helpers/server.ts';
import { testDeps } from '../support/memoryStore.ts';

/**
 * 앱 정적 파일(PLAN §9.6 표, ADR-028·049): 해시 이름 `/assets/g/*`는 1년 immutable + stale-if-error 7일,
 * HTML(`/`·`/{입장 코드}`·`/t/*`)과 `/sw.js`는 no-cache, `/api/*`는 그대로 no-store. 웹 폴더 밖은 못 나간다.
 */

const IMMUTABLE = 'public, max-age=31536000, immutable, stale-if-error=604800';
const INDEX = '<!doctype html><html lang="ko"><body><div id="root"></div></body></html>';
const SW = 'self.addEventListener("fetch", () => {});';
const SCRIPT = 'console.log("app");';
const SECRET = 'outside-web-secret';

let root: string;
let webDir: string;
let db: Db;
let log: Logger;
let app: ReturnType<typeof createApp>;

const makeApp = (withWeb: boolean) =>
  createApp({
    db,
    log,
    mediaDir: join(root, 'media'),
    queueLength: () => 0,
    lifecycle: createLifecycle(),
    limits: { jsonBodyMaxBytes: TEST_JSON_LIMIT_BYTES, hstsMaxAgeSec: 31_536_000 },
    useCases: testDeps().deps,
    ...(withWeb ? { webDir } : {}),
  });

const put = async (rel: string, text: string): Promise<void> => {
  const path = join(webDir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text);
};

beforeEach(async () => {
  root = await makeTempDir();
  webDir = join(root, 'web');
  await mkdir(join(root, 'media'), { recursive: true });
  db = openTestDb(root);
  log = createLogger({ dir: join(root, 'logs'), keepFiles: 7 });
  await put('index.html', INDEX);
  await put('sw.js', SW);
  await put('assets/g/index-AbC_12x.js', SCRIPT);
  await put('assets/g/index-Zz9.css', 'body{}');
  await put('assets/g/basis-r187/basis_transcoder.wasm', 'wasm');
  await put('assets/g/.hidden.js', SECRET);
  await writeFile(join(root, 'secret.txt'), SECRET);
  await symlink(join(root, 'secret.txt'), join(webDir, 'assets', 'g', 'link.js'));
  app = makeApp(true);
});

afterEach(async () => {
  log.close();
  if (db.open) db.close();
  await rm(root, { recursive: true, force: true });
});

interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

const call = async (path: string, init?: RequestInit, on = app): Promise<Reply> => {
  const res = await on.request(path, init);
  return { status: res.status, headers: res.headers, text: await res.text() };
};

const expectNotFound = (res: Reply, path: string): void => {
  expect(res.status, path).toBe(404);
  expect(res.text, path).not.toContain(SECRET);
  expect(res.text, path).not.toContain('<!doctype html>');
  expect(ApiErrorSchema.parse(JSON.parse(res.text)).error.code, path).toBe('E_NOT_FOUND');
};

describe('해시 이름 앱 파일 /assets/g/*', () => {
  it('1년 immutable + stale-if-error 7일, 형식·길이·ETag', async () => {
    const res = await call('/assets/g/index-AbC_12x.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe(SCRIPT);
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(SCRIPT)));
    expect(res.headers.get('etag')).toMatch(/^"[^"]+"$/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');

    const css = await call('/assets/g/index-Zz9.css');
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(css.headers.get('cache-control')).toBe(IMMUTABLE);
    const wasm = await call('/assets/g/basis-r187/basis_transcoder.wasm');
    expect(wasm.status).toBe(200);
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
    expect(wasm.headers.get('cache-control')).toBe(IMMUTABLE);
  });

  it('If-None-Match가 맞으면 304', async () => {
    const etag = (await call('/assets/g/index-AbC_12x.js')).headers.get('etag')!;
    const res = await call('/assets/g/index-AbC_12x.js', { headers: { 'If-None-Match': etag } });
    expect(res.status).toBe(304);
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(res.text).toBe('');
  });

  it('없는 파일·폴더는 index.html이 아니라 404', async () => {
    for (const path of [
      '/assets/g/x.js',
      '/assets/g/basis-r187',
      '/assets/g/basis-r187/',
      '/assets/g/',
      '/assets/g',
    ])
      expectNotFound(await call(path), path);
  });

  it('되짚기·인코딩·숨김 파일·링크·미디어 자리는 거절', async () => {
    const attempts = [
      '/assets/g/..%2f..%2fsecret.txt',
      '/assets/g/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/assets/g/%2e%2e/%2e%2e/secret.txt',
      '/assets/g/../../secret.txt',
      '/assets/g/a%5c..%5c..%5csecret.txt',
      '/assets/g/%2fetc%2fpasswd',
      '/assets/g//index-AbC_12x.js',
      '/assets/g/basis-r187/../../../secret.txt',
      '/assets/g/.hidden.js',
      '/assets/g/link.js',
      '/assets/g/index-AbC_12x.js%00.png',
      '/assets/g/m/x.webp',
    ];
    for (const path of attempts) expectNotFound(await call(path), path);
  });
});

describe('HTML과 서비스 워커', () => {
  it('/, /{6자리 코드}, /t, /t/* 는 index.html + no-cache + 보안 머리', async () => {
    for (const path of ['/', '/123456', '/t', '/t/x', '/t/abc/def', '/privacy']) {
      const res = await call(path);
      expect(res.status, path).toBe(200);
      expect(res.text, path).toBe(INDEX);
      expect(res.headers.get('cache-control'), path).toBe('no-cache');
      expect(res.headers.get('content-type'), path).toBe('text/html; charset=utf-8');
      expect(res.headers.get('content-security-policy'), path).toContain("default-src 'self'");
      expect(res.headers.get('referrer-policy'), path).toBe('no-referrer');
    }
  });

  it('HEAD / 는 머리만', async () => {
    const res = await call('/', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(INDEX)));
    expect(res.text).toBe('');
  });

  it('코드 모양이 아닌 한 칸 경로는 404', async () => {
    for (const path of ['/12345', '/1234567', '/abcdef', '/index.html', '/secret.txt'])
      expectNotFound(await call(path), path);
  });

  it('/sw.js 는 no-cache 자바스크립트', async () => {
    const res = await call('/sw.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe(SW);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  });
});

describe('/api 와 웹 폴더 없는 앱', () => {
  it('/api/* 는 그대로 no-store(있는 경로·없는 경로)', async () => {
    expect((await call('/api/health')).headers.get('cache-control')).toBe('no-store');
    const missing = await call('/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
  });

  it('웹 폴더를 주지 않으면 정적 경로를 붙이지 않는다', async () => {
    const bare = makeApp(false);
    for (const path of ['/', '/123456', '/sw.js', '/assets/g/index-AbC_12x.js'])
      expectNotFound(await call(path, undefined, bare), path);
  });
});
