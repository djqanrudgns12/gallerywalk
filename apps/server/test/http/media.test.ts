import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema } from '@gallery/core/types';
import { createExhibition } from '../../src/application/exhibitions.ts';
import { createApp } from '../../src/http/app.ts';
import { createLifecycle } from '../../src/http/lifecycle.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import type { AssetRecord } from '../../src/ports/index.ts';
import type { Db } from '../../src/store/db.ts';
import { makeTempDir, openTestDb, TEST_JSON_LIMIT_BYTES } from '../helpers/server.ts';
import { testDeps } from '../support/memoryStore.ts';

/**
 * 작품 미디어 `/assets/g/m/{exhibitionId}/{assetId}/{variant}.{ext}`(PLAN §9.6 표·§9.7·§10.3, ADR-028·049):
 * 남은 보관 기간으로 자른 캐시 머리, ETag·Range·HEAD, 지우는 중·만료·남의 전시 asset은 없음, 경로 밖으로 못 나감.
 */

const EX = '00000000-0000-4000-8001-0000000000a1';
const EX2 = '00000000-0000-4000-8001-0000000000a2';
const IMAGE = '00000000-0000-4000-8009-0000000000b1';
const SOUND = '00000000-0000-4000-8009-0000000000b2';
const OTHER = '00000000-0000-4000-8009-0000000000b3';

const SEC = 1000;
const DAY = 86_400 * SEC;

/** 1,000바이트 합성 파일(자리마다 다른 값이라 잘린 구간을 바로 비교할 수 있다) */
const WALL = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const AUDIO = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7) % 256));
const SECRET = Buffer.from('outside-media-secret');

let root: string;
let mediaDir: string;
let t: ReturnType<typeof testDeps>;
let db: Db;
let log: Logger;
let app: ReturnType<typeof createApp>;

const asset = (id: string, exhibitionId: string, variants: AssetRecord['variants']): AssetRecord => ({
  id,
  exhibitionId,
  kind: variants[0]?.ext === 'webp' ? 'IMAGE' : 'AUDIO',
  width: null,
  height: null,
  durationMs: null,
  variants,
  analysis: null,
  bytesTotal: variants.reduce((sum, v) => sum + v.bytes, 0),
  contentHash: `hash-${id}`,
  createdAt: 0,
});

const exhibition = (id: string, pin: string, linkTokenHash: string): void => {
  createExhibition(
    t.deps,
    { exhibitionId: id, title: '미디어 시험', templateId: 'modern-history', pin, linkTokenHash },
    { deviceRegistered: true },
  );
};

const put = async (rel: string, bytes: Buffer): Promise<void> => {
  const path = join(mediaDir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, bytes);
};

const makeApp = () =>
  createApp({
    db,
    log,
    mediaDir,
    queueLength: () => 0,
    lifecycle: createLifecycle(),
    limits: { jsonBodyMaxBytes: TEST_JSON_LIMIT_BYTES, hstsMaxAgeSec: 31_536_000 },
    useCases: t.deps,
  });

