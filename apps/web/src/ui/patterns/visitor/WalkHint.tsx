import { copy } from '@gallery/core/copy';
import type { JSX } from 'react';
import s from './WalkHint.module.css';

export interface WalkHintProps {
  /** 직접 표시할 안내 문구 (지정하면 최우선) */
  text?: string | undefined;
  /** 터치 기기 여부 (`text`가 없을 때 `touchText` / `desktopText` 중 선택) */
  touch?: boolean | undefined;
  /** 터치 기기 문구 (기본: `copy.viewer.walkHintTouch`) */
  touchText?: string | undefined;
  /** 데스크톱 문구 (기본: `copy.viewer.walkHintDesktop`) */
  desktopText?: string | undefined;
  className?: string | undefined;
}

export const WalkHint = ({
  text,
  touch = false,
  touchText = copy.viewer.walkHintTouch,
  desktopText = copy.viewer.walkHintDesktop,
  className,
}: WalkHintProps): JSX.Element => {
  const content = text ?? (touch ? touchText : desktopText);

  return (
    <p className={className ? `${s.hint} ${className}` : s.hint} role="status" data-testid="walk-hint">
      {content}
    </p>
  );
};
