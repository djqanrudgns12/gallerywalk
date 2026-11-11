import { AppError } from '@gallery/core/errors';
import { canonicalJson, sha256Hex } from '@gallery/core/layout';
import { isGone } from '@gallery/core/retention';
import type { Deps, ExhibitionRecord } from '../ports/index.ts';

/**
 * 유스케이스 공통(PLAN §9.2): 전시 경계, 지우는 중·만료 거절, `If-Match` rev 확인, 멱등 해시, 버전 올리기.
 */

/** 만들기 요청의 멱등 해시(본문 정규 JSON의 SHA-256) */
export const createHashOf = (body: unknown): string => sha256Hex(canonicalJson(body));

/** 살아 있는 전시(만료·지우는 중이면 없는 것으로 — 있는지 알려 주지 않음) */
export const liveExhibition = (deps: Pick<Deps, 'store' | 'clock'>, id: string): ExhibitionRecord => {
  const ex = deps.store.exhibitions.get(id);
  if (!ex || isGone(ex, deps.clock.now())) throw new AppError('E_NOT_FOUND');
  return ex;
};

/** 대상 행의 전시 = 토큰의 전시(전시 경계, `assertSameExhibition`) */
export const assertSameExhibition = (
  row: { readonly exhibitionId: string } | null,
  exhibitionId: string,
): void => {
  if (!row || row.exhibitionId !== exhibitionId) throw new AppError('E_NOT_FOUND');
};

/** `If-Match: {rev}` — 빠졌거나 어긋나면 충돌(화면이 새로 불러옴) */
export const assertRev = (row: { readonly rev: number }, ifMatch: number | null): void => {
  if (ifMatch === null || row.rev !== ifMatch) throw new AppError('E_CONFLICT');
};

export interface Bump {
  /** 학생이 보는 내용(제목·설명·게시 상태·순서…)이 바뀜 */
  readonly content?: boolean;
  /** 설정(반응·투어)이 바뀜 */
  readonly settings?: boolean;
  /** 배치를 다시 계산해야 함(게시 작품 집합·순서·형태·대표작·전시실 순서) */
  readonly layout?: boolean;
}

/** 버전 올리기 — 같은 트랜잭션 안에서 부른다 */
export const bump = (deps: Pick<Deps, 'store'>, ex: ExhibitionRecord, what: Bump): ExhibitionRecord =>
  deps.store.exhibitions.update(ex.id, {
    ...(what.content ? { contentVersion: ex.contentVersion + 1 } : {}),
    ...(what.settings ? { settingsVersion: ex.settingsVersion + 1 } : {}),
    ...(what.layout ? { layoutDirty: true } : {}),
  });