beforeEach(async () => {
  root = await makeTempDir();
  mediaDir = join(root, 'media');
  t = testDeps();
  db = openTestDb(root);
  log = createLogger({ dir: join(root, 'logs'), keepFiles: 7 });
  exhibition(EX, '482910', 'b'.repeat(64));
  exhibition(EX2, '573021', 'c'.repeat(64));
  t.deps.store.assets.insert(
    asset(IMAGE, EX, [
      { name: 'wall', ext: 'webp', w: 1600, h: 1000, bytes: WALL.length },
      // 행에는 있지만 파일이 없는 파생
      { name: 'thumb', ext: 'webp', w: 512, h: 320, bytes: 10 },
      // 행에는 있지만 파일 자리가 바깥을 가리키는 링크
      { name: 'zoom', ext: 'webp', w: 2048, h: 1280, bytes: 10 },
    ]),
  );
  t.deps.store.assets.insert(
    asset(SOUND, EX, [{ name: 'audio', ext: 'm4a', w: 0, h: 0, bytes: AUDIO.length }]),
  );
  t.deps.store.assets.insert(
    asset(OTHER, EX2, [{ name: 'wall', ext: 'webp', w: 10, h: 10, bytes: WALL.length }]),
  );
  await put(`exh/${EX}/${IMAGE}/wall.webp`, WALL);
  // 행의 파생 목록에 없는 파일은 디스크에 있어도 내주지 않는다
  await put(`exh/${EX}/${IMAGE}/cover.webp`, WALL);
  await put(`exh/${EX}/${SOUND}/audio.m4a`, AUDIO);
  await put(`exh/${EX2}/${OTHER}/wall.webp`, WALL);
  // 남의 전시 asset을 내 전시 경로에 둔 파일(행이 다른 전시라 거절돼야 함)
  await put(`exh/${EX}/${OTHER}/wall.webp`, WALL);
  // 미디어 폴더 바깥·exh 바로 아래의 비밀 파일
  await writeFile(join(root, 'secret.webp'), SECRET);
  await put('secret.webp', SECRET);
  await put('exh/secret.webp', SECRET);
  await symlink(join(root, 'secret.webp'), join(mediaDir, 'exh', EX, IMAGE, 'zoom.webp'));
  app = makeApp();
});

afterEach(async () => {
  vi.restoreAllMocks();
  log.close();
  if (db.open) db.close();
  await rm(root, { recursive: true, force: true });
});

const url = (exhibitionId: string, assetId: string, file: string): string =>
  `/assets/g/m/${exhibitionId}/${assetId}/${file}`;
const WALL_URL = url(EX, IMAGE, 'wall.webp');

interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Buffer;
}

/** 본문까지 다 읽는다(파일 스트림을 열어 둔 채 시험이 끝나지 않게) */
const call = async (path: string, init?: RequestInit, on = app): Promise<Reply> => {
  const res = await on.request(path, init);
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
};

const expectNotFound = (res: Reply): void => {
  expect(res.status).toBe(404);
  expect(res.body.includes(SECRET)).toBe(false);
  expect(ApiErrorSchema.parse(JSON.parse(res.body.toString('utf8'))).error.code).toBe('E_NOT_FOUND');
  // 없는 답을 어디에도 붙잡아 두지 않는다(서비스 워커는 404면 그 전시 캐시를 지운다)
  expect(res.headers.get('cache-control')).toBe('no-store');
};

describe('작품 미디어: 200과 캐시 머리', () => {
  it('만든 직후: 브라우저 30일·CDN 1일·stale-if-error 1일, 강한 ETag·Range 안내·형식·길이', async () => {
    const res = await call(WALL_URL);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=2592000, s-maxage=86400, stale-if-error=86400',
    );
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('content-length')).toBe('1000');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    const etag = res.headers.get('etag');
    expect(etag).toMatch(/^"[^"]+"$/);
    // 보안 머리는 그대로, /api 의 no-store는 붙지 않는다
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.body).toEqual(WALL);
    // 같은 파일이면 같은 ETag
    expect((await call(WALL_URL)).headers.get('etag')).toBe(etag);
  });

  it('남은 기간이 2일이면 브라우저 사본은 2일, CDN은 그대로 1일', async () => {
    const ex = t.deps.store.exhibitions.get(EX)!;
    t.advance(ex.expiresAt - t.at() - 2 * DAY);
    const res = await call(WALL_URL);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=172800, s-maxage=86400, stale-if-error=86400',
    );
  });

  it('남은 기간이 1시간 0.5초면 셋 다 3600(1초 미만은 버림)', async () => {
    const ex = t.deps.store.exhibitions.get(EX)!;
    t.advance(ex.expiresAt - t.at() - 3600 * SEC - 500);
    const res = await call(WALL_URL);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600, stale-if-error=3600');
  });

  it('소리 파생(m4a)은 audio/mp4', async () => {
    const res = await call(url(EX, SOUND, 'audio.m4a'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(res.body).toEqual(AUDIO);
  });

  it('HEAD: 머리는 GET과 같고 본문 없음', async () => {
    const get = await call(WALL_URL);
    const head = await call(WALL_URL, { method: 'HEAD' });
    expect(head.status).toBe(200);
    for (const name of ['cache-control', 'content-type', 'content-length', 'accept-ranges', 'etag'])
      expect(head.headers.get(name)).toBe(get.headers.get(name));
    expect(head.body.length).toBe(0);
  });
});

