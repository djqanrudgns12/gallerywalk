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
 * 막 내림 · 준비 중 · 다시 해 보기(PLAN §7.3, PRD G-01). 문을 닫은 미술관 앞 안내판 한 장 + 단추.
 * 준비 중은 같은 외관을 점선(아직 짓는 중)으로 그린다.
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
      <section className={s.plate} aria-labelledby={titleId}>
        <svg
          className={kind === 'notReady' ? `${s.facade} ${s.facadeDraft}` : s.facade}
          viewBox="0 0 220 120"
          aria-hidden="true"
        >
          <path className={s.line} d="M24 46 L110 10 L196 46 Z" />
          <path className={s.line} d="M34 46 L186 46 M30 104 L190 104 M22 112 L198 112" />
          <path className={s.line} d="M48 52 L48 104 M72 52 L72 104 M148 52 L148 104 M172 52 L172 104" />
          <path className={s.door} d="M92 104 L92 64 L128 64 L128 104 Z M110 64 L110 104" />
          <circle className={s.boss} cx="110" cy="32" r="5" />
        </svg>
        <h1 id={titleId} className={s.title}>
          {title}
        </h1>
        {kind === 'failed' ? <p className={s.sub}>{copy.entry.retryHint}</p> : null}
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
