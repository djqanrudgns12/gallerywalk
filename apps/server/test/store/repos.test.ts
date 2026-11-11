import { config } from '@gallery/core/config';
import { computeLayout } from '@gallery/core/layout';
import { ExhibitionSettingsSchema, type ExhibitionSettings } from '@gallery/core/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ArtworkRecord,
  AssetRecord,
  ExhibitionRecord,
  LayoutRecord,
  PageRecord,
  ReactionRecord,
  RoomRecord,
  TeacherSessionRecord,
  VisitorRecord,
} from '../../src/ports/index.ts';
import type { Db } from '../../src/store/db.ts';
import { StoreRowError } from '../../src/store/repos.ts';
import { sqliteTestDeps, TEST_STORES, type TestDeps } from '../support/sqliteDeps.ts';

/**
 * 저장소 계약 시험(P3-store). 앞 묶음은 메모리·SQLite 두 구현이 같게 동작하는지, 뒤 묶음은 SQLite만의 것
 * (표 제약·JSON 칸 검사·insert가 덮어쓰지 않음). 자료는 모두 가상(가상 학교·가상 작품).
 */

const id = (kind: number, n: number) =>
  `00000000-0000-4000-8${String(kind).padStart(3, '0')}-${String(n).padStart(12, '0')}`;
const NOW = Date.UTC(2026, 10, 11, 1, 0, 0);
const DAY = 24 * 3600 * 1000;
const EX1 = id(1, 1);
const EX2 = id(1, 2);
const R1 = id(2, 1);
const R2 = id(2, 2);
const A1 = id(3, 1);
const A2 = id(3, 2);
const IMG1 = id(9, 1);
const BGM1 = id(9, 2);
const IMG2 = id(9, 3);
const hex = (c: string) => c.repeat(64);
const LINK = hex('1');
const PIN = hex('2');
const VISITOR = hex('3');

const SETTINGS: ExhibitionSettings = ExhibitionSettingsSchema.parse({
  reactions: {
    naming: 'ANONYMOUS',
    collect: { score: true },
    stickerVisibility: 'PUBLIC',
    memoVisibility: 'SELECTED',
  },
  tour: { timeMode: 'FIXED' },
});

const exhibition = (exId: string, n: number, over: Partial<ExhibitionRecord> = {}): ExhibitionRecord => ({
  id: exId,
  entryCode: String(234_560 + n),
  pinHmac: `hmac:${n}`,
  title: `가상 전시 ${n}`,
  subtitle: '근현대사 탐구',
  templateId: 'modern-history',
  posterAssetId: null,
  schoolName: '가상초등학교',
  className: '6학년 2반',
  showSchool: true,
  settings: SETTINGS,
  status: 'OPEN',
  retentionDays: 30,
  rev: 3,
  createHash: hex('a'),
  contentVersion: 4,
  settingsVersion: 5,
  layoutVersion: 6,
  layoutDirty: false,
  deleting: true,
  createdAt: NOW,
  expiresAt: NOW + 30 * DAY,
  openedAt: NOW + 1,
  closedAt: NOW + 2,
  ...over,
});

const imageAsset = (assetId: string, exId: string, over: Partial<AssetRecord> = {}): AssetRecord => ({
  id: assetId,
  exhibitionId: exId,
  kind: 'IMAGE',
  width: 3000,
  height: 2000,
  durationMs: 1,
  variants: [
    { name: 'wall', ext: 'webp', w: 1600, h: 1067, bytes: 120_000 },
    { name: 'strip-0', ext: 'webp', w: 800, h: 4000, bytes: 90_000 },
  ],
  analysis: {
    edgeLuma: 0.8,
    linePitchPx: 12.5,
    linePitchConfidence: 0.75,
    lineProfile: 'AAEC',
    profileBinPx: 8,
  },
  bytesTotal: 210_000,
  contentHash: hex('b'),
  createdAt: NOW,
  ...over,
});

const audioAsset = (assetId: string, exId: string): AssetRecord => ({
  id: assetId,
  exhibitionId: exId,
  kind: 'AUDIO',
  width: 512,
  height: 512,
  durationMs: 95_000,
  variants: [
    { name: 'audio', ext: 'm4a', w: 0, h: 0, bytes: 500_000 },
    { name: 'cover', ext: 'webp', w: 512, h: 512, bytes: 20_000 },
  ],
  analysis: { audibleStartMs: 120, audibleEndMs: 90_000, loudnessDb: -14.5 },
  bytesTotal: 520_000,
  contentHash: hex('c'),
  createdAt: NOW,
});

