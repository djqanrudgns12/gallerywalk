import { copy, errorCopy } from '@gallery/core/copy';
import type { ErrorCode } from '@gallery/core/errors';
import { useId } from 'react';
import { STUDENT_THEME } from './theme.ts';
import s from './NoticeScreen.module.css';

export type NoticeKind = 'closed' | 'notReady' | 'failed';

export interface NoticeScreenProps {
  readonly kind: NoticeKind;
  /** `failed`일 때 문구를 고를 코드 */
  readonly failure?: ErrorCode | null | undefined;
  readonly onHome: () => void;
  readonly onRetry?: (() => void) | undefined;
}

/**
 * 막 내림 · 준비 중 · 다시 해 보기(PLAN §7.3, PRD G-01). 첫 화면과 같은 체계(F8 V-52 시안 A): 꽉 찬 숯색 바탕 위
 * 작은 앱 이름 · 큰 세리프 제목 · (다시 해 보기면) 한 줄 · 단추. 판·테·외관 그림은 두지 않는다.
 */
export const NoticeScreen = ({ kind, failure, onHome, onRetry }: NoticeScreenProps) => {
  const titleId = useId();
  const title =
    kind === 'closed'
      ? copy.closed.title
      : kind === 'notReady'
        ? copy.closed.draft
        : errorCopy[failure ?? 'E_SERVER'];
  const retry = kind === 'failed' && onRetry;

  return (
    <main className={s.page} data-theme={STUDENT_THEME} data-testid={`notice-${kind}`}>
      <section className={s.center} aria-labelledby={titleId}>
        <div className={s.head}>
          <p className={s.kicker}>{copy.entry.appName}</p>
          <h1 id={titleId} className={s.title}>
            {title}
          </h1>
          {kind === 'failed' ? <p className={s.sub}>{copy.entry.retryHint}</p> : null}
        </div>
        <div className={s.actions}>
          {retry ? (
            <button type="button" className={s.primary} onClick={onRetry}>
              {copy.entry.retry}
            </button>
          ) : null}
          <button type="button" className={retry ? s.secondary : s.primary} onClick={onHome}>
            {copy.closed.home}
          </button>
        </div>
      </section>
    </main>
  );
};
