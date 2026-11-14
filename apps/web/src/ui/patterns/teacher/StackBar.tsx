import type { JSX } from 'react';
import s from './StackBar.module.css';

/** 막대 칸 색: 남색 · 옅은 남색 · 자주(선생님) · 황동 · 조용한 회색 */
export type StackBarTone = 'accent' | 'soft' | 'plum' | 'brass' | 'quiet';

export interface StackBarPart {
  key: string;
  value: number;
  /** 범례 이름(예: 전시실 안) */
  label: string;
  tone: StackBarTone;
}

export interface StackBarProps {
  parts: readonly StackBarPart[];
  /** 묶음 이름(화면 낭독기용, 예: 관람 중인 학생 나눔) */
  label: string;
  /** 범례를 감출 때 false(막대만) */
  legend?: boolean | undefined;
  className?: string | undefined;
}

const clampValue = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * 쌓은 막대와 범례(G-32 수업 탭: 전시실 안 · 홀·광장·복도 · 위치 없음, 선생님은 따로).
 * 막대는 그림일 뿐이고(`aria-hidden`), 수는 범례 글로 읽힌다. 0인 칸은 막대에서 빠지고 범례에는 남는다.
 */
export const StackBar = ({ parts, label, legend = true, className }: StackBarProps): JSX.Element => (
  <div className={[s.root, className].filter(Boolean).join(' ')} role="group" aria-label={label}>
    <span className={s.bar} aria-hidden="true">
      {parts
        .filter(part => clampValue(part.value) > 0)
        .map(part => (
          <i
            key={part.key}
            className={[s.part, s[part.tone]].filter(Boolean).join(' ')}
            style={{ flexGrow: clampValue(part.value) }}
            data-part={part.key}
          />
        ))}
    </span>
    {legend ? (
      <ul className={s.legend}>
        {parts.map(part => (
          <li key={part.key} className={s.item} data-legend={part.key}>
            <i className={[s.dot, s[part.tone]].filter(Boolean).join(' ')} aria-hidden="true" />
            <span>{part.label}</span>
            <b className={s.count}>{clampValue(part.value)}</b>
          </li>
        ))}
      </ul>
    ) : null}
  </div>
);