const room = (roomId: string, exId: string, over: Partial<RoomRecord> = {}): RoomRecord => ({
  id: roomId,
  exhibitionId: exId,
  order: 0,
  title: '1905 을사늑약과 의병',
  intro: '전시실 소개',
  bgmAssetId: null,
  rev: 2,
  createHash: hex('d'),
  createdAt: NOW,
  updatedAt: NOW + 5,
  ...over,
});

const artwork = (
  artworkId: string,
  exId: string,
  roomId: string,
  over: Partial<ArtworkRecord> = {},
): ArtworkRecord => ({
  id: artworkId,
  exhibitionId: exId,
  roomId,
  order: 0,
  title: '가상 작품',
  author: '가상 작가',
  captionShort: '짧은 설명',
  descriptionLong: '긴 설명\n둘째 줄',
  kind: 'IMAGE',
  form: 'LANDSCAPE',
  formOverride: 'SQUARE',
  textHeavy: true,
  textHeavyOverride: false,
  featured: false,
  pageMode: 'SINGLE',
  status: 'PUBLISHED',
  sourceAssetId: null,
  pageCount: 3,
  textBody: '글 작품 본문',
  warnings: ['LOW_RES', 'MOSTLY_SILENT'],
  failCode: 'E_FILE_BROKEN',
  deletedAt: null,
  rev: 4,
  createHash: hex('e'),
  createdAt: NOW,
  updatedAt: NOW + 3,
  ...over,
});

const LAYOUT = computeLayout({
  exhibitionId: EX1,
  templateId: 'modern-history',
  algoVersion: config().ALGO_VERSION,
  rooms: [{ id: R1, order: 0, hasBgm: true }],
  artworks: [1, 2, 3].map(n => ({
    id: id(3, n),
    roomId: R1,
    order: n,
    kind: 'IMAGE' as const,
    form: 'LANDSCAPE' as const,
    featured: n === 1,
    textHeavy: false,
    pixel: { w: 3000, h: 2000 },
    pageCount: null,
  })),
});

const layoutRecord = (exId: string, version: number): LayoutRecord => ({
  exhibitionId: exId,
  version,
  algoVersion: LAYOUT.algoVersion,
  hash: LAYOUT.hash,
  data: LAYOUT,
  createdAt: NOW + version,
});

const session = (
  tokenHash: string,
  exId: string,
  over: Partial<TeacherSessionRecord> = {},
): TeacherSessionRecord => ({
  tokenHash,
  exhibitionId: exId,
  kind: 'LINK',
  createdAt: NOW,
  lastUsedAt: NOW + 7,
  ...over,
});

const visitor = (tokenHash: string, exId: string): VisitorRecord => ({
  tokenHash,
  exhibitionId: exId,
  nickname: '별빛',
  nicknameNorm: '별빛',
  consentVersion: 'v1',
  consentAt: NOW + 1,
  createdAt: NOW,
});

const reaction = (
  reactionId: string,
  exId: string,
  artworkId: string,
  tokenHash: string,
  over: Partial<ReactionRecord> = {},
): ReactionRecord => ({
  id: reactionId,
  exhibitionId: exId,
  artworkId,
  visitorTokenHash: tokenHash,
  sticker: 'GREAT',
  memo: '멋져요',
  scoreFact: 3,
  scoreDelivery: 2,
  hidden: true,
  publicSelected: true,
  createdAt: NOW,
  updatedAt: NOW + 1,
  ...over,
});

/** 전시 둘(EX1·EX2)과 그 asset·전시실(R1·R2) */
const seedBase = (t: TestDeps): void => {
  const s = t.store;
  s.exhibitions.insert(exhibition(EX1, 1));
  s.exhibitions.insert(exhibition(EX2, 2));
  s.assets.insert(imageAsset(IMG1, EX1));
  s.assets.insert(audioAsset(BGM1, EX1));
  s.assets.insert(imageAsset(IMG2, EX2));
  s.rooms.insert(room(R1, EX1));
  s.rooms.insert(room(R2, EX2));
};

