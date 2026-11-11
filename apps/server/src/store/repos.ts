import {
  ArtworkFormSchema,
  ArtworkKindSchema,
  ArtworkStatusSchema,
  ArtworkWarningSchema,
  AssetKindSchema,
  AudioAnalysisSchema,
  ErrorCodeSchema,
  ExhibitionSettingsSchema,
  ExhibitionStatusSchema,
  ImageAnalysisWireSchema,
  LayoutSchema,
  MediaVariantSchema,
  PageModeSchema,
  SessionKindSchema,
  StickerSchema,
  TemplateIdSchema,
} from '@gallery/core/types';
import { z } from 'zod';
import type {
  ArtworkRecord,
  ArtworkRepo,
  AssetRecord,
  ExhibitionRecord,
  ExhibitionRepo,
  LayoutRecord,
  PageRecord,
  ReactionRecord,
  ReactionRepo,
  RoomRecord,
  RoomRepo,
  Store,
  TeacherSessionRecord,
  VisitorRecord,
  VisitorRepo,
} from '../ports/index.ts';
import { transaction, type Db } from './db.ts';

/**
 * SQLite 저장소 — 서버 포트(`ports/index.ts`)의 better-sqlite3 구현(PLAN §10, ADR-055).
 * 동작의 기준은 메모리 구현(`test/support/memoryStore.ts`)이다. 그와 같게:
 * - 고치기는 빠진 칸·`undefined` 칸을 건너뛰고 `null`은 비운다. 없는 행 고치기는 오류.
 * - `transaction`은 던지면 모두 되돌린다. 안에서 다시 부르면 바깥 트랜잭션에 합류한다(SAVEPOINT — 안쪽만
 *   던지고 바깥이 잡으면 안쪽 변경만 되돌아간다. 메모리 구현의 스냅숏과 같은 결과).
 * - 목록은 넣은 순서(`rowid`)로 돌려준다(메모리의 Map 순서와 같음). `listByIds`는 받은 ID 순서대로.
 * 메모리 구현과 다른 점(DB 제약): `insert`는 같은 키가 있으면 덮어쓰지 않고 실패한다(전시 경계·멱등 확인은
 * 유스케이스가 먼저 `get`으로 한다). 복합 외래키·대표작 하나·반응 하나 같은 표 제약도 그대로 거절한다.
 * 행 ↔ 기록: snake_case ↔ camelCase, 0/1 ↔ 참거짓, JSON 칸 ↔ 값. 읽을 때 모든 칸을 zod로 검사하고
 * (JSON 칸은 core 스키마), 쓸 때도 같은 검사를 거친다 — 다시 읽을 수 없는 행은 쓰지 않는다.
 */

/** 저장된(또는 쓰려는) 행이 표 모양과 맞지 않음 — 깨진 JSON 칸·모르는 상태값. 요청은 `E_SERVER`가 된다. */
export class StoreRowError extends Error {
  override readonly name = 'StoreRowError';
  readonly table: string;
  /** 맞지 않는 칸(`settings_json.tour.secondsPerRoom`처럼). 값은 담지 않는다 */
  readonly fields: readonly string[];
  constructor(table: string, error: z.ZodError) {
    const fields = [...new Set(error.issues.map(i => i.path.map(String).join('.') || '_'))];
    super(`${table}: 행 모양이 맞지 않음 (${fields.join(', ')})`, { cause: error });
    this.table = table;
    this.fields = fields;
  }
}

// ── 칸 모양 ────────────────────────────────────────────────

type SqlValue = string | number | null;
type SqlRow = Readonly<Record<string, SqlValue>>;

const int = z.number().int();
const bool = z.literal([0, 1]).transform(v => v === 1);
const bit = (v: boolean): 0 | 1 => (v ? 1 : 0);

/** JSON 칸: 글자 → `JSON.parse` → 스키마 */
const json = <S extends z.ZodType>(schema: S) =>
  z
    .string()
    .transform((text, ctx): unknown => {
      try {
        return JSON.parse(text);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'json' });
        return z.NEVER;
      }
    })
    .pipe(schema);

interface Codec<Rec, Row extends SqlRow> {
  readonly table: string;
  readonly columns: readonly string[];
  /** DB 행 → 기록(모든 칸 검사) */
  readonly read: (row: unknown) => Rec;
  /** 기록 → DB 행. 읽기와 같은 검사를 거친 기록(`rec`)도 함께 */
  readonly write: (rec: Rec) => { readonly row: Row; readonly rec: Rec };
}

