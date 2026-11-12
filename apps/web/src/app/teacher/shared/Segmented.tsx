import { type KeyboardEvent, useId, useRef } from 'react';
import s from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegmentedOption<T>[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly testId?: string;
}

/**
 * 둘~셋 중 하나 고르기(기본 `<select>` 금지, AGENTS.md §3). 라디오 묶음 역할 — 화살표 키로 옮긴다.
 */
export const Segmented = <T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  testId,
}: SegmentedProps<T>) => {
  const labelId = useId();
  const group = useRef<HTMLDivElement>(null);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = options[(i + step + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    group.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  };

  return (
    <div className={s.row}>
      <span id={labelId} className={s.label}>
        {label}
      </span>
      <div ref={group} className={s.group} role="radiogroup" aria-labelledby={labelId} data-testid={testId}>
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-value={o.value}
              className={on ? `${s.option} ${s.optionOn}` : s.option}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              onKeyDown={e => onKey(e, i)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
