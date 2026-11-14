import type { JSX } from 'react';
import s from './StatNumber.module.css';

export interface StatNumberProps {
  /** 큰 명조 숫자(부르는 쪽이 `01`·`23`처럼 맞춰 넘겨도 된다) */
  value: number | string;
  /** 숫자 옆 작은 이름(예: 작품, 전시실, 명이 관람 중) */
  label: string;
  /** `md` 요약 줄 38px, `xl` 수업 탭 92px */
  size?: 'md' | 'xl' | undefined;
  className?: string | undefined;
}

/**
 * 큰 명조 숫자와 작은 이름(G-32 "글 대신 숫자", FIELD_PLAN §5.4 ④).
 * 나란히 두면 둘째부터 왼쪽에 가는 세로선이 생긴다.
 */
export const StatNumber = ({ value, label, size = 'md', className }: StatNumberProps): JSX.Element => (
  <div className={[s.stat, s[size], className].filter(Boolean).join(' ')} data-stat="" data-size={size}>
    <b className={s.value}>{value}</b>
    <span className={s.label}>{label}</span>
  </div>
);
