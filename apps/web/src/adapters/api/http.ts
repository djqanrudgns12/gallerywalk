import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { ApiErrorSchema, okEnvelope } from '@gallery/core/types';
import { z } from 'zod';
import type { DownloadedFile, UploadProgress } from '../../ports/index.ts';

/**
 * `fetch` 얇은 층(PLAN §9.2 봉투). 다시 보내기는 하지 않는다 — 부른 쪽이 `AppError.retryable`을 보고 정한다.
 *
 * - 성공 응답은 `okEnvelope(스키마)`로, 실패 응답은 `ApiErrorSchema`로 검사한다. 어긋나면(JSON 아님·모양 틀림) `E_SERVER`.
 * - 오류 봉투 → `AppError(code, {fields})`. `cause`에 HTTP 상태·requestId·서버의 retryable(`HttpFailure`).
 * - 연결 실패·시간 초과 → `E_OFFLINE`. 부른 쪽 `signal`로 멈추면 그 `AbortError`를 그대로 던진다.
 * - 머리: 늘 `X-Device-Id`, 토큰이 있으면 `Authorization: Bearer`, rev가 있으면 `If-Match`, 본문이 있으면 JSON.
 * - 파일 올리기(`upload`·`uploadSend`, P5-3)는 `XMLHttpRequest` — `fetch`는 보내는 진행률을 알 수 없고(스트림 본문은
 *   Safari·Firefox에 없음), 학교 와이파이에서 25MB를 보내는 동안 진행 막대가 필요하다. 본문은 `FormData`(브라우저가
 *   `Content-Length`·경계를 채움 — 서버는 `Content-Length` 없는 multipart를 받지 않는다, PLAN §9.4).
 *   시간 제한은 전체가 아니라 **멈춤**: 보내는 중·답을 기다리는 중 `uploadIdleMs` 동안 아무 진척이 없으면 `E_OFFLINE`.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequest {
  readonly method: HttpMethod;
  /** `baseUrl` 뒤 경로(`/e/123456`). 경로 조각은 부른 쪽이 `encodeURIComponent`로 */
  readonly path: string;
  /** JSON으로 보낼 본문 */
  readonly body?: unknown;
  /** `Authorization: Bearer {token}`(교사 토큰 원문·방문자 토큰 원문) */
  readonly token?: string;
  /** `If-Match: {rev}` */
  readonly ifMatch?: number;
  readonly signal?: AbortSignal | undefined;
}

/** 파일 올리기 요청(multipart). JSON 본문·`If-Match`는 없다(만들기는 기기가 만든 ID가 멱등 키, PLAN §9.2) */
export interface UploadRequest {
  readonly method: 'POST' | 'PUT';
  readonly path: string;
  readonly form: FormData;
  readonly token?: string;
  readonly signal?: AbortSignal | undefined;
  /** 보낸 바이트(브라우저가 알려 줄 때마다). 다 보낸 뒤 서버 처리를 기다리는 동안은 오지 않는다 */
  readonly onProgress?: ((p: UploadProgress) => void) | undefined;
}

/** `XMLHttpRequest`에서 이 층이 쓰는 부분(시험은 가짜를 넣는다) */
export type XhrLike = Pick<
  XMLHttpRequest,
  'open' | 'setRequestHeader' | 'send' | 'abort' | 'status' | 'responseText'