const codec = <Rec, Row extends SqlRow>(
  table: string,
  columns: readonly string[],
  schema: z.ZodType<Rec>,
  toRow: (rec: Rec) => Row,
): Codec<Rec, Row> => {
  const read = (row: unknown): Rec => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) throw new StoreRowError(table, parsed.error);
    return parsed.data;
  };
  return {
    table,
    columns,
    read,
    write: rec => {
      const row = toRow(rec);
      return { row, rec: read(row) };
    },
  };
};

// ── 표 ↔ 기록 (PLAN §10.2, 0001_init.sql) ──────────────────

const ExhibitionRow = z.object({
  id: z.string(),
  entry_code: z.string(),
  pin_hmac: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  template_id: TemplateIdSchema,
  poster_asset_id: z.string().nullable(),
  school_name: z.string().nullable(),
  class_name: z.string().nullable(),
  show_school: bool,
  settings_json: json(ExhibitionSettingsSchema),
  status: ExhibitionStatusSchema,
  retention_days: int,
  rev: int,
  create_hash: z.string(),
  content_version: int,
  settings_version: int,
  layout_version: int,
  layout_dirty: bool,
  deleting: bool,
  created_at: int,
  expires_at: int,
  opened_at: int.nullable(),
  closed_at: int.nullable(),
});

const exhibitionCodec = codec<ExhibitionRecord, z.input<typeof ExhibitionRow>>(
  'exhibitions',
  Object.keys(ExhibitionRow.shape),
  ExhibitionRow.transform((r): ExhibitionRecord => ({
    id: r.id,
    entryCode: r.entry_code,
    pinHmac: r.pin_hmac,
    title: r.title,
    subtitle: r.subtitle,
    templateId: r.template_id,
    posterAssetId: r.poster_asset_id,
    schoolName: r.school_name,
    className: r.class_name,
    showSchool: r.show_school,
    settings: r.settings_json,
    status: r.status,
    retentionDays: r.retention_days,
    rev: r.rev,
    createHash: r.create_hash,
    contentVersion: r.content_version,
    settingsVersion: r.settings_version,
    layoutVersion: r.layout_version,
    layoutDirty: r.layout_dirty,
    deleting: r.deleting,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
  })),
  e => ({
    id: e.id,
    entry_code: e.entryCode,
    pin_hmac: e.pinHmac,
    title: e.title,
    subtitle: e.subtitle,
    template_id: e.templateId,
    poster_asset_id: e.posterAssetId,
    school_name: e.schoolName,
    class_name: e.className,
    show_school: bit(e.showSchool),
    settings_json: JSON.stringify(e.settings),
    status: e.status,
    retention_days: e.retentionDays,
    rev: e.rev,
    create_hash: e.createHash,
    content_version: e.contentVersion,
    settings_version: e.settingsVersion,
    layout_version: e.layoutVersion,
    layout_dirty: bit(e.layoutDirty),
    deleting: bit(e.deleting),
    created_at: e.createdAt,
    expires_at: e.expiresAt,
    opened_at: e.openedAt,
    closed_at: e.closedAt,
  }),
);

const RoomRow = z.object({
  id: z.string(),
  exhibition_id: z.string(),
  ord: int,
  title: z.string(),
  intro: z.string().nullable(),
  bgm_asset_id: z.string().nullable(),
  rev: int,
  create_hash: z.string(),
  created_at: int,
  updated_at: int,
});

const roomCodec = codec<RoomRecord, z.input<typeof RoomRow>>(
  'rooms',
  Object.keys(RoomRow.shape),
  RoomRow.transform((r): RoomRecord => ({
    id: r.id,
    exhibitionId: r.exhibition_id,
    order: r.ord,
    title: r.title,
    intro: r.intro,
    bgmAssetId: r.bgm_asset_id,
    rev: r.rev,
    createHash: r.create_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })),
  r => ({
    id: r.id,
    exhibition_id: r.exhibitionId,
    ord: r.order,
    title: r.title,
    intro: r.intro,
    bgm_asset_id: r.bgmAssetId,
    rev: r.rev,
    create_hash: r.createHash,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }),
);

const ArtworkRow = z.object({
  id: z.string(),
  exhibition_id: z.string(),
  room_id: z.string(),
  ord: int,
  title: z.string(),
  author: z.string().nullable(),
  caption_short: z.string().nullable(),
  description_long: z.string().nullable(),
  kind: ArtworkKindSchema,
  form: ArtworkFormSchema,
  form_override: ArtworkFormSchema.nullable(),
  text_heavy: bool,
  text_heavy_override: bool.nullable(),
  featured: bool,
  page_mode: PageModeSchema,
  status: ArtworkStatusSchema,
  source_asset_id: z.string().nullable(),
  page_count: int.nullable(),
  text_body: z.string().nullable(),
  warnings_json: json(z.array(ArtworkWarningSchema)),
  fail_code: ErrorCodeSchema.nullable(),
  deleted_at: int.nullable(),
  rev: int,
  create_hash: z.string(),
  created_at: int,
  updated_at: int,
});

