import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * SQLite 열기·마이그레이션·트랜잭션(PLAN §9.1·§10, ADR-003). 저장소 포트 구현(repos)은 이 위에 따로 둔다.
 * better-sqlite3는 동기라 한 요청의 쓰기를 `transaction` 하나로 묶는다.
 */

export type Db = Database.Database;

export interface DbOptions {
  /** 다른 연결이 쓰는 중일 때 기다리는 시간(PLAN §9.1 `busy_timeout`) */
  readonly busyTimeoutMs: number;
}

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface MigrateResult {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly number[];
}

/** 이 파일 옆의 `migrations/NNNN_이름.sql`. 빌드 산출물(dist)로 돌릴 때는 SQL 파일도 같은 자리에 복사돼야 한다. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;
const VERSION_KEY = 'schema_version';

/** 열고 PLAN §9.1의 PRAGMA를 건다. WAL·외래키가 실제로 켜지지 않으면 시작을 거부한다. */
export function openDb(file: string, options: DbOptions): Db {
  const db = new Database(file, { timeout: options.busyTimeoutMs });
  try {
    const journal = db.pragma('journal_mode = WAL', { simple: true });
    if (journal !== 'wal') throw new Error(`sqlite journal_mode is ${String(journal)}, expected wal`);
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${Math.trunc(options.busyTimeoutMs)}`);
    db.pragma('secure_delete = ON');
    db.pragma('synchronous = NORMAL');
    if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('sqlite foreign_keys is off');
    return db;
  } catch (cause) {
    db.close();
    throw cause;
  }
}

/** 마이그레이션 파일을 판 순서로 읽는다. 이름이 틀리거나 판이 1부터 빈틈없이 이어지지 않으면 거부. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const names = readdirSync(dir)
    .filter(name => name.endsWith('.sql'))
    .sort();
  if (names.length === 0) throw new Error(`no migrations in ${dir}`);
  return names.map((name, index) => {
    const match = MIGRATION_FILE.exec(name);
    if (match?.[1] === undefined) throw new Error(`bad migration file name: ${name}`);
    const version = Number(match[1]);
    if (version !== index + 1) throw new Error(`migration versions must be 1..n without gaps: ${name}`);
    return { version, name, sql: readFileSync(join(dir, name), 'utf8') };
  });
}

/** `meta.schema_version`(meta 표가 아직 없으면 0) */
export function schemaVersion(db: Db): number {
  const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  if (hasMeta === undefined) return 0;
  const value = db.prepare('SELECT value FROM meta WHERE key = ?').pluck().get(VERSION_KEY);
  if (value === undefined) return 0;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) throw new Error('meta.schema_version is not an integer');
  return version;
}

/**
 * 앞으로만 가는 마이그레이션. 판마다 트랜잭션 하나(SQL + 판 기록)라 중간에 실패하면 그 판은 통째로 없던 일이 된다.
 * 이미 지난 판은 다시 돌지 않는다. DB가 코드보다 새 판이면 거부(옛 코드로 되돌린 경우).
 */
export function migrate(db: Db, migrations: readonly Migration[] = loadMigrations()): MigrateResult {
  const from = schemaVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;
  if (from > latest) throw new Error(`database schema ${from} is newer than code ${latest}`);
  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= from) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      ).run(VERSION_KEY, String(migration.version));
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length > 0) throw new Error(`migration ${migration.name} left foreign key violations`);
    });
    applied.push(migration.version);
  }
  return { from, to: Math.max(from, latest), applied };
}

const isThenable = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';

/**
 * 쓰기 트랜잭션(`BEGIN IMMEDIATE` — WAL에서 읽기→쓰기 승격 중 SQLITE_BUSY를 피한다).
 * `fn`은 동기여야 한다. Promise를 돌려주면 되돌리고 오류를 낸다(await 사이에 커밋되는 사고를 막음).
 */
export function transaction<T>(db: Db, fn: () => T): T {
  return db
    .transaction(() => {
      const result = fn();
      if (isThenable(result)) throw new Error('transaction callback must be synchronous');
      return result;
    })
    .immediate();
}

/** 끝내기(PLAN §9.1): WAL을 본 파일에 모두 옮기고 비운 뒤 닫는다. 이미 닫혔으면 아무것도 안 함. */
export function closeDb(db: Db): void {
  if (!db.open) return;
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}
