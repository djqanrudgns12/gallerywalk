import type { BubbleContent } from '@gallery/core/live';
import type { z } from 'zod';
import type {
  ArrangementResult,
  ArrangementSchema,
  ArtworkBatchSchema,
  ArtworkTeacher,
  CharacterId,
  CreateExhibitionResultSchema,
  CreateExhibitionSchema,
  CreateFileArtworkMetaSchema,
  CreateJsonArtworkSchema,
  CreatePdfArtworkSchema,
  CreateRoomSchema,
  DiagBody,
  ExhibitionTeacher,
  ExhibitionView,
  LiveServerMessage,
  LiveStats,
  PatchArtworkSchema,
  PatchExhibitionSchema,
  PatchRoomSchema,
  PinLoginResultSchema,
  Pose,
  ReactionBodySchema,
  ReactionPatchSchema,
  ReactionView,
  RoomTeacher,
  SessionKind,
  TeacherExhibitionView,
  TeacherMeSchema,
  TeacherReaction,
  VersionInfo,
  VisitorRegisterSchema,
} from '@gallery/core/types';

/**
 * 웹 포트(PLAN §2.4). 화면·관람 층(`ui/`·`viewer/`·`screens/`)은 이 인터페이스만 알고, 구현(`adapters/`)은 주입받는다.
 *
 * 오류 약속: `ApiClient`의 모든 메서드는 실패하면 `AppError`(`@gallery/core/errors`)로 거절한다.
 * - 서버 오류 봉투 → 그 `code`·`fields`
 * - 응답 모양이 스키마와 다름(봉투·데이터) → `E_SERVER`
 * - 연결 실패·시간 초과 → `E_OFFLINE`
 * - 이 기기에 그 전시의 토큰이 없음 → 요청 없이 `E_AUTH`
 * - 부른 쪽이 `signal`로 멈춘 경우만 예외: 그 `AbortError`를 그대로 던진다.
 * 다시 보내기는 부른 쪽이 `AppError.retryable`을 보고 정한다(여기서는 다시 보내지 않음).
 */

// ── 요청·응답 타입(core 스키마에서) ─────────────────────────────

/** 요청 본문은 스키마의 **입력** 모양(서버가 정규화·기본값을 채움) */
type In<S extends z.ZodType> = z.input<S>;

export type CreateExhibitionInput = Omit<In<typeof CreateExhibitionSchema>, 'linkTokenHash'>;
export type CreateExhibitionResult = z.output<typeof CreateExhibitionResultSchema>;
export type PatchExhibitionInput = In<typeof PatchExhibitionSchema>;
export type TeacherMe = z.output<typeof TeacherMeSchema>;
export type PinLoginResult = z.output<typeof PinLoginResultSchema>;
export type CreateRoomInput = In<typeof CreateRoomSchema>;
export type PatchRoomInput = In<typeof PatchRoomSchema>;
/** 글 작품·PDF 1단계(JSON). 그림·소리·PDF 쪽은 파일 올리기 길(`uploadArtwork`·`uploadPdf`) */
export type CreateJsonArtworkInput = In<typeof CreateJsonArtworkSchema>;
/** 그림·HEIC·소리 작품 multipart의 `meta` 칸 */
export type CreateFileArtworkMetaInput = In<typeof CreateFileArtworkMetaSchema>;
/** PDF 3단계 올리기의 작품 칸(쪽 수는 받은 쪽 그림 수로 어댑터가 채운다) */
export type CreatePdfArtworkInput = Omit<In<typeof CreatePdfArtworkSchema>, 'kind' | 'pageCount'>;
export type PatchArtworkInput = In<typeof PatchArtworkSchema>;
export type ArtworkBatchInput = In<typeof ArtworkBatchSchema>;
/** 한 번에 놓기(ADR-074): 바꾸기 전 배열 `base`·바꾼 뒤 배열 `rooms`(바뀐 판들만, 빈 판 허용)·되돌리기의 `restoreFeatured` */
export type ArrangementInput = In<typeof ArrangementSchema>;
export type ReactionPatchInput = In<typeof ReactionPatchSchema>;
export type ReactionBodyInput = In<typeof ReactionBodySchema>;
/** 방문자 등록 본문에서 토큰 해시를 뺀 것(해시는 어댑터가 이 기기의 방문자 토큰으로 만든다) */
export type VisitorRegisterInput = Omit<In<typeof VisitorRegisterSchema>, 'tokenHash'>;