describe.each(TEST_STORES)('저장소 계약 · $name', ({ make }) => {
  let t: TestDeps;
  beforeEach(() => {
    t = make();
  });
  afterEach(() => t.close());

  it('행 왕복: 모든 칸이 그대로(비울 수 있는 칸도 채우고 참거짓은 참)', () => {
    const s = t.store;
    const ex = exhibition(EX1, 1, { posterAssetId: IMG1 });
    const img = imageAsset(IMG1, EX1);
    const bgm = audioAsset(BGM1, EX1);
    const r = room(R1, EX1, { bgmAssetId: BGM1 });
    const a = artwork(A1, EX1, R1, {
      featured: true,
      status: 'FAILED',
      sourceAssetId: IMG1,
      deletedAt: NOW + 9,
    });
    const page: PageRecord = { artworkId: A1, idx: 1, assetId: IMG1 };
    const layout = layoutRecord(EX1, 1);
    const pin = session(PIN, EX1, { kind: 'PIN' });
    const v = visitor(VISITOR, EX1);
    const re = reaction(id(5, 1), EX1, A1, VISITOR);
    s.exhibitions.insert(ex);
    s.assets.insert(img);
    s.assets.insert(bgm);
    s.rooms.insert(r);
    s.artworks.insert(a);
    s.pages.put(page);
    s.layouts.insert(layout);
    s.sessions.insert(pin);
    s.visitors.insert(v);
    s.reactions.upsert(re);

    expect(s.exhibitions.get(EX1)).toStrictEqual(ex);
    expect(s.exhibitions.getByEntryCode(ex.entryCode)).toStrictEqual(ex);
    expect(s.assets.get(IMG1)).toStrictEqual(img);
    expect(s.assets.listByIds([IMG1, BGM1])).toStrictEqual([img, bgm]);
    expect(s.rooms.get(R1)).toStrictEqual(r);
    expect(s.rooms.listByExhibition(EX1)).toStrictEqual([r]);
    expect(s.artworks.get(A1)).toStrictEqual(a);
    expect(s.artworks.listByExhibition(EX1, { includeDeleted: true })).toStrictEqual([a]);
    expect(s.pages.listByArtworks([A1])).toStrictEqual([page]);
    expect(s.layouts.latest(EX1)).toStrictEqual(layout);
    expect(s.sessions.get(PIN)).toStrictEqual(pin);
    expect(s.visitors.get(VISITOR, EX1)).toStrictEqual(v);
    expect(s.reactions.getByVisitor(A1, VISITOR)).toStrictEqual(re);
    expect(s.reactions.listByExhibition(EX1)).toStrictEqual([re]);
  });

  it('행 왕복: 비울 수 있는 칸은 null, 참거짓은 거짓, 빈 목록은 빈 목록', () => {
    const s = t.store;
    const ex = exhibition(EX1, 1, {
      subtitle: null,
      schoolName: null,
      className: null,
      showSchool: false,
      status: 'DRAFT',
      layoutDirty: true,
      deleting: false,
      openedAt: null,
      closedAt: null,
    });
    const img = imageAsset(IMG1, EX1, {
      kind: 'PAGE',
      width: null,
      height: null,
      durationMs: null,
      variants: [],
      analysis: null,
    });
    const r = room(R1, EX1, { intro: null });
    const a = artwork(A1, EX1, R1, {
      author: null,
      captionShort: null,
      descriptionLong: null,
      kind: 'TEXT',
      form: 'TEXTCARD',
      formOverride: null,
      textHeavy: false,
      textHeavyOverride: null,
      pageMode: 'AUTO',
      status: 'HIDDEN',
      pageCount: null,
      textBody: null,
      warnings: [],
      failCode: null,
    });
    const v: VisitorRecord = {
      ...visitor(VISITOR, EX1),
      nickname: null,
      nicknameNorm: null,
      consentVersion: null,
      consentAt: null,
    };
    const re = reaction(id(5, 1), EX1, A1, VISITOR, {
      sticker: null,
      memo: null,
      scoreFact: null,
      scoreDelivery: null,
      hidden: false,
      publicSelected: false,
    });
    s.exhibitions.insert(ex);
    s.assets.insert(img);
    s.rooms.insert(r);
    s.artworks.insert(a);
    s.visitors.insert(v);
    s.reactions.upsert(re);

    expect(s.exhibitions.get(EX1)).toStrictEqual(ex);
    expect(s.assets.get(IMG1)).toStrictEqual(img);
    expect(s.rooms.get(R1)).toStrictEqual(r);
    expect(s.artworks.get(A1)).toStrictEqual(a);
    expect(s.visitors.get(VISITOR, EX1)).toStrictEqual(v);
    expect(s.reactions.getByVisitor(A1, VISITOR)).toStrictEqual(re);
    expect(s.exhibitions.get(EX2)).toBeNull();
    expect(s.exhibitions.getByEntryCode('999999')).toBeNull();
    expect(s.rooms.get(R2)).toBeNull();
    expect(s.artworks.get(A2)).toBeNull();
    expect(s.assets.get(IMG2)).toBeNull();
    expect(s.layouts.latest(EX1)).toBeNull();
    expect(s.sessions.get(LINK)).toBeNull();
    expect(s.visitors.get(hex('9'), EX1)).toBeNull();
    expect(s.reactions.getByVisitor(A2, VISITOR)).toBeNull();
    expect(s.rooms.listByExhibition(EX2)).toStrictEqual([]);
    expect(s.assets.listByIds([])).toStrictEqual([]);
    expect(s.pages.listByArtworks([])).toStrictEqual([]);
  });

  it('고치기: 빠진 칸·undefined 칸은 그대로, null은 비움, 돌려준 기록 = 다시 읽은 기록', () => {
    const s = t.store;
    seedBase(t);
    s.artworks.insert(artwork(A1, EX1, R1));
    s.visitors.insert(visitor(VISITOR, EX1));
    s.reactions.upsert(reaction(id(5, 1), EX1, A1, VISITOR));

    const before = s.exhibitions.get(EX1)!;
    const settings = ExhibitionSettingsSchema.parse({ reactions: { enabled: false } });
    const ex = s.exhibitions.update(EX1, {
      title: '새 전시 이름',
      subtitle: null,
      schoolName: undefined,
      showSchool: false,
      settings,
      rev: before.rev + 1,
    });
    expect(ex).toStrictEqual({
      ...before,
      title: '새 전시 이름',
      subtitle: null,
      showSchool: false,
      settings,
      rev: before.rev + 1,
    });
    expect(s.exhibitions.get(EX1)).toStrictEqual(ex);

    const roomBefore = s.rooms.get(R1)!;
    const r = s.rooms.update(R1, { intro: null, title: undefined, order: 5 });
    expect(r).toStrictEqual({ ...roomBefore, intro: null, order: 5 });
    expect(s.rooms.get(R1)).toStrictEqual(r);

    const artBefore = s.artworks.get(A1)!;
    const a = s.artworks.update(A1, {
      formOverride: null,
      textHeavyOverride: undefined,
      warnings: [],
      failCode: null,
      featured: true,
      deletedAt: NOW + 10,
    });
    expect(a).toStrictEqual({
      ...artBefore,
      formOverride: null,
      warnings: [],
      failCode: null,
      featured: true,
      deletedAt: NOW + 10,
    });
    expect(s.artworks.get(A1)).toStrictEqual(a);
    // 되살리기 = deletedAt을 null로
    expect(s.artworks.update(A1, { deletedAt: null }).deletedAt).toBeNull();
    expect(s.artworks.get(A1)?.deletedAt).toBeNull();

    const visitorBefore = s.visitors.get(VISITOR, EX1)!;
    const v = s.visitors.update(VISITOR, EX1, { nickname: null, consentAt: NOW + 20 });
    expect(v).toStrictEqual({ ...visitorBefore, nickname: null, consentAt: NOW + 20 });
    expect(s.visitors.get(VISITOR, EX1)).toStrictEqual(v);

    const reactionBefore = s.reactions.getByVisitor(A1, VISITOR)!;
    const re = s.reactions.update(id(5, 1), { memo: null, hidden: false, updatedAt: NOW + 30 });
    expect(re).toStrictEqual({ ...reactionBefore, memo: null, hidden: false, updatedAt: NOW + 30 });
    expect(s.reactions.getByVisitor(A1, VISITOR)).toStrictEqual(re);

    s.sessions.insert(session(LINK, EX1));
    s.sessions.touch(LINK, NOW + 40);
    expect(s.sessions.get(LINK)).toStrictEqual(session(LINK, EX1, { lastUsedAt: NOW + 40 }));
  });

  it('없는 행 고치기는 오류', () => {
    const s = t.store;
    expect(() => s.exhibitions.update(EX1, { title: '없음' })).toThrow(/없는 행/);
    expect(() => s.rooms.update(R1, { title: '없음' })).toThrow(/없는 행/);
    expect(() => s.artworks.update(A1, { title: '없음' })).toThrow(/없는 행/);
    expect(() => s.visitors.update(VISITOR, EX1, { nickname: '없음' })).toThrow(/없는 행/);
    expect(() => s.reactions.update(id(5, 1), { memo: '없음' })).toThrow(/없는 행/);
    expect(() => s.sessions.touch(LINK, NOW)).toThrow(/없는 행/);
  });

  it('트랜잭션: 던지면 넣기·고치기·지우기를 모두 되돌리고, 끝나면 돌려준 값을 준다', () => {
    const s = t.store;
    s.exhibitions.insert(exhibition(EX1, 1));
    s.sessions.insert(session(LINK, EX1));
    expect(() =>
      s.transaction(() => {
        s.exhibitions.insert(exhibition(EX2, 2));
        s.exhibitions.update(EX1, { title: '바뀜' });
        s.sessions.deleteKind(EX1, 'LINK');
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(s.exhibitions.get(EX2)).toBeNull();
    expect(s.exhibitions.get(EX1)?.title).toBe('가상 전시 1');
    expect(s.sessions.get(LINK)).not.toBeNull();

    expect(
      s.transaction(() => {
        s.exhibitions.insert(exhibition(EX2, 2));
        return 'done';
      }),
    ).toBe('done');
    expect(t.count('exhibitions')).toBe(2);
  });

  it('트랜잭션 중첩: 안쪽은 바깥에 합류한다(바깥이 던지면 함께 되돌림, 안쪽만 던지면 안쪽만)', () => {
    const s = t.store;
    expect(() =>
      s.transaction(() => {
        s.exhibitions.insert(exhibition(EX1, 1));
        expect(
          s.transaction(() => {
            s.exhibitions.insert(exhibition(EX2, 2));
            return 7;
          }),
        ).toBe(7);
        throw new Error('outer');
      }),
    ).toThrow('outer');
    expect(t.count('exhibitions')).toBe(0);

    s.transaction(() => {
      s.exhibitions.insert(exhibition(EX1, 1));
      expect(() =>
        s.transaction(() => {
          s.exhibitions.insert(exhibition(EX2, 2));
          throw new Error('inner');
        }),
      ).toThrow('inner');
      expect(s.exhibitions.get(EX2)).toBeNull();
    });
    expect(s.exhibitions.get(EX1)).not.toBeNull();
    expect(s.exhibitions.get(EX2)).toBeNull();
  });

  it('배치: latest는 판 번호가 가장 큰 것, prune은 그 전시의 최근 n판만 남긴다', () => {
    const s = t.store;
    s.exhibitions.insert(exhibition(EX1, 1));
    s.exhibitions.insert(exhibition(EX2, 2));
    for (const v of [2, 4, 1, 3]) s.layouts.insert(layoutRecord(EX1, v));
    for (const v of [1, 2]) s.layouts.insert(layoutRecord(EX2, v));
    expect(s.layouts.latest(EX1)?.version).toBe(4);

    s.layouts.prune(EX1, 2);
    expect(t.count('layouts', EX1)).toBe(2);
    expect(t.count('layouts', EX2)).toBe(2);
    expect(s.layouts.latest(EX1)).toStrictEqual(layoutRecord(EX1, 4));
    s.layouts.prune(EX1, 1);
    expect(t.count('layouts', EX1)).toBe(1);
    expect(s.layouts.latest(EX1)?.version).toBe(4);
    s.layouts.prune(EX1, 0);
    expect(t.count('layouts', EX1)).toBe(0);
    expect(s.layouts.latest(EX1)).toBeNull();
    expect(s.layouts.latest(EX2)?.version).toBe(2);
  });

  it('PIN·입장 코드 확인: 표에 있는 전시 전부(만료 포함), exceptId는 뺀다', () => {
    const s = t.store;
    const expired = exhibition(EX1, 1, { expiresAt: NOW - DAY, status: 'CLOSED' });
    s.exhibitions.insert(expired);
    expect(s.exhibitions.pinTaken(expired.pinHmac, null)).toBe(true);
    expect(s.exhibitions.pinTaken(expired.pinHmac, EX2)).toBe(true);
    expect(s.exhibitions.pinTaken(expired.pinHmac, EX1)).toBe(false);
    expect(s.exhibitions.pinTaken('hmac:other', null)).toBe(false);
    expect(s.exhibitions.entryCodeTaken(expired.entryCode)).toBe(true);
    expect(s.exhibitions.entryCodeTaken('999999')).toBe(false);
    // 만료·지우는 중 거절은 유스케이스(isGone)가 한다 — 저장소는 그대로 돌려준다
    expect(s.exhibitions.getByEntryCode(expired.entryCode)).toStrictEqual(expired);
  });

  it('작품 목록: 그 전시 것만, 지운 작품은 includeDeleted일 때만, 넣은 순서(고쳐도 자리 그대로)', () => {
    const s = t.store;
    seedBase(t);
    const later = id(3, 9);
    s.artworks.insert(artwork(later, EX1, R1, { order: 0 }));
    s.artworks.insert(artwork(A2, EX1, R1, { order: 1, deletedAt: NOW }));
    s.artworks.insert(artwork(A1, EX1, R1, { order: 2 }));
    s.artworks.insert(artwork(id(3, 5), EX2, R2));
    s.artworks.update(later, { order: 9 });
    expect(s.artworks.listByExhibition(EX1).map(a => a.id)).toStrictEqual([later, A1]);
    expect(s.artworks.listByExhibition(EX1, { includeDeleted: true }).map(a => a.id)).toStrictEqual([
      later,
      A2,
      A1,
    ]);
    expect(s.artworks.listByExhibition(EX1, { includeDeleted: false }).map(a => a.id)).toStrictEqual([
      later,
      A1,
    ]);
    s.rooms.insert(room(id(2, 7), EX1, { order: 1 }));
    expect(s.rooms.listByExhibition(EX1).map(r => r.id)).toStrictEqual([R1, id(2, 7)]);
  });

  it('asset 여러 개: 받은 ID 순서대로, 없는 ID는 빼고 겹친 ID는 겹친 대로', () => {
    const s = t.store;
    seedBase(t);
    expect(s.assets.listByIds([BGM1, id(9, 99), IMG1, BGM1]).map(a => a.id)).toStrictEqual([
      BGM1,
      IMG1,
      BGM1,
    ]);
  });

  it('쪽: 같은 쪽 번호에 다시 넣으면 바꾸고(자리 그대로), 고른 작품 것만', () => {
    const s = t.store;
    seedBase(t);
    s.artworks.insert(artwork(A1, EX1, R1, { kind: 'PDF', form: 'MULTIPAGE' }));
    s.artworks.insert(artwork(A2, EX1, R1, { kind: 'PDF', form: 'MULTIPAGE' }));
    s.pages.put({ artworkId: A1, idx: 1, assetId: IMG1 });
    s.pages.put({ artworkId: A1, idx: 2, assetId: IMG1 });
    s.pages.put({ artworkId: A2, idx: 1, assetId: IMG1 });
    s.pages.put({ artworkId: A1, idx: 1, assetId: BGM1 });
    expect(s.pages.listByArtworks([A1])).toStrictEqual([
      { artworkId: A1, idx: 1, assetId: BGM1 },
      { artworkId: A1, idx: 2, assetId: IMG1 },
    ]);
    expect(s.pages.listByArtworks([A2, A1])).toHaveLength(3);
  });

  it('세션: deleteKind는 그 전시의 그 종류만 지운다', () => {
    const s = t.store;
    seedBase(t);
    s.sessions.insert(session(LINK, EX1));
    s.sessions.insert(session(PIN, EX1, { kind: 'PIN' }));
    s.sessions.insert(session(hex('4'), EX2));
    s.sessions.deleteKind(EX1, 'LINK');
    expect(s.sessions.get(LINK)).toBeNull();
    expect(s.sessions.get(PIN)?.kind).toBe('PIN');
    expect(s.sessions.get(hex('4'))?.exhibitionId).toBe(EX2);
    expect(t.count('sessions')).toBe(2);
    expect(t.count('sessions', EX1)).toBe(1);
  });

  it('방문자·반응: 방문자는 전시까지 맞아야 찾고, upsert는 같은 ID를 통째로 바꾼다', () => {
    const s = t.store;
    seedBase(t);
    s.artworks.insert(artwork(A1, EX1, R1));
    s.artworks.insert(artwork(A2, EX1, R1));
    s.visitors.insert(visitor(VISITOR, EX1));
    expect(s.visitors.get(VISITOR, EX2)).toBeNull();
    const first = reaction(id(5, 1), EX1, A1, VISITOR);
    s.reactions.upsert(first);
    s.reactions.upsert(reaction(id(5, 2), EX1, A2, VISITOR, { sticker: 'MOVED' }));
    const replaced = { ...first, sticker: 'CURIOUS' as const, memo: null, updatedAt: NOW + 50 };
    s.reactions.upsert(replaced);
    expect(s.reactions.getByVisitor(A1, VISITOR)).toStrictEqual(replaced);
    expect(s.reactions.listByExhibition(EX1).map(r => r.id)).toStrictEqual([id(5, 1), id(5, 2)]);
    expect(s.reactions.listByExhibition(EX2)).toStrictEqual([]);
  });

  it('전시실 지우기: 지운 뒤 없음, 없는 ID는 조용히 넘어간다', () => {
    const s = t.store;
    seedBase(t);
    s.rooms.delete(R1);
    expect(s.rooms.get(R1)).toBeNull();
    s.rooms.delete(R1);
    expect(s.rooms.listByExhibition(EX1)).toStrictEqual([]);
  });
});

describe('SQLite 저장소만의 것', () => {
  let t: TestDeps & { readonly db: Db };
  beforeEach(() => {
    t = sqliteTestDeps();
    seedBase(t);
  });
  afterEach(() => t.close());

  const rowError = (fn: () => unknown): StoreRowError => {
    try {
      fn();
    } catch (error) {
      if (error instanceof StoreRowError) return error;
      throw error;
    }
    throw new Error('StoreRowError가 나지 않았다');
  };

  it('복합 외래키: 다른 전시의 전시실로 작품을 넣거나 옮기지 못하고, 다른 전시의 작품에 반응하지 못한다', () => {
    const s = t.store;
    s.artworks.insert(artwork(A1, EX1, R1));
    expect(() => s.artworks.insert(artwork(A2, EX1, R2))).toThrow(/FOREIGN KEY/);
    expect(s.artworks.get(A2)).toBeNull();
    expect(() => s.artworks.update(A1, { roomId: R2 })).toThrow(/FOREIGN KEY/);
    expect(s.artworks.get(A1)?.roomId).toBe(R1);
    s.visitors.insert(visitor(VISITOR, EX2));
    expect(() => s.reactions.upsert(reaction(id(5, 1), EX2, A1, VISITOR))).toThrow(/FOREIGN KEY/);
    expect(s.reactions.listByExhibition(EX2)).toStrictEqual([]);
  });

  it('insert는 같은 키를 덮어쓰지 않는다(메모리 구현은 덮어씀) — 다른 전시로 옮겨 가지 않는다', () => {
    const s = t.store;
    s.sessions.insert(session(LINK, EX1));
    expect(() => s.sessions.insert(session(LINK, EX2))).toThrow(/UNIQUE constraint/);
    expect(s.sessions.get(LINK)?.exhibitionId).toBe(EX1);
    expect(() => s.rooms.insert(room(R1, EX2))).toThrow(/UNIQUE constraint/);
    expect(s.rooms.get(R1)?.exhibitionId).toBe(EX1);
    expect(() => s.exhibitions.insert(exhibition(EX1, 3))).toThrow(/UNIQUE constraint/);
    expect(s.exhibitions.get(EX1)?.entryCode).toBe(exhibition(EX1, 1).entryCode);
    s.layouts.insert(layoutRecord(EX1, 1));
    expect(() => s.layouts.insert(layoutRecord(EX1, 1))).toThrow(/UNIQUE constraint/);
  });

  it('표 제약: 전시실마다 대표작 하나(지운 작품 빼고), 기기 1대 · 작품 1개에 반응 하나', () => {
    const s = t.store;
    s.artworks.insert(artwork(A1, EX1, R1, { featured: true }));
    expect(() => s.artworks.insert(artwork(A2, EX1, R1, { featured: true }))).toThrow(/UNIQUE constraint/);
    s.artworks.insert(artwork(A2, EX1, R1, { featured: true, deletedAt: NOW }));
    s.visitors.insert(visitor(VISITOR, EX1));
    s.reactions.upsert(reaction(id(5, 1), EX1, A1, VISITOR));
    expect(() => s.reactions.upsert(reaction(id(5, 2), EX1, A1, VISITOR))).toThrow(/UNIQUE constraint/);
  });

  it('방문자 고치기는 (토큰 해시, 전시)로 찾는다 — 다른 전시면 없는 행(메모리 구현은 전시를 보지 않음)', () => {
    const s = t.store;
    s.visitors.insert(visitor(VISITOR, EX1));
    expect(() => s.visitors.update(VISITOR, EX2, { nickname: '남의 전시' })).toThrow(/없는 행/);
    expect(s.visitors.get(VISITOR, EX1)?.nickname).toBe('별빛');
  });

  it('배치 모양 판이 다른 옛 행은 없는 것으로(다시 계산하게), 판이 없는 망가진 행은 읽기 오류', () => {
    t.store.layouts.insert(layoutRecord(EX1, 1));
    t.db
      .prepare(
        `UPDATE layouts SET data_json = json_set(data_json, '$.schemaVersion', 1) WHERE exhibition_id = ?`,
      )
      .run(EX1);
    expect(t.store.layouts.latest(EX1)).toBeNull();
    t.store.layouts.insert(layoutRecord(EX1, 2));
    expect(t.store.layouts.latest(EX1)?.version).toBe(2);
  });

  it('배치 prune은 오래된 판부터 지운다', () => {
    for (const v of [2, 4, 1, 3]) t.store.layouts.insert(layoutRecord(EX1, v));
    t.store.layouts.prune(EX1, 2);
    expect(
      t.db.prepare('SELECT version FROM layouts WHERE exhibition_id = ? ORDER BY version').pluck().all(EX1),
    ).toStrictEqual([3, 4]);
  });

  it('JSON 칸이 깨졌으면 읽기 오류: 어느 표·칸인지 알리고 저장된 값은 오류 글에 넣지 않는다', () => {
    const s = t.store;
    const { db } = t;
    db.prepare(`UPDATE exhibitions SET settings_json = '{"secretWord": tru' WHERE id = ?`).run(EX1);
    const broken = rowError(() => s.exhibitions.get(EX1));
    expect(broken.table).toBe('exhibitions');
    expect(broken.fields).toStrictEqual(['settings_json']);
    expect(broken.message).not.toContain('secretWord');
    expect(() => s.exhibitions.getByEntryCode(exhibition(EX1, 1).entryCode)).toThrow(StoreRowError);
    expect(() => s.exhibitions.update(EX1, { title: '고치기도 안 됨' })).toThrow(StoreRowError);

    db.prepare(`UPDATE exhibitions SET settings_json = '{"reactions":{"naming":"LOUD"}}' WHERE id = ?`).run(
      EX1,
    );
    expect(rowError(() => s.exhibitions.get(EX1)).fields).toStrictEqual(['settings_json.reactions.naming']);

    db.prepare(`UPDATE exhibitions SET template_id = 'no-such-template' WHERE id = ?`).run(EX2);
    expect(rowError(() => s.exhibitions.get(EX2)).fields).toStrictEqual(['template_id']);

    db.prepare(`UPDATE assets SET variants_json = '[{"name":"bad"}]' WHERE id = ?`).run(IMG1);
    const variants = rowError(() => s.assets.get(IMG1));
    expect(variants.table).toBe('assets');
    expect(variants.fields.length).toBeGreaterThan(0);
    expect(variants.fields.every(f => f.startsWith('variants_json.0'))).toBe(true);
    expect(() => s.assets.listByIds([IMG1])).toThrow(StoreRowError);

    // 소리 asset에 그림 분석값
    db.prepare(
      `UPDATE assets SET analysis_json = (SELECT analysis_json FROM assets WHERE id = ?) WHERE id = ?`,
    ).run(IMG2, BGM1);
    expect(rowError(() => s.assets.get(BGM1)).fields.every(f => f.startsWith('analysis_json'))).toBe(true);

    s.artworks.insert(artwork(A1, EX2, R2));
    db.prepare(`UPDATE artworks SET warnings_json = '["NOPE"]' WHERE id = ?`).run(A1);
    expect(rowError(() => s.artworks.get(A1)).fields).toStrictEqual(['warnings_json.0']);
    expect(() => s.artworks.listByExhibition(EX2)).toThrow(StoreRowError);

    s.layouts.insert(layoutRecord(EX2, 1));
    db.prepare(`UPDATE layouts SET data_json = '{}' WHERE exhibition_id = ?`).run(EX2);
    const layout = rowError(() => s.layouts.latest(EX2));
    expect(layout.table).toBe('layouts');
    expect(layout.fields.every(f => f.startsWith('data_json'))).toBe(true);
  });

  it('다시 읽을 수 없는 값은 쓰지 않는다(쓰기도 읽기와 같은 검사)', () => {
    const s = t.store;
    const bad: ExhibitionSettings = { ...SETTINGS, tour: { ...SETTINGS.tour, secondsPerRoom: -5 } };
    const third = id(1, 3);
    expect(() => s.exhibitions.insert(exhibition(third, 3, { settings: bad }))).toThrow(StoreRowError);
    expect(s.exhibitions.get(third)).toBeNull();
    expect(() => s.exhibitions.update(EX1, { settings: bad })).toThrow(StoreRowError);
    expect(s.exhibitions.get(EX1)?.settings).toStrictEqual(SETTINGS);
  });

  it('트랜잭션이 끝나면(커밋·되돌림·중첩) 열린 트랜잭션이 남지 않는다', () => {
    const s = t.store;
    s.transaction(() => s.transaction(() => s.exhibitions.update(EX1, { title: '중첩' })));
    expect(t.db.inTransaction).toBe(false);
    expect(() =>
      s.transaction(() => {
        s.transaction(() => s.exhibitions.update(EX1, { title: '되돌릴 것' }));
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(t.db.inTransaction).toBe(false);
    expect(s.exhibitions.get(EX1)?.title).toBe('중첩');
  });
});
