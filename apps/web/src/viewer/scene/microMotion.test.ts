import { config } from '@gallery/core/config';
import { describe, expect, it } from 'vitest';
import {
  dustCountOf,
  type GlowState,
  glowStep,
  glowWant,
  microLevelStep,
  shimmerOf,
  vignetteOf,
} from './microMotion.ts';

/**
 * 연출(V-40, PRD 8.2·8.3·10.3·10.4, ADR-013): 마우스 올림 빛, 크게 볼 때 빛 웅덩이, 먼지·빛 흔들림, 가장자리 어둡게.
 * 정지 상태 다시 그리기 0(PRD 10.1·15.5 `[고정]`)이 이겨야 하므로 "언제 끝나는가"를 숫자로 본다.
 */
describe('작은 움직임 세기(먼지·빛 흔들림)', () => {
  const c = () => config();
  it('움직이는 동안 켜지는 시간에 걸쳐 1까지 오른다', () => {
    const half = c().MICRO_MOTION.fadeInSec / 2;
    const a = microLevelStep(0, { enabled: true, sinceMoveSec: 0, dt: half });
    expect(a).toBeCloseTo(0.5, 6);
    expect(microLevelStep(a, { enabled: true, sinceMoveSec: 0, dt: half })).toBe(1);
  });

  it('도착 뒤 `MICRO_MOTION_SETTLE_SEC`까지 서서히 줄고 그 뒤로는 정확히 0(다시 그리지 않음)', () => {
    const settle = c().MICRO_MOTION_SETTLE_SEC;
    const mid = microLevelStep(1, { enabled: true, sinceMoveSec: settle / 2, dt: 0.016 });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(microLevelStep(mid, { enabled: true, sinceMoveSec: settle, dt: 0.016 })).toBe(0);
    expect(microLevelStep(1, { enabled: true, sinceMoveSec: settle + 5, dt: 0.016 })).toBe(0);
  });

  it("품질 '낮음'·동작 줄이기(enabled=false)에서는 늘 0", () => {
    expect(microLevelStep(1, { enabled: false, sinceMoveSec: 0, dt: 0.016 })).toBe(0);
  });

  it("먼지 수: 높음 > 보통(적게) > 0, '낮음'·동작 줄이기는 0", () => {
    expect(dustCountOf('HIGH', false)).toBeGreaterThan(dustCountOf('MEDIUM', false));
    expect(dustCountOf('MEDIUM', false)).toBeGreaterThan(0);
    expect(dustCountOf('LOW', false)).toBe(0);
    expect(dustCountOf('HIGH', true)).toBe(0);
  });

  it('빛 흔들림은 세기 0이면 정확히 1, 아니면 ±세기 안', () => {
    expect(shimmerOf(3.7, 1.2, 0)).toBe(1);
    const amp = c().MICRO_MOTION.shimmerAmp;
    for (let t = 0; t < 20; t += 0.37) {
      const v = shimmerOf(t, 0.8, amp);
      expect(Math.abs(v - 1)).toBeLessThanOrEqual(amp + 1e-9);
    }
  });
});

