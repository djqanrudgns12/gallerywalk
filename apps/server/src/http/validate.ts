import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError } from '@gallery/core/errors';

/**
 * JSON 본문 읽기 + zod 검사(PLAN §9.3 "zod 검증"). JSON이 깨졌으면 `E_VALIDATION`(`fields._ = json`) —
 * 그대로 두면 `SyntaxError`가 `E_SERVER`(다시 시도 가능)로 나가 기기가 같은 요청을 되풀이한다.
 * 스키마 오류는 그대로 던져 오류 봉투가 `issueFields`로 바꾼다.
 */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError('E_VALIDATION', { fields: { _: 'json' } });
  }
  return schema.parse(body);
}