/** `POST …/{id}/open` · `/close` · `/reopen` */
export type StatusAction = 'open' | 'close' | 'reopen';

export interface CallOptions {
  /** 화면을 떠날 때 등 부른 쪽이 멈추기 */
  readonly signal?: AbortSignal;
}

/** 올리는 파일 하나. `name`은 multipart 파일 이름(서버가 글 많음 추정에 씀) */
export interface UploadFile {
  readonly blob: Blob;
  readonly name: string;
}

/** 보낸 바이트. `total`을 모르면 0 */
export interface UploadProgress {
  readonly loaded: number;
  readonly total: number;
}

export interface UploadCallOptions extends CallOptions {
  /** 보내는 동안 여러 번(PDF는 모든 쪽을 합친 값) */
  readonly onProgress?: (p: UploadProgress) => void;
}

/** 받은 파일(반응 CSV) */
export interface DownloadedFile {
  readonly blob: Blob;
  /** `Content-Disposition`의 파일 이름(없으면 null) */
  readonly filename: string | null;
}

/**
 * 학생이 반응을 남길 전시. 경로는 입장 코드, 기기 저장(방문자 토큰)은 전시 ID로 찾는다
 * — 입장 코드는 전시가 지워진 뒤 다른 전시에 다시 쓰일 수 있다.
 */
export interface VisitTarget {
  readonly code: string;
  readonly exhibitionId: string;
}

// ── ApiClient ─────────────────────────────────────────────────

/** 학생 경로(PLAN §9.2 학생 표). 방문자 토큰이 필요한 것은 `Authorization: Bearer {방문자 토큰}` */
export interface StudentApi {
  /** `GET /api/e/{code}` — OPEN만. DRAFT `E_EXHIBITION_DRAFT` · CLOSED `E_EXHIBITION_CLOSED` · 없음 `E_NOT_FOUND` */
  exhibition(code: string, opts?: CallOptions): Promise<ExhibitionView>;
  /** `GET /api/e/{code}/v` — 60초 확인(ADR-027) */
  versions(code: string, opts?: CallOptions): Promise<VersionInfo>;
  /**
   * `POST /api/e/{code}/visitor` — 이 기기의 방문자 토큰(없으면 만들어 **보내기 전에** 저장)의 해시를 보낸다.
   * 다시 불러도 같은 토큰·같은 해시(멱등). 성공하면 동의한 문구 판과 별명을 기기에 남긴다.
   */
  registerVisitor(target: VisitTarget, input: VisitorRegisterInput): Promise<void>;
  /** `PATCH /api/e/{code}/visitor` — 별명 바꾸기 */
  changeNickname(target: VisitTarget, nickname: string): Promise<void>;
  /** `GET /api/e/{code}/me` — 내가 남긴 반응 */
  myReactions(target: VisitTarget, opts?: CallOptions): Promise<readonly ReactionView[]>;
  /** `PUT /api/e/{code}/reactions/{artworkId}` — 남기기·고치기(멱등) */
  putReaction(target: VisitTarget, artworkId: string, body: ReactionBodyInput): Promise<ReactionView>;
  /**
   * `POST /api/e/{code}/diag` — 익명 기기 보고(G-24·G-25, ADR-070): 가벼운 화면으로 내려간 까닭 하나 또는 관람 한 번의
   * 반응성. 토큰을 싣지 않는다. 화면이 숨는 때에도 가도록 `keepalive`로 보낸다. 실패는 부른 쪽이 버린다(관람을 막지 않음).
   */
  diag(code: string, body: DiagBody): Promise<void>;
}

/**
 * 교사 경로(PLAN §9.2 교사 표). 토큰은 이 기기에 저장된 그 전시의 원문을
 * `Authorization: Bearer`로 보낸다(서버는 해시만 저장, ADR-025). 그래서 모든 메서드가 전시 ID를 먼저 받는다.
 * `rev`를 받는 메서드는 `If-Match: {rev}` — 어긋나면 `E_CONFLICT`(화면이 새로 불러옴).
 */
