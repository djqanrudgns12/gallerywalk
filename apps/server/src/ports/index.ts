import type { IncomingMessage } from 'node:http';
import type {
  ArtworkForm,
  ArtworkKind,
  ArtworkStatus,
  ArtworkWarning,
  AssetKind,
  AudioAnalysis,
  DeviceReport,
  DiagReason,
  ExhibitionSettings,
  ExhibitionStatus,
  ImageAnalysisWire,
  Layout,
  MediaVariant,
  PageMode,
  SessionKind,
  Sticker,
} from '@gallery/core/types';
import type { ErrorCode } from '@gallery/core/errors';
import type { TemplateId } from '@gallery/core/templates';

/**
 * 서버 포트(PLAN §2.4). 유스케이스(`application/**`)는 이 인터페이스만 안다. SQLite 구현은 `store/**`,
 * 시험은 메모리 구현(`test/support/memoryStore.ts`). 행 모양은 PLAN §10.2 표를 camelCase로 옮긴 것.
 * 모든 저장소 호출은 동기다(better-sqlite3) — 한 요청의 쓰기는 `Store.transaction` 하나로 묶는다.
 */

export interface ExhibitionRecord {
  readonly id: string;
  readonly entryCode: string;
  readonly pinHmac: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly templateId: TemplateId;
  readonly posterAssetId: string | null;
  readonly schoolName: string | null;
  readonly className: string | null;
  readonly showSchool: boolean;
  readonly settings: ExhibitionSettings;
  readonly status: ExhibitionStatus;
  readonly retentionDays: number;
  readonly rev: number;
  readonly createHash: string;
  readonly contentVersion: number;
  readonly settingsVersion: number;
  readonly layoutVersion: number;
  readonly layoutDirty: boolean;
  readonly deleting: boolean;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly openedAt: number | null;
  readonly closedAt: number | null;
}

