import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { type ChangeEvent, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { PrivacyLink } from '../privacy/PrivacyLink.tsx';
import { digitsOnly, PATHS } from '../routes.ts';
import { STUDENT_THEME } from './theme.ts';
import s from './HomeScreen.module.css';

/**
 * 첫 화면 `/`(PLAN §7.3, F8 V-52 시안 A): 꽉 찬 숯색 바탕 위 작은 앱 이름 · 큰 세리프 두 줄 제목 · 밑줄형 숫자 칸. 숫자 칸 6개 위에 진짜 입력 칸 하나(`inputmode="numeric"`)를
 * 겹쳐 휴대폰·태블릿은 숫자 키패드가, 데스크톱은 키보드가 바로 받는다. 6자리가 차면 바로 `/{코드}`로 간다.
 */
export const HomeScreen = () => {
  const navigate = useNavigate();
  const [digits, setDigits] = useState('');
  const [focused, setFocused] = useState(false);
  const titleId = useId();
  const inputId = useId();
  const hintId = useId();
  const n = config().ENTRY_CODE_DIGITS;

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = digitsOnly(e.target.value, n);
    setDigits(next);
    if (next.length === n) navigate(PATHS.exhibition(next));
  };

  const activeIndex = focused ? Math.min(digits.length, n - 1) : -1;

  const [line1, line2] = copy.entry.headline;

  return (
    <main className={s.page} data-theme={STUDENT_THEME} data-testid="entry-home">
      <section className={s.center} aria-labelledby={titleId}>
        <div className={s.head}>
          <p className={s.kicker}>{copy.entry.appName}</p>
          <h1 id={titleId} className={s.title}>
            {line1} <br />
            {line2}
          </h1>
          <p id={hintId} className={s.hint}>
            {fill(copy.entry.hint, { n })}
          </p>
        </div>

        <div className={s.foot}>
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
              aria-describedby={hintId}
              onChange={onChange}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoFocus
            />
          </label>

          <div className={s.links}>
            <button type="button" className={s.teacher} onClick={() => navigate(PATHS.teacher)}>
              {copy.entry.teacher}
            </button>
            <PrivacyLink />
          </div>
        </div>
      </section>
    </main>
  );
};