> & {
  onload: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onabort: ((ev: unknown) => void) | null;
  onprogress: ((ev: unknown) => void) | null;
  readonly upload: {
    onprogress: ((ev: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
    onload: ((ev: unknown) => void) | null;
  };
};

export interface HttpOptions {
  /** 시간 제한(ms). 설정 키가 아직 없어 부르는 쪽이 넣는다(보고: `API_TIMEOUT_MS`) */
  readonly timeoutMs: number;
  /** `X-Device-Id`(기기 저장의 기기 ID) */
  readonly deviceId: () => string;
  /** 기본 `/api` */
  readonly baseUrl?: string;
  /** 기본은 부를 때의 전역 `fetch`(시험에서 `vi.stubGlobal`로 바꿀 수 있게 미리 잡지 않는다) */
  readonly fetch?: typeof fetch;
  /** 파일 올리기용. 기본 `new XMLHttpRequest()` */
  readonly xhr?: () => XhrLike;
  /** 파일 올리기 멈춤 한도(ms). 기본 `UPLOAD_IDLE_TIMEOUT_SEC`(서버가 끊는 무응답 시간과 같게) */
  readonly uploadIdleMs?: number;
}

/** 오류 봉투를 받았을 때 `AppError.cause` */
export interface HttpFailure {
  readonly status: number;
  readonly requestId: string | null;
  /** 서버 봉투의 retryable(오류 목록 값과 같아야 한다) */
  readonly retryable: boolean;
}

export interface Http {
  /** 성공 봉투의 `data`를 스키마로 검사해 돌려준다 */
  json<S extends z.ZodType>(req: HttpRequest, schema: S): Promise<z.output<S>>;
  /** 돌려받을 값이 없는 경로: 204·빈 본문 또는 `data`가 무엇이든 성공 봉투면 끝 */
  send(req: HttpRequest): Promise<void>;
  /** 파일 받기(반응 CSV). 실패 응답은 같은 오류 봉투 */
  file(req: HttpRequest): Promise<DownloadedFile>;
  /** 파일 올리기(multipart) → 성공 봉투의 `data`를 스키마로 */
  upload<S extends z.ZodType>(req: UploadRequest, schema: S): Promise<z.output<S>>;
  /** 파일 올리기, 돌려받을 값 없음(204·성공 봉투) */
  uploadSend(req: UploadRequest): Promise<void>;
}

const MS_PER_SEC = 1000;
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const HTTP_NO_CONTENT = 204;

const AnyOkEnvelope = okEnvelope(z.unknown());

/** `Content-Disposition`의 파일 이름: `filename*=UTF-8''…`(RFC 5987)이 먼저, 없으면 `filename="…"` */
export const dispositionFilename = (header: string | null): string | null => {
  if (header === null) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star?.[2] !== undefined) {
    try {
      return decodeURIComponent(star[2].trim());
    } catch {
      // 깨진 % 인코딩이면 아래 plain 이름으로
    }
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(header);
  const name = plain?.[1]?.replace(/\\(.)/g, '$1') ?? plain?.[2]?.trim();
  return name === undefined || name === '' ? null : name;
};

const serverError = (cause: unknown): AppError => new AppError('E_SERVER', { cause });

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

export const createHttp = (opts: HttpOptions): Http => {
  const baseUrl = opts.baseUrl ?? '/api';

  const errorFromBody = (status: number, text: string): AppError => {
    const json = parseJson(text);
    const parsed = json.ok ? ApiErrorSchema.safeParse(json.value) : null;
    if (!parsed?.success) return serverError({ status, body: 'not_envelope' });
    const { code, fields, retryable } = parsed.data.error;
    const cause: HttpFailure = { status, requestId: parsed.data.requestId ?? null, retryable };
    return new AppError(code, fields === undefined ? { cause } : { fields, cause });
  };

  /** 요청 → (응답, 본문 읽기). 시간 제한은 본문을 다 읽을 때까지 */
  const exchange = async <T>(req: HttpRequest, read: (res: Response) => Promise<T>): Promise<T> => {
    const headers = new Headers({ Accept: 'application/json', 'X-Device-Id': opts.deviceId() });
    if (req.token !== undefined) headers.set('Authorization', `Bearer ${req.token}`);
    if (req.ifMatch !== undefined) headers.set('If-Match', String(req.ifMatch));
    let body: string | undefined;
    if (req.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(req.body);
    }

    // AbortSignal.any·timeout은 오래된 iPad Safari에 없어서 직접 잇는다
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs);
    const outer = req.signal;
    const onOuterAbort = () => controller.abort(outer?.reason);
    if (outer?.aborted) controller.abort(outer.reason);
    else outer?.addEventListener('abort', onOuterAbort, { once: true });

    const fail = (cause: unknown): never => {
      if (outer?.aborted && !timedOut) throw outer.reason ?? cause;
      throw new AppError('E_OFFLINE', { cause: timedOut ? 'timeout' : cause });
    };

    try {
      const doFetch = opts.fetch ?? globalThis.fetch;
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}${req.path}`, {
          method: req.method,
          headers,
          signal: controller.signal,
          ...(body === undefined ? {} : { body }),
        });
      } catch (err) {
        return fail(err);
      }
      if (!res.ok) {
        let text: string;
        try {
          text = await res.text();
        } catch (err) {
          return fail(err);
        }
        throw errorFromBody(res.status, text);
      }
      try {
        return await read(res);
      } catch (err) {
        if (err instanceof AppError) throw err;
        return fail(err);
      }
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    }
  };

  /** 성공 본문 → 봉투 검사 */
  const okDataOf = <S extends z.ZodType>(status: number, text: string, schema: S): z.output<S> => {
    const json = parseJson(text);
    if (!json.ok) throw serverError({ status, body: 'not_json' });
    // `okEnvelope(schema)`와 같은 검사를 두 번에: 봉투(`requestId` 포함) → `data`
    const envelope = AnyOkEnvelope.safeParse(json.value);
    if (!envelope.success) throw serverError(envelope.error);
    const data = schema.safeParse(envelope.data.data);
    if (!data.success) throw serverError(data.error);
    return data.data;
  };

  /** 돌려받을 값이 없는 성공: 204·빈 본문·아무 성공 봉투 */
  const okEmpty = (status: number, text: string): void => {
    if (status === HTTP_NO_CONTENT || text === '') return;
    const json = parseJson(text);
    if (!json.ok || !AnyOkEnvelope.safeParse(json.value).success)
      throw serverError({ status, body: 'not_envelope' });
  };

  /** 파일 올리기 한 번 → (상태, 본문). 실패 응답은 오류 봉투로 던진다 */
  const exchangeUpload = (req: UploadRequest): Promise<{ status: number; text: string }> =>
    new Promise((resolve, reject) => {
      const outer = req.signal;
      if (outer?.aborted) {
        reject(outer.reason);
        return;
      }
      const x = (opts.xhr ?? (() => new XMLHttpRequest() as unknown as XhrLike))();
      const idleMs = opts.uploadIdleMs ?? config().UPLOAD_IDLE_TIMEOUT_SEC * MS_PER_SEC;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timedOut = true;
          x.abort();
        }, idleMs);
      };
      const onOuterAbort = () => x.abort();
      const settle = () => {
        clearTimeout(timer);
        outer?.removeEventListener('abort', onOuterAbort);
      };
      x.open(req.method, `${baseUrl}${req.path}`);
      x.setRequestHeader('Accept', 'application/json');
      x.setRequestHeader('X-Device-Id', opts.deviceId());
      if (req.token !== undefined) x.setRequestHeader('Authorization', `Bearer ${req.token}`);
      // 진행 듣기는 send 전에 달아야 브라우저가 보낸다
      x.upload.onprogress = ev => {
        arm();
        req.onProgress?.({ loaded: ev.loaded, total: ev.lengthComputable ? ev.total : 0 });
      };
      x.upload.onload = () => arm();
      x.onprogress = () => arm();
      x.onload = () => {
        settle();
        const status = x.status;
        if (status === 0) {
          reject(new AppError('E_OFFLINE', { cause: 'status_0' }));
          return;
        }
        const text = x.responseText;
        if (status < HTTP_OK_MIN || status > HTTP_OK_MAX) reject(errorFromBody(status, text));
        else resolve({ status, text });
      };
      x.onerror = cause => {
        settle();
        reject(new AppError('E_OFFLINE', { cause }));
      };
      x.onabort = () => {
        settle();
        if (outer?.aborted && !timedOut) reject(outer.reason);
        else reject(new AppError('E_OFFLINE', { cause: 'timeout' }));
      };
      outer?.addEventListener('abort', onOuterAbort, { once: true });
      arm();
      x.send(req.form);
    });

  return {
    json: (req, schema) => exchange(req, async res => okDataOf(res.status, await res.text(), schema)),

    send: req =>
      exchange(req, async res => {
        if (res.status === HTTP_NO_CONTENT) return;
        okEmpty(res.status, await res.text());
      }),

    file: req =>
      exchange(req, async res => ({
        blob: await res.blob(),
        filename: dispositionFilename(res.headers.get('Content-Disposition')),
      })),

    upload: async (req, schema) => {
      const { status, text } = await exchangeUpload(req);
      return okDataOf(status, text, schema);
    },

    uploadSend: async req => {
      const { status, text } = await exchangeUpload(req);
      okEmpty(status, text);
    },
  };
};
