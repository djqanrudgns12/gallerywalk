import { config } from '@gallery/core/config';
import { existsSync } from 'node:fs';
import { lutimes, mkdir, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteArtwork, restoreArtwork } from '../../src/application/artworks.ts';
import { createExhibition } from '../../src/application/exhibitions.ts';
import { recomputeLayout } from '../../src/application/layout.ts';
import { createRoom } from '../../src/application/rooms.ts';
import { teacherView } from '../../src/application/views.ts';
import { createMediaFiles, exhibitionMediaDir } from '../../src/deps.ts';
import { createCleanupJobs } from '../../src/jobs/index.ts';
import type { ArtworkRecord, AssetRecord, Deps } from '../../src/ports/index.ts';
import { UploadManager } from '../../src/upload/index.ts';
import { checkTarget, completePdfArtwork, createPdfArtwork } from '../../src/upload/records.ts';
import { makeTempDir } from '../helpers/server.ts';
import { TEST_STORES, type TestDeps } from '../support/sqliteDeps.ts';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const id = (group: number, n: number) => `${group}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EX = id(1, 1);
const ROOM = id(2, 1);
const ART = id(3, 1);
const ASSET = id(9, 1);

describe.each(TEST_STORES)('주기 정리 · $name', ({ make }) => {
  let t: TestDeps;
  let root: string;
  let deps: Deps;
  let jobs: ReturnType<typeof createCleanupJobs>;
  let activeTmp: Set<string>;
  const file = (assetId: string) => join(root, 'media', 'exh', EX, assetId, 'wall.webp');
  const seedAsset = async (assetId: string, createdAt = t.at(), patch: Partial<AssetRecord> = {}) => {
    t.store.assets.insert({
      id: assetId,
      exhibitionId: EX,
      kind: 'IMAGE',
      width: 512,
      height: 512,
      durationMs: null,
      variants: [{ name: 'wall', ext: 'webp', w: 512, h: 512, bytes: 1 }],
      analysis: null,
      bytesTotal: 1,
      contentHash: assetId,
      createdAt,
      ...patch,
    });
    await mkdir(join(file(assetId), '..'), { recursive: true });
    await writeFile(file(assetId), 'x');
  };
  const seedArt = (artworkId = ART, assetId: string | null = ASSET, patch: Partial<ArtworkRecord> = {}) => {
    t.store.artworks.insert({
      id: artworkId,
      exhibitionId: EX,
      roomId: ROOM,
      order: 0,
      title: '합성 그림',
      author: null,
      captionShort: null,
      descriptionLong: null,
      kind: 'IMAGE',
      form: 'SQUARE',
      formOverride: null,
      textHeavy: false,
      textHeavyOverride: null,
      featured: false,
      pageMode: 'AUTO',
      status: 'PUBLISHED',
      sourceAssetId: assetId,
      pageCount: null,
      textBody: null,
      warnings: [],
      failCode: null,
      deletedAt: null,
      rev: 1,
      createHash: artworkId,
      createdAt: t.at(),
      updatedAt: t.at(),
      ...patch,
    });
  };
  const tick = async (ms: number) => {
    t.advance(ms);
    await jobs.runCycle();
  };

  beforeEach(async () => {
    t = make();
    root = await makeTempDir();
    deps = { ...t.deps, media: createMediaFiles(join(root, 'media')) };
    activeTmp = new Set();
    jobs = createCleanupJobs(deps, {
      tmpDir: join(root, 'tmp'),
      isTemporaryPathActive: path => activeTmp.has(path),
    });
    createExhibition(
      deps,
      {
        exhibitionId: EX,
        title: '합성 전시',
        templateId: 'modern-history',
        pin: '58392647',
        linkTokenHash: 'b'.repeat(64),
      },
      { deviceRegistered: true },
    );
    createRoom(deps, EX, { id: ROOM, title: '합성 전시실', order: 0 });
  });
  afterEach(async () => {
    await jobs.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
    t.close();
    await rm(root, { recursive: true, force: true });
  });

  it('만료 시각부터 접근을 막고 다음 60초 주기에 폴더·연쇄 행·WAL을 지운다', async () => {
    await seedAsset(ASSET);
    seedArt();
    t.store.exhibitions.update(EX, { expiresAt: t.at() + MINUTE });
    vi.useFakeTimers();
    await jobs.start();
    t.advance(MINUTE);
    expect(() => teacherView(deps, EX)).toThrowError(expect.objectContaining({ code: 'E_NOT_FOUND' }));
    await vi.advanceTimersByTimeAsync(MINUTE);
    await jobs.stop();
    expect(t.store.exhibitions.get(EX)).toBeNull();
    expect(t.count('artworks')).toBe(0);
    expect(t.count('assets')).toBe(0);
    expect(existsSync(file(ASSET))).toBe(false);
    expect(t.trail).toContain('checkpoint');
    if (t.walBytes() !== null) expect(t.walBytes()).toBe(0);
  });

  it('폴더 실패를 개수로만 기록하고 deleting 전시를 다음 주기에 다시 지운다', async () => {
    await seedAsset(ASSET);
    t.store.exhibitions.update(EX, { expiresAt: t.at() });
    vi.spyOn(deps.media, 'removeExhibition').mockRejectedValueOnce(new Error('민감한 경로 PIN 토큰'));
    await jobs.runCycle();
    expect(t.store.exhibitions.get(EX)?.deleting).toBe(true);
    expect(existsSync(file(ASSET))).toBe(true);
    expect(t.logs).toContainEqual({ level: 'warn', msg: 'retention_cleanup_failed', fields: { count: 1 } });
    expect(JSON.stringify(t.logs)).not.toContain('민감한');
    await tick(MINUTE);
    expect(t.store.exhibitions.get(EX)).toBeNull();
    expect(existsSync(file(ASSET))).toBe(false);
  });

  it('만료 전이더라도 deleting = 1이면 이어서 정리한다', async () => {
    await seedAsset(ASSET);
    t.store.exhibitions.update(EX, { deleting: true });
    await jobs.runCycle();
    expect(t.store.exhibitions.get(EX)).toBeNull();
    expect(existsSync(file(ASSET))).toBe(false);
  });

  it('지운 작품은 23시간에 유지하고 24시간에 쪽·반응·source·쪽 asset까지 정리한다', async () => {
    await seedAsset(ASSET);
    const page = id(9, 2);
    await seedAsset(page, t.at(), { kind: 'PAGE' });
    seedArt();
    t.store.pages.put({ artworkId: ART, idx: 1, assetId: page });
    t.store.visitors.insert({
      tokenHash: 'v'.repeat(64),
      exhibitionId: EX,
      nickname: '합성 별명',
      nicknameNorm: null,
      consentVersion: null,
      consentAt: null,
      createdAt: t.at(),
    });
    t.store.reactions.upsert({
      id: id(4, 1),
      exhibitionId: EX,
      artworkId: ART,
      visitorTokenHash: 'v'.repeat(64),
      sticker: 'MOVED',
      memo: '합성 메모',
      scoreFact: null,
      scoreDelivery: null,
      hidden: false,
      publicSelected: false,
      createdAt: t.at(),
      updatedAt: t.at(),
    });
    deleteArtwork(deps, EX, ART, 1);
    await tick(23 * HOUR);
    expect(t.store.artworks.get(ART)?.deletedAt).not.toBeNull();
    expect(existsSync(file(ASSET))).toBe(true);
    await tick(HOUR);
    expect(t.store.artworks.get(ART)).toBeNull();
    expect(t.count('pages')).toBe(0);
    expect(t.count('reactions')).toBe(0);
    expect(t.count('assets')).toBe(0);
    expect(existsSync(file(ASSET))).toBe(false);
    expect(existsSync(file(page))).toBe(false);
    expect(t.trail).toContain('checkpoint');
    expect(JSON.stringify(t.logs)).not.toMatch(/합성 (별명|메모|그림)/);
  });

  it('오래된 미완성 PDF는 소프트 삭제 후 기존 유예를 거쳐 작품·쪽·자산 파일을 정리한다', async () => {
    await seedAsset(ASSET, t.at(), { kind: 'PAGE' });
    const art = createPdfArtwork(deps, EX, {
      id: ART,
      roomId: ROOM,
      order: 0,
      title: '합성 미완성 문서',
      kind: 'PDF',
      pageCount: 2,
    });
    t.store.pages.put({ artworkId: ART, idx: 1, assetId: ASSET });
    const layout = recomputeLayout(deps, EX);
    const exhibition = t.store.exhibitions.get(EX)!;

    await tick(config().PDF_INCOMPLETE_PURGE_HOURS * HOUR);
    expect(t.store.artworks.get(ART)).toMatchObject({ deletedAt: t.at(), rev: art.rev + 1 });
    expect(t.store.artworks.listByExhibition(EX)).toEqual([]);
    expect(t.store.exhibitions.get(EX)).toEqual({
      ...exhibition,
      contentVersion: exhibition.contentVersion + 1,
    });
    expect(recomputeLayout(deps, EX)).toEqual(layout);
    expect(t.store.pages.listByArtworks([ART])).toEqual([{ artworkId: ART, idx: 1, assetId: ASSET }]);
    expect(existsSync(file(ASSET))).toBe(true);

    await tick(config().PURGE_DELETED_HOURS * HOUR);
    expect(t.store.artworks.get(ART)).toBeNull();
    expect(t.store.pages.listByArtworks([ART])).toEqual([]);
    expect(t.store.assets.get(ASSET)).toBeNull();
    expect(existsSync(file(ASSET))).toBe(false);
  });

  it('최근 미완성 PDF와 PDF 쪽 수신을 다시 시작한 작품은 남긴다', async () => {
    const meta = {
      id: ART,
      roomId: ROOM,
      order: 0,
      title: '합성 받는 문서',
      kind: 'PDF' as const,
      pageCount: 2,
    };
    const old = createPdfArtwork(deps, EX, meta);
    t.advance(config().PDF_INCOMPLETE_PURGE_HOURS * HOUR - MINUTE);
    const recent = createPdfArtwork(deps, EX, { ...meta, id: id(3, 2) });
    checkTarget(deps, EX, { kind: 'PAGE', artworkId: ART, idx: 1 });
    const receivedAt = t.at();
    await tick(MINUTE);

    expect(t.store.artworks.get(ART)).toEqual({ ...old, updatedAt: receivedAt });
    expect(t.store.artworks.get(recent.id)).toEqual(recent);
  });

  it('마친 PDF·숨긴 PDF·실패 PDF와 다른 종류는 미완성 PDF 정리 뒤에도 남긴다', async () => {
    await seedAsset(ASSET, t.at(), {
      kind: 'PAGE',
      analysis: {
        edgeLuma: 0.8,
        linePitchPx: null,
        linePitchConfidence: 0,
        lineProfile: null,
        profileBinPx: 8,
      },
    });
    createPdfArtwork(deps, EX, {
      id: ART,
      roomId: ROOM,
      order: 0,
      title: '합성 마친 문서',
      kind: 'PDF',
      pageCount: 1,
    });
    t.store.pages.put({ artworkId: ART, idx: 1, assetId: ASSET });
    completePdfArtwork(deps, EX, ART);
    seedArt(id(3, 2), null, { kind: 'PDF', status: 'HIDDEN' });
    seedArt(id(3, 3), null, { kind: 'PDF', status: 'FAILED', failCode: 'E_FILE_BROKEN' });
    seedArt(id(3, 4), null, { status: 'PROCESSING' });
    seedArt(id(3, 5), null, { kind: 'AUDIO', status: 'PROCESSING' });
    seedArt(id(3, 6), null, { kind: 'TEXT', status: 'PROCESSING' });
    const artworks = t.store.artworks.listByExhibition(EX);
    const asset = t.store.assets.get(ASSET);
    await tick(config().PDF_INCOMPLETE_PURGE_HOURS * HOUR);
    await tick(config().PURGE_DELETED_HOURS * HOUR);

    expect(t.store.artworks.listByExhibition(EX)).toEqual(artworks);
    expect(t.store.pages.listByArtworks([ART])).toEqual([{ artworkId: ART, idx: 1, assetId: ASSET }]);
    expect(t.store.assets.get(ASSET)).toEqual(asset);
    expect(existsSync(file(ASSET))).toBe(true);
  });

  it('되살린 작품과 다른 작품·쪽·포스터·배경음악에서 쓰는 asset은 남긴다', async () => {
    for (let n = 1; n <= 5; n++) await seedAsset(id(9, n));
    seedArt();
    deleteArtwork(deps, EX, ART, 1);
    t.advance(23 * HOUR);
    restoreArtwork(deps, EX, ART);
    seedArt(id(3, 2), id(9, 2));
    t.store.pages.put({ artworkId: ART, idx: 1, assetId: id(9, 3) });
    t.store.exhibitions.update(EX, { posterAssetId: id(9, 4) });
    t.store.rooms.update(ROOM, { bgmAssetId: id(9, 5) });
    await tick(HOUR);
    expect(t.store.artworks.get(ART)?.deletedAt).toBeNull();
    expect(t.count('assets')).toBe(5);
    for (let n = 1; n <= 5; n++) expect(existsSync(file(id(9, n)))).toBe(true);
  });

  it('붙지 않은 asset은 2시간에 정리하고 폴더 실패 뒤에는 asset 행으로 재시도한다', async () => {
    await seedAsset(ASSET);
    await tick(HOUR);
    expect(existsSync(file(ASSET))).toBe(true);
    vi.spyOn(deps.media, 'removeAsset').mockRejectedValueOnce(new Error('가짜 파일 실패'));
    await tick(HOUR);
    expect(t.store.assets.get(ASSET)).not.toBeNull();
    expect(existsSync(file(ASSET))).toBe(true);
    await tick(HOUR);
    expect(t.store.assets.get(ASSET)).toBeNull();
    expect(existsSync(file(ASSET))).toBe(false);
  });

  it('지운 작품의 파일 삭제가 실패해도 asset 행을 남겨 다음 시간에 다시 지운다', async () => {
    await seedAsset(ASSET);
    seedArt();
    deleteArtwork(deps, EX, ART, 1);
    vi.spyOn(deps.media, 'removeAsset').mockRejectedValueOnce(new Error('가짜 파일 실패'));
    await tick(24 * HOUR);
    expect(t.store.assets.get(ASSET)).not.toBeNull();
    await tick(HOUR);
    expect(t.store.assets.get(ASSET)).toBeNull();
    expect(existsSync(file(ASSET))).toBe(false);
  });

  it('임시 파일·폴더는 1시간에 정리하되 새 항목·받는 중 경로·링크 밖은 보존한다', async () => {
    const tmp = join(root, 'tmp');
    await mkdir(join(tmp, 'old-dir'), { recursive: true });
    await mkdir(join(tmp, 'active-dir'));
    await writeFile(join(tmp, 'old-dir', 'input'), 'x');
    await writeFile(join(tmp, 'active-dir', 'input'), 'x');
    await writeFile(join(tmp, 'old-file'), 'x');
    const outside = join(root, 'keep');
    await mkdir(outside);
    await writeFile(join(outside, 'safe'), 'x');
    await symlink(outside, join(tmp, 'old-link'));
    const old = new Date(t.at() - HOUR);
    for (const name of ['old-file', 'old-dir', 'active-dir']) await utimes(join(tmp, name), old, old);
    await lutimes(join(tmp, 'old-link'), old, old);
    activeTmp.add(join(tmp, 'active-dir'));
    await jobs.runCycle();
    expect((await readdir(tmp)).sort()).toEqual(['active-dir']);
    expect(await readdir(outside)).toEqual(['safe']);
    await writeFile(join(tmp, 'new-file'), 'x');
    const fresh = new Date(t.at() + HOUR);
    await utimes(join(tmp, 'new-file'), fresh, fresh);
    await tick(HOUR);
    expect(existsSync(join(tmp, 'new-file'))).toBe(true);
    activeTmp.clear();
    await tick(HOUR);
    expect(await readdir(tmp)).toEqual([]);
  });

  it('실제 UploadManager가 다시 받는 미완성 PDF와 오래된 임시 폴더를 보호한다', async () => {
    const tmpDir = join(root, 'tmp');
    const mediaDir = join(root, 'media');
    const uploads = new UploadManager({
      deps,
      log: deps.log,
      tmpDir,
      mediaDir,
      exhibitionDir: exhibitionId => exhibitionMediaDir(mediaDir, exhibitionId),
      diskUsage: async () => ({ exhibitionBytes: 0, mediaBytes: 0, freeBytes: 100 * 1024 ** 3 }),
    });
    await jobs.stop();
    jobs = createCleanupJobs(
      { ...deps, uploads },
      {
        tmpDir,
        isTemporaryPathActive: path => uploads.isTemporaryPathActive(path),
      },
    );
    createPdfArtwork(deps, EX, {
      id: ART,
      roomId: ROOM,
      order: 0,
      title: '합성 받는 문서',
      kind: 'PDF',
      pageCount: 2,
    });
    t.advance(config().PDF_INCOMPLETE_PURGE_HOURS * HOUR + MINUTE);
    let finished = Promise.resolve();
    const server = createServer((incoming, response) => {
      finished = uploads.receive(EX, { kind: 'PAGE', artworkId: ART, idx: 1 }, incoming).then(
        () => {
          response.end();
        },
        () => {
          response.end();
        },
      );
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test address');
    const client = request({
      hostname: '127.0.0.1',
      port: address.port,
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=cleanup', 'content-length': '1000' },
    });
    client.on('error', () => {});
    try {
      client.write(
        '--cleanup\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\nx',
      );
      let folder = '';
      await vi.waitFor(async () => {
        const names = await readdir(tmpDir).catch(() => []);
        expect(names).toHaveLength(1);
        folder = join(tmpDir, names[0]!);
      });
      const old = new Date(t.at() - 2 * HOUR);
      await utimes(folder, old, old);
      expect(uploads.isTemporaryPathActive(folder)).toBe(true);
      expect(uploads.isTemporaryPathActive(join(folder, 'input'))).toBe(true);
      expect(uploads.isTemporaryPathActive(tmpDir)).toBe(true);
      expect(uploads.isTemporaryPathActive(`${folder}-other`)).toBe(false);
      await jobs.runCycle();
      expect(t.store.artworks.get(ART)).toMatchObject({
        status: 'PROCESSING',
        deletedAt: null,
        updatedAt: t.at(),
      });
      expect(existsSync(folder)).toBe(true);
      await uploads.drainAll(0);
      await finished;
      expect(uploads.isTemporaryPathActive(folder)).toBe(false);
      expect(existsSync(folder)).toBe(false);
    } finally {
      client.destroy();
      server.closeAllConnections();
      await uploads.drainAll(0);
      await finished;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('보관·시간별 정리가 겹치지 않으며 stop은 진행 중 주기를 기다리고 새 주기를 막는다', async () => {
    t.store.exhibitions.update(EX, { expiresAt: t.at() });
    let release = () => {};
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    t.uploads.during = () => blocked;
    const first = jobs.runCycle();
    await expect(jobs.runCycle()).resolves.toBe(false);
    let stopped = false;
    const closing = jobs.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    await expect(jobs.runCycle()).resolves.toBe(false);
    release();
    await first;
    await closing;
    expect(stopped).toBe(true);
    await expect(jobs.runCycle()).resolves.toBe(false);
  });

  it('한 주기 상한 뒤 다음 ID부터 진행해 실패한 첫 전시가 뒷 전시를 막지 않는다', async () => {
    const base = t.store.exhibitions.get(EX)!;
    for (let n = 2; n <= config().CLEANUP_BATCH_SIZE + 1; n++)
      t.store.exhibitions.insert({
        ...base,
        id: id(1, n),
        entryCode: String(200000 + n),
        pinHmac: `batch-${n}`,
        expiresAt: t.at(),
      });
    t.store.exhibitions.update(EX, { expiresAt: t.at() });
    vi.spyOn(deps.media, 'removeExhibition').mockImplementation(async exhibitionId => {
      if (exhibitionId === EX) throw new Error('가짜 파일 실패');
    });
    await jobs.runCycle();
    expect(t.count('exhibitions')).toBe(2);
    await tick(MINUTE);
    expect(t.count('exhibitions')).toBe(1);
    expect(t.store.exhibitions.get(EX)?.deleting).toBe(true);
  });
});
