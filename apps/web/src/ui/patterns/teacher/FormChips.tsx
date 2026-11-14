import type { JSX } from 'react';
import { useId, useMemo } from 'react';
import s from './FormChips.module.css';
import { rovingIndex, useRovingRadio } from './useRovingRadio.ts';

/** 거는 모양 그림: 세로 액자 · 가로 액자 · 이젤 */
export type FormGlyph = 'portrait' | 'landscape' | 'easel';

export interface FormChipOption<T extends string> {
  value: T;
  /** 칩 아래 작은 글(예: 세로) */
  label: string;
  glyph: FormGlyph;
}

export interface FormChipsProps<T extends string> {
  options: readonly FormChipOption<T>[];
  /** 고른 값(정하지 않았으면 null) */
  value: T | null;
  onChange: (value: T) => void;
  /** 묶음 이름. 칩 위 작은 머리글로 보이고 묶음 이름이 된다(예: 형태). */
  label: string;
  /** 저절로 정해진 값이면 머리글 오른쪽에 보일 글(예: 자동). 없으면 감춘다. */
  autoLabel?: string | undefined;
  className?: string | undefined;
}

/**
 * 거는 모양을 보여 주는 작은 선 그림(낱말 대신 모양). 아이콘 묶음(`Icon`)의 쓰임새 아이콘이 아니라
 * 작품이 걸리는 모양 자체를 그린 그림이라 이 부품 안에 둔다(ArtworkCard의 미리 보기 그림과 같은 처리).
 */
const Glyph = ({ glyph }: { glyph: FormGlyph }): JSX.Element => {
  switch (glyph) {
    case 'portrait':
      return (
        <svg className={s.glyph} viewBox="0 0 30 26" aria-hidden="true" focusable="false">
          <rect x="9" y="2" width="12" height="20" rx="1" />
          <rect x="12" y="5" width="6" height="14" />
        </svg>
      );
    case 'landscape':
      return (
        <svg className={s.glyph} viewBox="0 0 30 26" aria-hidden="true" focusable="false">
          <rect x="3" y="4" width="24" height="15" rx="1" />
          <rect x="6" y="7" width="18" height="9" />
          <line x1="9" y1="23" x2="21" y2="23" />
        </svg>
      );
    case 'easel':
      return (
        <svg className={s.glyph} viewBox="0 0 30 26" aria-hidden="true" focusable="false">
          <rect x="8" y="2" width="14" height="11" rx="1" />
          <path d="M11 13 7 24M19 13l4 11M15 13v7" />
        </svg>
      );
  }
};

/**
 * 형태 그림 칩 3개(세로 액자·가로 액자·이젤)와 `자동` 표시(G-32 ④). 라디오 묶음, 칩 높이 52px.
 */
export const FormChips = <T extends string>({
  options,
  value,
  onChange,
  label,
  autoLabel,
  className,
}: FormChipsProps<T>): JSX.Element => {
  const headingId = useId();
  const autoId = useId();
  const values = useMemo(() => options.map(o => o.value), [options]);
  const { refs, onKeyDown } = useRovingRadio(values, onChange);
  const tabAt = rovingIndex(values, value);

  return (
    <div className={[s.root, className].filter(Boolean).join(' ')}>
      <div className={s.head}>
        <span id={headingId} className={s.heading}>
          {label}
        </span>
        {autoLabel ? (
          <span id={autoId} className={s.auto} data-auto="">
            {autoLabel}
          </span>
        ) : null}
      </div>
      <div
        className={s.chips}
        role="radiogroup"
        aria-labelledby={headingId}
        aria-describedby={autoLabel ? autoId : undefined}
      >
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
              className={[s.chip, on && s.on].filter(Boolean).join(' ')}
              data-value={option.value}
              onClick={() => onChange(option.value)}
              onKeyDown={e => onKeyDown(e, i)}
            >
              <Glyph glyph={option.glyph} />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