export interface TeacherApi {
  /**
   * `POST /api/teacher/exhibitions` — 선생님 링크 토큰을 만들어(그 전시 ID로 이미 있으면 그것) **보내기 전에** 저장하고
   * 해시만 보낸다. 같은 ID·같은 본문으로 다시 부르면 같은 해시라 처음 결과가 온다(멱등).
   */
  createExhibition(input: CreateExhibitionInput): Promise<CreateExhibitionResult>;
  /** `/t#{토큰}`을 연 기기: `GET /api/teacher/me`를 그 토큰으로 → 전시 ID 아래 저장. 형식이 틀리면 요청 없이 `E_AUTH` */
  openLink(linkToken: string): Promise<TeacherMe>;
  /** `GET /api/teacher/me` — 저장된 토큰이 아직 통하는지 */
  me(exhibitionId: string, opts?: CallOptions): Promise<TeacherMe>;
  /** `POST /api/teacher/pin` — PIN 세션 토큰을 만들어 해시를 보내고, 받은 전시 ID 아래 저장 */
  pinLogin(pin: string): Promise<PinLoginResult>;
  /** `GET /api/teacher/exhibitions/{id}` */
  exhibition(exhibitionId: string, opts?: CallOptions): Promise<TeacherExhibitionView>;
  /** `PATCH /api/teacher/exhibitions/{id}` */
  patchExhibition(exhibitionId: string, rev: number, patch: PatchExhibitionInput): Promise<ExhibitionTeacher>;
  /** `POST …/{id}/open|close|reopen` — 게시 0이면 `E_NOTHING_PUBLISHED`. 이미 그 상태면 그대로 */
  changeStatus(exhibitionId: string, action: StatusAction): Promise<ExhibitionTeacher>;
  /** `DELETE /api/teacher/exhibitions/{id}` — 지금 삭제 */
  deleteExhibition(exhibitionId: string, rev: number): Promise<void>;
  /** `DELETE …/{id}/poster` */
  removePoster(exhibitionId: string): Promise<void>;
  /**
   * `POST …/{id}/link/rotate` — 새 링크 토큰(이전 링크 무효). 답을 못 받으면(연결 끊김) 새 토큰을 기기에 남겨 두고,
   * 다음에 부를 때 그 토큰이 이미 통하는지 먼저 확인한다(이 기기가 링크로 들어왔으면 옛 토큰이 이미 죽었을 수 있다).
   */
  rotateLink(exhibitionId: string): Promise<void>;
  /** `POST …/{id}/rooms` (ID는 기기가 만든 UUID, 멱등) */
  createRoom(exhibitionId: string, body: CreateRoomInput): Promise<RoomTeacher>;
  /** `PATCH /api/teacher/rooms/{roomId}` */
  patchRoom(exhibitionId: string, roomId: string, rev: number, patch: PatchRoomInput): Promise<RoomTeacher>;
  /** `DELETE /api/teacher/rooms/{roomId}` */
  deleteRoom(exhibitionId: string, roomId: string, rev: number): Promise<void>;
  /**
   * `PUT …/{id}/rooms/order` — 전체 순서(집합이 다르면 `E_CONFLICT`). `base`(바꾸기 전 순서, ADR-074)를 주면 서버의 지금
   * 순서와 다를 때도 `E_CONFLICT`(다른 기기가 먼저 바꿈). 되돌리기는 `ids`와 `base`를 맞바꿔 부른다.
   */
  reorderRooms(exhibitionId: string, ids: readonly string[], base?: readonly string[]): Promise<void>;
  /** `DELETE /api/teacher/rooms/{roomId}/bgm` */
  removeBgm(exhibitionId: string, roomId: string): Promise<void>;
  /** `POST …/{id}/artworks` JSON — 글 작품, PDF 1단계(`PROCESSING` 작품) */
  createArtwork(exhibitionId: string, body: CreateJsonArtworkInput): Promise<ArtworkTeacher>;
  /** `POST /api/teacher/artworks/{aid}/complete` — PDF 3단계(빠진 쪽이 있으면 `E_VALIDATION`) */
  completePdf(exhibitionId: string, artworkId: string): Promise<ArtworkTeacher>;
  /** `PATCH /api/teacher/artworks/{aid}` */
  patchArtwork(
    exhibitionId: string,
    artworkId: string,
    rev: number,
    patch: PatchArtworkInput,
  ): Promise<ArtworkTeacher>;
  /** `PUT /api/teacher/rooms/{roomId}/artwork-order` — 전체 순서(집합이 다르면 `E_CONFLICT`) */
  reorderArtworks(exhibitionId: string, roomId: string, ids: readonly string[]): Promise<void>;
  /**
   * `PUT …/{id}/arrangement` — 한 번에 놓기(ADR-074): 같은 판 순서·다른 판 n번째·여러 개·되돌리기(`base`↔`rooms` 맞바꿈).
   * `base`의 판마다 그 전시실의 지우지 않은 작품 전부(숨김·처리 중·실패 포함)를 보드 차례대로 담는다. 서버의 지금 배열에서
   * 그사이 올라온 작품을 뺀 것이 `base`와 다르면 `E_CONFLICT`. 돌려받은 `revs`는 바로 반영한다(다음 PATCH의 `If-Match`).
   */
  putArrangement(exhibitionId: string, body: ArrangementInput): Promise<ArrangementResult>;
  /** `POST /api/teacher/artworks/batch` */
  batchArtworks(exhibitionId: string, batch: ArtworkBatchInput): Promise<void>;
  /** `DELETE /api/teacher/artworks/{aid}` — 표시만(되살리기 가능) */
  deleteArtwork(exhibitionId: string, artworkId: string, rev: number): Promise<void>;
  /** `POST /api/teacher/artworks/{aid}/restore` */
  restoreArtwork(exhibitionId: string, artworkId: string): Promise<ArtworkTeacher>;
  /**
   * `GET …/{id}/live` — 지금 관람 수(HT-07): 함께 관람 학생·교사 수, 가벼운 화면 수(까닭별), 수업 지도 칸(HT-16, 선택:
   * 전시실별 `rooms`·전시실 밖 `elsewhere`·위치 없음 `noPose`). 수업 탭이 `LIVE_TEACHER_POLL_SEC`마다 부른다.
   */
  getLive(exhibitionId: string, opts?: CallOptions): Promise<LiveStats>;
  /** `GET …/{id}/reactions` */
  reactions(exhibitionId: string, opts?: CallOptions): Promise<readonly TeacherReaction[]>;
  /** `PATCH /api/teacher/reactions/{rid}` — 숨기기·공개로 고르기 */
  patchReaction(
    exhibitionId: string,
    reactionId: string,
    patch: ReactionPatchInput,
  ): Promise<TeacherReaction>;
  /** `GET …/{id}/reactions.csv` — 내려받기(Bearer가 필요해 링크로 열 수 없음) */
  reactionsCsv(exhibitionId: string, opts?: CallOptions): Promise<DownloadedFile>;

