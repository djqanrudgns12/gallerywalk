import type { HttpBindings } from '@hono/node-server';
import type { MiddlewareHandler } from 'hono';
import { AppError } from '@gallery/core/errors';
import { isGone } from '@gallery/core/retention';
import type { SessionKind } from '@gallery/core/types';
import type { Deps } from '../../ports/index.ts';
import { bearerToken, hashEquals, tokenHash } from '../../security/tokens.ts';
import type { AppVariables } from '../types.ts';

/**
 * 교사 인증(PLAN §9.2 교사 표·§11.1, ADR-025). `Authorization: Bearer {선생님 링크 토큰 또는 PIN 세션 토큰}` →
 * SHA-256 → `teacher_sessions` → 문맥에 `teacher`(전시 ID·세션 종류)와 접근 기록용 `exhibitionId`를 넣는다.
 *
 * - 머리가 없음·Bearer가 아님·토큰 모양이 아님·모르는 토큰(지운 세션 포함) → `E_AUTH`
 * - 세션의 전시가 만료됐거나 지우는 중 → `E_NOT_FOUND`(없는 전시로 다룸, PLAN §9.7)
 * - 통과하면 `last_used_at`을 지금으로. 토큰 원문은 해시를 만든 뒤 쓰지 않는다(문맥·기록에 없음).
 * 대상 행이 이 전시의 것인지(`assertSameExhibition`)는 유스케이스가 본다.
 */

export interface TeacherAuth {
  readonly exhibitionId: string;
  readonly sessionKind: SessionKind;
}

export interface TeacherVariables extends AppVariables {
  teacher: TeacherAuth;
}

/** 교사 경로(`new Hono<TeacherEnv>()`)의 문맥 — `app.route()`로 `Hono<AppEnv>` 앱에 붙인다 */
export interface TeacherEnv {
  Bindings: HttpBindings;
  Variables: TeacherVariables;
}

export const teacherAuth =
  (deps: Pick<Deps, 'store' | 'clock'>): MiddlewareHandler<TeacherEnv> =>
  async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (token === null) throw new AppError('E_AUTH');
    const hash = tokenHash(token);
    const session = deps.store.sessions.get(hash);
    if (!session || !hashEquals(session.tokenHash, hash)) throw new AppError('E_AUTH');
    const now = deps.clock.now();
    const exhibition = deps.store.exhibitions.get(session.exhibitionId);
    if (!exhibition || isGone(exhibition, now)) throw new AppError('E_NOT_FOUND');
    deps.store.sessions.touch(hash, now);
    c.set('teacher', { exhibitionId: exhibition.id, sessionKind: session.kind });
    c.set('exhibitionId', exhibition.id);
    await next();
  };
