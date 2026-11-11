import { z } from 'zod';
import { ErrorCodeSchema } from './common.ts';

/**
 * API 봉투(AGENTS.md §3, PLAN §9.2): 성공 `{data, requestId}`, 실패 `{error:{code, message, retryable, fields}}`.
 * `message`는 기록·개발용 짧은 영문 설명이다. 화면 문구는 기기가 `code`로 `copy/ko.ts`에서 찾는다.
 */

export const okEnvelope = <T extends z.ZodType>(data: T) => z.object({ data, requestId: z.string().min(1) });

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    /** 칸 이름 → 짧은 사유 코드(`too_long` 등) */
    fields: z.record(z.string(), z.string()).optional(),
  }),
  requestId: z.string().min(1).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** zod 오류 → 봉투의 `fields`(칸 경로 → 첫 사유 코드) */
export const issueFields = (error: z.ZodError): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
};
