import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { AppError, errorCatalog, type ErrorCode } from '@gallery/core/errors';
import { issueFields, type ApiError } from '@gallery/core/types';
import type { Logger } from '../../log.ts';
import type { AppEnv } from '../types.ts';

/**
 * 오류 봉투(PLAN §9.2·§9.3 마지막): `{error:{code, message, retryable, fields?}, requestId}`.
 * - `AppError` → `errorCatalog`의 http·retryable
 * - zod 오류 → `E_VALIDATION` + `issueFields`
 * - Hono `HTTPException`(4xx) → 가장 가까운 코드
 * - 그 밖 → `E_SERVER`. 원인은 기록에만 남기고 응답에는 넣지 않는다.
 * `message`는 기록·개발용 짧은 영문(코드에서 만듦). 화면 문구는 기기가 `code`로 찾는다.
 */

interface Classified {
  readonly code: ErrorCode;
  readonly fields: Readonly<Record<string, string>> | undefined;
  /** 기록에 원인을 남길 오류(예상하지 못한 것) */
  readonly unexpected: boolean;
}

const HTTP_EXCEPTION_CODES: Readonly<Partial<Record<number, ErrorCode>>> = {
  401: 'E_AUTH',
  403: 'E_AUTH',
  404: 'E_NOT_FOUND',
  409: 'E_CONFLICT',
  429: 'E_RATE_LIMITED',
};

function classify(err: unknown): Classified {
  if (err instanceof AppError) {
    // 기기에서만 생기는 코드(http null)나 E_SERVER는 서버 잘못으로 다룬다.
    if (errorCatalog[err.code].http === null)
      return { code: 'E_SERVER', fields: undefined, unexpected: true };
    return { code: err.code, fields: err.fields, unexpected: err.code === 'E_SERVER' };
  }
  if (err instanceof z.ZodError) return { code: 'E_VALIDATION', fields: issueFields(err), unexpected: false };
  if (err instanceof HTTPException && err.status < 500) {
    return { code: HTTP_EXCEPTION_CODES[err.status] ?? 'E_VALIDATION', fields: undefined, unexpected: false };
  }
  return { code: 'E_SERVER', fields: undefined, unexpected: true };
}

const shortMessage = (code: ErrorCode): string => code.replace(/^E_/, '').toLowerCase().replaceAll('_', ' ');

export function errorBody(
  code: ErrorCode,
  requestId: string | undefined,
  fields?: Readonly<Record<string, string>>,
): ApiError {
  return {
    error: {
      code,
      message: shortMessage(code),
      retryable: errorCatalog[code].retryable,
      ...(fields === undefined ? {} : { fields: { ...fields } }),
    },
    ...(requestId === undefined ? {} : { requestId }),
  };
}

export function respondError(
  c: Context<AppEnv>,
  code: ErrorCode,
  fields?: Readonly<Record<string, string>>,
): Response {
  c.set('errorCode', code);
  const status = (errorCatalog[code].http ?? errorCatalog.E_SERVER.http) as ContentfulStatusCode;
  return c.json(errorBody(code, c.get('requestId'), fields), status);
}

export const errorHandler =
  (log: Logger): ErrorHandler<AppEnv> =>
  (err, c) => {
    const { code, fields, unexpected } = classify(err);
    if (unexpected) {
      log.error('unhandled_error', {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        exhibitionId: c.get('exhibitionId'),
        code,
        err,
      });
    }
    return respondError(c, code, fields);
  };

export const notFoundHandler: NotFoundHandler<AppEnv> = c => respondError(c, 'E_NOT_FOUND');
