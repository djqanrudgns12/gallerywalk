import { config } from '@gallery/core/config';
import type { Tier } from '../textures/residency.ts';

/**
 * 연출 계산(V-40, PRD 8.2·8.3·10.3·10.4, ADR-013) — three에 기대지 않는 순수 함수. 그리기는 `MicroMotion.tsx`.
 * - 작은 움직임(먼지·빛 흔들림) 세기: 움직이는 동안 켜지고, 도착 뒤 `MICRO_MOTION_SETTLE_SEC`에 걸쳐 0으로.
 *   0이 되면 더 그리지 않는다(PRD 10.1·15.5 `[고정]`이 8.3 `[추천]`을 이김, C18).
 * - 빛 웅덩이 밝히기: 마우스 올림 `HOVER_POOL_BOOST`(`T_HOVER`), 크게 볼 때 그 작품 `ZOOM_POOL_BOOST`(`T_ZOOM`·`T_UNZOOM`).
 */

/** 다음 프레임의 작은 움직임 세기(0..1). `sinceMoveSec` = 카메라가 마지막으로 움직인 뒤 지난 시간(움직이는 중이면 0) */
export const microLevelStep = (
  level: number,
  { enabled, sinceMoveSec, dt }: { enabled: boolean; sinceMoveSec: number; dt: number },
): number => {
  if (!enabled) return 0;
  const c = config();
  const settle = c.MICRO_MOTION_SETTLE_SEC;
  if (sinceMoveSec >= settle) return 0;
  // 도착 뒤에는 코사인으로 서서히(1 → 0), 움직이기 시작하면 `fadeInSec`에 걸쳐 오른다
  const ceiling = sinceMoveSec <= 0 ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * sinceMoveSec) / settle);
  return Math.min(ceiling, level + dt / c.MICRO_MOTION.fadeInSec);
};

/** 단계·동작 줄이기에 따른 먼지 수(PRD 10.4: 높음 켬 · 보통 적게 · 낮음 끔, 8.4: 동작 줄이기 끔) */
export const dustCountOf = (tier: Tier, reducedMotion: boolean): number =>
  reducedMotion ? 0 : config().MICRO_MOTION.dustCount[tier];

/** 빛 흔들림 배율: 두 사인을 섞은 느린 흔들림. 세기 0이면 정확히 1(멈춘 뒤 값이 남지 않게) */
export const shimmerOf = (
  t: number,
  phase: number,
  amp: number,
  {
    shimmerHz: [a, b],
    shimmerMix: [mixA, mixB],
    shimmerPhaseRatio,
  }: {
    readonly shimmerHz: readonly [number, number];
    readonly shimmerMix: readonly [number, number];
    readonly shimmerPhaseRatio: number;
  } = config().MICRO_MOTION,
): number => {
  if (amp === 0) return 1;
  const w =
    mixA * Math.sin(2 * Math.PI * a * t + phase) +
    mixB * Math.sin(2 * Math.PI * b * t + shimmerPhaseRatio * phase);
  return 1 + amp * w;
};

/** 작품마다 바라는 빛 웅덩이 배율. 크게 보는 동안에는 마우스 올림을 보지 않는다 */
export const glowWant = (
  id: string,
  { zoomId, hoverId }: { zoomId: string | null; hoverId: string | null },
): number => {
  const c = config();
  if (zoomId !== null) return id === zoomId ? c.ZOOM_POOL_BOOST : 1;
  return id === hoverId ? c.HOVER_POOL_BOOST : 1;
};

export interface GlowState {
  readonly value: number;
  /** 이 작품이 크게 보기 대상인지(밝기가 아직 낮아도 닫기를 구분한다) */
  readonly zooming: boolean;
  readonly transition: {
    readonly kind: 'hover' | 'zoom' | 'unzoom';
    readonly from: number;
    readonly to: number;
    readonly durationSec: number;
    readonly elapsedSec: number;
  } | null;
}

const IDLE_GLOW: GlowState = { value: 1, zooming: false, transition: null };

/**
 * 전환 시작 때 종류·시작값·목표값·지속 시간을 고정하고 지난 시간만 누적한다.
 * 크게 보기 시작·닫기는 `T_ZOOM`·`T_UNZOOM`, 마우스 올림은 `T_HOVER`. 동작 줄이기면 바로.
 */
export const glowStep = (
  state: GlowState | undefined,
  want: number,
  { dt, zooming, reducedMotion }: { dt: number; zooming: boolean; reducedMotion: boolean },
): GlowState => {
  const cur = state ?? IDLE_GLOW;
  if (cur.value === want || reducedMotion) {
    return cur.value === want && cur.zooming === zooming && cur.transition === null
      ? cur
      : { value: want, zooming, transition: null };
  }
  let transition = cur.transition;
  if (transition === null || transition.to !== want || cur.zooming !== zooming) {
    const c = config();
    const kind = zooming ? 'zoom' : cur.zooming ? 'unzoom' : 'hover';
    const durationSec = kind === 'zoom' ? c.T_ZOOM : kind === 'unzoom' ? c.T_UNZOOM : c.T_HOVER;
    transition = { kind, from: cur.value, to: want, durationSec, elapsedSec: 0 };
  }
  const elapsedSec = Math.min(transition.durationSec, transition.elapsedSec + dt);
  const next =
    elapsedSec >= transition.durationSec
      ? want
      : transition.from + (transition.to - transition.from) * (elapsedSec / transition.durationSec);
  // 소수 오차로 끝에 닿지 못하면 다시 그리기가 멈추지 않는다 — 아주 가까우면 바라는 값에 붙인다
  const value = Math.abs(next - want) < 1e-9 ? want : next;
  return {
    value,
    zooming,
    transition: value === want ? null : { ...transition, elapsedSec },
  };
};

/** 단계별 가장자리 어둡기(0이면 그리지 않음) */
export const vignetteOf = (tier: Tier): number => config().VIGNETTE.strength[tier];