describe('빛 웅덩이 밝히기(마우스 올림·크게 보기)', () => {
  it('크게 보는 작품은 `ZOOM_POOL_BOOST`, 나머지는 1. 크게 보는 동안 마우스 올림은 무시', () => {
    const c = config();
    expect(glowWant('a', { zoomId: 'a', hoverId: 'b' })).toBe(c.ZOOM_POOL_BOOST);
    expect(glowWant('b', { zoomId: 'a', hoverId: 'b' })).toBe(1);
    expect(glowWant('b', { zoomId: null, hoverId: 'b' })).toBe(c.HOVER_POOL_BOOST);
    expect(glowWant('a', { zoomId: null, hoverId: null })).toBe(1);
  });

  it('마우스 올림은 `T_HOVER`에 걸쳐 오르고 내린다', () => {
    const c = config();
    const up = glowStep(undefined, c.HOVER_POOL_BOOST, {
      dt: c.T_HOVER / 2,
      zooming: false,
      reducedMotion: false,
    });
    expect(up.value).toBeCloseTo(1 + (c.HOVER_POOL_BOOST - 1) / 2, 6);
    const full = glowStep(up, c.HOVER_POOL_BOOST, {
      dt: c.T_HOVER / 2,
      zooming: false,
      reducedMotion: false,
    });
    expect(full.value).toBe(c.HOVER_POOL_BOOST);
    expect(glowStep(full, 1, { dt: c.T_HOVER, zooming: false, reducedMotion: false }).value).toBe(1);
  });

  it('크게 보기는 `T_ZOOM`에 걸쳐 함께 오르고(PLAN §6.3), 닫으면 `T_UNZOOM`에 걸쳐 내린다', () => {
    const c = config();
    const span = c.ZOOM_POOL_BOOST - 1;
    const up = glowStep(undefined, c.ZOOM_POOL_BOOST, {
      dt: c.T_ZOOM / 4,
      zooming: true,
      reducedMotion: false,
    });
    expect(up.value).toBeCloseTo(1 + span / 4, 6);
    const zoomed: GlowState = { value: c.ZOOM_POOL_BOOST, zooming: true, transition: null };
    const down = glowStep(zoomed, 1, { dt: c.T_UNZOOM / 4, zooming: false, reducedMotion: false });
    expect(down.value).toBeCloseTo(c.ZOOM_POOL_BOOST - span / 4, 6);
  });

  it('작은 dt로 확대를 닫아도 마우스 올림 밝기 아래에서 빨라지지 않고 전체 `T_UNZOOM`을 채운다', () => {
    const c = config();
    const frames = 60;
    const dt = c.T_UNZOOM / frames;
    let state: GlowState = { value: c.ZOOM_POOL_BOOST, zooming: true, transition: null };
    for (let frame = 1; frame <= frames; frame++) {
      state = glowStep(state, 1, { dt, zooming: false, reducedMotion: false });
      expect(state.value).toBeCloseTo(c.ZOOM_POOL_BOOST + (1 - c.ZOOM_POOL_BOOST) * (frame / frames), 9);
      if (frame < frames) expect(state.value).toBeGreaterThan(1);
    }
    expect(state.value).toBe(1);
    expect(state.transition).toBeNull();
  });

  it('확대를 닫고 마우스 올림 밝기로 돌아갈 때도 시작값부터 전체 `T_UNZOOM`에 걸쳐 바뀐다', () => {
    const c = config();
    const frames = 60;
    let state: GlowState = { value: c.ZOOM_POOL_BOOST, zooming: true, transition: null };
    for (let frame = 1; frame <= frames; frame++) {
      state = glowStep(state, c.HOVER_POOL_BOOST, {
        dt: c.T_UNZOOM / frames,
        zooming: false,
        reducedMotion: false,
      });
      expect(state.value).toBeCloseTo(
        c.ZOOM_POOL_BOOST + (c.HOVER_POOL_BOOST - c.ZOOM_POOL_BOOST) * (frame / frames),
        9,
      );
    }
    expect(state.value).toBe(c.HOVER_POOL_BOOST);
    expect(state.transition).toBeNull();
  });

  it('동작 줄이기면 바로 바꾼다', () => {
    const c = config();
    expect(
      glowStep(undefined, c.ZOOM_POOL_BOOST, { dt: 0.001, zooming: true, reducedMotion: true }).value,
    ).toBe(c.ZOOM_POOL_BOOST);
  });
});

describe('아주 약한 가장자리 어둡게(PRD 10.3)', () => {
  it("모서리 어둡기는 약하게(0.3 미만), '낮음'은 끔(0)", () => {
    expect(vignetteOf('HIGH')).toBeGreaterThan(0);
    expect(vignetteOf('HIGH')).toBeLessThan(0.3);
    expect(vignetteOf('LOW')).toBe(0);
  });
});