const artworkCodec = codec<ArtworkRecord, z.input<typeof ArtworkRow>>(
  'artworks',
  Object.keys(ArtworkRow.shape),
  ArtworkRow.transform((r): ArtworkRecord => ({
    id: r.id,
    exhibitionId: r.exhibition_id,
    roomId: r.room_id,
    order: r.ord,
    title: r.title,
    author: r.author,
    captionShort: r.caption_short,
    descriptionLong: r.description_long,
    kind: r.kind,
    form: r.form,
    formOverride: r.form_override,
    textHeavy: r.text_heavy,
    textHeavyOverride: r.text_heavy_override,
    featured: r.featured,
    pageMode: r.page_mode,
    status: r.status,
    sourceAssetId: r.source_asset_id,
    pageCount: r.page_count,
    textBody: r.text_body,
    warnings: r.warnings_json,
    failCode: r.fail_code,
    deletedAt: r.deleted_at,
    rev: r.rev,
    createHash: r.create_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })),
  a => ({
    id: a.id,
    exhibition_id: a.exhibitionId,
    room_id: a.roomId,
    ord: a.order,
    title: a.title,
    author: a.author,
    caption_short: a.captionShort,
    description_long: a.descriptionLong,
    kind: a.kind,
    form: a.form,
    form_override: a.formOverride,
    text_heavy: bit(a.textHeavy),
    text_heavy_override: a.textHeavyOverride === null ? null : bit(a.textHeavyOverride),
    featured: bit(a.featured),
    page_mode: a.pageMode,
    status: a.status,
    source_asset_id: a.sourceAssetId,
    page_count: a.pageCount,
    text_body: a.textBody,
    warnings_json: JSON.stringify(a.warnings),
    fail_code: a.failCode,
    deleted_at: a.deletedAt,
    rev: a.rev,
    create_hash: a.createHash,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  }),
);

/** 분석값은 asset 종류로 고른다: 소리(배경음악 포함) = 소리 분석값, 그 밖(그림·쪽·포스터·표지) = 그림 분석값 */
const assetFields = {
  id: z.string(),
  exhibition_id: z.string(),
  width: int.nullable(),
  height: int.nullable(),
  duration_ms: int.nullable(),
  variants_json: json(z.array(MediaVariantSchema)),
  bytes_total: int,
  content_hash: z.string(),
  created_at: int,
};
const AudioAssetRow = z.object({
  ...assetFields,
  kind: z.literal('AUDIO'),
  analysis_json: json(AudioAnalysisSchema).nullable(),
});
const ImageAssetRow = z.object({
  ...assetFields,
  kind: AssetKindSchema.exclude(['AUDIO']),
  analysis_json: json(ImageAnalysisWireSchema).nullable(),
});
type AssetRow = Omit<z.input<typeof AudioAssetRow>, 'kind' | 'analysis_json'> & {
  readonly kind: AssetRecord['kind'];
  readonly analysis_json: string | null;
};

const assetCodec = codec<AssetRecord, AssetRow>(
  'assets',
  Object.keys(AudioAssetRow.shape),
  z.discriminatedUnion('kind', [AudioAssetRow, ImageAssetRow]).transform((r): AssetRecord => ({
    id: r.id,
    exhibitionId: r.exhibition_id,
    kind: r.kind,
    width: r.width,
    height: r.height,
    durationMs: r.duration_ms,
    variants: r.variants_json,
    analysis: r.analysis_json,
    bytesTotal: r.bytes_total,
    contentHash: r.content_hash,
    createdAt: r.created_at,
  })),
  a => ({
    id: a.id,
    exhibition_id: a.exhibitionId,
    kind: a.kind,
    width: a.width,
    height: a.height,
    duration_ms: a.durationMs,
    variants_json: JSON.stringify(a.variants),
    analysis_json: a.analysis === null ? null : JSON.stringify(a.analysis),
    bytes_total: a.bytesTotal,
    content_hash: a.contentHash,
    created_at: a.createdAt,
  }),
);

const PageRow = z.object({ artwork_id: z.string(), idx: int, asset_id: z.string() });

