import { useState } from 'react';
import { useLocation } from 'react-router';
import { PATHS } from '../../routes.ts';

/** 교사 경로(PLAN §7.1). `TeacherApp.tsx`의 경로와 같다 */
export const TEACHER_PATHS = {
  home: PATHS.teacher,
  create: `${PATHS.teacher}/new`,
  manage: (exhibitionId: string) => `${PATHS.teacher}/e/${exhibitionId}`,
  tour: (exhibitionId: string) => `${PATHS.teacher}/e/${exhibitionId}/tour`,
} as const;

/**
 * 교사 화면 사이로 넘기는 상태(`navigate(path, { state })`). 새 전시 만들기 → 관리 화면이 "30일" 토스트를 띄우게.
 * 관리 화면(B)은 `useArrivalToast()`로 받아 `<Toast>`로 보인다.
 */
export interface TeacherNavState {
  readonly toast?: string;
}

const isNavState = (v: unknown): v is TeacherNavState =>
  typeof v === 'object' && v !== null && (!('toast' in v) || typeof v.toast === 'string');

/** 이 화면에 들어올 때 받은 토스트 글(처음 한 번). 닫으면 null */
export const useArrivalToast = (): readonly [string | null, () => void] => {
  const state: unknown = useLocation().state;
  const [toast, setToast] = useState<string | null>(() =>
    isNavState(state) && state.toast !== undefined ? state.toast : null,
  );
  return [toast, () => setToast(null)];
};
