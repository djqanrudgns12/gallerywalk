import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { type ChangeEvent, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { digitsOnly, PATHS } from '../routes.ts';
import { STUDENT_THEME } from './theme.ts';
import s from './HomeScreen.module.css';

/**
 * 첫 화면 `/`(PLAN §7.3): 박물관 안내판 모양의 입장 코드 칸. 숫자 칸 6개 위에 진짜 입력 칸 하나(`inputmode="numeric"`)를
 * 겹쳐 휴대폰·태블릿은 숫자 키패드가, 데스크톱은 키보드가 바로 받는다. 6자리가 차면 바로 `/{코드}`로 간다.
 */
export const HomeScreen = () => {
  const navigate = useNavigate();
  const [digits, setDigits] = useState('');
  const [focused, setFocused] = useState(false);
  const titleId = useId();
  const inputId = useId();
  const n = config().ENTRY_CODE_DIGITS;

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = digitsOnly(e.target.value, n);
    setDigits(next);
    if (next.length === n) navigate(PATHS.exhibition(next));
  };

  const activeIndex = focused ? Math.min(digits.length, n - 1) : -1;

  return (
    <main className={s.page} data-theme={STUDENT_THEME} data-testid="entry-home">
      <div className={s.center}>
        <section className={s.plate} aria-labelledby={titleId}>
          <svg className={s.pediment} viewBox="0 0 96 34" aria-hidden="true">
            <path d="M6 30 L48 6 L90 30 Z" />
            <path d="M16 30 L80 30" />
            <circle cx="48" cy="21" r="3.2" />
          </svg>
          <p className={s.kicker}>{copy.entry.appName}</p>
          <h1 id={titleId} className={s.title}>
            {copy.entry.title}
          </h1>

          <label
            className={s.cells}
            htmlFor={inputId}
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: n }, (_, i) => (
              <span
                key={i}
                className={i === activeIndex ? `${s.cell} ${s.cellActive}` : s.cell}
                data-filled={i < digits.length ? '1' : '0'}
                aria-hidden="true"
              >
                {digits[i] ?? ''}
              </span>
            ))}
            <input
              id={inputId}
              className={s.input}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={n}
              value={digits}
              aria-label={fill(copy.entry.codeLabel, { n })}
              onChange={onChange}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoFocus
            />
          </label>

          <p className={s.hint}>{fill(copy.entry.hint, { n })}</p>
        </section>

        <button type="button" className={s.teacher} onClick={() => navigate(PATHS.teacher)}>
          {copy.entry.teacher}
        </button>
      </div>
    </main>
  );
};
