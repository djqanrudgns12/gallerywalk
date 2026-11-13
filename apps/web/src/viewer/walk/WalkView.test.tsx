import { config } from '@gallery/core/config';
import { planTour } from '@gallery/core/tour';
import { type RootState, useFrame } from '@react-three/fiber';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import { teacherExhibition } from '../../dev/teacherFixtures.ts';
import { visitModelOf } from '../../app/visit/visitModel.ts';
import { MicroMotion } from '../scene/MicroMotion.tsx';
import { sceneDim } from '../scene/materials.ts';
import { TourDriver } from '../tour/TourDriver.tsx';
import { tourInputOf } from '../tour/tourCamera.ts';
import { WalkView } from './WalkView.tsx';
import { useWalkKeyboard } from './input.ts';
import { useWalk } from './walkStore.ts';
import { ZoomDim } from './ZoomDim.tsx';

const loop = vi.hoisted(() => ({
  state: null as RootState | null,
  frames: new Set<(state: RootState, dt: number) => void>(),
  after: new Set<() => void>(),
  rendering: false,
}));
vi.mock('@react-three/fiber', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    useThree: (select: (state: RootState) => unknown) => select(loop.state!),
    useFrame: (callback: (state: RootState, dt: number) => void) => {
      const ref = useRef(callback);
      ref.current = callback;
      useEffect(() => {
        const frame = (state: RootState, dt: number) => ref.current(state, dt);
        loop.frames.add(frame);
        return () => {
          loop.frames.delete(frame);
        };
      }, []);
    },
    addAfterEffect: (callback: () => void) => {
      loop.after.add(callback);
      return () => {
        loop.after.delete(callback);
      };
    },
  };
});
vi.mock('../scene/Character.tsx', () => ({ Character: () => null }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  root = createRoot(host);
  loop.state = {
    camera: new PerspectiveCamera(),
    size: { width: 1440, height: 900 },
    clock: { elapsedTime: 0 },
    gl: { info: { render: { calls: 1, triangles: 2 }, memory: { textures: 0, geometries: 0 } } },
    internal: { frames: 1 },
    get: () => loop.state!,
    invalidate: () => {
      loop.state!.internal.frames = loop.rendering ? 2 : 1;
    },
  } as unknown as RootState;
  useWalk.setState(useWalk.getInitialState());
  vi.restoreAllMocks();
  vi.spyOn(performance, 'now').mockImplementation(() => loop.state!.clock.elapsedTime * 1000);
});
afterEach(() => {
  act(() => root.unmount());
  loop.frames.clear();
  loop.after.clear();
  useWalk.setState(useWalk.getInitialState());
  vi.restoreAllMocks();
});
const frame = (dt: number, advance = dt) =>
  act(() => {
    const state = loop.state!;
    state.clock.elapsedTime += advance;
    loop.rendering = true;
    for (const callback of loop.frames) callback(state, dt);
    loop.rendering = false;
    state.internal.frames = Math.max(0, state.internal.frames - 1);
    for (const callback of loop.after) callback();
  });

it('다른 장면 연출이 다음 프레임을 예약한 동안에는 정지 표시를 찍지 않는다', () => {
  let tail = false;
  const Tail = () => {
    useFrame(state => {
      if (tail) state.invalidate();
    });
    return null;
  };
  const model = visitModelOf(testExhibitionView([2]));
  act(() =>
    root.render(
      <>
        <WalkView
          layout={model.layout}
          artworks={model.artworks}
          character="student-m"
          placeOf={model.placeOf}
          paused
        />
        <Tail />
      </>,
    ),
  );
  for (let i = 0; i < 100 && loop.state!.internal.frames > 0; i++) frame(0.5);
  expect(loop.state!.internal.frames).toBe(0);
  tail = true;
  loop.state!.invalidate();
  frame(0.5);
  expect(useWalk.getState().idleFrameMark).not.toBe(useWalk.getState().perf.framesRendered);
  tail = false;
  frame(0.5);
  expect(useWalk.getState().idleFrameMark).toBe(useWalk.getState().perf.framesRendered);
});

it('느린 프레임에서도 크게 보기의 빛과 어둡기가 정해진 실제 시간에 끝난다', () => {
  const boosts = { art: { value: 1 } };
  const holders = { art: { value: 1 } };
  act(() =>
    root.render(
      <>
        <ZoomDim holders={holders} reducedMotion={false} />
        <MicroMotion boosts={boosts} hovered={() => null} tier="LOW" reducedMotion={false} color="#ffffff" />
      </>,
    ),
  );
  frame(0);
  act(() => useWalk.setState({ mode: 'zoom', zoomId: 'art' }));
  frame(0);
  frame(config().T_ZOOM);
  expect(boosts.art.value).toBe(config().ZOOM_POOL_BOOST);
  expect(sceneDim.value).toBe(config().ZOOM_DIM);
  act(() => useWalk.setState({ mode: 'view', zoomId: null }));
  frame(0);
  frame(config().T_UNZOOM);
  expect(boosts.art.value).toBe(1);
  expect(sceneDim.value).toBe(1);
});

