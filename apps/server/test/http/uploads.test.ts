import { randomUUID } from 'node:crypto';
import { createServer, request, type ClientRequest, type Server } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { config, overrideConfig, resetConfig } from '@gallery/core/config';
import {
  ApiErrorSchema,
  ArtworkTeacherSchema,
  ExhibitionTeacherSchema,
  RoomTeacherSchema,
  TeacherExhibitionViewSchema,
  okEnvelope,
} from '@gallery/core/types';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exhibitionMediaDir } from '../../src/deps.ts';
import { runMedia } from '../../src/upload/process.ts';
import { readDiskUsage, type DiskUsage } from '../../src/upload/space.ts';
import { makeImage, makeHeic, makeTaggedMp3, wavBytes } from '../fixtures/make.ts';
import { parseFile } from 'music-metadata';
import { z } from 'zod';
import { createMediaFiles } from '../../src/deps.ts';
import { UploadManager } from '../../src/upload/index.ts';
import { createExhibition } from '../../src/application/exhibitions.ts';
import { createRoom } from '../../src/application/rooms.ts';
import { createApp } from '../../src/http/app.ts';
import { createLifecycle } from '../../src/http/lifecycle.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import type { Deps } from '../../src/ports/index.ts';
import { createSecurity, tokenHash } from '../../src/security/index.ts';
import { randomToken, tempDb, type TempDb } from '../security/support.ts';
import { TEST_STORES, type TestDeps } from '../support/sqliteDeps.ts';

