import { existsSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDb,
  loadMigrations,
  migrate,
  openDb,
  schemaVersion,
  transaction,
  type Db,
} from '../../src/store/db.ts';
import { makeTempDir, openTestDb, TEST_BUSY_TIMEOUT_MS } from '../helpers/server.ts';

let root: string;
let db: Db | undefined;

beforeEach(async () => {
  root = await makeTempDir();
});
afterEach(async () => {
  if (db?.open) db.close();
  db = undefined;
  await rm(root, { recursive: true, force: true });
});

const schema = (handle: Db): unknown[] =>
  handle
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();

const NOW = 1_700_000_000_000;

/** 전시 하나 + 전시실 + 작품 + 방문자 + 반응. 이름 끝 글자로 전시를 구분한다. */
function seedExhibition(handle: Db, tag: string): void {
  const exhibition = `00000000-0000-4000-8000-00000000000${tag}`;
  handle
    .prepare(
      `INSERT INTO exhibitions (id, entry_code, pin_hmac, title, template_id, settings_json, status,
        retention_days, create_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'modern-history', '{}', 'DRAFT', 30, 'h', ?, ?)`,
    )
    .run(exhibition, `12345${tag}`, `pin-${tag}`, `전시 ${tag}`, NOW, NOW + 1);
  handle
    .prepare(
      `INSERT INTO rooms (id, exhibition_id, ord, title, create_hash, created_at, updated_at)
       VALUES (?, ?, 0, '전시실', 'h', ?, ?)`,
    )
    .run(`room-${tag}`, exhibition, NOW, NOW);
  insertArtwork(handle, `art-${tag}`, exhibition, `room-${tag}`);
  insertVisitor(handle, `visitor-${tag}`, exhibition);
  insertReaction(handle, `reaction-${tag}`, exhibition, `art-${tag}`, `visitor-${tag}`);
}

const exhibitionId = (tag: string): string => `00000000-0000-4000-8000-00000000000${tag}`;

function insertArtwork(handle: Db, id: string, exhibition: string, room: string): void {
  handle
    .prepare(
      `INSERT INTO artworks (id, exhibition_id, room_id, ord, kind, form, status, create_hash, created_at, updated_at)
       VALUES (?, ?, ?, 0, 'IMAGE', 'SQUARE', 'PUBLISHED', 'h', ?, ?)`,
    )
    .run(id, exhibition, room, NOW, NOW);
}

function insertVisitor(handle: Db, token: string, exhibition: string): void {
  handle
    .prepare('INSERT INTO visitors (token_hash, exhibition_id, created_at) VALUES (?, ?, ?)')
    .run(token, exhibition, NOW);
}

function insertReaction(handle: Db, id: string, exhibition: string, artwork: string, visitor: string): void {
  handle
    .prepare(
      `INSERT INTO reactions (id, exhibition_id, artwork_id, visitor_token_hash, sticker, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'GREAT', ?, ?)`,
    )
    .run(id, exhibition, artwork, visitor, NOW, NOW);
}

const count = (handle: Db, table: string, exhibition: string): unknown =>
  handle.prepare(`SELECT count(*) FROM ${table} WHERE exhibition_id = ?`).pluck().get(exhibition);

describe('SQLite 열기', () => {
  it('PLAN §9.1 PRAGMA가 모두 걸린다', () => {
    db = openDb(join(root, 'gallery.sqlite'), { busyTimeoutMs: TEST_BUSY_TIMEOUT_MS });
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(TEST_BUSY_TIMEOUT_MS);
    expect(db.pragma('secure_delete', { simple: true })).toBe(1);
    // NORMAL = 1
    expect(db.pragma('synchronous', { simple: true })).toBe(1);
  });

  it('끝낼 때 WAL을 비우고 닫는다(wal_checkpoint TRUNCATE)', () => {
    const file = join(root, 'gallery.sqlite');
    db = openTestDb(root);
    seedExhibition(db, '1');
    expect(statSync(`${file}-wal`).size).toBeGreaterThan(0);
    closeDb(db);
    expect(db.open).toBe(false);
    expect(!existsSync(`${file}-wal`) || statSync(`${file}-wal`).size === 0).toBe(true);
    closeDb(db);
  });
});

