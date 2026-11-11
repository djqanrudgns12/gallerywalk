import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import type { DeletedRows, Deps } from '../ports/index.ts';
import { assertRev, liveExhibition } from './common.ts';

/**
 * 전시 지우기 — 교사 "지금 삭제"(`DELETE /api/teacher/exhibitions/{id}`)와 보관 정리 작업(P3-6)이 같은 함수를 쓴다
 * (PLAN §9.7). 순서를 바꾸지 않는다(행을 먼저 지우면 폴더 삭제가 실패했을 때 다시 할 근거가 사라진다):
 *
 * 1. `deleting = 1`(행과 함께 남으므로 재시작해도 이어서 함). 이 순간부터 모든 API가 이 전시를 없는 것으로 다룬다
 *    (`isGone` — 교사 인증·`liveExhibition`·학생 입장 코드·PIN 로그인·함께 관람). 부른 쪽에 `onGone`으로 알린다.
 * 2. 진행 중인 업로드·처리를 `DELETE_WAIT_SEC`까지 기다리고, 넘으면 취소(`uploads.drain`).
 * 3. 미디어 폴더 삭제 — 멱등(이미 없으면 성공). 실패하면 여기서 멈추고 `E_SERVER`(행은 `deleting = 1`로 남아 다음
 *    정리 주기가 다시 한다).
 * 4. 폴더가 없어진 것을 확인한 뒤에만 한 트랜잭션으로 행 삭제(외래키 연쇄) → 개수만 기록 → `wal_checkpoint(TRUNCATE)`.
 *
 * 다시 불러도 안전하다: 이미 지우는 중이면 1단계는 그대로 넘어가고, 행이 이미 없으면 폴더만 한 번 더 확인하고 0개.
 */

const MS_PER_SEC = 1000;

export interface DeleteOptions {
  /**
   * 교사 "지금 삭제": 교사가 본 전시 `rev`(`If-Match`, 빠졌으면 `null` → `E_CONFLICT`). 이때는 살아 있는 전시만
   * 받는다(만료·지우는 중이면 `E_NOT_FOUND`). 보관 정리는 넘기지 않는다 — rev를 보지 않고 지우는 중·만료 전시도 이어서 지운다.
   */
  readonly ifMatch?: number | null;
  /** 1단계 바로 뒤(없는 전시가 된 때) 한 번 — 함께 관람 연결 끊기 */
  readonly onGone?: (exhibitionId: string) => void;
}

const sum = (rows: DeletedRows): number => Object.values(rows).reduce((total, n) => total + n, 0);

/** 1단계: `deleting = 1`. 행이 없으면 false(이미 지워짐) */
const markDeleting = (deps: Deps, exhibitionId: string, ifMatch: number | null | undefined): boolean =>
  deps.store.transaction(() => {
    if (ifMatch === undefined) {
      const ex = deps.store.exhibitions.get(exhibitionId);
      if (!ex) return false;
      if (!ex.deleting) deps.store.exhibitions.update(ex.id, { deleting: true });
      return true;
    }
    const live = liveExhibition(deps, exhibitionId);
    assertRev(live, ifMatch);
    deps.store.exhibitions.update(live.id, { deleting: true });
    return true;
  });

/** 2·3단계: 업로드 기다리기 → 폴더 지우기 → 없어졌는지 확인. 하나라도 안 되면 `E_SERVER`(원인은 기록용 `cause`) */
const clearMedia = async (deps: Deps, exhibitionId: string): Promise<void> => {
  try {
    await deps.uploads.drain(exhibitionId, config().DELETE_WAIT_SEC * MS_PER_SEC);
    await deps.media.removeExhibition(exhibitionId);
    if (await deps.media.exists(exhibitionId)) throw new Error('media folder still exists after remove');
  } catch (cause) {
    throw new AppError('E_SERVER', { cause });
  }
};

export const deleteExhibition = async (
  deps: Deps,
  exhibitionId: string,
  options: DeleteOptions = {},
): Promise<DeletedRows> => {
  const marked = markDeleting(deps, exhibitionId, options.ifMatch);
  if (marked) options.onGone?.(exhibitionId);
  await clearMedia(deps, exhibitionId);
  // 4단계: 행(연쇄). 기록에는 지운 행 수만(이름·글·별명은 남기지 않는다, PLAN §9.8)
  const rows = deps.store.transaction(() => deps.store.exhibitions.delete(exhibitionId));
  if (rows.exhibitions > 0) deps.log.info('exhibition_deleted', { exhibitionId, count: sum(rows) });
  // 행은 이미 지웠다 — 체크포인트가 막혀도 지우기는 끝난 것(다음 체크포인트가 WAL을 마저 비운다)
  try {
    if (!deps.store.checkpoint()) deps.log.warn('wal_checkpoint_busy', { exhibitionId });
  } catch (err) {
    deps.log.warn('wal_checkpoint_failed', { exhibitionId, err });
  }
  return rows;
};