it('자동 투어도 느린 프레임의 실제 재생 시간을 보존한다', () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const model = visitModelOf(testExhibitionView([2]));
  const plan = planTour(tourInputOf(model.layout, () => null, teacherExhibition().settings.tour));
  const clock = { t: 0, playing: true, updatedAt: 0 };
  act(() =>
    root.render(
      <TourDriver layout={model.layout} plan={plan} clock={clock} onRegion={() => {}} onTick={() => {}} />,
    ),
  );
  now = 800;
  frame(0.8);
  expect(clock.t).toBeCloseTo(0.8, 8);
  clock.playing = false;
  now = 100_000;
  frame(99.2);
  expect(clock.t).toBeCloseTo(0.8, 8);
});

it('정지 뒤 입력부터 첫 느린 프레임 사이의 이동 시간도 보존하고, 쉰 시간은 빼고 걷는다', () => {
  const model = visitModelOf(testExhibitionView([2]));
  act(() =>
    root.render(
      <WalkView
        layout={model.layout}
        artworks={model.artworks}
        character="student-m"
        placeOf={model.placeOf}
        paused
      />,
    ),
  );
  for (let i = 0; i < 100 && loop.state!.internal.frames > 0; i++) frame(0.5);
  const before = model.layout.walk.spawn.pos[2];
  loop.state!.clock.elapsedTime += 60;
  act(() => useWalk.getState().setKeys({ forward: 1, strafe: 0, run: false }));
  frame(60.75, 0.75);
  frame(0.75);
  act(() => useWalk.getState().setKeys({ forward: 0, strafe: 0, run: false }));
  for (let i = 0; i < 100 && loop.state!.internal.frames > 0; i++) frame(0.5);
  const distance = useWalk.getState().me.z - before;
  expect(distance).toBeGreaterThan(1);
  expect(distance).toBeLessThan(config().CHAR_WALK_MPS * 2);
});

it.each(['keyboard', 'stick'] as const)(
  '%s 입력 즉시 정지 표시를 해제하고, 첫 프레임 전에 뗀 입력의 이동 시간도 보존한다',
  source => {
    const model = visitModelOf(testExhibitionView([2]));
    const Keyboard = () => {
      useWalkKeyboard();
      return null;
    };
    const press = (forward: number) =>
      act(() => {
        if (source === 'stick') useWalk.getState().setStick({ forward, strafe: 0, run: false });
        else window.dispatchEvent(new KeyboardEvent(forward ? 'keydown' : 'keyup', { code: 'KeyW' }));
      });
    act(() =>
      root.render(
        <>
          <Keyboard />
          <WalkView
            layout={model.layout}
            artworks={model.artworks}
            character="student-m"
            placeOf={model.placeOf}
            paused
          />
        </>,
      ),
    );
    for (let i = 0; i < 100 && loop.state!.internal.frames > 0; i++) frame(0.5);
    const before = useWalk.getState().me.z;
    loop.state!.clock.elapsedTime += 60;
    press(1);
    expect(useWalk.getState().idleFrameMark).toBe(0);
    loop.state!.clock.elapsedTime += 1.5;
    press(0);
    frame(62, 0.5);
    for (let i = 0; i < 100 && loop.state!.internal.frames > 0; i++) frame(0.5);
    const distance = useWalk.getState().me.z - before;
    expect(distance).toBeGreaterThan(1);
    expect(distance).toBeLessThan(config().CHAR_WALK_MPS * 2);
    expect(useWalk.getState().idleFrameMark).toBe(useWalk.getState().perf.framesRendered);
  },
);

it('다른 관람객이 계속 그려져도 카메라·연출 종료 뒤 실제 렌더의 예산을 표시한다', () => {
  let effectsActive = true;
  const Crowd = () => {
    useFrame(state => {
      useWalk.getState().set({ microMotionActive: effectsActive });
      state.invalidate();
    });
    return null;
  };
  const model = visitModelOf(testExhibitionView([2]));
  act(() =>
    root.render(
      <>
        <WalkView
          layout={model.layout}
          artworks={model.artworks}
          character="student-m"
          placeOf={model.placeOf}
          paused
        />
        <Crowd />
      </>,
    ),
  );
  for (let i = 0; i < 100; i++) frame(0.5);
  expect(useWalk.getState().viewFrameMark).toBe(0);
  effectsActive = false;
  loop.state!.gl.info.render.calls = 31;
  frame(0.5);
  expect(loop.state!.internal.frames).toBeGreaterThan(0);
  expect(useWalk.getState().idleFrameMark).toBe(0);
  expect(useWalk.getState().viewFrameMark).toBe(useWalk.getState().perf.framesRendered);
  expect(useWalk.getState().viewFrameMark).toBeGreaterThan(0);
  expect(useWalk.getState().perf.calls).toBe(31);
});