describe('마이그레이션', () => {
  it('두 번 돌려도 같다: 처음만 적용되고 다시 열어도 다시 돌지 않는다', () => {
    const file = join(root, 'gallery.sqlite');
    db = openDb(file, { busyTimeoutMs: TEST_BUSY_TIMEOUT_MS });
    expect(schemaVersion(db)).toBe(0);
    const first = migrate(db);
    const latest = loadMigrations().length;
    expect(first).toEqual({ from: 0, to: latest, applied: loadMigrations().map(m => m.version) });
    const before = schema(db);
    expect(migrate(db)).toEqual({ from: latest, to: latest, applied: [] });
    expect(schema(db)).toEqual(before);
    db.close();

    db = openDb(file, { busyTimeoutMs: TEST_BUSY_TIMEOUT_MS });
    expect(migrate(db).applied).toEqual([]);
    expect(schema(db)).toEqual(before);
    expect(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").pluck().get()).toBe(
      String(latest),
    );
  });

  it('PLAN §10.2 표가 STRICT로 만들어지고 assets.analysis_json은 있고 artworks.analysis_json은 없다', () => {
    db = openTestDb(root);
    const tables = db
      .prepare(
        "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string; strict: number }[];
    expect(tables.map(t => t.name).sort()).toEqual(
      [
        'artwork_pages',
        'artworks',
        'assets',
        'exhibitions',
        'layouts',
        'meta',
        'rate_buckets',
        'reactions',
        'rooms',
        'teacher_devices',
        'teacher_sessions',
        'visitors',
      ].sort(),
    );
    expect(tables.every(t => t.strict === 1)).toBe(true);
    const columns = (table: string): string[] =>
      db!.prepare('SELECT name FROM pragma_table_info(?)').pluck().all(table) as string[];
    const assetColumns = columns('assets');
    expect(assetColumns.indexOf('analysis_json')).toBe(assetColumns.indexOf('variants_json') + 1);
    expect(columns('artworks')).not.toContain('analysis_json');
    expect(columns('artworks')).toEqual(expect.arrayContaining(['warnings_json', 'fail_code']));
  });

  it('DB가 코드보다 새 판이면 거부한다', () => {
    db = openTestDb(root);
    db.prepare("UPDATE meta SET value = '999' WHERE key = 'schema_version'").run();
    expect(() => migrate(db!)).toThrow(/newer than code/);
  });

  it('파일 이름이 틀리거나 판에 빈틈이 있으면 읽지 않는다', async () => {
    const gap = join(root, 'gap');
    await mkdir(gap);
    await writeFile(
      join(gap, '0001_a.sql'),
      'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
    );
    await writeFile(join(gap, '0003_c.sql'), 'SELECT 1;');
    expect(() => loadMigrations(gap)).toThrow(/without gaps/);

    const badName = join(root, 'bad');
    await mkdir(badName);
    await writeFile(join(badName, '1_init.sql'), 'SELECT 1;');
    expect(() => loadMigrations(badName)).toThrow(/bad migration file name/);

    const empty = join(root, 'empty');
    await mkdir(empty);
    expect(() => loadMigrations(empty)).toThrow(/no migrations/);
  });

  it('판 하나가 중간에 실패하면 그 판은 통째로 되돌리고 판 번호도 그대로', async () => {
    const dir = join(root, 'migrations');
    await mkdir(dir);
    await writeFile(
      join(dir, '0001_init.sql'),
      'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;',
    );
    await writeFile(join(dir, '0002_broken.sql'), 'CREATE TABLE half (id TEXT) STRICT;\nTHIS IS NOT SQL;');
    db = openDb(join(root, 'gallery.sqlite'), { busyTimeoutMs: TEST_BUSY_TIMEOUT_MS });
    expect(() => migrate(db!, loadMigrations(dir))).toThrow();
    expect(schemaVersion(db)).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
  });
});

describe('전시 경계(복합 외래키, PLAN §10.2)', () => {
  beforeEach(() => {
    db = openTestDb(root);
    seedExhibition(db, '1');
    seedExhibition(db, '2');
  });

  it('작품 → 다른 전시의 전시실을 거절한다', () => {
    expect(() => insertArtwork(db!, 'art-x', exhibitionId('1'), 'room-2')).toThrow(/FOREIGN KEY/);
    insertArtwork(db!, 'art-ok', exhibitionId('1'), 'room-1');
  });

  it('반응 → 다른 전시의 작품·방문자를 거절한다', () => {
    expect(() => insertReaction(db!, 'r-x1', exhibitionId('1'), 'art-2', 'visitor-1')).toThrow(/FOREIGN KEY/);
    expect(() => insertReaction(db!, 'r-x2', exhibitionId('1'), 'art-1', 'visitor-2')).toThrow(/FOREIGN KEY/);
    insertVisitor(db!, 'visitor-1b', exhibitionId('1'));
    insertReaction(db!, 'r-ok', exhibitionId('1'), 'art-1', 'visitor-1b');
  });

  it('STRICT·CHECK가 틀린 형·상태값을 거절한다', () => {
    expect(() =>
      db!
        .prepare(
          `INSERT INTO rooms (id, exhibition_id, ord, title, create_hash, created_at, updated_at)
           VALUES ('room-bad', ?, 'first', 't', 'h', 0, 0)`,
        )
        .run(exhibitionId('1')),
    ).toThrow(/cannot store TEXT value in INTEGER column/);
    expect(() =>
      db!.prepare("UPDATE exhibitions SET status = 'open' WHERE id = ?").run(exhibitionId('1')),
    ).toThrow(/CHECK constraint/);
  });

  it('전시를 지우면 그 전시의 행만 연쇄로 지워진다(보관 정리 §9.7)', () => {
    db!.prepare('DELETE FROM exhibitions WHERE id = ?').run(exhibitionId('1'));
    for (const table of ['rooms', 'artworks', 'visitors', 'reactions']) {
      expect(count(db!, table, exhibitionId('1'))).toBe(0);
      expect(count(db!, table, exhibitionId('2'))).toBe(1);
    }
  });
});

describe('트랜잭션', () => {
  beforeEach(() => {
    db = openTestDb(root);
  });

  it('던지면 되돌린다', () => {
    expect(() =>
      transaction(db!, () => {
        seedExhibition(db!, '1');
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(db!.prepare('SELECT count(*) FROM exhibitions').pluck().get()).toBe(0);
  });

  it('비동기 함수는 받지 않고 되돌린다', () => {
    expect(() =>
      transaction(db!, async () => {
        seedExhibition(db!, '1');
      }),
    ).toThrow(/synchronous/);
    expect(db!.prepare('SELECT count(*) FROM exhibitions').pluck().get()).toBe(0);
  });

  it('값을 돌려주고 커밋한다', () => {
    const result = transaction(db!, () => {
      seedExhibition(db!, '1');
      return 'done';
    });
    expect(result).toBe('done');
    expect(db!.prepare('SELECT count(*) FROM exhibitions').pluck().get()).toBe(1);
  });
});
