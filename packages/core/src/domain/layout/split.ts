import { config } from '../../config.ts';
import type { ArtworkForm } from '../../types/common.ts';

/**
 * 전시실 나누기와 자동 대표작(PLAN §4.3, ADR-022).
 */

export interface SplitItem {
  readonly id: string;
  readonly order: number;
  readonly form: ArtworkForm;
  readonly featured: boolean;
  /** 기준 크기(대표작 배율 전)의 바깥 면적 — 자동 대표작 고르기 */
  readonly baseArea: number;
}

/** 고르게 k개로: 기본 ⌊n/k⌋개, 앞의 (n mod k)개 관이 하나씩 더. 순서 유지. */
export const evenChunks = <T>(items: readonly T[], k: number): T[][] => {
  const n = items.length;
  const base = Math.floor(n / k);
  const extra = n % k;
  const out: T[][] = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push(items.slice(at, at + size));
    at += size;
  }
  return out;
};

/** 관 수 k = ⌈n / ROOM_SPLIT_AT⌉ (n ≥ 1) */
export const partCountFor = (n: number): number => Math.max(1, Math.ceil(n / config().ROOM_SPLIT_AT));

/**
 * 관 안 대표작의 색인. 지정 대표작이 있으면 그것. 없으면 후보 = ⌊m/3⌋ ~ max(⌊m/3⌋, ⌈2m/3⌉−1) 중 기준 바깥 면적이
 * 가장 큰 것, 같으면 `order`가 작은 것, 그래도 같으면 `id` 사전순. 소리 명판은 빼고, 후보가 모두 소리면 첫 후보.
 */
export const featuredIndex = (items: readonly SplitItem[]): number => {
  const designated = items.findIndex(a => a.featured);
  if (designated >= 0) return designated;
  const m = items.length;
  const lo = Math.floor(m / 3);
  const hi = Math.max(lo, Math.ceil((2 * m) / 3) - 1);
  let best = -1;
  for (let i = lo; i <= hi; i++) {
    const a = items[i]!;
    if (a.form === 'SOUND') continue;
    if (best < 0) {
      best = i;
      continue;
    }
    const b = items[best]!;
    if (
      a.baseArea > b.baseArea ||
      (a.baseArea === b.baseArea && (a.order < b.order || (a.order === b.order && a.id < b.id)))
    )
      best = i;
  }
  return best >= 0 ? best : lo;
};