/** 실제 Node 요청을 흘려받는다. Hono의 app.request는 incoming을 만들지 않는다. */
describe.each(TEST_STORES)('업로드 HTTP · $name', ({ make }) => {
  let t: TempDb;
  let s: TestDeps;
  let deps: Deps;
  let log: Logger;
  let server: Server;
  let base: string;
  let token: string;
  let exhibitionId: string;
  let roomId: string;
  let uploads: UploadManager;
  let disk: DiskUsage | undefined;
  let processor: typeof runMedia;
  let rateLimits: { device: number; ip: number; windowSec: number };

  beforeEach(async () => {
    t = await tempDb();
    s = make();
    const security = createSecurity(t.env, { db: t.db, clock: s.deps.clock });
    disk = undefined;
    processor = runMedia;
    rateLimits = { device: 100, ip: 300, windowSec: 60 };
    uploads = new UploadManager({
      deps: s.deps,
      log: s.deps.log,
      mediaDir: t.env.mediaDir,
      tmpDir: t.env.tmpDir,
      exhibitionDir: id => exhibitionMediaDir(t.env.mediaDir, id),
      diskUsage: id =>
        disk
          ? Promise.resolve(disk)
          : readDiskUsage(t.env.mediaDir, t.env.tmpDir, exhibitionMediaDir(t.env.mediaDir, id)),
      processMedia: (...args) => processor(...args),
    });
    deps = { ...s.deps, security, uploads, media: createMediaFiles(t.env.mediaDir) };
    token = randomToken();
    exhibitionId = randomUUID();
    createExhibition(
      deps,
      {
        exhibitionId,
        title: '합성 작품 전시',
        templateId: 'modern-history',
        pin: '58392647',
        linkTokenHash: tokenHash(token),
      },
      { deviceRegistered: true },
    );
    roomId = randomUUID();
    createRoom(deps, exhibitionId, { id: roomId, order: 0, title: '합성 전시실' });
    log = createLogger({ dir: join(t.root, 'logs'), keepFiles: 1 });
    const app = createApp({
      db: t.db,
      log,
      mediaDir: t.env.mediaDir,
      queueLength: () => 0,
      lifecycle: createLifecycle(),
      limits: {
        jsonBodyMaxBytes: config().JSON_BODY_MAX_KB * 1024,
        hstsMaxAgeSec: config().HSTS_MAX_AGE_SEC,
      },
      useCases: deps,
      teacher: { security, uploads, uploadRateLimits: rateLimits },
    });
    server = createServer(getRequestListener(app.fetch));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test address');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    log.close();
    s.close();
    await t.close();
    resetConfig();
  });

  const meta = () => ({ id: randomUUID(), roomId, order: 0, title: '합성 그림', kind: 'IMAGE' as const });
  const artworksPath = () => `/api/teacher/exhibitions/${exhibitionId}/artworks`;
  const call = (path: string, init: RequestInit) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init.headers },
    });
  const artwork = async (res: Response) => {
    const json: unknown = await res.json();
    expect({ status: res.status, json }).toMatchObject({ status: 200 });
    return okEnvelope(ArtworkTeacherSchema).parse(json).data;
  };
  const failure = async (res: Response) => ApiErrorSchema.parse(await res.json()).error;
  const image = () =>
    sharp({ create: { width: 800, height: 900, channels: 3, background: '#ae7251' } })
      .png()
      .toBuffer();
  const form = (body: unknown, bytes: Buffer) => {
    const data = new FormData();
    data.set('meta', JSON.stringify(body));
    data.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'synthetic.png');
    return data;
  };

  it('multipart 그림을 처리해 게시하고 같은 ID는 같은 결과, 다른 ID의 같은 파일은 E_DUPLICATE', async () => {
    const body = meta();
    const bytes = await image();
    const first = await artwork(await call(artworksPath(), { method: 'POST', body: form(body, bytes) }));
    expect(first.status).toBe('PUBLISHED');
    expect(first.image?.w).toBe(800);
    expect(first.image?.asset.variants.map(v => v.name)).toEqual(['thumb', 'wall', 'wall-lo', 'zoom']);
    expect(await artwork(await call(artworksPath(), { method: 'POST', body: form(body, bytes) }))).toEqual(
      first,
    );
    expect(
      (await failure(await call(artworksPath(), { method: 'POST', body: form(meta(), bytes) }))).code,
    ).toBe('E_DUPLICATE');
  });

  it('PDF는 PROCESSING으로 시작하고 빠진 쪽이 있으면 complete가 E_VALIDATION', async () => {
    const body = { ...meta(), kind: 'PDF', pageCount: 2 };
    const art = await artwork(
      await call(artworksPath(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(art.status).toBe('PROCESSING');
    expect(art.pages).toEqual([]);
    expect(
      await failure(await call(`/api/teacher/artworks/${art.id}/complete`, { method: 'POST' })),
    ).toMatchObject({ code: 'E_VALIDATION' });
  });
  const pagePath = (id: string, idx: number) => `/api/teacher/artworks/${id}/pages/${idx}`;
  const attachmentForm = (bytes: Buffer) => {
    const data = new FormData();
    data.set(
      'file',
      new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
      'wrong-extension.bin',
    );
    return data;
  };
  const json = async <S extends z.ZodType>(res: Response, schema: S) => {
    expect(res.status).toBe(200);
    return schema.parse(okEnvelope(z.unknown()).parse(await res.json()).data);
  };
  const view = async () =>
    json(
      await call(`/api/teacher/exhibitions/${exhibitionId}`, { method: 'GET' }),
      TeacherExhibitionViewSchema,
    );
  const tmpFiles = () => readdir(t.env.tmpDir).catch(() => [] as string[]);
  const sourceBytes = async (
    name: string,
    w: number,
    h: number,
    options: Parameters<typeof makeImage>[3] = {},
  ) => {
    const path = join(t.root, name);
    await makeImage(path, w, h, options);
    return readFile(path);
  };
  const upload = (body: unknown, bytes: Buffer) =>
    call(artworksPath(), { method: 'POST', body: form(body, bytes) });

  it('GPS EXIF는 파생 전부에서 지워지고 실제 파일·분석·내용 해시·바이트 합계가 행과 맞는다', async () => {
    const bytes = await sourceBytes('gps.jpg', 900, 1000, { gps: true });
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const art = await artwork(await upload(meta(), bytes));
    const media = art.image!;
    const asset = s.store.assets.get(media.asset.assetId)!;
    expect(asset.contentHash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(asset.analysis).toEqual(media.analysis);
    let total = 0;
    for (const variant of media.asset.variants) {
      const path = join(
        exhibitionMediaDir(t.env.mediaDir, exhibitionId),
        media.asset.assetId,
        `${variant.name}.${variant.ext}`,
      );
      const output = await sharp(path).metadata();
      expect(output.exif).toBeUndefined();
      expect(output.xmp).toBeUndefined();
      expect(output.icc).toBeUndefined();
      const length = (await readFile(path)).length;
      expect(length).toBe(variant.bytes);
      total += length;
    }
    expect(asset.bytesTotal).toBe(total);
    expect(await tmpFiles()).toEqual([]);
    expect((await readdir(exhibitionMediaDir(t.env.mediaDir, exhibitionId))).sort()).toEqual([asset.id]);
  });

  it('투명 PNG의 알파를 유지하고 799px에는 LOW_RES 경고를 붙인다', async () => {
    const art = await artwork(
      await upload(meta(), await sourceBytes('alpha.png', 799, 900, { alpha: true })),
    );
    expect(art.warnings).toEqual(['LOW_RES']);
    const asset = art.image!.asset;
    for (const variant of asset.variants) {
      const path = join(
        exhibitionMediaDir(t.env.mediaDir, exhibitionId),
        asset.assetId,
        `${variant.name}.${variant.ext}`,
      );
      expect((await sharp(path).metadata()).hasAlpha).toBe(true);
      const stats = await sharp(path).stats();
      expect([stats.channels[3]?.min, stats.channels[3]?.max]).toEqual([0, 255]);
    }
  });

  it('800×20000은 폭 800을 유지한 띠 10개로 저장한다', async () => {
    const art = await artwork(
      await upload(meta(), await sourceBytes('tall.png', 800, 20000, { bands: true })),
    );
    expect(art.formAuto).toBe('TALL');
    expect(art.textHeavyAuto).toBe(true);
    const strips = art.image!.asset.variants.filter(v => v.name.startsWith('strip-'));
    expect(strips).toHaveLength(10);
    expect(strips.map(v => v.w)).toEqual(Array(10).fill(800));
    expect(strips.reduce((sum, v) => sum + v.h, 0)).toBe(20000);
  });

  it.each([
    [299, 600, 'E_FILE_TOO_SMALL'],
    [300, 9300, 'E_ASPECT'],
  ] as const)('%i×%i를 %s로 거절하고 FAILED 행과 사유만 남긴다', async (w, h, code) => {
    const body = meta();
    expect((await failure(await upload(body, await sourceBytes('invalid.png', w, h)))).code).toBe(code);
    const art = s.store.artworks.get(body.id);
    expect(art).toMatchObject({ status: 'FAILED', failCode: code, sourceAssetId: null });
    expect(s.count('assets')).toBe(0);
    expect(await tmpFiles()).toEqual([]);
    expect(await readdir(exhibitionMediaDir(t.env.mediaDir, exhibitionId))).toEqual([]);
  });

  it('매직 바이트를 따르고 깨진 파일·PDF 원본·동영상을 구분해 거절한다', async () => {
    const broken = Buffer.from('synthetic broken file');
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
    const video = Buffer.from([
      0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0, 109, 112, 52, 50, 105, 115, 111, 109,
    ]);
    for (const [bytes, code] of [
      [broken, 'E_FILE_BROKEN'],
      [pdf, 'E_FILE_TYPE'],
      [video, 'E_VIDEO_UNSUPPORTED'],
    ] as const) {
      const body = meta();
      expect((await failure(await upload(body, bytes))).code).toBe(code);
      expect(s.store.artworks.get(body.id)?.failCode).toBe(code);
    }
    // 파일 이름·선언 형식은 틀려도 실제 PNG이면 그림으로 처리한다.
    const data = attachmentForm(await image());
    data.set('meta', JSON.stringify(meta()));
    expect((await artwork(await call(artworksPath(), { method: 'POST', body: data }))).kind).toBe('IMAGE');
  });

  it('25MB를 넘는 파일은 수신 중 거절하고 임시 파일·예약을 돌려준다', async () => {
    const bytes = Buffer.alloc(25 * 1024 ** 2 + 1);
    expect((await failure(await upload(meta(), bytes))).code).toBe('E_FILE_TOO_LARGE');
    expect(await tmpFiles()).toEqual([]);
    expect(s.count('assets')).toBe(0);
    expect((await artwork(await upload(meta(), await image()))).status).toBe('PUBLISHED');
  });

  it('지운 작품과 같은 파일을 새 ID로 올릴 수 있고 같은 ID의 다른 meta는 E_CONFLICT', async () => {
    const bytes = await image();
    const body = meta();
    const first = await artwork(await upload(body, bytes));
    expect((await failure(await upload({ ...body, title: '바뀐 제목' }, bytes))).code).toBe('E_CONFLICT');
    expect(
      (
        await call(`/api/teacher/artworks/${first.id}`, {
          method: 'DELETE',
          headers: { 'if-match': String(first.rev) },
        })
      ).status,
    ).toBe(204);
    const second = await artwork(await upload(meta(), bytes));
    expect(second.id).not.toBe(first.id);
    expect(second.image!.asset.assetId).not.toBe(first.image!.asset.assetId);
    expect(s.count('assets')).toBe(2);
  });

  it.skipIf(process.platform !== 'darwin')('sips로 만든 HEIC를 같은 그림 경로로 처리한다', async () => {
    const path = join(t.root, 'heic-source.jpg');
    await makeImage(path, 900, 1000);
    const heic = join(t.root, 'source.heic');
    await makeHeic(path, heic);
    const art = await artwork(await upload(meta(), await readFile(heic)));
    expect([art.image?.w, art.image?.h]).toEqual([900, 1000]);
    expect(art.image?.asset.variants.every(v => v.ext === 'webp')).toBe(true);
  });

  it.skipIf(process.platform !== 'darwin')(
    'ID3·표지 MP3의 태그를 지우고 표지와 소리 분석을 저장한다',
    async () => {
      const path = join(t.root, 'tagged.mp3');
      const frames = await makeTaggedMp3(path);
      const body = { ...meta(), kind: 'AUDIO' };
      const art = await artwork(await upload(body, await readFile(path)));
      expect(art.form).toBe('SOUND');
      const audio = art.audio!;
      const output = join(exhibitionMediaDir(t.env.mediaDir, exhibitionId), audio.asset.assetId, 'audio.mp3');
      expect(await readFile(output)).toEqual(frames);
      const tags = await parseFile(output);
      expect(tags.common.picture).toBeUndefined();
      expect(Object.keys(tags.native)).toEqual([]);
      expect(audio.cover?.variants.map(v => v.name)).toEqual(['cover']);
      expect(audio.analysis).toEqual({ audibleStartMs: 0, audibleEndMs: 0, loudnessDb: null });
    },
  );

  it('11분 WAV는 디코딩 전에 E_AUDIO_LENGTH로 거절한다', async () => {
    const body = { ...meta(), kind: 'AUDIO' };
    expect((await failure(await upload(body, wavBytes(11 * 60, { sampleRate: 8000 })))).code).toBe(
      'E_AUDIO_LENGTH',
    );
    expect(s.store.artworks.get(body.id)).toMatchObject({ status: 'FAILED', failCode: 'E_AUDIO_LENGTH' });
    expect(await tmpFiles()).toEqual([]);
    expect(s.count('assets')).toBe(0);
  });

  it('포스터 올리기·재시도·바꾸기·빼기는 전시 응답과 판을 맞춘다', async () => {
    const path = `/api/teacher/exhibitions/${exhibitionId}/poster`;
    const bytes = await image();
    const first = await json(
      await call(path, { method: 'PUT', body: attachmentForm(bytes) }),
      ExhibitionTeacherSchema,
    );
    expect(first.poster?.variants.map(v => v.name)).toEqual(['thumb', 'wall', 'wall-lo', 'zoom']);
    expect(
      await json(await call(path, { method: 'PUT', body: attachmentForm(bytes) }), ExhibitionTeacherSchema),
    ).toEqual(first);
    const second = await json(
      await call(path, { method: 'PUT', body: attachmentForm(await sourceBytes('poster2.png', 900, 1000)) }),
      ExhibitionTeacherSchema,
    );
    expect(second.poster?.assetId).not.toBe(first.poster?.assetId);
    expect(second.rev).toBe(first.rev + 1);
    expect((await call(path, { method: 'DELETE' })).status).toBe(204);
    expect((await view()).exhibition.poster).toBeNull();
    const rev = (await view()).exhibition.rev;
    expect((await call(path, { method: 'DELETE' })).status).toBe(204);
    expect((await view()).exhibition.rev).toBe(rev);
  });

  it.skipIf(process.platform !== 'darwin')(
    '전시실 배경음악을 올리고 빼며 WAV를 메타데이터 없는 AAC로 저장한다',
    async () => {
      const path = `/api/teacher/rooms/${roomId}/bgm`;
      const bytes = wavBytes(1, { startSec: 0.1, endSec: 0.9 });
      const first = await json(
        await call(path, { method: 'PUT', body: attachmentForm(bytes) }),
        RoomTeacherSchema,
      );
      expect(first.bgm?.durationMs).toBe(1000);
      expect(first.bgm?.asset.variants.map(v => v.ext)).toEqual(['m4a']);
      expect(
        await json(await call(path, { method: 'PUT', body: attachmentForm(bytes) }), RoomTeacherSchema),
      ).toEqual(first);
      expect((await call(path, { method: 'DELETE' })).status).toBe(204);
      expect((await view()).rooms[0]?.bgm).toBeNull();
      expect((await call(path, { method: 'DELETE' })).status).toBe(204);
    },
  );

  it('PDF 쪽 순서는 자유롭고 같은 쪽은 멱등이며 빠진 쪽·다른 내용은 거절한다', async () => {
    const body = { ...meta(), kind: 'PDF', pageCount: 3 };
    const create = () =>
      call(artworksPath(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const first = await artwork(await create());
    expect(await artwork(await create())).toEqual(first);
    const bytes = await image();
    expect((await call(pagePath(first.id, 3), { method: 'PUT', body: attachmentForm(bytes) })).status).toBe(
      204,
    );
    const pagesBefore = s.count('assets');
    const revBefore = s.store.artworks.get(first.id)?.rev;
    expect((await call(pagePath(first.id, 3), { method: 'PUT', body: attachmentForm(bytes) })).status).toBe(
      204,
    );
    expect(s.count('assets')).toBe(pagesBefore);
    expect(s.store.artworks.get(first.id)?.rev).toBe(revBefore);
    const complete = () => call(`/api/teacher/artworks/${first.id}/complete`, { method: 'POST' });
    expect(await failure(await complete())).toMatchObject({ code: 'E_VALIDATION', fields: { pages: '1,2' } });
    expect(
      (
        await failure(
          await call(pagePath(first.id, 3), {
            method: 'PUT',
            body: attachmentForm(await sourceBytes('page-new.png', 900, 1000)),
          }),
        )
      ).code,
    ).toBe('E_CONFLICT');
    for (const idx of [1, 2])
      expect(
        (await call(pagePath(first.id, idx), { method: 'PUT', body: attachmentForm(bytes) })).status,
      ).toBe(204);
    const completed = await artwork(await complete());
    expect(completed.status).toBe('PUBLISHED');
    expect(completed.pages?.map(p => p.idx)).toEqual([1, 2, 3]);
    expect(await artwork(await complete())).toEqual(completed);
    expect((await call(pagePath(first.id, 3), { method: 'PUT', body: attachmentForm(bytes) })).status).toBe(
      204,
    );
    for (const idx of [0, 4])
      expect(
        (await failure(await call(pagePath(first.id, idx), { method: 'PUT', body: attachmentForm(bytes) })))
          .code,
      ).toBe('E_VALIDATION');
  });

  it('전시당·전체·남은 디스크 공간 한도를 예약 단계에서 확인하고 거절 뒤 다음 요청은 가능하다', async () => {
    const bytes = await image();
    for (const over of [
      { exhibitionBytes: config().EXHIBITION_MAX_MB * 1024 ** 2 },
      { mediaBytes: config().MEDIA_DISK_MAX_GB * 1024 ** 3 },
      { freeBytes: config().DISK_FREE_MIN_GB * 1024 ** 3 },
    ]) {
      disk = { exhibitionBytes: 0, mediaBytes: 0, freeBytes: 100 * 1024 ** 3, ...over };
      expect((await failure(await upload(meta(), bytes))).code).toBe('E_QUOTA');
      expect(s.count('artworks')).toBe(0);
      expect(await tmpFiles()).toEqual([]);
    }
    disk = undefined;
    expect((await artwork(await upload(meta(), bytes))).status).toBe('PUBLISHED');
  });

  /** 본문을 아직 보내지 않아도 인증·경계·슬롯·Content-Length·예약 결과를 받을 수 있다. */
  const rawRequest = (path: string, headers: Record<string, string>, initial?: Buffer) => {
    let req: ClientRequest;
    const response = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      req = request(
        `${base}${path}`,
        { method: 'POST', headers: { authorization: `Bearer ${token}`, ...headers } },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', (b: Buffer) => chunks.push(b));
          res.on('end', () => {
            try {
              resolve({
                status: res.statusCode ?? 0,
                body: JSON.parse(Buffer.concat(chunks).toString()) as unknown,
              });
            } catch (cause) {
              reject(cause);
            }
          });
        },
      );
      req.on('error', reject);
      req.flushHeaders();
      if (initial) req.write(initial);
    });
    return { req: req!, response };
  };
  const rawError = (result: { body: unknown }) => ApiErrorSchema.parse(result.body).error;
  const rawHeaders = () => ({
    'content-type': 'multipart/form-data; boundary=test',
    'content-length': '10000',
  });

  it('본문을 읽기 전 인증·경계·상태·길이·공간을 검사한다', async () => {
    for (const [path, headers, code] of [
      [artworksPath(), { ...rawHeaders(), authorization: '' }, 'E_AUTH'],
      [`/api/teacher/exhibitions/${randomUUID()}/artworks`, rawHeaders(), 'E_NOT_FOUND'],
      [
        artworksPath(),
        { 'content-type': 'multipart/form-data; boundary=test', 'transfer-encoding': 'chunked' },
        'E_FILE_TOO_LARGE',
      ],
      [artworksPath(), { ...rawHeaders(), 'content-length': String(27 * 1024 ** 2) }, 'E_FILE_TOO_LARGE'],
    ] as const) {
      const pending = rawRequest(path, headers);
      expect(rawError(await pending.response).code).toBe(code);
      pending.req.destroy();
    }
    for (const patch of [{ deleting: true }, { expiresAt: s.at() }]) {
      s.store.exhibitions.update(exhibitionId, patch);
      const pending = rawRequest(artworksPath(), rawHeaders());
      expect(rawError(await pending.response).code).toBe('E_NOT_FOUND');
      pending.req.destroy();
      s.store.exhibitions.update(exhibitionId, { deleting: false, expiresAt: s.at() + 86400000 });
    }
    expect(await tmpFiles()).toEqual([]);
  });

  it('다른 전시의 전시실·작품·PDF·포스터·배경음악은 토큰 경계를 통과하지 못한다', async () => {
    const other = randomUUID();
    const foreignToken = randomToken();
    createExhibition(
      deps,
      {
        exhibitionId: other,
        title: '다른 합성 전시',
        templateId: 'modern-history',
        pin: '69583724',
        linkTokenHash: tokenHash(foreignToken),
      },
      { deviceRegistered: true },
    );
    const room = randomUUID();
    createRoom(deps, other, { id: room, order: 0, title: '다른 방' });
    const bytes = await image();
    expect((await failure(await upload({ ...meta(), roomId: room }, bytes))).code).toBe('E_NOT_FOUND');
    expect(
      (
        await failure(
          await call(`/api/teacher/rooms/${room}/bgm`, { method: 'PUT', body: attachmentForm(bytes) }),
        )
      ).code,
    ).toBe('E_NOT_FOUND');
    expect(
      (
        await failure(
          await call(`/api/teacher/exhibitions/${other}/poster`, {
            method: 'PUT',
            body: attachmentForm(bytes),
          }),
        )
      ).code,
    ).toBe('E_NOT_FOUND');
    const foreignPdf = await artwork(
      await call(`/api/teacher/exhibitions/${other}/artworks`, {
        method: 'POST',
        headers: { authorization: `Bearer ${foreignToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...meta(), roomId: room, kind: 'PDF', pageCount: 1 }),
      }),
    );
    expect(
      (await failure(await call(pagePath(foreignPdf.id, 1), { method: 'PUT', body: attachmentForm(bytes) })))
        .code,
    ).toBe('E_NOT_FOUND');
    expect(
      (await failure(await call(`/api/teacher/artworks/${foreignPdf.id}/complete`, { method: 'POST' }))).code,
    ).toBe('E_NOT_FOUND');
    expect((await failure(await upload({ ...meta(), id: foreignPdf.id }, bytes))).code).toBe('E_NOT_FOUND');
    expect(s.count('assets')).toBe(0);
    expect(s.count('artworks', exhibitionId)).toBe(0);
    expect(s.count('artworks', other)).toBe(1);
  });

  it('수신 슬롯은 전시당·전체 한도를 지키고 연결 끊김·무응답 뒤에 반환된다', async () => {
    overrideConfig({ UPLOAD_SLOTS_PER_EXHIBITION: 1, UPLOAD_SLOTS_GLOBAL: 1, UPLOAD_IDLE_TIMEOUT_SEC: 0.15 });
    const first = rawRequest(artworksPath(), rawHeaders(), Buffer.from('--test\r\n'));
    void first.response.catch(() => undefined);
    await expect.poll(async () => (await tmpFiles()).length).toBe(1);
    const busy = rawRequest(artworksPath(), rawHeaders());
    expect(rawError(await busy.response)).toMatchObject({ code: 'E_BUSY', retryable: true });
    busy.req.destroy();
    first.req.destroy();
    await expect.poll(tmpFiles).toEqual([]);
    const idle = rawRequest(artworksPath(), rawHeaders(), Buffer.from('--test\r\n'));
    expect(rawError(await idle.response)).toMatchObject({
      code: 'E_FILE_BROKEN',
      fields: { _: 'upload_idle' },
    });
    idle.req.destroy();
    expect(await tmpFiles()).toEqual([]);
    expect((await artwork(await upload(meta(), await image()))).status).toBe('PUBLISHED');
  });

  it('대기열이 가득 차면 E_BUSY이고 같은 요청을 다시 보내면 처리할 수 있다', async () => {
    overrideConfig({ PROCESS_CONCURRENCY: 1, PROCESS_QUEUE_MAX: 0 });
    let release = () => {};
    let started = false;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    processor = async (...args) => {
      started = true;
      await gate;
      return runMedia(...args);
    };
    const first = upload(meta(), await image());
    await expect.poll(() => started).toBe(true);
    const body = meta();
    const secondBytes = await sourceBytes('second.png', 900, 1000);
    expect((await failure(await upload(body, secondBytes))).code).toBe('E_BUSY');
    expect(s.store.artworks.get(body.id)).toMatchObject({ status: 'FAILED', failCode: 'E_BUSY' });
    release();
    await artwork(await first);
    expect((await artwork(await upload(body, secondBytes))).status).toBe('PUBLISHED');
    expect(await tmpFiles()).toEqual([]);
  });

  it('같은 파일을 동시에 보내도 중복 asset은 하나만 쓰고 멱등 응답을 공유한다', async () => {
    overrideConfig({ PROCESS_CONCURRENCY: 2 });
    const body = meta();
    const bytes = await image();
    const [a, b] = await Promise.all([upload(body, bytes).then(artwork), upload(body, bytes).then(artwork)]);
    expect(a).toEqual(b);
    expect(s.count('assets')).toBe(1);
    expect(await readdir(exhibitionMediaDir(t.env.mediaDir, exhibitionId))).toEqual([a.image!.asset.assetId]);
    expect(await tmpFiles()).toEqual([]);
  });

  it('속도 칸은 본문·수신 슬롯보다 먼저 거절한다', async () => {
    rateLimits.device = 1;
    const first = await artwork(await upload(meta(), await image()));
    expect(first.status).toBe('PUBLISHED');
    const pending = rawRequest(artworksPath(), rawHeaders());
    expect(rawError(await pending.response)).toMatchObject({ code: 'E_RATE_LIMITED', retryable: true });
    pending.req.destroy();
    expect(await tmpFiles()).toEqual([]);
  });

  it('지금 삭제는 진행 중인 수신을 취소한 뒤 폴더·행을 지우고 늦은 파일을 남기지 않는다', async () => {
    overrideConfig({ DELETE_WAIT_SEC: 0 });
    const pending = rawRequest(artworksPath(), rawHeaders(), Buffer.from('--test\r\n'));
    void pending.response.catch(() => undefined);
    await expect.poll(async () => (await tmpFiles()).length).toBe(1);
    const rev = s.store.exhibitions.get(exhibitionId)!.rev;
    expect(
      (
        await call(`/api/teacher/exhibitions/${exhibitionId}`, {
          method: 'DELETE',
          headers: { 'if-match': String(rev) },
        })
      ).status,
    ).toBe(200);
    expect(rawError(await pending.response).code).toBe('E_NOT_FOUND');
    pending.req.destroy();
    expect(s.store.exhibitions.get(exhibitionId)).toBeNull();
    expect(s.count('assets')).toBe(0);
    expect(await tmpFiles()).toEqual([]);
    expect(await readdir(join(t.env.mediaDir, 'exh')).catch(() => [])).toEqual([]);
  });
  it('서로 다른 전시도 전체 수신 슬롯을 공유한다', async () => {
    overrideConfig({ UPLOAD_SLOTS_PER_EXHIBITION: 2, UPLOAD_SLOTS_GLOBAL: 1 });
    const other = randomUUID();
    const otherToken = randomToken();
    createExhibition(
      deps,
      {
        exhibitionId: other,
        title: '다른 전시',
        templateId: 'modern-history',
        pin: '69583724',
        linkTokenHash: tokenHash(otherToken),
      },
      { deviceRegistered: true },
    );
    const first = rawRequest(artworksPath(), rawHeaders(), Buffer.from('--test\r\n'));
    void first.response.catch(() => undefined);
    await expect.poll(async () => (await tmpFiles()).length).toBe(1);
    const next = rawRequest(`/api/teacher/exhibitions/${other}/artworks`, {
      ...rawHeaders(),
      authorization: `Bearer ${otherToken}`,
    });
    expect(rawError(await next.response).code).toBe('E_BUSY');
    next.req.destroy();
    first.req.destroy();
    await expect.poll(tmpFiles).toEqual([]);
  });

  it('파일 처리·대기 중 지금 삭제는 프로세스와 대기열을 취소하고 폴더를 다시 만들지 않는다', async () => {
    overrideConfig({ PROCESS_CONCURRENCY: 1, PROCESS_QUEUE_MAX: 2, DELETE_WAIT_SEC: 0 });
    let processing = false;
    let canceled = false;
    processor = (...args) => {
      processing = true;
      args[3].addEventListener(
        'abort',
        () => {
          canceled = true;
        },
        { once: true },
      );
      return runMedia(...args);
    };
    const first = upload(meta(), await sourceBytes('running.png', 800, 20000, { bands: true }));
    await expect.poll(() => processing, { interval: 5 }).toBe(true);
    const second = upload(meta(), await image());
    await expect.poll(() => uploads.queueLength(), { interval: 5 }).toBe(1);
    const rev = s.store.exhibitions.get(exhibitionId)!.rev;
    expect(
      (
        await call(`/api/teacher/exhibitions/${exhibitionId}`, {
          method: 'DELETE',
          headers: { 'if-match': String(rev) },
        })
      ).status,
    ).toBe(200);
    expect(canceled).toBe(true);
    expect((await failure(await first)).code).toBe('E_NOT_FOUND');
    expect((await failure(await second)).code).toBe('E_NOT_FOUND');
    expect(uploads.queueLength()).toBe(0);
    expect(s.store.exhibitions.get(exhibitionId)).toBeNull();
    expect(await tmpFiles()).toEqual([]);
    expect(await readdir(join(t.env.mediaDir, 'exh'))).toEqual([]);
  });

  it('DB 쓰기가 실패하면 asset·작품 트랜잭션을 되돌리고 공개 파일을 지운다', async () => {
    const original = s.store.artworks.insert.bind(s.store.artworks);
    const insert = vi.spyOn(s.store.artworks, 'insert').mockImplementationOnce(() => {
      throw new Error('synthetic store failure');
    });
    const body = meta();
    expect((await failure(await upload(body, await image()))).code).toBe('E_SERVER');
    expect(s.count('assets')).toBe(0);
    expect(s.store.artworks.get(body.id)).toMatchObject({ status: 'FAILED', failCode: 'E_SERVER' });
    expect(await readdir(exhibitionMediaDir(t.env.mediaDir, exhibitionId))).toEqual([]);
    expect(await tmpFiles()).toEqual([]);
    insert.mockImplementation(original);
    expect((await artwork(await upload(body, await image()))).status).toBe('PUBLISHED');
    insert.mockRestore();
  });

  it('파일·필드 개수와 meta JSON을 검사하고 잘린 multipart를 거절한다', async () => {
    const bytes = await image();
    const doubleFile = form(meta(), bytes);
    doubleFile.append('file', new Blob([new Uint8Array(bytes)]), 'second.png');
    expect((await failure(await call(artworksPath(), { method: 'POST', body: doubleFile }))).code).toBe(
      'E_FILE_TOO_LARGE',
    );
    const doubleMeta = form(meta(), bytes);
    doubleMeta.append('meta', '{}');
    expect((await failure(await call(artworksPath(), { method: 'POST', body: doubleMeta }))).code).toBe(
      'E_FILE_TOO_LARGE',
    );
    const invalidJson = attachmentForm(bytes);
    invalidJson.set('meta', '{');
    expect((await failure(await call(artworksPath(), { method: 'POST', body: invalidJson }))).code).toBe(
      'E_VALIDATION',
    );
    const unexpected = attachmentForm(bytes);
    unexpected.set('unexpected', '{}');
    expect((await failure(await call(artworksPath(), { method: 'POST', body: unexpected }))).code).toBe(
      'E_VALIDATION',
    );
    const truncated =
      '--test\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\ntruncated';
    expect(
      (
        await failure(
          await call(artworksPath(), {
            method: 'POST',
            headers: { 'content-type': 'multipart/form-data; boundary=test' },
            body: truncated,
          }),
        )
      ).code,
    ).toBe('E_FILE_BROKEN');
    expect(await tmpFiles()).toEqual([]);
    expect(s.count('assets')).toBe(0);
  });
  it('처리 중 만료되면 파생·행을 남기지 않고 같은 요청도 다시 노출하지 않는다', async () => {
    processor = async (...args) => {
      s.advance(31 * 86400000);
      return runMedia(...args);
    };
    const body = meta();
    expect((await failure(await upload(body, await image()))).code).toBe('E_NOT_FOUND');
    expect(s.store.artworks.get(body.id)).toBeNull();
    expect(s.count('assets')).toBe(0);
    expect(await tmpFiles()).toEqual([]);
    expect(await readdir(exhibitionMediaDir(t.env.mediaDir, exhibitionId))).toEqual([]);
  });
  it('서버 종료 취소는 재시도 가능한 FAILED로 남기고 같은 ID로 다시 처리할 수 있다', async () => {
    let started = false;
    processor = (...args) => {
      started = true;
      return runMedia(...args);
    };
    const body = meta();
    const bytes = await sourceBytes('shutdown.png', 800, 20000, { bands: true });
    const pending = upload(body, bytes);
    await expect.poll(() => started, { interval: 5 }).toBe(true);
    await uploads.drainAll(0);
    expect((await failure(await pending)).code).toBe('E_BUSY');
    expect(s.store.artworks.get(body.id)).toMatchObject({ status: 'FAILED', failCode: 'E_BUSY' });
    expect(await tmpFiles()).toEqual([]);
    expect(await readdir(exhibitionMediaDir(t.env.mediaDir, exhibitionId))).toEqual([]);
    expect((await artwork(await upload(body, bytes))).status).toBe('PUBLISHED');
  });
});
