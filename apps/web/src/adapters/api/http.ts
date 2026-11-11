import { AppError } from '@gallery/core/errors';
import { ApiErrorSchema, okEnvelope } from '@gallery/core/types';
import { z } from 'zod';
import type { DownloadedFile } from '../../ports/index.ts';

/**
 * `fetch` 얇은 층(PLAN §9.2 봉투). 다시 보내기는 하지 않는다 — 부른 쪽이 `AppError.retryable`을 보고 정한다.
 *
 * - 성공 응답은 `okEnvelope(스키마)`로, 실패 응답은 `ApiErrorSchema`로 검사한다. 어긋나면(JSON 아님·모양 틀림) `E_SERVER`.
 * - 오류 봉투 → `AppError(code, {fields})`. `cause`에 HTTP 상태·requestId·서버의 retryable(`HttpFailure`).
 * - 연결 실패·시간 초과 → `E_OFFLINE`. 부른 쪽 `signal`로 멈추면 그 `AbortError`를 그대로 던진다.
 * - 머리: 늘 `X-Device-Id`, 토큰이 있으면 `Authorization: Bearer`, rev가 있으면 `If-Match`, 본문이 있으면 JSON.
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

export interface HttpOptions {
  /** 시간 제한(ms). 설정 키가 아직 없어 부르는 쪽이 넣는다(보고: `API_TIMEOUT_MS`) */
  readonly timeoutMs: number;
  /** `X-Device-Id`(기기 저장의 기기 ID) */
  readonly deviceId: () => string;
  /** 기본 `/api` */
  readonly baseUrl?: string;
  /** 기본은 부를 때의 전역 `fetch`(시험에서 `vi.stubGlobal`로 바꿀 수 있게 미리 잡지 않는다) */
  readonly fetch?: typeof fetch;
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
}

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

  const errorFromBody = (res: Response, text: string): AppError => {
    const json = parseJson(text);
    const parsed = json.ok ? ApiErrorSchema.safeParse(json.value) : null;
    if (!parsed?.success) return serverError({ status: res.status, body: 'not_envelope' });
    const { code, fields, retryable } = parsed.data.error;
    const cause: HttpFailure = { status: res.status, requestId: parsed.data.requestId ?? null, retryable };
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
        throw errorFromBody(res, text);
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

  /** 성공 본문 → 봉투 검사. 본문을 읽다 끊기면 `exchange`가 `E_OFFLINE`으로 바꾼다 */
  const okData = async <S extends z.ZodType>(res: Response, schema: S): Promise<z.output<S>> => {
    const json = parseJson(await res.text());
    if (!json.ok) throw serverError({ status: res.status, body: 'not_json' });
    // `okEnvelope(schema)`와 같은 검사를 두 번에: 봉투(`requestId` 포함) → `data`
    const envelope = AnyOkEnvelope.safeParse(json.value);
    if (!envelope.success) throw serverError(envelope.error);
    const data = schema.safeParse(envelope.data.data);
    if (!data.success) throw serverError(data.error);
    return data.data;
  };

  return {
    json: (req, schema) => exchange(req, res => okData(res, schema)),

    send: req =>
      exchange(req, async res => {
        if (res.status === 204) return;
        const text = await res.text();
        if (text === '') return;
        const json = parseJson(text);
        if (!json.ok || !AnyOkEnvelope.safeParse(json.value).success)
          throw serverError({ status: res.status, body: 'not_envelope' });
      }),

    file: req =>
      exchange(req, async res => ({
        blob: await res.blob(),
        filename: dispositionFilename(res.headers.get('Content-Disposition')),
      })),
  };
};