const pageCodec = codec<PageRecord, z.input<typeof PageRow>>(
  'artwork_pages',
  Object.keys(PageRow.shape),
  PageRow.transform((r): PageRecord => ({ artworkId: r.artwork_id, idx: r.idx, assetId: r.asset_id })),
  p => ({ artwork_id: p.artworkId, idx: p.idx, asset_id: p.assetId }),
);

const LayoutRow = z.object({
  exhibition_id: z.string(),
  version: int,
  algo_version: int,
  hash: z.string(),
  data_json: json(LayoutSchema),
  created_at: int,
});

/**
 * 저장된 배치 행이 지금 배치 모양 판인가(JSON만 들여다봄). `schemaVersion`이 **다른 숫자**인 옛 행만 false —
 * 판이 없거나 JSON이 깨진 행은 true로 두어 그대로 읽기 오류가 나게 한다(망가진 행을 숨기지 않음).
 */
const LAYOUT_SHAPE = LayoutSchema.shape.schemaVersion.value;
const currentLayoutShape = (row: unknown): boolean => {
  const raw = (row as { data_json?: unknown }).data_json;
  if (typeof raw !== 'string') return true;
  try {
    const v = (JSON.parse(raw) as { schemaVersion?: unknown }).schemaVersion;
    return typeof v !== 'number' || v === LAYOUT_SHAPE;
  } catch {
    return true;
  }
};

const layoutCodec = codec<LayoutRecord, z.input<typeof LayoutRow>>(
  'layouts',
  Object.keys(LayoutRow.shape),
  LayoutRow.transform((r): LayoutRecord => ({
    exhibitionId: r.exhibition_id,
    version: r.version,
    algoVersion: r.algo_version,
    hash: r.hash,
    data: r.data_json,
    createdAt: r.created_at,
  })),
  l => ({
    exhibition_id: l.exhibitionId,
    version: l.version,
    algo_version: l.algoVersion,
    hash: l.hash,
    data_json: JSON.stringify(l.data),
    created_at: l.createdAt,
  }),
);

const SessionRow = z.object({
  token_hash: z.string(),
  exhibition_id: z.string(),
  kind: SessionKindSchema,
  created_at: int,
  last_used_at: int,
});

const sessionCodec = codec<TeacherSessionRecord, z.input<typeof SessionRow>>(
  'teacher_sessions',
  Object.keys(SessionRow.shape),
  SessionRow.transform((r): TeacherSessionRecord => ({
    tokenHash: r.token_hash,
    exhibitionId: r.exhibition_id,
    kind: r.kind,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  })),
  s => ({
    token_hash: s.tokenHash,
    exhibition_id: s.exhibitionId,
    kind: s.kind,
    created_at: s.createdAt,
    last_used_at: s.lastUsedAt,
  }),
);

const VisitorRow = z.object({
  token_hash: z.string(),
  exhibition_id: z.string(),
  nickname: z.string().nullable(),
  nickname_norm: z.string().nullable(),
  consent_version: z.string().nullable(),
  consent_at: int.nullable(),
  created_at: int,
});

const visitorCodec = codec<VisitorRecord, z.input<typeof VisitorRow>>(
  'visitors',
  Object.keys(VisitorRow.shape),
  VisitorRow.transform((r): VisitorRecord => ({
    tokenHash: r.token_hash,
    exhibitionId: r.exhibition_id,
    nickname: r.nickname,
    nicknameNorm: r.nickname_norm,
    consentVersion: r.consent_version,
    consentAt: r.consent_at,
    createdAt: r.created_at,
  })),
  v => ({
    token_hash: v.tokenHash,
    exhibition_id: v.exhibitionId,
    nickname: v.nickname,
    nickname_norm: v.nicknameNorm,
    consent_version: v.consentVersion,
    consent_at: v.consentAt,
    created_at: v.createdAt,
  }),
);

const ReactionRow = z.object({
  id: z.string(),
  exhibition_id: z.string(),
  artwork_id: z.string(),
  visitor_token_hash: z.string(),
  sticker: StickerSchema.nullable(),
  memo: z.string().nullable(),
  score_fact: int.nullable(),
  score_delivery: int.nullable(),
  hidden: bool,
  public_selected: bool,
  created_at: int,
  updated_at: int,
});

