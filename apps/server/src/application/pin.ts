import { AppError } from '@gallery/core/errors';
import { isGone } from '@gallery/core/retention';
import type { Deps } from '../ports/index.ts';

/**
 * PIN 로그인(PLAN §9.2 `POST /api/teacher/pin`, §11.1·§11.2, ADR-024·025).
 * PIN이 맞으면 기기가 만든 PIN 세션 토큰의 해시를 `teacher_sessions`(kind `PIN`)에 넣는다. 토큰 원문은 받지 않는다.
 * 실패 칸 셋(기기·IP·전역)과 지연은 라우트가 보안 모듈(`pinGuard`)로 한다 — 여기는 "맞는가·세션 넣기"만.
 */

export interface PinLoginBody {
  readonly pin: string;
  readonly sessionTokenHash: string;
}

export interface PinLoginResult {
  readonly exhibitionId: string;
}

/**
 * 맞으면 전시 ID, 틀리면 `null`(그런 PIN이 없음·만료·지우는 중 — 모두 같은 "틀림"으로, 있는지 알려 주지 않음).
 * 같은 세션 해시로 다시 오면(답을 못 받은 기기) 그대로 성공. 그 해시가 다른 전시나 링크 세션의 것이면 `E_CONFLICT`.
 */
export const pinLogin = (deps: Deps, body: PinLoginBody): PinLoginResult | null =>
  deps.store.transaction(() => {
    const ex = deps.store.exhibitions.getByPinHmac(deps.security.pinHmac(body.pin));
    const now = deps.clock.now();
    if (!ex || isGone(ex, now)) return null;
    const existing = deps.store.sessions.get(body.sessionTokenHash);
    if (existing) {
      if (existing.exhibitionId !== ex.id || existing.kind !== 'PIN') throw new AppError('E_CONFLICT');
      return { exhibitionId: ex.id };
    }
    deps.store.sessions.insert({
      tokenHash: body.sessionTokenHash,
      exhibitionId: ex.id,
      kind: 'PIN',
      createdAt: now,
      lastUsedAt: now,
    });
    return { exhibitionId: ex.id };
  });