describe('작품 미디어: 조건부 요청', () => {
  it('If-None-Match가 맞으면 304(ETag·캐시 머리 유지, 본문 없음). W/ 비교·* 도 맞음, 다르면 200', async () => {
    const etag = (await call(WALL_URL)).headers.get('etag')!;
    for (const value of [etag, `W/${etag}`, `"nope", ${etag}`, '*']) {
      const res = await call(WALL_URL, { headers: { 'If-None-Match': value } });
      expect(res.status, value).toBe(304);
      expect(res.headers.get('etag')).toBe(etag);
      expect(res.headers.get('cache-control')).toBe(
        'public, max-age=2592000, s-maxage=86400, stale-if-error=86400',
      );
      expect(res.body.length).toBe(0);
    }
    const other = await call(WALL_URL, { headers: { 'If-None-Match': '"other"' } });
    expect(other.status).toBe(200);
    expect(other.body).toEqual(WALL);
  });
});

describe('작품 미디어: Range', () => {
  const range = (value: string, extra: Record<string, string> = {}) =>
    call(WALL_URL, { headers: { Range: value, ...extra } });

  it('한 구간이면 206 + Content-Range + 그 바이트만', async () => {
    const cases: readonly (readonly [string, number, number])[] = [
      ['bytes=0-99', 0, 99],
      ['bytes=990-', 990, 999],
      ['bytes=-5', 995, 999],
      ['bytes=900-5000', 900, 999],
      ['bytes=-5000', 0, 999],
    ];
    for (const [value, start, end] of cases) {
      const res = await range(value);
      expect(res.status, value).toBe(206);
      expect(res.headers.get('content-range'), value).toBe(`bytes ${start}-${end}/1000`);
      expect(res.headers.get('content-length'), value).toBe(String(end - start + 1));
      expect(res.headers.get('accept-ranges')).toBe('bytes');
      expect(res.headers.get('etag')).toMatch(/^"[^"]+"$/);
      expect(res.headers.get('cache-control')).toBe(
        'public, max-age=2592000, s-maxage=86400, stale-if-error=86400',
      );
      expect(res.body, value).toEqual(WALL.subarray(start, end + 1));
    }
  });

  it('맞출 수 없는 구간은 416 + bytes */크기', async () => {
    for (const value of ['bytes=1000-', 'bytes=5000-6000', 'bytes=-0']) {
      const res = await range(value);
      expect(res.status, value).toBe(416);
      expect(res.headers.get('content-range'), value).toBe('bytes */1000');
      expect(res.headers.get('cache-control'), value).toBe('no-store');
    }
  });

  it('여러 구간·잘못 쓴 Range·다른 단위는 무시하고 전체 200', async () => {
    for (const value of ['bytes=0-1,5-6', 'bytes=5-1', 'bytes=abc', 'items=0-5', 'bytes=-']) {
      const res = await range(value);
      expect(res.status, value).toBe(200);
      expect(res.body, value).toEqual(WALL);
    }
  });

  it('If-Range가 지금 ETag면 206, 다르면(또는 약한 ETag면) 전체 200', async () => {
    const etag = (await call(WALL_URL)).headers.get('etag')!;
    expect((await range('bytes=0-9', { 'If-Range': etag })).status).toBe(206);
    expect((await range('bytes=0-9', { 'If-Range': '"stale"' })).status).toBe(200);
    expect((await range('bytes=0-9', { 'If-Range': `W/${etag}` })).status).toBe(200);
  });

  it('HEAD + Range: 206 머리만', async () => {
    const res = await call(WALL_URL, { method: 'HEAD', headers: { Range: 'bytes=10-19' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect(res.headers.get('content-length')).toBe('10');
    expect(res.body.length).toBe(0);
  });
});

describe('작품 미디어: 없는 전시로 다루기(§9.7)', () => {
  it('지우는 중인 전시는 처음 요청부터 404', async () => {
    t.deps.store.exhibitions.update(EX, { deleting: true });
    expectNotFound(await call(WALL_URL));
  });

  it('만료 시각부터 404', async () => {
    const ex = t.deps.store.exhibitions.get(EX)!;
    t.advance(ex.expiresAt - t.at());
    expectNotFound(await call(WALL_URL));
  });

  it('상태 캐시(10초): 지우는 중으로 바뀐 뒤 10초 안에는 캐시된 상태로 내줄 수 있지만 10초가 되면 404', async () => {
    expect((await call(WALL_URL)).status).toBe(200);
    t.deps.store.exhibitions.update(EX, { deleting: true });
    t.advance(9_999);
    expect((await call(WALL_URL)).status).toBe(200);
    t.advance(1);
    expectNotFound(await call(WALL_URL));
    // 다시 캐시가 차도 계속 없음
    t.advance(5 * SEC);
    expectNotFound(await call(WALL_URL));
  });

  it('상태 캐시가 있어도 만료는 기다리지 않는다(캐시 10초 안에 만료 시각이 오면 바로 404)', async () => {
    const ex = t.deps.store.exhibitions.get(EX)!;
    t.advance(ex.expiresAt - t.at() - 3 * SEC);
    expect((await call(WALL_URL)).status).toBe(200);
    t.advance(3 * SEC);
    expectNotFound(await call(WALL_URL));
  });

  it('행이 지워진 전시(캐시 10초 뒤)도 404', async () => {
    expect((await call(WALL_URL)).status).toBe(200);
    t.deps.store.transaction(() => t.deps.store.exhibitions.delete(EX));
    t.advance(10 * SEC);
    expectNotFound(await call(WALL_URL));
  });

  it('없는 전시 ID는 404', async () => {
    expectNotFound(await call(url('00000000-0000-4000-8001-0000000000ff', IMAGE, 'wall.webp')));
  });
});

describe('작품 미디어: 행과 파일', () => {
  it('다른 전시의 asset은 그 파일이 내 전시 폴더에 있어도 404', async () => {
    expectNotFound(await call(url(EX, OTHER, 'wall.webp')));
    // 제 전시 경로로는 나온다
    expect((await call(url(EX2, OTHER, 'wall.webp'))).status).toBe(200);
  });

  it('행의 파생 목록에 없는 파일·없는 asset·파일이 없는 파생·확장자가 다른 파생은 404', async () => {
    expectNotFound(await call(url(EX, IMAGE, 'cover.webp')));
    expectNotFound(await call(url(EX, '00000000-0000-4000-8009-0000000000ff', 'wall.webp')));
    expectNotFound(await call(url(EX, IMAGE, 'thumb.webp')));
    expectNotFound(await call(url(EX, SOUND, 'audio.mp3')));
  });

  it('파생 파일 자리가 링크면 따라가지 않는다(404, 바깥 내용 없음)', async () => {
    expectNotFound(await call(url(EX, IMAGE, 'zoom.webp')));
  });

  it('대문자로 쓴 ID는 다른 ID(404)', async () => {
    expectNotFound(await call(url(EX.toUpperCase(), IMAGE, 'wall.webp')));
    expectNotFound(await call(url(EX, IMAGE.toUpperCase(), 'wall.webp')));
  });
});

describe('작품 미디어: 경로 검사는 저장소·디스크보다 먼저', () => {
  it('되짚기·인코딩·절대 경로·틀린 확장자·틀린 UUID는 저장소를 보기 전에 404', async () => {
    const exhibitionsGet = vi.spyOn(t.deps.store.exhibitions, 'get');
    const assetsGet = vi.spyOn(t.deps.store.assets, 'get');
    const attempts = [
      url(EX, IMAGE, '..%2f..%2f..%2fsecret.webp'),
      url(EX, IMAGE, '%2e%2e%2f%2e%2e%2fsecret.webp'),
      url(EX, IMAGE, '..%5c..%5csecret.webp'),
      url(EX, IMAGE, '%2fetc%2fpasswd'),
      url(EX, IMAGE, '%2F..%2F..%2Fsecret.webp'),
      url(EX, '..', 'secret.webp'),
      url(EX, '%2e%2e', 'secret.webp'),
      url('%2e%2e', '%2e%2e', 'secret.webp'),
      `/assets/g/m/${EX}/${IMAGE}/wall.webp%00.png`,
      url(EX, IMAGE, 'wall.png'),
      url(EX, IMAGE, 'wall.WEBP'),
      url(EX, IMAGE, 'wall.webp.bak'),
      url(EX, IMAGE, 'wall'),
      url(EX, IMAGE, '.webp'),
      url(EX, IMAGE, 'secret.webp'),
      url(EX, IMAGE, 'strip-01.webp'),
      url(EX, 'not-a-uuid', 'wall.webp'),
      url('not-a-uuid', IMAGE, 'wall.webp'),
      url(EX, `${IMAGE}x`, 'wall.webp'),
      url(EX, '.upload-abc', 'wall.webp'),
      `/assets/g/m/${EX}//wall.webp`,
      `/assets/g/m/${EX}/${IMAGE}/sub/wall.webp`,
      '/assets/g/m/secret.webp',
      '/assets/g/m/exh/secret.webp',
    ];
    for (const path of attempts) {
      const res = await call(path);
      expect(res.status, path).toBe(404);
      expect(res.body.includes(SECRET), path).toBe(false);
    }
    expect(exhibitionsGet).not.toHaveBeenCalled();
    expect(assetsGet).not.toHaveBeenCalled();
  });

  it('유스케이스 없는 앱(건강 확인만)에는 미디어 경로가 없다', async () => {
    const bare = createApp({
      db,
      log,
      mediaDir,
      queueLength: () => 0,
      lifecycle: createLifecycle(),
      limits: { jsonBodyMaxBytes: TEST_JSON_LIMIT_BYTES, hstsMaxAgeSec: 31_536_000 },
    });
    expect((await call(WALL_URL, undefined, bare)).status).toBe(404);
  });
});

describe('작품 미디어: 실제 Node 서버(@hono/node-server)', () => {
  /** 경로를 고치지 않고 그대로 보낸다(fetch는 `..`를 미리 접어 버린다) */
  const raw = (port: number, path: string, method = 'GET', headers: Record<string, string> = {}) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((done, fail) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        res.on('error', fail);
      });
      req.on('error', fail);
      req.end();
    });

  it('스트림 본문·Range·HEAD가 그대로 나가고, 날것의 되짚기 경로는 404', async () => {
    const server = createServer(getRequestListener(app.fetch));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const full = await raw(port, WALL_URL);
      expect(full.status).toBe(200);
      expect(full.body).toEqual(WALL);
      expect(full.headers['cache-control']).toBe(
        'public, max-age=2592000, s-maxage=86400, stale-if-error=86400',
      );

      const part = await raw(port, WALL_URL, 'GET', { Range: 'bytes=100-199' });
      expect(part.status).toBe(206);
      expect(part.headers['content-range']).toBe('bytes 100-199/1000');
      expect(part.body).toEqual(WALL.subarray(100, 200));

      const head = await raw(port, WALL_URL, 'HEAD');
      expect(head.status).toBe(200);
      expect(head.headers['content-length']).toBe('1000');
      expect(head.body.length).toBe(0);

      for (const path of [
        `/assets/g/m/${EX}/${IMAGE}/../../../secret.webp`,
        `/assets/g/m/${EX}/${IMAGE}/..%2f..%2f..%2fsecret.webp`,
        `/assets/g/m/${EX}/../../../../secret.webp`,
        `/assets/g/m/${EX}/${IMAGE}/..%5c..%5c..%5csecret.webp`,
      ]) {
        const res = await raw(port, path);
        expect(res.status, path).toBe(404);
        expect(res.body.includes(SECRET), path).toBe(false);
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
