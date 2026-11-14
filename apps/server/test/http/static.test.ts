import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
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
const SCRIPT_BR = brotliCompressSync(SCRIPT);
const SCRIPT_GZIP = gzipSync(SCRIPT);
const SCRIPT_URL = '/assets/g/index-AbC_12x.js';
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

const put = async (rel: string, text: string | Buffer): Promise<void> => {
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
  await put('assets/g/index-AbC_12x.js.br', SCRIPT_BR);
  await put('assets/g/index-AbC_12x.js.gz', SCRIPT_GZIP);
  await put('index.html.br', brotliCompressSync(INDEX));
  await put('sw.js.gz', gzipSync(SW));
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
  readonly body: Buffer;
}

const call = async (path: string, init?: RequestInit, on = app): Promise<Reply> => {
  const res = await on.request(path, init);
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, text: body.toString('utf8'), body };
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

describe('앱 정적 파일의 압축 협상', () => {
  it.each([
    ['gzip, br', 'br'],
    ['BR, GZIP', 'br'],
    ['gzip', 'gzip'],
    ['br;q=0, gzip', 'gzip'],
    ['br;q=0.3, gzip;q=0.8', 'gzip'],
    ['gzip;q=0.5, br;q=0.5', 'br'],
    ['*', 'br'],
    ['*;q=1, br;q=0', 'gzip'],
    ['br;q=0.001, gzip;q=0', 'br'],
  ])('%s이면 %s 사본과 원래 형식·캐시 머리를 보낸다', async (accept, encoding) => {
    const res = await call(SCRIPT_URL, { headers: { 'Accept-Encoding': accept } });
    const expected = encoding === 'br' ? SCRIPT_BR : SCRIPT_GZIP;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe(encoding);
    expect(res.headers.get('vary')).toBe('Accept-Encoding');
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('content-length')).toBe(String(expected.length));
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(res.body).toEqual(expected);
    expect((encoding === 'br' ? brotliDecompressSync(res.body) : gunzipSync(res.body)).toString()).toBe(
      SCRIPT,
    );
  });

  it.each([undefined, '', 'identity', 'deflate', 'br;q=0, gzip;q=0', '*;q=0', 'br;q=invalid'])(
    '압축을 허용하지 않는 %s 요청은 원본과 Vary를 보낸다',
    async accept => {
      const res = await call(SCRIPT_URL, {
        headers: accept === undefined ? {} : { 'Accept-Encoding': accept },
      });
      expect(res.status).toBe(200);
      expect(res.text).toBe(SCRIPT);
      expect(res.headers.get('content-encoding')).toBeNull();
      expect(res.headers.get('vary')).toBe('Accept-Encoding');
    },
  );

  it('br 사본이 없으면 허용된 gzip, 허용된 사본이 모두 없으면 원본을 보낸다', async () => {
    await rm(join(webDir, 'assets/g/index-AbC_12x.js.br'));
    const gzip = await call(SCRIPT_URL, { headers: { 'Accept-Encoding': 'br, gzip' } });
    expect(gzip.headers.get('content-encoding')).toBe('gzip');
    expect(gzip.body).toEqual(SCRIPT_GZIP);
    const plain = await call(SCRIPT_URL, { headers: { 'Accept-Encoding': 'br' } });
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(plain.text).toBe(SCRIPT);
    expect(plain.headers.get('vary')).toBe('Accept-Encoding');
  });

  it('압축 사본이 링크·폴더이면 건너뛰고 원본 링크·없는 원본은 사본으로 우회하지 못한다', async () => {
    await rm(join(webDir, 'assets/g/index-AbC_12x.js.br'));
    await symlink(join(root, 'secret.txt'), join(webDir, 'assets/g/index-AbC_12x.js.br'));
    await rm(join(webDir, 'assets/g/index-AbC_12x.js.gz'));
    await mkdir(join(webDir, 'assets/g/index-AbC_12x.js.gz'));
    const plain = await call(SCRIPT_URL, { headers: { 'Accept-Encoding': 'br, gzip' } });
    expect(plain.text).toBe(SCRIPT);
    expect(plain.headers.get('content-encoding')).toBeNull();
    await put('assets/g/link.js.br', SCRIPT_BR);
    await put('assets/g/absent.js.br', SCRIPT_BR);
    for (const path of ['/assets/g/link.js', '/assets/g/absent.js'])
      expectNotFound(await call(path, { headers: { 'Accept-Encoding': 'br' } }), path);
  });

  it('Range는 압축 협상을 건너뛰며 206·416·잘못 쓴 구간·If-Range 동작을 유지한다', async () => {
    const etag = (await call(SCRIPT_URL)).headers.get('etag')!;
    const cases = [
      {
        range: 'bytes=0-6',
        status: 206,
        text: SCRIPT.slice(0, 7),
        contentRange: `bytes 0-6/${Buffer.byteLength(SCRIPT)}`,
      },
      { range: 'bytes=1000-', status: 416, text: '', contentRange: `bytes */${Buffer.byteLength(SCRIPT)}` },
      { range: 'bytes=bad', status: 200, text: SCRIPT, contentRange: null },
      { range: 'bytes=0-6', ifRange: '"stale"', status: 200, text: SCRIPT, contentRange: null },
      {
        range: 'bytes=0-6',
        ifRange: etag,
        status: 206,
        text: SCRIPT.slice(0, 7),
        contentRange: `bytes 0-6/${Buffer.byteLength(SCRIPT)}`,
      },
    ];
    for (const { range, ifRange, status, text, contentRange } of cases) {
      const res = await call(SCRIPT_URL, {
        headers: {
          'Accept-Encoding': 'br, gzip',
          Range: range,
          ...(ifRange ? { 'If-Range': ifRange } : {}),
        },
      });
      expect(res.status).toBe(status);
      expect(res.text).toBe(text);
      expect(res.headers.get('content-range')).toBe(contentRange);
      expect(res.headers.get('content-encoding')).toBeNull();
      expect(res.headers.get('etag')).toBe(etag);
      expect(res.headers.get('vary')).toBe('Accept-Encoding');
      expect(res.headers.get('cache-control')).toBe(status === 416 ? 'no-store' : IMMUTABLE);
    }
  });

  it('HEAD는 선택한 압축 GET과 같은 머리만 보낸다', async () => {
    const headers = { 'Accept-Encoding': 'br, gzip' };
    const get = await call(SCRIPT_URL, { headers });
    const head = await call(SCRIPT_URL, { method: 'HEAD', headers });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-encoding')).toBe('br');
    for (const name of [
      'content-type',
      'content-length',
      'content-encoding',
      'cache-control',
      'etag',
      'vary',
    ])
      expect(head.headers.get(name), name).toBe(get.headers.get(name));
    expect(head.body.length).toBe(0);
  });

  it('ETag는 압축별로 구분하고 304에도 압축·Vary·캐시 머리를 유지한다', async () => {
    const etags = new Set<string>();
    for (const encoding of ['identity', 'br', 'gzip']) {
      const first = await call(SCRIPT_URL, { headers: { 'Accept-Encoding': encoding } });
      const etag = first.headers.get('etag')!;
      expect(etag).toMatch(/^"[^"]+"$/);
      etags.add(etag);
      const cached = await call(SCRIPT_URL, {
        headers: {
          'Accept-Encoding': encoding,
          'If-None-Match': `W/${etag}`,
        },
      });
      expect(cached.status).toBe(304);
      expect(cached.body.length).toBe(0);
      expect(cached.headers.get('etag')).toBe(etag);
      expect(cached.headers.get('cache-control')).toBe(IMMUTABLE);
      expect(cached.headers.get('vary')).toBe('Accept-Encoding');
      expect(cached.headers.get('content-encoding')).toBe(encoding === 'identity' ? null : encoding);
    }
    expect(etags.size).toBe(3);
    const plain = (await call(SCRIPT_URL)).headers.get('etag')!;
    expect(
      (await call(SCRIPT_URL, { headers: { 'Accept-Encoding': 'br', 'If-None-Match': plain } })).status,
    ).toBe(200);
  });

  it('HTML·서비스 워커도 사본을 고르며 원래 형식과 no-cache를 유지한다', async () => {
    for (const path of ['/', '/123456', '/t', '/privacy', '/check']) {
      const res = await call(path, { headers: { 'Accept-Encoding': 'br' } });
      expect(res.headers.get('content-encoding'), path).toBe('br');
      expect(res.headers.get('content-type'), path).toBe('text/html; charset=utf-8');
      expect(res.headers.get('cache-control'), path).toBe('no-cache');
      expect(brotliDecompressSync(res.body).toString(), path).toBe(INDEX);
    }
    const sw = await call('/sw.js', { headers: { 'Accept-Encoding': 'br, gzip' } });
    expect(sw.headers.get('content-encoding')).toBe('gzip');
    expect(sw.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
    expect(gunzipSync(sw.body).toString()).toBe(SW);
  });
});

describe('HTML과 서비스 워커', () => {
  it('/, /{6자리 코드}, /t, /t/* 는 index.html + no-cache + 보안 머리', async () => {
    for (const path of ['/', '/123456', '/t', '/t/x', '/t/abc/def', '/privacy', '/check']) {
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