  // ── 파일 올리기(P5-3, multipart `meta` + `file`) ──────────────
  // 멱등 키는 서버 규칙 그대로: 작품은 기기가 만든 `meta.id`(+ 내용 해시), 쪽은 (작품, 쪽 번호), 포스터·배경음악은 내용 해시.
  // 답을 못 받았으면(`E_OFFLINE`) 같은 ID·같은 파일로 다시 보내면 처음 결과가 온다. 처리가 끝난 뒤 응답한다.

  /** `POST …/{id}/artworks` multipart — 그림·HEIC·소리. 같은 파일이 이미 있으면 `E_DUPLICATE` */
  uploadArtwork(
    exhibitionId: string,
    meta: CreateFileArtworkMetaInput,
    file: UploadFile,
    opts?: UploadCallOptions,
  ): Promise<ArtworkTeacher>;
  /** `PUT …/{id}/poster` — 바뀐 전시 행 */
  uploadPoster(exhibitionId: string, file: UploadFile, opts?: UploadCallOptions): Promise<ExhibitionTeacher>;
  /** `PUT /api/teacher/rooms/{roomId}/bgm` — 바뀐 전시실 행 */
  uploadBgm(
    exhibitionId: string,
    roomId: string,
    file: UploadFile,
    opts?: UploadCallOptions,
  ): Promise<RoomTeacher>;
  /** `PUT /api/teacher/artworks/{aid}/pages/{idx}`(1부터) — PDF 2단계 한 쪽 */
  uploadPdfPage(
    exhibitionId: string,
    artworkId: string,
    idx: number,
    file: UploadFile,
    opts?: UploadCallOptions,
  ): Promise<void>;
  /**
   * PDF 3단계(ADR-056, PLAN §9.2): ① `createArtwork({kind:'PDF', pageCount})` ② 쪽마다 `uploadPdfPage`(차례로)
   * ③ `completePdf`. 중간에 끊겨도 같은 `input.id`로 다시 부르면 이미 받은 쪽은 처음 결과로 지나간다.
   */
  uploadPdf(
    exhibitionId: string,
    input: CreatePdfArtworkInput,
    pages: readonly UploadFile[],
    opts?: UploadCallOptions,
  ): Promise<ArtworkTeacher>;
}

