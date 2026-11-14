import type { JSX } from 'react';
import { useId } from 'react';
import s from './ToggleTile.module.css';

export interface ToggleTileProps {
  /** 이름(예: 대표작, 게시) */
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 이름 옆 작은 알약 글(예: 자동). 화면 낭독기에는 설명으로 읽힌다. */
  badge?: string | undefined;
  /** 이름 앞 표지: `featured`는 황동 마름모(대표작과 같은 뜻) */
  mark?: 'featured' | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * 이름과 스위치가 한 칸에 있는 타일(G-32 살펴보기 칸의 대표작·게시). 칸 전체가 `role="switch"` 단추라
 * 어디를 눌러도 켜고 끈다. 칸 높이 48px.
 */
export const ToggleTile = ({
  label,
  checked,
  onChange,
  badge,
  mark,
  disabled = false,
  className,
}: ToggleTileProps): JSX.Element => {
  const badgeId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={badge ? badgeId : undefined}
      disabled={disabled}
      className={[s.tile, checked && s.on, className].filter(Boolean).join(' ')}
      data-checked={checked ? 'true' : 'false'}
      onClick={() => onChange(!checked)}
    >
      {mark === 'featured' ? <span className={s.mark} aria-hidden="true" data-mark="featured" /> : null}
      <span className={s.label}>{label}</span>
      {badge ? (
        <span id={badgeId} className={s.badge}>
          {badge}
        </span>
      ) : null}
      <span className={s.spacer} />
      <span className={s.switch} aria-hidden="true">
        <span className={s.knob} />
      </span>
    </button>
  );
};
