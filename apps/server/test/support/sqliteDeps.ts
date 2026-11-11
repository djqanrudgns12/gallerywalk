import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Deps, Store } from '../../src/ports/index.ts';
import type { Db } from '../../src/store/db.ts';
import { createSqliteStore } from '../../src/store/repos.ts';
import { openTestDb } from '../helpers/server.ts';
import { testDeps, type FakeMedia, type FakeUploads, type LogLine } from './memoryStore.ts';

/**
 * 같은 유스케이스·계약 시험을 메모리·SQLite 두 저장소로 돌리기 위한 의존성(P3-store).
 * 시계·난수·보안·미디어/업로드 가짜·기록 모으기는 `testDeps()`의 것을 그대로 쓰고 저장소만 바꾼다.
 */

/** 저장소 공통 조회로 세는 표(메모리 `tables()`와 SQLite 표가 같은 뜻) */
export type CountedTable =
  | 'exhibitions'
  | 'sessions'
  | 'layouts'
  | 'rooms'
  | 'artworks'
  | 'pages'
  | 'assets'
  | 'visitors'
  | 'reactions';

export interface TestDeps {
  readonly deps: Deps;
  readonly store: Store;
  readonly advance: (ms: number) => void;
  readonly at: () => number;
  /** 표의 행 수. 전시를 주면 그 전시의 행만(쪽은 그 전시 작품의 쪽) */
  readonly count: (table: CountedTable, exhibitionId?: string) => number;
  /** 가짜 미디어 폴더(`deps.media`) */
  readonly media: FakeMedia;
  /** 가짜 업로드 기다리기(`deps.uploads`) */
  readonly uploads: FakeUploads;
  /** `deps.log`로 남긴 기록 */
  readonly logs: readonly LogLine[];
  /** 지우기 단계를 부른 차례(`drain`·`remove`·`exists`·`checkpoint`) */
  readonly trail: string[];
  /** WAL 파일 크기(바이트). 메모리 저장소는 null */
  readonly walBytes: () => number | null;
  /** 시험 끝: SQLite는 닫고 임시 폴더를 지운다 */
  readonly close: () => void;
}

/** 체크포인트를 부른 차례도 `trail`에 남긴다 */
const traceCheckpoint = (store: Store, trail: string[]): Store => ({
  ...store,
  checkpoint: () => {
    trail.push('checkpoint');
    return store.checkpoint();
  },
});

/** 메모리 저장소(`testDeps()`)에 공통 조회를 붙인 것 */
export const memoryTestDeps = (start?: number): TestDeps => {
  const t = testDeps(start);
  const count = (table: CountedTable, exhibitionId?: string): number => {
    const rows = t.store.tables();
    const artworkOwner = new Map([...rows.artworks.values()].map(a => [a.id, a.exhibitionId]));
    const owners: readonly (string | undefined)[] =
      table === 'exhibitions'
        ? [...rows.exhibitions.values()].map(e => e.id)
        : table === 'layouts'
          ? rows.layouts.map(l => l.exhibitionId)
          : table === 'pages'
            ? [...rows.pages.values()].map(p => artworkOwner.get(p.artworkId))
            : [...rows[table].values()].map(r => r.exhibitionId);
    return exhibitionId === undefined ? owners.length : owners.filter(o => o === exhibitionId).length;
  };
  const store = traceCheckpoint(t.store, t.trail);
  return {
    deps: { ...t.deps, store },
    store,
    advance: t.advance,
    at: t.at,
    count,
    media: t.media,
    uploads: t.uploads,
    logs: t.logs,
    trail: t.trail,
    walBytes: () => null,
    close: () => undefined,
  };
};

/** 시험 DB도 git 제외된 .local 안에(시험마다 새 폴더) — `helpers/server.ts`의 `makeTempDir`와 같은 곳 */
const TEST_ROOT = resolve(import.meta.dirname, '../../../..', '.local', 'test-server');

const COUNT_SQL: Record<CountedTable, { readonly table: string; readonly owner: string }> = {
  exhibitions: { table: 'exhibitions', owner: 'id' },
  sessions: { table: 'teacher_sessions', owner: 'exhibition_id' },
  layouts: { table: 'layouts', owner: 'exhibition_id' },
  rooms: { table: 'rooms', owner: 'exhibition_id' },
  artworks: { table: 'artworks', owner: 'exhibition_id' },
  // 쪽에는 전시 칸이 없다 — 작품으로 찾는다
  pages: {
    table: 'artwork_pages',
    owner: '(SELECT exhibition_id FROM artworks WHERE artworks.id = artwork_pages.artwork_id)',
  },
  assets: { table: 'assets', owner: 'exhibition_id' },
  visitors: { table: 'visitors', owner: 'exhibition_id' },
  reactions: { table: 'reactions', owner: 'exhibition_id' },
};

/** `testDeps()`와 같은 모양 + 임시 폴더의 새 SQLite DB(마이그레이션 적용) */
export const sqliteTestDeps = (start?: number): TestDeps & { readonly db: Db } => {
  const t = testDeps(start);
  mkdirSync(TEST_ROOT, { recursive: true });
  const root = mkdtempSync(join(TEST_ROOT, 'store-'));
  const db = openTestDb(root);
  const store = traceCheckpoint(createSqliteStore(db), t.trail);
  const count = (table: CountedTable, exhibitionId?: string): number => {
    const { table: name, owner } = COUNT_SQL[table];
    const value: unknown =
      exhibitionId === undefined
        ? db.prepare(`SELECT count(*) FROM ${name}`).pluck().get()
        : db.prepare(`SELECT count(*) FROM ${name} WHERE ${owner} = ?`).pluck().get(exhibitionId);
    if (typeof value !== 'number') throw new Error(`count(${name}) is not a number`);
    return value;
  };
  const walBytes = (): number => statSync(`${db.name}-wal`, { throwIfNoEntry: false })?.size ?? 0;
  const close = (): void => {
    if (db.open) db.close();
    rmSync(root, { recursive: true, force: true });
  };
  return {
    deps: { ...t.deps, store },
    store,
    db,
    advance: t.advance,
    at: t.at,
    count,
    media: t.media,
    uploads: t.uploads,
    logs: t.logs,
    trail: t.trail,
    walBytes,
    close,
  };
};

/** `describe.each(TEST_STORES)('… · $name', ({ make }) => …)` */
export const TEST_STORES: readonly { readonly name: string; readonly make: () => TestDeps }[] = [
  { name: 'memory', make: () => memoryTestDeps() },
  { name: 'sqlite', make: () => sqliteTestDeps() },
];