export interface ApiClient {
  readonly student: StudentApi;
  readonly teacher: TeacherApi;
}

// ── DeviceStore ───────────────────────────────────────────────

/** 선생님 첫 화면의 최근 전시 카드(최대 `RECENT_EXHIBITIONS_MAX`, 최신 순) */
export interface RecentExhibition {
  readonly exhibitionId: string;
  readonly title: string;
  /** 지워지는 시각(UTC ms). 모르면 null. 지난 것은 목록에서 빠진다 */
  readonly expiresAt: number | null;
  /** 마지막으로 기억한 시각(UTC ms) */
  readonly touchedAt: number;
}

export interface RememberExhibition {
  readonly exhibitionId: string;
  readonly title: string;
  readonly expiresAt?: number | null;
}

/** 이 기기가 가진 그 전시의 교사 토큰(원문, ADR-025) */
export interface TeacherSession {
  /** `Authorization`에 싣는 토큰이 무엇인가: 선생님 링크(LINK) · PIN 세션(PIN) */
  readonly kind: SessionKind;
  readonly token: string;
  /** 이 기기가 아는 선생님 링크 토큰(링크 복사는 이것이 있을 때만, §11.1). LINK면 `token`과 같다 */
  readonly linkToken: string | null;
  /** 링크 새로 만들기를 보냈는데 답을 못 받은 새 토큰(다음 시도 때 먼저 확인) */
  readonly pendingLinkToken: string | null;
}

/** 이 기기의 그 전시 방문자 신원(ADR-029) */
export interface VisitorIdentity {
  /** 기기가 만든 256비트 토큰 원문. 서버에는 해시만 간다 */
  readonly token: string;
  /** 동의한 문구 판(`CONSENT_VERSION`). 등록이 끝나기 전이면 null */
  readonly consentVersion: string | null;
  /** 등록·바꾸기가 끝난 별명("{별명}으로 남겨요"). 익명 방식이면 null */
  readonly nickname: string | null;
}

/**
 * 기기 저장(PLAN §2.4). 저장소가 막혀도(사생활 모드·꽉 참) 던지지 않는다 — 그때는 이 탭 안에서만 기억한다.
 */
export interface DeviceStore {
  /** 처음 열 때 만든 무작위 UUID(`X-Device-Id`, §11.2). 같은 기기에서는 늘 같다 */
  deviceId(): string;

  /** 최신 순, 지난 전시 제외, 최대 `RECENT_EXHIBITIONS_MAX` */
  recentExhibitions(): readonly RecentExhibition[];
  /** 맨 앞으로(같은 전시는 하나만). 넘치면 가장 오래된 것부터 빠진다 */
  rememberExhibition(entry: RememberExhibition): void;
  /** 최근 목록과 교사 토큰을 함께 지운다 */
  forgetExhibition(exhibitionId: string): void;

  teacherSession(exhibitionId: string): TeacherSession | null;
  setTeacherSession(exhibitionId: string, session: TeacherSession): void;
  clearTeacherSession(exhibitionId: string): void;