const reactionCodec = codec<ReactionRecord, z.input<typeof ReactionRow>>(
  'reactions',
  Object.keys(ReactionRow.shape),
  ReactionRow.transform((r): ReactionRecord => ({
    id: r.id,
    exhibitionId: r.exhibition_id,
    artworkId: r.artwork_id,
    visitorTokenHash: r.visitor_token_hash,
    sticker: r.sticker,
    memo: r.memo,
    scoreFact: r.score_fact,
    scoreDelivery: r.score_delivery,
    hidden: r.hidden,
    publicSelected: r.public_selected,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })),
  r => ({
    id: r.id,
    exhibition_id: r.exhibitionId,
    artwork_id: r.artworkId,
    visitor_token_hash: r.visitorTokenHash,
    sticker: r.sticker,
    memo: r.memo,
    score_fact: r.scoreFact,
    score_delivery: r.scoreDelivery,
    hidden: bit(r.hidden),
    public_selected: bit(r.publicSelected),
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }),
);

// ── SQL 만들기(칸 이름은 위 행 스키마에서만 온다) ──────────────

interface TableShape {
  readonly table: string;
  readonly columns: readonly string[];
}

const setList = (columns: readonly string[], value: (c: string) => string): string =>
  columns.map(c => `${c} = ${value(c)}`).join(', ');

const selectSql = (t: TableShape, tail: string): string =>
  `SELECT ${t.columns.join(', ')} FROM ${t.table} ${tail}`;

const insertSql = (t: TableShape): string =>
  `INSERT INTO ${t.table} (${t.columns.join(', ')}) VALUES (${t.columns.map(c => `@${c}`).join(', ')})`;

/** 열쇠 칸(`keys`)으로 찾아 나머지 칸을 모두 쓴다 */
const updateSql = (t: TableShape, keys: readonly string[]): string =>
  `UPDATE ${t.table} SET ${setList(
    t.columns.filter(c => !keys.includes(c)),
    c => `@${c}`,
  )} WHERE ${keys.map(k => `${k} = @${k}`).join(' AND ')}`;

const upsertSql = (t: TableShape, keys: readonly string[]): string =>
  `${insertSql(t)} ON CONFLICT (${keys.join(', ')}) DO UPDATE SET ${setList(
    t.columns.filter(c => !keys.includes(c)),
    c => `excluded.${c}`,
  )}`;

// ── 고치기 ─────────────────────────────────────────────────

type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/** `undefined` 칸을 건너뛴다(메모리 구현의 `skipUndefined`와 같음). `null`은 남긴다 = 비움 */
const defined = <T extends object>(patch: T): Defined<T> =>
  Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Defined<T>;

const missing = (what: string): Error => new Error(`없는 행 고치기: ${what}`);

const changedOne = (changes: number, what: string): void => {
  if (changes !== 1) throw missing(what);
};

const isTrue = (v: unknown): boolean => v === 1;

/** 전시 지우기 전에 센 딸린 행 수(`exhibitions.counts`) */
const deleteCounts = z.object({
  rooms: int,
  artworks: int,
  pages: int,
  assets: int,
  layouts: int,
  sessions: int,
  visitors: int,
  reactions: int,
});

/** `PRAGMA wal_checkpoint(TRUNCATE)`의 한 줄: busy 1 = 다른 연결 때문에 다 하지 못함 */
const checkpointResult = z.array(z.object({ busy: int, log: int, checkpointed: int })).length(1);

type ExhibitionPatch = Parameters<ExhibitionRepo['update']>[1];
type RoomPatch = Parameters<RoomRepo['update']>[1];
type ArtworkPatch = Parameters<ArtworkRepo['update']>[1];
type VisitorPatch = Parameters<VisitorRepo['update']>[2];
type ReactionPatch = Parameters<ReactionRepo['update']>[1];

/** 소프트 삭제 작품·PDF 쪽도 아직 되살릴 수 있으므로 참조에 포함한다. */
const ASSET_REFERENCED = `
  EXISTS (SELECT 1 FROM artworks WHERE source_asset_id = assets.id)
  OR EXISTS (SELECT 1 FROM artwork_pages WHERE asset_id = assets.id)
  OR EXISTS (SELECT 1 FROM exhibitions WHERE poster_asset_id = assets.id)
  OR EXISTS (SELECT 1 FROM rooms WHERE bgm_asset_id = assets.id)`;

