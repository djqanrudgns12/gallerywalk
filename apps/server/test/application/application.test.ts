import { overrideConfig, resetConfig } from '@gallery/core/config';
import { AppError, type ErrorCode } from '@gallery/core/errors';
import { ExhibitionViewSchema, TeacherExhibitionViewSchema } from '@gallery/core/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  batchArtworks,
  deleteArtwork,
  patchArtwork,
  reorderArtworks,
  restoreArtwork,
} from '../../src/application/artworks.ts';
import {
  changeStatus,
  createExhibition,
  patchExhibition,
  rotateLink,
} from '../../src/application/exhibitions.ts';
import { recomputeLayout } from '../../src/application/layout.ts';
import { createRoom, deleteRoom, reorderRooms } from '../../src/application/rooms.ts';
import { exhibitionView, teacherView, versionInfo } from '../../src/application/views.ts';
import type { ArtworkRecord, Deps } from '../../src/ports/index.ts';
import { TEST_STORES, type TestDeps } from '../support/sqliteDeps.ts';

const id = (kind: number, n: number) =>
  `00000000-0000-4000-8${String(kind).padStart(3, '0')}-${String(n).padStart(12, '0')}`;
const EX = id(1, 1);
const HASH = 'a'.repeat(64);

const code = (fn: () => unknown): ErrorCode | 'OK' => {
  try {
    fn();
    return 'OK';
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
};

const body = (over: Partial<Parameters<typeof createExhibition>[1]> = {}) => ({
  exhibitionId: EX,
  title: 'S.O.S. 연대기 전시관',
  templateId: 'modern-history' as const,
  pin: '482910',
  linkTokenHash: HASH,
  startCode: 'start-ok',
  ...over,
});

/** 그림 작품 하나와 그 파생 묶음을 저장소에 바로 넣는다(올리기는 P3-4) */
const seedArtwork = (
  deps: Deps,
  n: number,
  roomId: string,
  over: Partial<ArtworkRecord> = {},
): ArtworkRecord => {
  const assetId = id(9, n);
  deps.store.assets.insert({
    id: assetId,
    exhibitionId: EX,
    kind: 'IMAGE',
    width: 3000,
    height: 2000,
    durationMs: null,
    variants: [{ name: 'wall', ext: 'webp', w: 1600, h: 1067, bytes: 120_000 }],
    analysis: {
      edgeLuma: 0.8,
      linePitchPx: null,
      linePitchConfidence: 0,
      lineProfile: null,
      profileBinPx: 8,
    },
    bytesTotal: 120_000,
    contentHash: `h${n}`,
    createdAt: 0,
  });
  const rec: ArtworkRecord = {
    id: id(3, n),
    exhibitionId: EX,
    roomId,
    order: n,
    title: `작품 ${n}`,
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
    sourceAssetId: assetId,
    pageCount: null,
    textBody: null,
    warnings: [],
    failCode: null,
    deletedAt: null,
    rev: 1,
    createHash: `c${n}`,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
  deps.store.artworks.insert(rec);
  return rec;
};

let t: TestDeps;
/** 묶음마다 메모리·SQLite 두 저장소로 돌린다(시험마다 새 저장소, 끝나면 닫고 지움) */
const useStore = (make: () => TestDeps): void => {
  beforeEach(() => {
    t = make();
  });
  afterEach(() => t.close());
};
afterEach(() => resetConfig());

describe.each(TEST_STORES)('전시 만들기(멱등·PIN·시작 코드) · $name', ({ make }) => {
  useStore(make);
  it('같은 ID·같은 본문이면 처음 결과, 본문이 다르면 충돌', () => {
    const first = createExhibition(t.deps, body(), { deviceRegistered: false });
    expect(first.entryCode).toMatch(/^[1-9]\d{5}$/);
    expect(first.registerDevice).toBe(true);
    const again = createExhibition(t.deps, body(), { deviceRegistered: false });
    expect(again.entryCode).toBe(first.entryCode);
    expect(
      code(() => createExhibition(t.deps, body({ title: '다른 이름' }), { deviceRegistered: true })),
    ).toBe('E_CONFLICT');
    expect(t.deps.store.exhibitions.get(EX)?.status).toBe('DRAFT');
    expect(t.deps.store.sessions.get(HASH)?.kind).toBe('LINK');
  });

  it('쉬운 PIN·이미 쓰이는 PIN·시작 코드', () => {
    expect(code(() => createExhibition(t.deps, body({ pin: '111111' }), { deviceRegistered: true }))).toBe(
      'E_PIN_WEAK',
    );
    createExhibition(t.deps, body(), { deviceRegistered: true });
    expect(
      code(() => createExhibition(t.deps, body({ exhibitionId: id(1, 2) }), { deviceRegistered: true })),
    ).toBe('E_PIN_TAKEN');
    // 새 전시는 새 링크 토큰(같은 해시를 다른 전시에 넣으면 SQLite가 기본 키로 거절한다 — 메모리는 덮어썼다)
    const { startCode: _, ...noCode } = body({
      exhibitionId: id(1, 3),
      pin: '739104',
      linkTokenHash: 'd'.repeat(64),
    });
    expect(code(() => createExhibition(t.deps, noCode, { deviceRegistered: false }))).toBe('E_START_CODE');
    expect(code(() => createExhibition(t.deps, noCode, { deviceRegistered: true }))).toBe('OK');
  });

  it('실패하면 아무것도 남지 않는다(트랜잭션)', () => {
    code(() => createExhibition(t.deps, body({ pin: '111111' }), { deviceRegistered: true }));
    expect(t.count('exhibitions')).toBe(0);
    expect(t.count('sessions')).toBe(0);
  });
});

describe.each(TEST_STORES)('전시실·작품 규칙(§9.2) · $name', ({ make }) => {
  useStore(make);
  const R1 = id(2, 1);
  const R2 = id(2, 2);
  beforeEach(() => {
    createExhibition(t.deps, body(), { deviceRegistered: true });
    createRoom(t.deps, EX, { id: R1, order: 0, title: '1905 을사늑약과 의병' });
    createRoom(t.deps, EX, { id: R2, order: 1, title: '3·1 운동' });
  });

  it('전시실 만들기는 멱등, 다른 본문이면 충돌', () => {
    expect(createRoom(t.deps, EX, { id: R1, order: 0, title: '1905 을사늑약과 의병' }).id).toBe(R1);
    expect(code(() => createRoom(t.deps, EX, { id: R1, order: 0, title: '다른 이름' }))).toBe('E_CONFLICT');
  });

  it('대표작은 전시실마다 하나: 고르면 기존을 풀고, 옮기면 풀린다', () => {
    const a = seedArtwork(t.deps, 1, R1, { featured: true });
    const b = seedArtwork(t.deps, 2, R1);
    patchArtwork(t.deps, EX, b.id, { featured: true }, 1);
    expect(t.deps.store.artworks.get(a.id)?.featured).toBe(false);
    expect(t.deps.store.artworks.get(b.id)?.featured).toBe(true);
    const moved = patchArtwork(t.deps, EX, b.id, { roomId: R2 }, 2);
    expect(moved.featured).toBe(false);
    expect(moved.roomId).toBe(R2);
  });

  it('rev가 어긋나면 충돌, 다른 전시의 작품은 없는 것', () => {
    const a = seedArtwork(t.deps, 1, R1);
    expect(code(() => patchArtwork(t.deps, EX, a.id, { title: '새 이름' }, 7))).toBe('E_CONFLICT');
    expect(code(() => patchArtwork(t.deps, EX, a.id, { title: '새 이름' }, null))).toBe('E_CONFLICT');
    createExhibition(t.deps, body({ exhibitionId: id(1, 9), pin: '739104', linkTokenHash: 'b'.repeat(64) }), {
      deviceRegistered: true,
    });
    expect(code(() => patchArtwork(t.deps, id(1, 9), a.id, { title: '남의 작품' }, 1))).toBe('E_NOT_FOUND');
  });

  it('순서 바꾸기는 집합이 같아야 한다', () => {
    const a = seedArtwork(t.deps, 1, R1);
    const b = seedArtwork(t.deps, 2, R1);
    expect(code(() => reorderArtworks(t.deps, EX, R1, [a.id]))).toBe('E_CONFLICT');
    reorderArtworks(t.deps, EX, R1, [b.id, a.id]);
    expect(t.deps.store.artworks.get(b.id)?.order).toBe(0);
    expect(code(() => reorderRooms(t.deps, EX, [R2]))).toBe('E_CONFLICT');
  });

  it('여러 개: 숨기기·게시·옮기기(처리 중은 건너뜀)', () => {
    const a = seedArtwork(t.deps, 1, R1);
    const p = seedArtwork(t.deps, 2, R1, { status: 'PROCESSING' });
    expect(batchArtworks(t.deps, EX, { action: 'HIDE', ids: [a.id, p.id] })).toBe(1);
    expect(t.deps.store.artworks.get(a.id)?.status).toBe('HIDDEN');
    expect(batchArtworks(t.deps, EX, { action: 'MOVE', ids: [a.id], roomId: R2 })).toBe(1);
    expect(t.deps.store.artworks.get(a.id)?.roomId).toBe(R2);
  });

  it('지우기·되살리기: 그 전시실에 대표작이 생겼으면 표시 없이, 24시간 지나면 못 되살림', () => {
    const a = seedArtwork(t.deps, 1, R1, { featured: true });
    deleteArtwork(t.deps, EX, a.id, 1);
    const b = seedArtwork(t.deps, 2, R1);
    patchArtwork(t.deps, EX, b.id, { featured: true }, 1);
    expect(restoreArtwork(t.deps, EX, a.id).featured).toBe(false);
    deleteArtwork(t.deps, EX, a.id, 3);
    t.advance(24 * 3600 * 1000);
    expect(code(() => restoreArtwork(t.deps, EX, a.id))).toBe('E_NOT_FOUND');
  });

  it('전시실 지우기: 작품은 남은 첫 전시실 끝으로, 대표작이 겹치면 푼다. 마지막 전시실은 작품이 있으면 못 지움', () => {
    seedArtwork(t.deps, 1, R2, { featured: true });
    seedArtwork(t.deps, 2, R1, { featured: true });
    deleteRoom(t.deps, EX, R1, 1);
    const left = t.deps.store.artworks.listByExhibition(EX);
    expect(left.every(a => a.roomId === R2)).toBe(true);
    expect(left.filter(a => a.featured)).toHaveLength(1);
    expect(code(() => deleteRoom(t.deps, EX, R2, 1))).toBe('E_CONFLICT');
  });
});

describe.each(TEST_STORES)('열기·배치·보기 묶음 · $name', ({ make }) => {
  useStore(make);
  const R1 = id(2, 1);
  beforeEach(() => {
    createExhibition(t.deps, body(), { deviceRegistered: true });
    createRoom(t.deps, EX, { id: R1, order: 0, title: '1905 을사늑약과 의병' });
  });

  it('게시 작품이 없으면 못 열고, 열면 학생 보기 묶음이 스키마대로', () => {
    expect(code(() => changeStatus(t.deps, EX, 'open'))).toBe('E_NOTHING_PUBLISHED');
    const entry = t.deps.store.exhibitions.get(EX)!.entryCode;
    expect(code(() => exhibitionView(t.deps, entry))).toBe('E_EXHIBITION_DRAFT');
    for (let n = 1; n <= 5; n++) seedArtwork(t.deps, n, R1);
    seedArtwork(t.deps, 6, R1, { status: 'HIDDEN' });
    changeStatus(t.deps, EX, 'open');
    const view = ExhibitionViewSchema.parse(exhibitionView(t.deps, entry));
    expect(view.artworks).toHaveLength(5);
    expect(view.layout.frames).toHaveLength(5);
    expect(view.reactions).toHaveLength(5);
    const teacher = TeacherExhibitionViewSchema.parse(teacherView(t.deps, EX));
    expect(teacher.artworks).toHaveLength(6);
    changeStatus(t.deps, EX, 'close');
    expect(code(() => exhibitionView(t.deps, entry))).toBe('E_EXHIBITION_CLOSED');
    expect(versionInfo(t.deps, entry).status).toBe('CLOSED');
    changeStatus(t.deps, EX, 'reopen');
    expect(versionInfo(t.deps, entry).status).toBe('OPEN');
  });

  it('배치는 바뀔 때만 판이 오르고 최근 2판만 남는다', () => {
    const a = seedArtwork(t.deps, 1, R1);
    seedArtwork(t.deps, 2, R1);
    const v1 = recomputeLayout(t.deps, EX);
    expect(recomputeLayout(t.deps, EX).version).toBe(v1.version);
    // 이름만 바꾸면 배치 해시가 같다(ADR-052)
    patchExhibition(t.deps, EX, { title: '새 전시 이름' }, 1);
    expect(recomputeLayout(t.deps, EX).version).toBe(v1.version);
    patchArtwork(t.deps, EX, a.id, { status: 'HIDDEN' }, 1);
    const v2 = recomputeLayout(t.deps, EX);
    expect(v2.version).toBe(v1.version + 1);
    patchArtwork(t.deps, EX, a.id, { status: 'PUBLISHED' }, 2);
    expect(recomputeLayout(t.deps, EX).version).toBe(v2.version + 1);
    expect(t.count('layouts', EX)).toBe(2);
  });

  it('만료·지우는 중이면 학생·교사 모두 없는 전시', () => {
    seedArtwork(t.deps, 1, R1);
    changeStatus(t.deps, EX, 'open');
    const entry = t.deps.store.exhibitions.get(EX)!.entryCode;
    overrideConfig({ EXHIBITION_TTL_DAYS: 30 });
    t.advance(30 * 24 * 3600 * 1000);
    expect(code(() => exhibitionView(t.deps, entry))).toBe('E_NOT_FOUND');
    expect(code(() => teacherView(t.deps, EX))).toBe('E_NOT_FOUND');
  });

  it('선생님 링크 새로 만들기: 이전 LINK 세션은 무효, 새 해시만', () => {
    rotateLink(t.deps, EX, 'c'.repeat(64));
    expect(t.deps.store.sessions.get(HASH)).toBeNull();
    expect(t.deps.store.sessions.get('c'.repeat(64))?.kind).toBe('LINK');
  });
});
