import { config } from '@gallery/core/config';
import type { Tier } from '../textures/residency.ts';

/**
 * 품질 단계(PLAN §6.10, ADR-035 — 자유 관람에 맞춤, ADR-057).
 * - 시작 단계: 기기 능력(`RendererCaps`)으로. 데스크톱 높음 · iPad·iPhone 보통 · Android는 Adreno 6xx 이상·Mali-G7x 이상이면 보통
 *   아니면 낮음 · 모르면 보통. 이 기기에서 지난번에 내린 단계가 있으면 그것(기기 저장은 부르는 쪽).
 * - 내리기: 멈춘 화면은 그리지 않으므로 **움직이는 구간**(캐릭터·카메라가 움직이는 동안)의 프레임으로만 잰다.
 *   구간 두 번 연속 중앙값이 기준 아래면 한 단계 내린다(데스크톱 50·태블릿 40·휴대폰 28fps). 수업 중 올리지 않는다.
 * - 2D로(ADR-019): '낮음'에서 구간 `FALLBACK_2D_LOW_SEGMENTS`번 연속 `FALLBACK_2D_FPS` 미만이면 `onFallback` 한 번.
 */

export type DeviceKind = 'desktop' | 'tablet' | 'phone';

export interface RendererCaps {
  readonly webgl2: boolean;
  readonly maxTextureSize: number;
  /** `WEBGL_debug_renderer_info`가 주는 이름(없으면 '') */
  readonly gpu: string;
  readonly kind: DeviceKind;
  /** 'ios' | 'android' | 'other' */
  readonly os: 'ios' | 'android' | 'other';
}

const ORDER: readonly Tier[] = ['LOW', 'MEDIUM', 'HIGH'];

/** Adreno 6xx 이상 · Mali-G7x 이상(G710 등 포함) */
const strongAndroidGpu = (gpu: string): boolean => {
  const adreno = /adreno\D*(\d{3})/i.exec(gpu);
  if (adreno) return Number(adreno[1]) >= 600;
  const mali = /mali-g(\d{2,3})/i.exec(gpu);
  if (mali) return Number(mali[1]!.slice(0, 1)) >= 7;
  return false;
};

export const startTier = (caps: RendererCaps, remembered: Tier | null): Tier => {
  if (remembered) return remembered;
  if (!caps.webgl2 || caps.maxTextureSize < 2048) return 'LOW';
  if (caps.kind === 'desktop' && caps.os === 'other') return 'HIGH';
  if (caps.os === 'android')
    return caps.gpu === '' ? 'MEDIUM' : strongAndroidGpu(caps.gpu) ? 'MEDIUM' : 'LOW';
  return 'MEDIUM';
};

export const lowerTier = (t: Tier): Tier => ORDER[Math.max(0, ORDER.indexOf(t) - 1)]!;

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * 움직이는 구간마다 프레임 간격을 모아 중앙 fps를 잰다. `frame(dtSec, moving)`을 매 프레임,
 * 구간이 끝나면(움직임 → 멈춤) 그 구간의 중앙값을 판정한다. 두 구간 연속 기준 아래면 `onLower`.
 */
export class TierMonitor {
  private tier: Tier;
  private readonly kind: DeviceKind;
  private readonly onLower: (t: Tier) => void;
  private readonly onFallback: (() => void) | undefined;
  private samples: number[] = [];
  private lowStreak = 0;
  /** '낮음'에서 `FALLBACK_2D_FPS` 미만 구간 연속 수(ADR-019) */
  private fallbackStreak = 0;
  private fellBack = false;
  private wasMoving = false;

  constructor(tier: Tier, kind: DeviceKind, onLower: (t: Tier) => void, onFallback?: () => void) {
    this.tier = tier;
    this.kind = kind;
    this.onLower = onLower;
    this.onFallback = onFallback;
  }

  get current(): Tier {
    return this.tier;
  }

  frame(dtSec: number, moving: boolean): void {
    if (moving && dtSec > 0 && dtSec < 0.5) this.samples.push(1 / dtSec);
    if (this.wasMoving && !moving) this.endSegment();
    this.wasMoving = moving;
  }

  private endSegment(): void {
    const c = config();
    const enough = this.samples.length >= c.QUALITY_MIN_SEGMENT_FRAMES;
    const fps = enough ? median(this.samples) : Number.POSITIVE_INFINITY;
    this.samples = [];
    if (!enough) return;
    const floor = c.QUALITY_FPS_FLOOR[this.kind];
    // '낮음'에서도 너무 느리면 2D로(한 번만 알림)
    if (this.tier === 'LOW') {
      this.fallbackStreak = fps < c.FALLBACK_2D_FPS ? this.fallbackStreak + 1 : 0;
      if (!this.fellBack && this.fallbackStreak >= c.FALLBACK_2D_LOW_SEGMENTS) {
        this.fellBack = true;
        this.onFallback?.();
      }
    }
    this.lowStreak = fps < floor ? this.lowStreak + 1 : 0;
    if (this.lowStreak >= 2 && this.tier !== 'LOW') {
      this.tier = lowerTier(this.tier);
      this.lowStreak = 0;
      this.onLower(this.tier);
    }
  }
}

/** 기기 종류: 터치가 없으면 데스크톱, 있으면 화면 짧은 변 600px 미만이 휴대폰 */
export const deviceKindOf = (touchPoints: number, shortSidePx: number): DeviceKind =>
  touchPoints === 0 ? 'desktop' : shortSidePx < 600 ? 'phone' : 'tablet';

/** 운영체제: iPadOS는 데스크톱 Safari처럼 보이므로 'Macintosh' + 터치를 iOS로 */
export const osOf = (ua: string, touchPoints: number): RendererCaps['os'] => {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
};
