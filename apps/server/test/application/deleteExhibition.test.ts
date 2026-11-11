import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, resetConfig } from '@gallery/core/config';
import { AppError, type ErrorCode } from '@gallery/core/errors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { patchArtwork } from '../../src/application/artworks.ts';
import { deleteExhibition } from '../../src/application/deleteExhibition.ts';
import { changeStatus, createExhibition, patchExhibition } from '../../src/application/exhibitions.ts';
import { recomputeLayout } from '../../src/application/layout.ts';
import { pinLogin } from '../../src/application/pin.ts';
import { createRoom } from '../../src/application/rooms.ts';
import { createTextArtwork } from '../../src/application/textArtworks.ts';
import { exhibitionView, teacherView, versionInfo } from '../../src/application/views.ts';
import { myReactions, putReaction, registerVisitor } from '../../src/application/visitors.ts';
import { createMediaFiles } from '../../src/deps.ts';
import type { AssetRecord, DeletedRows, Deps } from '../../src/ports/index.ts';
import { makeTempDir } from '../helpers/server.ts';
import { sqliteTestDeps, TEST_STORES, type CountedTable, type TestDeps } from '../support/sqliteDeps.ts';

/**
 * "지금 삭제"·보관 정리 공통 함수(PLAN §9.7): 순서(deleting → 업로드 기다림 → 폴더 → 확인 → 행 → 체크포인트),
 * 폴더 실패 때 행이 deleting = 1로 남아 다시 하면 이어서 됨, 지우는 중 요청은 없는 전시, 멱등.
 * 메모리·SQLite 두 저장소로. 미디어는 가짜(`testDeps`) — 실제 폴더 구현(`createMediaFiles`)은 아래 따로.
 */

const id = (kind: number, n: number) =>
  `00000000-0000-4000-8${String(kind).padStart(3, '0')}-${String(n).padStart(12, '0')}`;
const A = id(1, 1);
const B = id(1, 2);
/** 전시마다 다른 PIN(같은 PIN은 만들 수 없다) */
const pinOf = (exhibitionId: string): string => (exhibitionId === A ? '482910' : '739104');
/** 토큰 해시 모양(소문자 16진 64자) */
const hash = (n: number): string => n.toString(16).padStart(64, '0');
const WAIT_MS = () => config().DELETE_WAIT_SEC * 1000;
const TABLES: readonly CountedTable[] = [
  'exhibitions',
  'rooms',
  'artworks',
  'pages',
  'assets',
  'layouts',
  'sessions',
  'visitors',
  'reactions',
];