  visitor(exhibitionId: string): VisitorIdentity | null;
  setVisitor(exhibitionId: string, visitor: VisitorIdentity): void;
  clearVisitor(exhibitionId: string): void;

  /** `소리` 켬/끔(PRD G-06 "기기에 기억"). 기억한 값이 없으면 켬 */
  soundOn(): boolean;
  setSoundOn(on: boolean): void;

  /** 이 기기가 전시 만들기에 한 번 성공했는가(시작 코드 칸을 숨김, ADR-048). 서버 판단의 힌트일 뿐이다 */
  startCodePassed(): boolean;
  setStartCodePassed(passed: boolean): void;

  /** 이 기기 선생님의 캐릭터(PRD 15.8 "선생님은 교사 화면에서 고름") — 투어·3D 미리 보기·함께 관람에 쓴다. 기본 `teacher-m` */
  teacherCharacter(): TeacherCharacter;
  setTeacherCharacter(character: TeacherCharacter): void;

  /** 교사 작업 화면 액자 크기(G-32 "크게/작게", 기기에 기억). 기본 크게 */
  manageFrameSize(): ManageFrameSize;
  setManageFrameSize(size: ManageFrameSize): void;
}

export type ManageFrameSize = 'big' | 'small';

export type TeacherCharacter = Extract<CharacterId, `teacher-${string}`>;

// ── TokenTools ────────────────────────────────────────────────

/** 기기가 만드는 토큰과 해시(ADR-025, PLAN §11.1) */
export interface TokenTools {
  /** 256비트 무작위 → base64url(채움 없음, 43자) */
  newToken(): string;
  /** `newToken()`이 만든 모양인가(주소 조각 `#토큰` 검사 등) */
  isToken(value: string): boolean;
  /** 글(UTF-8)의 SHA-256 → 소문자 16진 64자. 토큰 해시는 토큰 글 그대로를 해시한다 */
  sha256Hex(text: string): Promise<string>;
}

// ── 함께 관람(ADR-057, `types/live.ts`) ─────────────────────────

/** 연결 상태: 끔 · 잇는 중 · 이어짐 · 다시 잇기 기다림 · 사람이 꽉 참(혼자 관람) · 거절(다시 잇지 않음) */
export type LiveStatus = 'off' | 'connecting' | 'live' | 'retrying' | 'full' | 'refused';

export interface LiveJoin {
  /** 입장 코드(주소용)와 토큰 원문(첫 메시지에만 — 주소에 넣지 않음) */
  readonly code: string;
  readonly token: string;
  readonly as: 'visitor' | 'teacher';
  readonly character: CharacterId;
  readonly pose: Pose;
}

export interface LiveHandlers {
  readonly onMessage: (msg: LiveServerMessage, receivedAt: number) => void;
  readonly onStatus: (status: LiveStatus, code?: string) => void;
  /** 받은 글 길이(바이트, 검사 전) — 실기기 반응성 재기(받는 양)에만 쓴다 */
  readonly onBytes?: ((bytes: number) => void) | undefined;
}

/**
 * 함께 관람 통로. 끊기면 스스로 다시 잇고(`LIVE_RETRY_*` 지수 증가), 꽉 참·거절이면 멈춘다. 서버가 보낸 메시지는 스키마로
 * 검사한 것만 넘긴다. 위치는 `sendPose`가 `LIVE_POSE_HZ`보다 잦으면 마지막 것만 보낸다.
 */
export interface LiveChannel {
  join(join: LiveJoin, handlers: LiveHandlers): void;
  sendPose(pose: Pose): void;
  /** 내 점프가 뜨는 순간 한 번(PRD_V2 W-05, ADR-073). 판 2 연결이 이어져 있을 때만 보낸다 */
  sendJump(): void;
  /**
   * 말풍선 하나(PRD_V2 W-02). 판 2 연결이 이어져 있을 때만 보내고 true — 그 밖에는 버리고 false(부른 쪽이 제 머리 위에 띄울지
   * 정한다). 속도 제한·설정·글 거름은 부른 쪽이 `domain/live/bubble.ts`로 먼저 본다(서버도 같은 규칙으로 다시 봄)
   */
  sendBubble(b: BubbleContent): boolean;
  leave(): void;
}
