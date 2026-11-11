import { config } from '@gallery/core/config';
import { describe, expect, it } from 'vitest';
import { deviceKindOf, lowerTier, osOf, type RendererCaps, startTier, TierMonitor } from './tier.ts';

const caps = (patch: Partial<RendererCaps>): RendererCaps => ({
  webgl2: true,
  maxTextureSize: 8192,
  gpu: '',
  kind: 'desktop',
  os: 'other',
  ...patch,
});

describe('startTier', () => {
  it('데스크톱 높음 · iPad·iPhone 보통 · Android는 GPU로 · 모르면 보통 · 지난번 단계 우선', () => {
    expect(startTier(caps({}), null)).toBe('HIGH');
    expect(startTier(caps({ kind: 'tablet', os: 'ios' }), null)).toBe('MEDIUM');
    expect(startTier(caps({ kind: 'phone', os: 'ios' }), null)).toBe('MEDIUM');
    expect(startTier(caps({ kind: 'tablet', os: 'android', gpu: 'Adreno (TM) 650' }), null)).toBe('MEDIUM');
    expect(startTier(caps({ kind: 'tablet', os: 'android', gpu: 'Adreno (TM) 540' }), null)).toBe('LOW');
    expect(startTier(caps({ kind: 'phone', os: 'android', gpu: 'Mali-G710 MC10' }), null)).toBe('MEDIUM');
    expect(startTier(caps({ kind: 'phone', os: 'android', gpu: 'Mali-G57 MC2' }), null)).toBe('LOW');
    expect(startTier(caps({ kind: 'phone', os: 'android', gpu: '' }), null)).toBe('MEDIUM');
    expect(startTier(caps({ webgl2: false }), null)).toBe('LOW');
    expect(startTier(caps({}), 'LOW')).toBe('LOW');
    expect(lowerTier('LOW')).toBe('LOW');
  });
});

describe('TierMonitor', () => {
  const segment = (m: TierMonitor, fps: number, frames = config().QUALITY_MIN_SEGMENT_FRAMES) => {
    for (let i = 0; i < frames; i++) m.frame(1 / fps, true);
    m.frame(1 / fps, false);
  };

  it('움직이는 구간 두 번 연속 기준 아래면 한 단계 내린다(멈춘 프레임은 세지 않음)', () => {
    const lowered: string[] = [];
    const m = new TierMonitor('HIGH', 'tablet', t => lowered.push(t));
    segment(m, 30);
    expect(lowered).toEqual([]);
    // 멈춘 동안의 긴 간격은 상관없다
    for (let i = 0; i < 100; i++) m.frame(2, false);
    segment(m, 30);
    expect(lowered).toEqual(['MEDIUM']);
    expect(m.current).toBe('MEDIUM');
  });

  it('사이에 기준 위 구간이 끼면 다시 센다, 짧은 구간은 판정하지 않는다', () => {
    const lowered: string[] = [];
    const m = new TierMonitor('MEDIUM', 'phone', t => lowered.push(t));
    segment(m, 20);
    segment(m, 60);
    segment(m, 20);
    segment(m, 10, 5);
    expect(lowered).toEqual([]);
    segment(m, 20);
    expect(lowered).toEqual(['LOW']);
  });
});

describe('TierMonitor — 2D로 바꾸기(ADR-019)', () => {
  const segment = (m: TierMonitor, fps: number, frames = config().QUALITY_MIN_SEGMENT_FRAMES) => {
    for (let i = 0; i < frames; i++) m.frame(1 / fps, true);
    m.frame(1 / fps, false);
  };
  it("'낮음'에서 움직이는 구간 세 번 연속 중앙값이 FALLBACK_2D_FPS 미만이면 한 번 알린다(사이에 넘는 구간이 끼면 다시 셈)", () => {
    const fallbacks: number[] = [];
    const m = new TierMonitor(
      'LOW',
      'tablet',
      () => {},
      () => fallbacks.push(1),
    );
    const low = config().FALLBACK_2D_FPS - 5;
    segment(m, low);
    segment(m, low);
    segment(m, config().FALLBACK_2D_FPS + 5);
    segment(m, low);
    segment(m, low);
    expect(fallbacks).toEqual([]);
    segment(m, low);
    expect(fallbacks).toEqual([1]);
    segment(m, low);
    segment(m, low);
    segment(m, low);
    expect(fallbacks).toEqual([1]);
  });

  it("'낮음'이 아니면 2D로 바꾸지 않는다(먼저 단계를 내린다)", () => {
    const fallbacks: number[] = [];
    const m = new TierMonitor(
      'MEDIUM',
      'tablet',
      () => {},
      () => fallbacks.push(1),
    );
    for (let i = 0; i < 3; i++) segment(m, config().FALLBACK_2D_FPS - 5);
    expect(fallbacks).toEqual([]);
  });
});

describe('기기 종류·운영체제', () => {
  it('터치 없음 = 데스크톱, 짧은 변 600 미만 = 휴대폰, 그 밖 = 태블릿', () => {
    expect(deviceKindOf(0, 390)).toBe('desktop');
    expect(deviceKindOf(5, 390)).toBe('phone');
    expect(deviceKindOf(5, 820)).toBe('tablet');
  });

  it('iPadOS(Macintosh + 터치)는 iOS, Android는 android', () => {
    const ipad =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
    expect(osOf(ipad, 5)).toBe('ios');
    expect(osOf(ipad, 0)).toBe('other');
    expect(osOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe('ios');
    expect(osOf('Mozilla/5.0 (Linux; Android 14; SM-X200) Chrome/130.0', 5)).toBe('android');
  });
});
