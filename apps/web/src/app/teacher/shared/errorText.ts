import { config } from '@gallery/core/config';
import { errorCopy, fill } from '@gallery/core/copy';
import { AppError, type ErrorCode } from '@gallery/core/errors';

/** 거절 값의 오류 코드(`AppError`가 아니면 `E_SERVER`) */
export const errorCodeOf = (err: unknown): ErrorCode => (err instanceof AppError ? err.code : 'E_SERVER');

/**
 * 교사 화면 오류 문구(`errorCopy`). `E_PIN_LOCKED`의 `{n}`분은 서버가 준 `fields.retryAfterMin`, 없으면 `PIN_LOCK_MIN`.
 */
export const errorText = (err: unknown): string => {
  const code = errorCodeOf(err);
  if (code === 'E_PIN_LOCKED') {
    const raw = err instanceof AppError ? err.fields?.retryAfterMin : undefined;
    const n = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : config().PIN_LOCK_MIN;
    return fill(errorCopy.E_PIN_LOCKED, { n });
  }
  return errorCopy[code];
};

/** 부른 쪽이 `signal`로 멈춘 것(화면을 떠남) — 오류로 보이지 않는다 */
export const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';
