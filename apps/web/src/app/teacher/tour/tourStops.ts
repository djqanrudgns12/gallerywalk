import type { TourPlan } from '@gallery/core/tour';

/**
 * 투어 건너뛰기 지점(V-16, PRD G-16 "→: 다음 전시실"). 시간표(`planTour`)에서 얻는다:
 * 처음(입구 홀) · 전시실마다 첫 이름판 시작 · 출구 시작. 오름차순, 겹친 값은 하나로.
 */
export const tourStops = (plan: Pick<TourPlan, 'rooms' | 'segments'>): number[] => {
  const exit = plan.segments.find(s => s.kind === 'EXIT');
  const all = [0, ...plan.rooms.map(r => r.startSec), ...(exit ? [exit.startSec] : [])];
  return [...new Set(all)].sort((a, b) => a - b);
};

/** `→`: 지금보다 뒤의 첫 지점. 더 없으면 그대로 */
export const nextStop = (stops: readonly number[], t: number): number => stops.find(s => s > t) ?? t;

/** `←`: 지금 있는 구간(시작 ≤ t인 마지막 지점)의 앞 구간 시작. 처음 구간이면 0 */
export const prevStop = (stops: readonly number[], t: number): number => {
  let here = -1;
  stops.forEach((s, i) => {
    if (s <= t) here = i;
  });
  return here > 0 ? (stops[here - 1] ?? 0) : 0;
};
