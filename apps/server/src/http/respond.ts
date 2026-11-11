import type { Context } from 'hono';
import type { AppEnv } from './types.ts';

/** 성공 봉투 `{data, requestId}`(PLAN §9.2) */
export const ok = <T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200) =>
  c.json({ data, requestId: c.get('requestId') }, status);
