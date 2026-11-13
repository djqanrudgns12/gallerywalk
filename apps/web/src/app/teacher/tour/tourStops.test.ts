import type { TourPlan } from '@gallery/core/tour';
import { describe, expect, it } from 'vitest';
import { nextStop, prevStop, tourStops } from './tourStops.ts';

// 시간표에서 쓰는 칸만 채운 가짜 시간표: 입구 0~5초, 전시실 5~45·45~85초, 출구 85~90초
const plan = {
  totalSec: 90,
  rooms: [
    { roomId: 'a', startSec: 5, endSec: 45 },
    { roomId: 'b', startSec: 45, endSec: 85 },
  ],
  segments: [
    { kind: 'HALL', startSec: 0, endSec: 5 },
    { kind: 'EXIT', startSec: 85, endSec: 90, fadeOutStartSec: 87 },
  ],
} as unknown as TourPlan;

describe('투어 건너뛰기 지점(V-16, PRD G-16 "→: 다음 전시실")', () => {
  it('처음 · 전시실마다 시작 · 출구 시작', () => {
    expect(tourStops(plan)).toEqual([0, 5, 45, 85]);
  });

  it('→ 는 지금보다 뒤의 첫 지점, 마지막 뒤에서는 그대로', () => {
    const stops = tourStops(plan);
    expect(nextStop(stops, 0)).toBe(5);
    expect(nextStop(stops, 5)).toBe(45);
    expect(nextStop(stops, 30)).toBe(45);
    expect(nextStop(stops, 85)).toBe(85);
    expect(nextStop(stops, 88)).toBe(88);
  });

  it('← 는 지금 있는 구간의 앞 구간 시작, 처음이면 0', () => {
    const stops = tourStops(plan);
    expect(prevStop(stops, 50)).toBe(5);
    expect(prevStop(stops, 45)).toBe(5);
    expect(prevStop(stops, 20)).toBe(0);
    expect(prevStop(stops, 3)).toBe(0);
    expect(prevStop(stops, 88)).toBe(45);
  });
});
