import type { JSX } from 'react';
import { useMemo } from 'react';
import { Icon, type IconName } from '../../Icon.tsx';
import s from './Seg.module.css';
import { rovingIndex, useRovingRadio } from './useRovingRadio.ts';

export interface SegOption<T extends string> {
  value: T;
  /** 칸 글(화면 문구는 부르는 쪽이 `copy`에서 넘긴다) */
  label: string;
  icon?: IconName | undefined;
}

export interface SegProps<T extends string> {
  /** 두세 칸 */
  options: readonly SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 묶음 이름(화면 낭독기용, 예: 액자 크기) */
  label: string;
  className?: string | undefined;
}

/**
 * 두세 칸 고르기(예: 크게/작게). 기본 `<select>` 대신 라디오 묶음 단추로 만든다.
 * 칸마다 누름 영역 `--manage-touch`(44px 이상).
 */
export const Seg = <T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegProps<T>): JSX.Element => {
  const values = useMemo(() => options.map(o => o.value), [options]);
  const { refs, onKeyDown } = useRovingRadio(values, onChange);
  const tabAt = rovingIndex(values, value);

  return (
    <div className={[s.seg, className].filter(Boolean).join(' ')} role="radiogroup" aria-label={label}>
      {options.map((option, i) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            ref={el => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === tabAt ? 0 : -1}
            className={[s.option, on && s.on].filter(Boolean).join(' ')}
            data-value={option.value}
            onClick={() => onChange(option.value)}
            onKeyDown={e => onKeyDown(e, i)}
          >
            {option.icon ? <Icon name={option.icon} size={16} /> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};