const code = async (fn: () => unknown): Promise<ErrorCode | 'OK'> => {
  try {
    await fn();
    return 'OK';
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
};

const asset = (exhibitionId: string, n: number, over: Partial<AssetRecord> = {}): AssetRecord => ({
  id: id(9, n),
  exhibitionId,
  kind: 'IMAGE',
  width: 3000,
  height: 2000,
  durationMs: null,
  variants: [{ name: 'wall', ext: 'webp', w: 1600, h: 1067, bytes: 120_000 }],
  analysis: { edgeLuma: 0.8, linePitchPx: null, linePitchConfidence: 0, lineProfile: null, profileBinPx: 8 },
  bytesTotal: 120_000,
  contentHash: `h${n}`,
  createdAt: 0,
  ...over,
});

interface Seeded {
  readonly entryCode: string;
  readonly imageArt: string;
  readonly textArt: string;
  readonly visitors: readonly [string, string];
}

/**
 * 전시 하나를 가득 채운다: 전시실 2(하나는 배경음악 asset)·그림 작품(asset)·PDF 작품(쪽 2, 숨김)·글 작품·배치·
 * LINK/PIN 세션·방문자 2·반응 2. `base`로 전시마다 다른 ID를 쓴다. 이름·메모는 가상 글.
 */
const seedFull = (deps: Deps, exhibitionId: string, base: number): Seeded => {
  createExhibition(
    deps,
    {
      exhibitionId,
      title: '하늘고래 전시',
      templateId: 'modern-history',
      pin: pinOf(exhibitionId),
      linkTokenHash: hash(base),
    },
    { deviceRegistered: true },
  );
  const r1 = id(2, base + 1);
  const r2 = id(2, base + 2);
  createRoom(deps, exhibitionId, { id: r1, order: 0, title: '1 전시실' });
  createRoom(deps, exhibitionId, { id: r2, order: 1, title: '2 전시실' });
  // 배경음악 asset(전시실 → asset은 ON DELETE SET NULL — 연쇄 안에서도 걸리지 않아야 함)
  deps.store.assets.insert(
    asset(exhibitionId, base + 4, {
      kind: 'AUDIO',
      width: null,
      height: null,
      durationMs: 30_000,
      analysis: null,
    }),
  );
  deps.store.rooms.update(r2, { bgmAssetId: id(9, base + 4) });

  deps.store.assets.insert(asset(exhibitionId, base + 1));
  const imageArt = id(3, base + 1);
  deps.store.artworks.insert({
    id: imageArt,
    exhibitionId,
    roomId: r1,
    order: 0,
    title: '바람의 그림',
    author: null,
    captionShort: null,
    descriptionLong: null,
    kind: 'IMAGE',
    form: 'LANDSCAPE',
    formOverride: null,
    textHeavy: false,
    textHeavyOverride: null,
    featured: false,
    pageMode: 'AUTO',
    status: 'PUBLISHED',
    sourceAssetId: id(9, base + 1),
    pageCount: null,
    textBody: null,
    warnings: [],
    failCode: null,
    deletedAt: null,
    rev: 1,
    createHash: `c${base + 1}`,
    createdAt: 0,
    updatedAt: 0,
  });
  // PDF 작품과 쪽(쪽 → asset 외래키는 연쇄가 아님 — 한 문장 안에서 함께 지워져야 함)
  const pdfArt = id(3, base + 2);
  deps.store.assets.insert(asset(exhibitionId, base + 2, { kind: 'PAGE' }));
  deps.store.assets.insert(asset(exhibitionId, base + 3, { kind: 'PAGE' }));
  deps.store.artworks.insert({
    ...deps.store.artworks.get(imageArt)!,
    id: pdfArt,
    order: 1,
    title: '보고서',
    kind: 'PDF',
    form: 'MULTIPAGE',
    status: 'HIDDEN',
    sourceAssetId: null,
    pageCount: 2,
    createHash: `c${base + 2}`,
  });
  deps.store.pages.put({ artworkId: pdfArt, idx: 1, assetId: id(9, base + 2) });
  deps.store.pages.put({ artworkId: pdfArt, idx: 2, assetId: id(9, base + 3) });

  const textArt = id(3, base + 3);
  createTextArtwork(deps, exhibitionId, {
    id: textArt,
    roomId: r2,
    order: 0,
    title: '바람의 편지',
    kind: 'TEXT',
    textBody: '바람이 불면 편지를 써요.',
  });
  changeStatus(deps, exhibitionId, 'open');
  recomputeLayout(deps, exhibitionId);
  const entryCode = deps.store.exhibitions.get(exhibitionId)!.entryCode;
  expect(pinLogin(deps, { pin: pinOf(exhibitionId), sessionTokenHash: hash(base + 5) })).toEqual({
    exhibitionId,
  });
  const v1 = hash(base + 6);
  const v2 = hash(base + 7);
  const consentVersion = config().CONSENT_VERSION;
  registerVisitor(deps, entryCode, { tokenHash: v1, nickname: '하늘고래', consentVersion });
  registerVisitor(deps, entryCode, { tokenHash: v2, consentVersion });
  putReaction(deps, entryCode, v1, imageArt, {
    sticker: 'MOVED',
    memo: '배운 게 많아요',
    scoreFact: null,
    scoreDelivery: null,
  });
  putReaction(deps, entryCode, v2, textArt, {
    sticker: 'GREAT',
    memo: null,
    scoreFact: null,
    scoreDelivery: null,
  });
  return { entryCode, imageArt, textArt, visitors: [v1, v2] };
};

let t: TestDeps;
const counts = (exhibitionId: string): Record<CountedTable, number> =>
  Object.fromEntries(TABLES.map(table => [table, t.count(table, exhibitionId)])) as Record<
    CountedTable,
    number
  >;
const total = (rows: DeletedRows): number => Object.values(rows).reduce((sum, n) => sum + n, 0);

afterEach(() => resetConfig());

describe.each(TEST_STORES)('전시 지우기(§9.7) · $name', ({ make }) => {
  beforeEach(() => {
    t = make();
  });
  afterEach(() => t.close());

  it('순서대로 지우고 딸린 행을 모두 없앤다 — 다른 전시·폴더는 그대로, 기록은 개수만, 체크포인트', async () => {
    const a = seedFull(t.deps, A, 10);
    seedFull(t.deps, B, 20);
    t.media.folders.add(A);
    t.media.folders.add(B);
    const before = counts(A);
    expect(Object.values(before).every(n => n > 0)).toBe(true);
    const otherBefore = counts(B);

    // 기다리는 동안(1단계 뒤) 이 전시는 이미 지우는 중이고 모든 길에서 없는 전시
    const during: Record<string, ErrorCode | 'OK' | boolean> = {};
    t.uploads.during = async exhibitionId => {
      during.deleting = t.store.exhibitions.get(exhibitionId)?.deleting === true;
      during.teacherView = await code(() => teacherView(t.deps, A));
      during.patch = await code(() => patchExhibition(t.deps, A, { title: '바꿈' }, 2));
      during.room = await code(() => createRoom(t.deps, A, { id: id(2, 99), order: 5, title: '끼어든 방' }));
      during.view = await code(() => exhibitionView(t.deps, a.entryCode));
      during.version = await code(() => versionInfo(t.deps, a.entryCode));
      during.visitor = await code(() =>
        registerVisitor(t.deps, a.entryCode, {
          tokenHash: hash(99),
          consentVersion: config().CONSENT_VERSION,
        }),
      );
      during.reaction = await code(() =>
        putReaction(t.deps, a.entryCode, a.visitors[0], a.imageArt, {
          sticker: 'CURIOUS',
          memo: null,
          scoreFact: null,
          scoreDelivery: null,
        }),
      );
      during.me = await code(() => myReactions(t.deps, a.entryCode, a.visitors[0]));
      // PIN이 맞아도 "틀림"(있는지 알려 주지 않음)
      during.pin = pinLogin(t.deps, { pin: pinOf(A), sessionTokenHash: hash(98) }) === null;
    };

    const rows = await deleteExhibition(t.deps, A, { onGone: gone => t.trail.push(`gone ${gone}`) });

    expect(during).toEqual({
      deleting: true,
      teacherView: 'E_NOT_FOUND',
      patch: 'E_NOT_FOUND',
      room: 'E_NOT_FOUND',
      view: 'E_NOT_FOUND',
      version: 'E_NOT_FOUND',
      visitor: 'E_NOT_FOUND',
      reaction: 'E_NOT_FOUND',
      me: 'E_NOT_FOUND',
      pin: true,
    });
    expect(t.trail).toEqual([
      `gone ${A}`,
      `drain ${A} ${WAIT_MS()}`,
      `remove ${A}`,
      `exists ${A}`,
      'checkpoint',
    ]);
    expect(rows).toEqual(before);
    expect(Object.values(counts(A)).every(n => n === 0)).toBe(true);
    expect(t.store.exhibitions.get(A)).toBeNull();
    expect(t.store.sessions.get(hash(10))).toBeNull();
    expect(t.store.sessions.get(hash(15))).toBeNull();
    expect(counts(B)).toEqual(otherBefore);
    expect([...t.media.folders]).toEqual([B]);
    // 기록: 한 줄, 전시 ID와 개수만(이름·별명·메모 없음)
    expect(t.logs).toEqual([
      { level: 'info', msg: 'exhibition_deleted', fields: { exhibitionId: A, count: total(rows) } },
    ]);
    const logged = JSON.stringify(t.logs);
    for (const text of ['하늘고래', '배운 게 많아요', '바람의 편지', pinOf(A)])
      expect(logged).not.toContain(text);
    // SQLite는 WAL을 비웠다(TRUNCATE)
    const wal = t.walBytes();
    if (wal !== null) expect(wal).toBe(0);
  });

  it('폴더 지우기가 실패하면 멈춘다 — 행은 deleting = 1로 남고, 다시 하면 이어서 지운다', async () => {
    seedFull(t.deps, A, 10);
    t.media.folders.add(A);
    const before = counts(A);
    t.media.failNext();

    await expect(deleteExhibition(t.deps, A)).rejects.toMatchObject({ code: 'E_SERVER' });
    expect(t.store.exhibitions.get(A)?.deleting).toBe(true);
    expect(counts(A)).toEqual(before);
    expect(t.media.folders.has(A)).toBe(true);
    expect(t.trail).toEqual([`drain ${A} ${WAIT_MS()}`, `remove ${A}`]);
    expect(t.logs).toEqual([]);
    // 지우는 중인 전시는 교사 "지금 삭제"로는 다시 못 한다(없는 전시) — 보관 정리가 이어서 한다
    expect(await code(() => deleteExhibition(t.deps, A, { ifMatch: 2 }))).toBe('E_NOT_FOUND');

    t.trail.length = 0;
    const rows = await deleteExhibition(t.deps, A);
    expect(rows).toEqual(before);
    expect(t.store.exhibitions.get(A)).toBeNull();
    expect(t.media.folders.has(A)).toBe(false);
    expect(t.trail).toEqual([`drain ${A} ${WAIT_MS()}`, `remove ${A}`, `exists ${A}`, 'checkpoint']);
  });

  it('지웠다고 답했는데 폴더가 남아 있으면 행을 지우지 않는다', async () => {
    seedFull(t.deps, A, 10);
    t.media.folders.add(A);
    t.media.stickNext();
    await expect(deleteExhibition(t.deps, A)).rejects.toMatchObject({ code: 'E_SERVER' });
    expect(t.store.exhibitions.get(A)?.deleting).toBe(true);
    expect(t.count('artworks', A)).toBe(3);
    expect(t.trail).not.toContain('checkpoint');
    await deleteExhibition(t.deps, A);
    expect(t.store.exhibitions.get(A)).toBeNull();
  });

  it('폴더가 처음부터 없어도 성공, 이미 지운 전시를 다시 지워도 성공(0개)', async () => {
    seedFull(t.deps, A, 10);
    const rows = await deleteExhibition(t.deps, A);
    expect(rows.exhibitions).toBe(1);
    expect(t.store.exhibitions.get(A)).toBeNull();
    const again = await deleteExhibition(t.deps, A);
    expect(total(again)).toBe(0);
    expect(t.store.exhibitions.get(A)).toBeNull();
  });

  it('지금 삭제(If-Match): rev가 빠졌거나 어긋나면 E_CONFLICT이고 아무것도 하지 않는다', async () => {
    seedFull(t.deps, A, 10);
    t.media.folders.add(A);
    const rev = t.store.exhibitions.get(A)!.rev;
    for (const ifMatch of [null, rev + 1])
      expect(await code(() => deleteExhibition(t.deps, A, { ifMatch }))).toBe('E_CONFLICT');
    expect(t.store.exhibitions.get(A)?.deleting).toBe(false);
    expect(t.trail).toEqual([]);
    // 다른 전시 ID(없는 전시)는 E_NOT_FOUND
    expect(await code(() => deleteExhibition(t.deps, id(1, 7), { ifMatch: 1 }))).toBe('E_NOT_FOUND');
    await deleteExhibition(t.deps, A, { ifMatch: rev });
    expect(t.store.exhibitions.get(A)).toBeNull();
    expect(t.media.folders.has(A)).toBe(false);
  });

  it('보관 정리: 만료된 전시도 지운다(rev를 보지 않음)', async () => {
    seedFull(t.deps, A, 10);
    // 작품 하나를 고쳐 rev를 바꿔 둔다(rev와 상관없이 지워져야 함)
    patchArtwork(t.deps, A, id(3, 11), { title: '새 제목' }, 1);
    const ex = t.store.exhibitions.get(A)!;
    t.advance(ex.expiresAt - t.at());
    expect(await code(() => teacherView(t.deps, A))).toBe('E_NOT_FOUND');
    await deleteExhibition(t.deps, A);
    expect(t.store.exhibitions.get(A)).toBeNull();
  });
});

describe('미디어 폴더(node:fs, `MEDIA_DIR/exh/{exhibitionId}`)', () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempDir();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = async (...parts: string[]) => {
    const file = join(root, ...parts);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'x');
  };

  it('그 전시 폴더만 통째로 지우고, 이미 없으면 그대로 성공', async () => {
    const media = createMediaFiles(root);
    await write('exh', A, id(9, 1), 'wall.webp');
    await write('exh', A, id(9, 2), 'zoom.webp');
    await write('exh', B, id(9, 3), 'wall.webp');
    await write('keep.txt');
    expect(await media.exists(A)).toBe(true);
    await media.removeExhibition(A);
    expect(await media.exists(A)).toBe(false);
    await media.removeExhibition(A);
    expect(await media.exists(B)).toBe(true);
    expect((await readdir(join(root, 'exh'))).sort()).toEqual([B]);
    expect(await readdir(root)).toContain('keep.txt');
    // 전시가 하나도 없던 미디어 폴더(`exh/`도 없음)도 성공
    const empty = createMediaFiles(join(root, 'nothing-here'));
    expect(await empty.exists(A)).toBe(false);
    await empty.removeExhibition(A);
  });

  it('`exh/` 밖으로 나가는 ID·UUID 모양이 아닌 ID는 거절하고 아무것도 지우지 않는다', async () => {
    const media = createMediaFiles(join(root, 'media'));
    await write('victim', 'keep.txt');
    await write('media', 'exh', A, 'a', 'wall.webp');
    await write('media', 'exh', 'not-a-uuid', 'keep.txt');
    const escapes = [
      '../../victim',
      '..',
      '',
      '.',
      join(root, 'victim'),
      `${A}/../../../victim`,
      `${A}/..`,
      `${B}/../${A}`,
      'not-a-uuid',
      `${A}\u0000`,
    ];
    for (const bad of escapes) {
      await expect(media.removeExhibition(bad), bad).rejects.toThrow(/MEDIA_DIR/);
      await expect(media.exists(bad), bad).rejects.toThrow(/MEDIA_DIR/);
    }
    expect(await readdir(join(root, 'victim'))).toEqual(['keep.txt']);
    expect((await readdir(join(root, 'media', 'exh'))).sort()).toEqual([A, 'not-a-uuid'].sort());
    expect(await media.exists(A)).toBe(true);
  });

  it('SQLite + 실제 폴더: 지우기 끝까지(폴더·행·WAL)', async () => {
    const s = sqliteTestDeps();
    try {
      const media = createMediaFiles(join(root, 'media'));
      const deps: Deps = { ...s.deps, media };
      seedFull(deps, A, 10);
      seedFull(deps, B, 20);
      await write('media', 'exh', A, id(9, 11), 'wall.webp');
      await write('media', 'exh', B, id(9, 21), 'wall.webp');
      const rev = deps.store.exhibitions.get(A)!.rev;
      const rows = await deleteExhibition(deps, A, { ifMatch: rev });
      expect(rows.artworks).toBe(3);
      expect(await media.exists(A)).toBe(false);
      expect(await media.exists(B)).toBe(true);
      expect(s.count('exhibitions')).toBe(1);
      expect(s.count('artworks')).toBe(3);
      expect(s.walBytes()).toBe(0);
    } finally {
      s.close();
    }
  });
});