export interface RoomRecord {
  readonly id: string;
  readonly exhibitionId: string;
  readonly order: number;
  readonly title: string;
  readonly intro: string | null;
  readonly bgmAssetId: string | null;
  readonly rev: number;
  readonly createHash: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ArtworkRecord {
  readonly id: string;
  readonly exhibitionId: string;
  readonly roomId: string;
  readonly order: number;
  readonly title: string;
  readonly author: string | null;
  readonly captionShort: string | null;
  readonly descriptionLong: string | null;
  readonly kind: ArtworkKind;
  /** 자동 판정 형태 */
  readonly form: ArtworkForm;
  readonly formOverride: ArtworkForm | null;
  readonly textHeavy: boolean;
  readonly textHeavyOverride: boolean | null;
  readonly featured: boolean;
  readonly pageMode: PageMode;
  readonly status: ArtworkStatus;
  readonly sourceAssetId: string | null;
  readonly pageCount: number | null;
  readonly textBody: string | null;
  readonly warnings: readonly ArtworkWarning[];
  readonly failCode: ErrorCode | null;
  readonly deletedAt: number | null;
  readonly rev: number;
  readonly createHash: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AssetRecord {
  readonly id: string;
  readonly exhibitionId: string;
  readonly kind: AssetKind;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
  readonly variants: readonly MediaVariant[];
  /** 분석값 — `assets.analysis_json`. 그림·쪽 = 그림 분석값, 소리·배경음악 = 소리 분석값 */
  readonly analysis: ImageAnalysisWire | AudioAnalysis | null;
  readonly bytesTotal: number;
  readonly contentHash: string;
  readonly createdAt: number;
}

export interface PageRecord {
  readonly artworkId: string;
  readonly idx: number;
  readonly assetId: string;
}

export interface LayoutRecord {
  readonly exhibitionId: string;
  readonly version: number;
  readonly algoVersion: number;
  readonly hash: string;
  readonly data: Layout;
  readonly createdAt: number;
}

export interface TeacherSessionRecord {
  readonly tokenHash: string;
  readonly exhibitionId: string;
  readonly kind: SessionKind;
  readonly createdAt: number;
  readonly lastUsedAt: number;
}

export interface VisitorRecord {
  readonly tokenHash: string;
  readonly exhibitionId: string;
  readonly nickname: string | null;
  readonly nicknameNorm: string | null;
  readonly consentVersion: string | null;
  readonly consentAt: number | null;
  readonly createdAt: number;
}

export interface ReactionRecord {
  readonly id: string;
  readonly exhibitionId: string;
  readonly artworkId: string;
  readonly visitorTokenHash: string;
  readonly sticker: Sticker | null;
  readonly memo: string | null;
  readonly scoreFact: number | null;
  readonly scoreDelivery: number | null;
  readonly hidden: boolean;
  readonly publicSelected: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 고치기: 빠진 칸과 `undefined`인 칸은 그대로 둔다(구현은 `undefined`를 건너뛴다). `null`은 비움. */
type Patch<T> = { readonly [K in keyof Omit<T, 'id' | 'exhibitionId'>]?: T[K] | undefined };

export interface ExhibitionRepo {
  get(id: string): ExhibitionRecord | null;
  /** 지우는 중 또는 만료된 전시. ID 순서, 앞 주기의 마지막 ID 다음부터 한 묶음 */
  listForCleanup(now: number, limit: number, afterId?: string): ExhibitionRecord[];
  getByEntryCode(code: string): ExhibitionRecord | null;
  /** PIN HMAC으로 전시 찾기(PIN 로그인, `pin_hmac`은 표에서 하나뿐). 만료·지우는 중인지는 부른 쪽이 본다 */
  getByPinHmac(pinHmac: string): ExhibitionRecord | null;
  /** 같은 HMAC의 PIN을 가진 다른(만료되지 않은) 전시가 있는가 */
  pinTaken(pinHmac: string, exceptId: string | null): boolean;
  entryCodeTaken(code: string): boolean;
  insert(rec: ExhibitionRecord): void;
  update(id: string, patch: Patch<ExhibitionRecord>): ExhibitionRecord;
  /**
   * 전시 행을 지운다. 딸린 행(전시실·작품·쪽·asset·배치·교사 세션·방문자·반응)은 외래키 연쇄(`ON DELETE CASCADE`)로
   * 함께 지워진다. 지운 행 수를 표마다 돌려준다(없는 전시면 모두 0). 부른 쪽이 `transaction` 안에서 부른다.
   */
  delete(id: string): DeletedRows;
}

/** 전시 하나를 지울 때 표마다 지운 행 수(기록에는 개수만 남긴다, PLAN §9.7) */
export interface DeletedRows {
  readonly exhibitions: number;
  readonly rooms: number;
  readonly artworks: number;
  readonly pages: number;
  readonly assets: number;
  readonly layouts: number;
  readonly sessions: number;
  readonly visitors: number;
  readonly reactions: number;
}

export interface RoomRepo {
  get(id: string): RoomRecord | null;
  listByExhibition(exhibitionId: string): RoomRecord[];
  insert(rec: RoomRecord): void;
  update(id: string, patch: Patch<RoomRecord>): RoomRecord;
  delete(id: string): void;
}

export interface ArtworkRepo {
  get(id: string): ArtworkRecord | null;
  listDeletedBefore(cutoff: number, limit: number, afterId?: string): ArtworkRecord[];
  /** 마치지 못한 PDF(`PROCESSING`, 지우지 않음)로 마지막 변경이 기준 시각 이전인 것(§9.2 `PDF_INCOMPLETE_PURGE_HOURS`) */
  listIncompletePdfBefore(cutoff: number, limit: number, afterId?: string): ArtworkRecord[];
  /** 기준 시각까지 지운 상태일 때만 행·쪽·반응 연쇄 삭제. asset 행은 파일 정리 재시도 근거로 남긴다 */
  deleteDeletedBefore(id: string, cutoff: number): boolean;
  /** 지운 작품 포함 여부 */
  listByExhibition(exhibitionId: string, options?: { readonly includeDeleted?: boolean }): ArtworkRecord[];
  insert(rec: ArtworkRecord): void;
  update(id: string, patch: Patch<ArtworkRecord>): ArtworkRecord;
}

export interface AssetRepo {
  get(id: string): AssetRecord | null;
  /** source·쪽·포스터·배경음악 어디에서도 쓰지 않는 asset. 소프트 삭제 작품도 참조로 센다 */
  listUnreferencedBefore(cutoff: number, limit: number, afterId?: string): AssetRecord[];
  isReferenced(id: string): boolean;
  /** 파일이 사라진 뒤에만 부른다. 그사이 참조가 생겼으면 지우지 않는다 */
  deleteUnreferenced(id: string): boolean;
  listByIds(ids: readonly string[]): AssetRecord[];
  insert(rec: AssetRecord): void;
}

export interface PageRepo {
  listByArtworks(artworkIds: readonly string[]): PageRecord[];
  put(rec: PageRecord): void;
}

export interface LayoutRepo {
  latest(exhibitionId: string): LayoutRecord | null;
  insert(rec: LayoutRecord): void;
  /** 최근 n판만 남긴다(`LAYOUT_KEEP_VERSIONS`) */
  prune(exhibitionId: string, keep: number): void;
}

export interface TeacherSessionRepo {
  get(tokenHash: string): TeacherSessionRecord | null;
  insert(rec: TeacherSessionRecord): void;
  touch(tokenHash: string, at: number): void;
  deleteKind(exhibitionId: string, kind: SessionKind): void;
}

export interface VisitorRepo {
  get(tokenHash: string, exhibitionId: string): VisitorRecord | null;
  insert(rec: VisitorRecord): void;
  update(tokenHash: string, exhibitionId: string, patch: Partial<VisitorRecord>): VisitorRecord;
}

export interface ReactionRepo {
  listByExhibition(exhibitionId: string): ReactionRecord[];
  getByVisitor(artworkId: string, visitorTokenHash: string): ReactionRecord | null;
  upsert(rec: ReactionRecord): void;
  update(id: string, patch: Partial<Omit<ReactionRecord, 'id'>>): ReactionRecord;
}

export interface Store {
  /** 안에서 던지면 모두 되돌린다 */
  transaction<T>(fn: () => T): T;
  readonly exhibitions: ExhibitionRepo;
  readonly rooms: RoomRepo;
  readonly artworks: ArtworkRepo;
  readonly assets: AssetRepo;
  readonly pages: PageRepo;
  readonly layouts: LayoutRepo;
  readonly sessions: TeacherSessionRepo;
  readonly visitors: VisitorRepo;
  readonly reactions: ReactionRepo;
  /**
   * WAL을 본 DB로 옮기고 WAL 파일을 비운다(`wal_checkpoint(TRUNCATE)`, PLAN §9.7 — 지운 행이 WAL에 남지 않게).
   * 트랜잭션 밖에서 부른다. 다 옮기고 비웠으면 `true`(다른 연결이 읽는 중이라 못 했으면 `false` — 다음 체크포인트가 마저
   * 함). 메모리 구현은 할 일이 없다(`true`).
   */
  checkpoint(): boolean;
}

/**
 * 전시 미디어 폴더(PLAN §10.3 `MEDIA_DIR/exh/{exhibitionId}/…`). 운영 구현은 `deps.ts`(node:fs), 시험은 가짜.
 * 전시 ID가 UUID 모양이 아니거나 경로가 `MEDIA_DIR/exh/` 밖으로 나가면 둘 다 거절한다(던짐).
 */
export interface MediaFiles {
  /** 그 전시의 폴더가 아직 있는가 */
  exists(exhibitionId: string): Promise<boolean>;
  /** 그 전시의 폴더를 통째로 지운다. 이미 없으면 그대로 성공(멱등). 지우지 못하면 던진다 */
  removeExhibition(exhibitionId: string): Promise<void>;
  assetExists(exhibitionId: string, assetId: string): Promise<boolean>;
  /** UUID 둘을 검사하고 해당 asset 폴더만 멱등 삭제 */
  removeAsset(exhibitionId: string, assetId: string): Promise<void>;
}

/** 진행 중인 업로드·처리(PLAN §9.4, P3-4가 구현) */
export interface UploadDrain {
  /**
   * 그 전시의 받는 중·처리 중인 작업이 끝나기를 `timeoutMs`까지 기다리고, 넘으면 취소한다(임시 파일 삭제·예약 풂).
   * 끝나면(모두 끝났거나 취소됨) 돌아온다. 새 업로드는 부른 쪽이 먼저 막는다(`deleting = 1`).
   */
  drain(exhibitionId: string, timeoutMs: number): Promise<void>;
}

/** 파일 업로드의 대상. HTTP 인증·경로 검사를 거친 뒤에도 처리·커밋 때 전시 경계를 다시 본다. */
export type UploadTarget =
  | { readonly kind: 'ARTWORK' }
  | { readonly kind: 'POSTER' }
  | { readonly kind: 'BGM'; readonly roomId: string }
  | { readonly kind: 'PAGE'; readonly artworkId: string; readonly idx: number };

/** 운영 업로드 관리자. Hono 본문 파서를 거치지 않은 Node 요청만 받는다. */
export interface FileUploads extends UploadDrain {
  receive(exhibitionId: string, target: UploadTarget, incoming: IncomingMessage): Promise<string>;
  queueLength(): number;
  /** 서버 종료: 새 요청을 막은 뒤 전체를 기다리거나 취소한다. DB를 닫기 전에 정리까지 마친다. */
  drainAll(timeoutMs: number): Promise<void>;
  /** 임시 폴더 정리 직전에 조회한다. 받기·대기·처리·파일 정리가 끝날 때까지 보호 */
  isTemporaryPathActive(path: string): boolean;
}

/** 기록 칸(개수·전시 ID·오류 코드·원인만 — 이름·글·토큰 칸이 없다, PLAN §9.8) */
export interface EventLogFields {
  readonly exhibitionId?: string;
  readonly count?: number;
  readonly code?: string;
  readonly err?: unknown;
}

/** 유스케이스가 남기는 기록(운영 구현은 `log.ts`의 Logger) */
export interface EventLog {
  info(msg: string, fields?: EventLogFields): void;
  warn(msg: string, fields?: EventLogFields): void;
}

export interface Clock {
  now(): number;
}

/** 암호학적 난수(`crypto.randomInt`) — 입장 코드 고르기 */
export interface Random {
  int(minInclusive: number, maxInclusive: number): number;
}

/** 보안 모듈(`security/**`)이 구현: PIN HMAC·쉬운 PIN·시작 코드 */
export interface Security {
  pinHmac(pin: string): string;
  isWeakPin(pin: string): boolean;
  startCodeOk(code: string): boolean;
}

/**
 * 기기 보고 파일의 한 줄(HW-02, ADR-070): 받은 시각(ISO, UTC)·전시 ID + 보고 그대로(`DeviceReportSchema`는 `strict`라
 * 다른 칸이 끼지 못한다). IP·기기 ID·UA·토큰은 싣지 않는다.
 */
export type DeviceReportLine = { readonly at: string; readonly exhibitionId: string } & DeviceReport;

/** 기기 보고 파일(운영 구현은 `deps.ts`, node:fs). 부른 쪽을 기다리게 하지 않는다 — 쓰기 실패는 구현이 기록만 */
export interface DeviceReportFiles {
  append(line: DeviceReportLine): void;
}

/** 최근 `DIAG_COUNT_WINDOW_MIN`분 동안 가벼운 화면으로 들어온 수(합과 까닭별) */
export interface DiagRecent {
  readonly light: number;
  readonly reasons: Partial<Record<DiagReason, number>>;
}

/**
 * 기기 진단(HW-02, ADR-070). 구현은 `application/diag.ts`: 까닭별 수는 메모리에만(전시 ID·분 칸), 보고는 파일로.
 * 토큰·IP·기기 ID는 받지도 두지도 않는다.
 */
export interface DeviceDiag {
  /** 가벼운 화면으로 들어간 까닭 하나 */
  fail(exhibitionId: string, reason: DiagReason): void;
  /** 관람 한 번의 반응성 보고 — 파일에 한 줄 */
  report(exhibitionId: string, report: DeviceReport): void;
  recent(exhibitionId: string): DiagRecent;
  /** 마지막으로 부른 뒤 받은 수를 꺼내고 비운다(1분 기록, HS-00). 창 밖 칸도 이때 치운다 */
  takeMinute(): { readonly fail: number; readonly report: number };
}

export interface Deps {
  readonly store: Store;
  readonly clock: Clock;
  readonly random: Random;
  readonly security: Security;
  readonly media: MediaFiles;
  readonly uploads: UploadDrain;
  readonly log: EventLog;
  /** env.ts가 개발·시험 환경에서만 허용한 분 단위 보관 기간 */
  readonly retentionTestMinutes?: number;
  /** 기기 진단(HW-02). 없으면 받기만 하고 버린다(시험용 앱) */
  readonly diag?: DeviceDiag;
}
