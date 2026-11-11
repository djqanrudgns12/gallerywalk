/**
 * 동작 줄이기 판정(P4-11, PRD 8.4, PLAN §6.14): 기기의 '동작 줄이기'가 켜져 있는가.
 * 켜져 있으면 포스터가 사라지는 연출을 건너뛰어 바로 관람으로 바꾼다(시트는 CSS가 바로 보인다).
 * `matchMedia`가 없는 곳(시험 환경·아주 오래된 기기)은 꺼진 것으로 본다.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export const prefersReducedMotion = (
  win:
    | { readonly matchMedia?: ((query: string) => { readonly matches: boolean }) | undefined }
    | null
    | undefined,
): boolean => {
  if (typeof win?.matchMedia !== 'function') return false;
  try {
    return win.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
};
