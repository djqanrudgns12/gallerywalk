import { copy, fill } from '@gallery/core/copy';
import { useId } from 'react';
import { digitsOnly } from '../../routes.ts';
import c from './controls.module.css';

export interface DigitsInputProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (digits: string) => void;
  readonly maxLength: number;
  readonly hint?: string | undefined;
  readonly error?: string | null | undefined;
  /** 칸 아래 오류·안내를 찾는 시험 이름 */
  readonly testId?: string;
  /** 비밀번호처럼 가린다(다른 사람이 보는 화면) */
  readonly masked?: boolean;
  readonly autoFocus?: boolean;
  readonly onEnter?: () => void;
}

/**
 * 숫자만 받는 칸(PIN·시작 코드). `inputmode="numeric"`이라 휴대폰·태블릿은 숫자 키패드가 바로 뜬다.
 * 붙여넣은 글의 숫자 아닌 글자는 버리고 `maxLength`자리까지 자른다.
 */
export const DigitsInput = ({
  label,
  value,
  onChange,
  maxLength,
  hint,
  error,
  testId,
  masked = false,
  autoFocus = false,
  onEnter,
}: DigitsInputProps) => {
  const id = useId();
  const hintId = useId();
  const errorId = useId();
  const described = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={c.field}>
      <div className={c.labelRow}>
        <label className={c.label} htmlFor={id}>
          {label}
        </label>
        <span className={c.counter}>
          {fill(copy.teacher.create.charCount, { n: value.length, max: maxLength })}
        </span>
      </div>
      <input
        id={id}
        className={c.input}
        type={masked ? 'password' : 'text'}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={maxLength}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        data-testid={testId}
        autoFocus={autoFocus}
        onChange={e => onChange(digitsOnly(e.target.value, maxLength))}
        onKeyDown={e => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
      {hint ? (
        <p id={hintId} className={c.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={c.error} role="alert" data-testid={testId ? `${testId}-error` : undefined}>
          {error}
        </p>
      ) : null}
    </div>
  );
};