/** 준비된 문장을 한 번 만들고 저장소 9개를 돌려준다. `db`는 `openDb` + `migrate`를 거친 것. */
export const createSqliteStore = (db: Db): Store => {
  const ex = exhibitionCodec;
  const exhibitions = {
    get: db.prepare(selectSql(ex, 'WHERE id = ?')),
    cleanup: db.prepare(
      selectSql(ex, 'WHERE (deleting = 1 OR expires_at <= @now) AND id > @after ORDER BY id LIMIT @limit'),
    ),
    byCode: db.prepare(selectSql(ex, 'WHERE entry_code = ?')),
    byPin: db.prepare(selectSql(ex, 'WHERE pin_hmac = ?')),
    // 만료 행은 정리 작업이 지우므로 표에 있는 전시 전부와 비교한다(PLAN §10.1)
    pinTaken: db
      .prepare('SELECT EXISTS (SELECT 1 FROM exhibitions WHERE pin_hmac = @pin AND id IS NOT @except)')
      .pluck(),
    codeTaken: db.prepare('SELECT EXISTS (SELECT 1 FROM exhibitions WHERE entry_code = ?)').pluck(),
    insert: db.prepare(insertSql(ex)),
    update: db.prepare(updateSql(ex, ['id'])),
    // 연쇄로 지워질 행 수를 먼저 센다(SQLite `changes`는 연쇄 행을 세지 않음). 같은 트랜잭션 안이라 센 수 = 지운 수
    counts: db.prepare(
      `SELECT
         (SELECT count(*) FROM rooms WHERE exhibition_id = @id) AS rooms,
         (SELECT count(*) FROM artworks WHERE exhibition_id = @id) AS artworks,
         (SELECT count(*) FROM artwork_pages
            WHERE artwork_id IN (SELECT id FROM artworks WHERE exhibition_id = @id)) AS pages,
         (SELECT count(*) FROM assets WHERE exhibition_id = @id) AS assets,
         (SELECT count(*) FROM layouts WHERE exhibition_id = @id) AS layouts,
         (SELECT count(*) FROM teacher_sessions WHERE exhibition_id = @id) AS sessions,
         (SELECT count(*) FROM visitors WHERE exhibition_id = @id) AS visitors,
         (SELECT count(*) FROM reactions WHERE exhibition_id = @id) AS reactions`,
    ),
    delete: db.prepare('DELETE FROM exhibitions WHERE id = ?'),
  };
  const rooms = {
    get: db.prepare(selectSql(roomCodec, 'WHERE id = ?')),
    list: db.prepare(selectSql(roomCodec, 'WHERE exhibition_id = ? ORDER BY rowid')),
    insert: db.prepare(insertSql(roomCodec)),
    update: db.prepare(updateSql(roomCodec, ['id', 'exhibition_id'])),
    delete: db.prepare('DELETE FROM rooms WHERE id = ?'),
  };
  const artworks = {
    get: db.prepare(selectSql(artworkCodec, 'WHERE id = ?')),
    deleted: db.prepare(
      selectSql(artworkCodec, 'WHERE deleted_at <= @cutoff AND id > @after ORDER BY id LIMIT @limit'),
    ),
    deleteDeleted: db.prepare('DELETE FROM artworks WHERE id = @id AND deleted_at <= @cutoff'),
    listAll: db.prepare(selectSql(artworkCodec, 'WHERE exhibition_id = ? ORDER BY rowid')),
    listLive: db.prepare(
      selectSql(artworkCodec, 'WHERE exhibition_id = ? AND deleted_at IS NULL ORDER BY rowid'),
    ),
    insert: db.prepare(insertSql(artworkCodec)),
    update: db.prepare(updateSql(artworkCodec, ['id', 'exhibition_id'])),
  };
  const assets = {
    get: db.prepare(selectSql(assetCodec, 'WHERE id = ?')),
    unreferenced: db.prepare(
      selectSql(
        assetCodec,
        `WHERE created_at <= @cutoff AND id > @after AND NOT (${ASSET_REFERENCED}) ORDER BY id LIMIT @limit`,
      ),
    ),
    referenced: db
      .prepare(`SELECT EXISTS (SELECT 1 FROM assets WHERE id = ? AND (${ASSET_REFERENCED}))`)
      .pluck(),
    deleteUnreferenced: db.prepare(`DELETE FROM assets WHERE id = ? AND NOT (${ASSET_REFERENCED})`),
    // ID 목록은 JSON 배열 하나로 넘긴다(개수와 상관없이 같은 문장)
    byIds: db.prepare(selectSql(assetCodec, 'WHERE id IN (SELECT value FROM json_each(?))')),
    insert: db.prepare(insertSql(assetCodec)),
  };
  const pages = {
    byArtworks: db.prepare(
      selectSql(pageCodec, 'WHERE artwork_id IN (SELECT value FROM json_each(?)) ORDER BY rowid'),
    ),
    put: db.prepare(upsertSql(pageCodec, ['artwork_id', 'idx'])),
  };
  const layouts = {
    latest: db.prepare(selectSql(layoutCodec, 'WHERE exhibition_id = ? ORDER BY version DESC LIMIT 1')),
    insert: db.prepare(insertSql(layoutCodec)),
    prune: db.prepare(
      `DELETE FROM layouts WHERE exhibition_id = @ex AND version NOT IN
         (SELECT version FROM layouts WHERE exhibition_id = @ex ORDER BY version DESC LIMIT @keep)`,
    ),
  };
  const sessions = {
    get: db.prepare(selectSql(sessionCodec, 'WHERE token_hash = ?')),
    insert: db.prepare(insertSql(sessionCodec)),
    touch: db.prepare('UPDATE teacher_sessions SET last_used_at = ? WHERE token_hash = ?'),
    deleteKind: db.prepare('DELETE FROM teacher_sessions WHERE exhibition_id = ? AND kind = ?'),
  };
  const visitors = {
    get: db.prepare(selectSql(visitorCodec, 'WHERE token_hash = ? AND exhibition_id = ?')),
    insert: db.prepare(insertSql(visitorCodec)),
    update: db.prepare(updateSql(visitorCodec, ['token_hash', 'exhibition_id'])),
  };
  const reactions = {
    get: db.prepare(selectSql(reactionCodec, 'WHERE id = ?')),
    list: db.prepare(selectSql(reactionCodec, 'WHERE exhibition_id = ? ORDER BY rowid')),
    byVisitor: db.prepare(selectSql(reactionCodec, 'WHERE artwork_id = ? AND visitor_token_hash = ?')),
    upsert: db.prepare(upsertSql(reactionCodec, ['id'])),
    update: db.prepare(updateSql(reactionCodec, ['id'])),
  };

  /** 한 행(없으면 null) */
  const one = <Rec>(read: (row: unknown) => Rec, row: unknown): Rec | null =>
    row === undefined ? null : read(row);

  const getExhibition = (id: string): ExhibitionRecord | null => one(ex.read, exhibitions.get.get(id));
  const getRoom = (id: string): RoomRecord | null => one(roomCodec.read, rooms.get.get(id));
  const getArtwork = (id: string): ArtworkRecord | null => one(artworkCodec.read, artworks.get.get(id));
  const getVisitor = (tokenHash: string, exhibitionId: string): VisitorRecord | null =>
    one(visitorCodec.read, visitors.get.get(tokenHash, exhibitionId));
  const getReaction = (id: string): ReactionRecord | null => one(reactionCodec.read, reactions.get.get(id));

  return {
    transaction: fn => transaction(db, fn),
    // 트랜잭션 안에서는 체크포인트가 WAL을 비우지 못한다 — 부른 쪽이 밖에서 부른다(PLAN §9.7)
    checkpoint: () => checkpointResult.parse(db.pragma('wal_checkpoint(TRUNCATE)'))[0]?.busy === 0,
    exhibitions: {
      get: getExhibition,
      listForCleanup: (now, limit, afterId = '') =>
        exhibitions.cleanup.all({ now, limit, after: afterId }).map(ex.read),
      getByEntryCode: code => one(ex.read, exhibitions.byCode.get(code)),
      getByPinHmac: pinHmac => one(ex.read, exhibitions.byPin.get(pinHmac)),
      pinTaken: (pinHmac, exceptId) => isTrue(exhibitions.pinTaken.get({ pin: pinHmac, except: exceptId })),
      entryCodeTaken: code => isTrue(exhibitions.codeTaken.get(code)),
      insert: rec => void exhibitions.insert.run(ex.write(rec).row),
      update: (id, patch: ExhibitionPatch) => {
        const cur = getExhibition(id);
        if (!cur) throw missing(id);
        const { row, rec } = ex.write({ ...cur, ...defined(patch), id: cur.id });
        changedOne(exhibitions.update.run(row).changes, id);
        return rec;
      },
      delete: id => {
        const counted = deleteCounts.parse(exhibitions.counts.get({ id }));
        return { ...counted, exhibitions: exhibitions.delete.run(id).changes };
      },
    },
    rooms: {
      get: getRoom,
      listByExhibition: exhibitionId => rooms.list.all(exhibitionId).map(roomCodec.read),
      insert: rec => void rooms.insert.run(roomCodec.write(rec).row),
      update: (id, patch: RoomPatch) => {
        const cur = getRoom(id);
        if (!cur) throw missing(id);
        const next = { ...cur, ...defined(patch), id: cur.id, exhibitionId: cur.exhibitionId };
        const { row, rec } = roomCodec.write(next);
        changedOne(rooms.update.run(row).changes, id);
        return rec;
      },
      delete: id => void rooms.delete.run(id),
    },
    artworks: {
      get: getArtwork,
      listDeletedBefore: (cutoff, limit, afterId = '') =>
        artworks.deleted.all({ cutoff, limit, after: afterId }).map(artworkCodec.read),
      deleteDeletedBefore: (id, cutoff) => artworks.deleteDeleted.run({ id, cutoff }).changes > 0,
      listByExhibition: (exhibitionId, options) =>
        (options?.includeDeleted ? artworks.listAll : artworks.listLive)
          .all(exhibitionId)
          .map(artworkCodec.read),
      insert: rec => void artworks.insert.run(artworkCodec.write(rec).row),
      update: (id, patch: ArtworkPatch) => {
        const cur = getArtwork(id);
        if (!cur) throw missing(id);
        const next = { ...cur, ...defined(patch), id: cur.id, exhibitionId: cur.exhibitionId };
        const { row, rec } = artworkCodec.write(next);
        changedOne(artworks.update.run(row).changes, id);
        return rec;
      },
    },
    assets: {
      get: id => one(assetCodec.read, assets.get.get(id)),
      listUnreferencedBefore: (cutoff, limit, afterId = '') =>
        assets.unreferenced.all({ cutoff, limit, after: afterId }).map(assetCodec.read),
      isReferenced: id => isTrue(assets.referenced.get(id)),
      deleteUnreferenced: id => assets.deleteUnreferenced.run(id).changes > 0,
      listByIds: ids => {
        // 메모리 구현과 같이 받은 ID 순서대로(겹친 ID는 겹친 대로, 없는 ID는 빼고)
        const found = new Map(
          assets.byIds
            .all(JSON.stringify(ids))
            .map(assetCodec.read)
            .map(a => [a.id, a]),
        );
        return ids.flatMap(id => {
          const a = found.get(id);
          return a ? [a] : [];
        });
      },
      insert: rec => void assets.insert.run(assetCodec.write(rec).row),
    },
    pages: {
      listByArtworks: artworkIds => pages.byArtworks.all(JSON.stringify(artworkIds)).map(pageCodec.read),
      put: rec => void pages.put.run(pageCodec.write(rec).row),
    },
    layouts: {
      // 배치 모양 판(`schemaVersion`)이 지금과 다른 옛 행은 읽지 않는다 → 없는 것으로 보고 다시 계산(ADR-057 보충)
      latest: exhibitionId => {
        const row = layouts.latest.get(exhibitionId);
        if (row && !currentLayoutShape(row)) return null;
        return one(layoutCodec.read, row);
      },
      insert: rec => void layouts.insert.run(layoutCodec.write(rec).row),
      prune: (exhibitionId, keep) => void layouts.prune.run({ ex: exhibitionId, keep }),
    },
    sessions: {
      get: tokenHash => one(sessionCodec.read, sessions.get.get(tokenHash)),
      insert: rec => void sessions.insert.run(sessionCodec.write(rec).row),
      // 토큰 해시는 오류 글에 넣지 않는다(기록에 남지 않게)
      touch: (tokenHash, at) => changedOne(sessions.touch.run(at, tokenHash).changes, sessionCodec.table),
      deleteKind: (exhibitionId, kind) => void sessions.deleteKind.run(exhibitionId, kind),
    },
    visitors: {
      get: getVisitor,
      insert: rec => void visitors.insert.run(visitorCodec.write(rec).row),
      update: (tokenHash, exhibitionId, patch: VisitorPatch) => {
        // 방문자는 (토큰 해시, 전시)로 찾는다 — 다른 전시의 방문자는 없는 행
        const cur = getVisitor(tokenHash, exhibitionId);
        if (!cur) throw missing(visitorCodec.table);
        const next = { ...cur, ...defined(patch), tokenHash: cur.tokenHash, exhibitionId: cur.exhibitionId };
        const { row, rec } = visitorCodec.write(next);
        changedOne(visitors.update.run(row).changes, visitorCodec.table);
        return rec;
      },
    },
    reactions: {
      listByExhibition: exhibitionId => reactions.list.all(exhibitionId).map(reactionCodec.read),
      getByVisitor: (artworkId, visitorTokenHash) =>
        one(reactionCodec.read, reactions.byVisitor.get(artworkId, visitorTokenHash)),
      upsert: rec => void reactions.upsert.run(reactionCodec.write(rec).row),
      update: (id, patch: ReactionPatch) => {
        const cur = getReaction(id);
        if (!cur) throw missing(id);
        const { row, rec } = reactionCodec.write({ ...cur, ...defined(patch), id: cur.id });
        changedOne(reactions.update.run(row).changes, id);
        return rec;
      },
    },
  };
};
