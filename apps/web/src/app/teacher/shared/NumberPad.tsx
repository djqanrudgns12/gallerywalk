import { copy, fill } from '@gallery/core/copy';
import { useEffect, useRef } from 'react';
import s from './NumberPad.module.css';

export interface NumberPadProps {
  readonly value: string;
  readonly onChange: (digits: string) => void;
  readonly maxLength: number;
  /** 칸 수 표시를 이만큼은 늘 보인다(PIN 최소 자리) */
  readonly minLength: number;
  /** Enter·`확인` */
  readonly onSubmit?: () => void;
  readonly disabled?: boolean;
  /** 숫자 대신 점으로(PIN) */
  readonly masked?: boolean;
  readonly label: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * 화면 숫자 키패드(PIN 시트 등). 휴대폰 자판이 화면을 덮지 않게 입력 칸 대신 칸 표시 + 큰 단추를 쓰고,
 * 키보드가 있는 기기는 숫자·Backspace·Enter를 그대로 받는다(이 부품이 화면에 있는 동안).
 */
export const NumberPad = ({
  value,
  onChange,
  maxLength,
  minLength,
  onSubmit,
  disabled = false,
  masked = true,
  label,
}: NumberPadProps) => {
  const latest = useRef({ value, onChange, onSubmit, disabled, maxLength });
  latest.current = { value, onChange, onSubmit, disabled, maxLength };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cur = latest.current;
      if (cur.disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        if (cur.value.length < cur.maxLength) cur.onChange(cur.value + e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        cur.onChange(cur.value.slice(0, -1));
      } else if (e.key === 'Enter' && cur.onSubmit) {
        e.preventDefault();
        cur.onSubmit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const press = (d: string): void => {
    if (!disabled && value.length < maxLength) onChange(value + d);
  };
  const cells = Math.max(minLength, Math.min(maxLength, value.length + 1));

  return (
    <div className={s.pad}>
      <div
        className={s.cells}
        role="status"
        aria-label={fill(copy.teacher.pin.entered, { label, n: value.length })}
        data-testid="number-pad-cells"
      >
        {Array.from({ length: cells }, (_, i) => (
          <span key={i} className={s.cell} data-filled={i < value.length ? '1' : '0'} aria-hidden="true">
            {i < value.length ? (masked ? '' : value[i]) : ''}
          </span>
        ))}
      </div>
      <div className={s.keys}>
        {KEYS.map(k => (
          <button key={k} type="button" className={s.key} disabled={disabled} onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button
          type="button"
          className={`${s.key} ${s.keySub}`}
          disabled={disabled || value === ''}
          onClick={() => onChange('')}
        >
          {copy.teacher.pin.clear}
        </button>
        <button type="button" className={s.key} disabled={disabled} onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          className={`${s.key} ${s.keySub}`}
          disabled={disabled || value === ''}
          onClick={() => onChange(value.slice(0, -1))}
          aria-label={copy.teacher.pin.backspace}
        >
          {copy.teacher.pin.backspaceShort}
        </button>
      </div>
    </div>
  );
};
