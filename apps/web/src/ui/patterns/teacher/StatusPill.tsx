import type { JSX } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './StatusPill.module.css';

/** 전시 상태: 준비 중 · 열림 · 닫힘 */
export type StatusPillKind = 'draft' | 'open' | 'closed';

export interface StatusPillProps {
  status: StatusPillKind;
  /** 상태 이름(화면 문구는 부르는 쪽이 `copy`에서 넘긴다) */
  label: string;
  /** 주면 눌러서 상태 차림표를 여는 단추가 된다(아래 화살표 표시) */
  onClick?: (() => void) | undefined;
  /** 단추일 때 차림표가 열려 있는지 */
  expanded?: boolean | undefined;
  className?: string | undefined;
}

/**
 * 전시 상태 알약(HT-02 위 줄, G-32). 점 색과 글로 상태를 알리고, 단추일 때 누름 영역은
 * 알약(32px)보다 큰 `--manage-touch`(44px 이상)다.
 */
export const StatusPill = ({ status, label, onClick, expanded, className }: StatusPillProps): JSX.Element => {
  const pill = (
    <span className={[s.pill, s[status]].filter(Boolean).join(' ')}>
      <span className={s.dot} aria-hidden="true" />
      <span className={s.text}>{label}</span>
      {onClick ? <Icon name="chevron-right" size={14} className={s.caret} /> : null}
    </span>
  );

  if (!onClick) {
    return (
      <span className={[s.root, className].filter(Boolean).join(' ')} data-status={status}>
        {pill}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={[s.root, s.button, className].filter(Boolean).join(' ')}
      data-status={status}
      aria-haspopup="menu"
      aria-expanded={expanded ?? false}
      onClick={onClick}
    >
      {pill}
    </button>
  );
};
