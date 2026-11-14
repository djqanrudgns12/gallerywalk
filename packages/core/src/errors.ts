/**
 * 오류 코드 한 곳(PLAN §17.2). 학생·교사에게는 코드 대신 문구만 보인다(문구는 `copy/ko.ts`).
 *
 * - `http`: 서버가 이 코드로 답할 때의 HTTP 상태. `null`은 기기 쪽에서만 생기는 코드.
 * - `retryable`: 같은 요청을 잠시 뒤 다시 보내도 되는지(오류 봉투의 `retryable`).
 */
export const errorCatalog = {
  E_NOT_FOUND: { http: 404, retryable: false },
  E_EXHIBITION_CLOSED: { http: 409, retryable: false },
  E_EXHIBITION_DRAFT: { http: 409, retryable: false },
  E_REACTIONS_OFF: { http: 409, retryable: false },
  E_MEMO_BLOCKED: { http: 422, retryable: false },
  E_PIN_TAKEN: { http: 409, retryable: false },
  E_PIN_WEAK: { http: 422, retryable: false },
  E_PIN_INVALID: { http: 401, retryable: true },
  E_PIN_LOCKED: { http: 429, retryable: true },
  E_START_CODE: { http: 401, retryable: true },
  E_AUTH: { http: 401, retryable: false },
  E_RATE_LIMITED: { http: 429, retryable: true },
  E_VALIDATION: { http: 400, retryable: false },
  E_CONFLICT: { http: 409, retryable: true },
  E_NOTHING_PUBLISHED: { http: 409, retryable: false },
  E_FILE_TYPE: { http: 415, retryable: false },
  E_VIDEO_UNSUPPORTED: { http: 415, retryable: false },
  E_FILE_TOO_SMALL: { http: 422, retryable: false },
  E_FILE_TOO_LARGE: { http: 413, retryable: false },
  E_ASPECT: { http: 422, retryable: false },
  E_PDF_PAGES: { http: 422, retryable: false },
  E_TEXT_LENGTH: { http: 422, retryable: false },
  E_AUDIO_LENGTH: { http: 422, retryable: false },
  E_FILE_BROKEN: { http: 422, retryable: false },
  E_HEIC_UNSUPPORTED: { http: 415, retryable: false },
  E_DUPLICATE: { http: 409, retryable: false },
  E_QUOTA: { http: 507, retryable: false },
  E_BUSY: { http: 503, retryable: true },
  /** 함께 관람: 전시에 이은 사람이 상한(`LIVE_MAX_PER_EXHIBITION`) — 혼자 관람은 그대로 */
  E_LIVE_FULL: { http: 503, retryable: true },
  E_OFFLINE: { http: null, retryable: true },
  E_SERVER: { http: 500, retryable: true },
} as const satisfies Record<string, ErrorTraits>;

export interface ErrorTraits {
  readonly http: number | null;
  readonly retryable: boolean;
}

export type ErrorCode = keyof typeof errorCatalog;

export const isErrorCode = (value: unknown): value is ErrorCode =>
  // `Object.hasOwn`은 오래된 학교 기기(Safari 15.4·Chrome 93 미만)에 없다(G-24 HW-05)
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(errorCatalog, value);

/** 앱 안에서 던지는 오류. 화면 문구는 코드로 `copy/ko.ts`에서 찾는다. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fields: Readonly<Record<string, string>> | undefined;

  constructor(code: ErrorCode, options?: { fields?: Record<string, string>; cause?: unknown }) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.fields = options?.fields;
  }

  get retryable(): boolean {
    return errorCatalog[this.code].retryable;
  }
}
