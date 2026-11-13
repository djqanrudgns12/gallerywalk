import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Texture,
} from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { prepareScene, ScenePreparation } from './ScenePreparation.tsx';

const state = vi.hoisted(() => ({ current: {} as unknown, frame: (() => {}) as () => void }));
vi.mock('@react-three/fiber', () => ({
  useThree: (select: (s: unknown) => unknown) => select(state.current),
  useFrame: (frame: () => void) => {
    state.frame = frame;
  },
}));

afterEach(() => vi.unstubAllGlobals());

it('질감 올리기·비동기 셰이더 준비·첫 그리기가 끝나기 전에는 입장을 열지 않고 입장 뒤에는 반복하지 않는다', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++nextFrame, cb);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const flushFrame = async () => {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(cb => cb(0));
    });
  };
  let compiled: () => void = () => {};
  const compilation = new Promise<void>(resolve => {
    compiled = resolve;
  });
  const events: string[] = [];
  const texture = new Texture();
  const material = new MeshBasicMaterial({ map: texture });
  const geometry = new PlaneGeometry();
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const gl = {
    initTexture: vi.fn(() => events.push('texture')),
    compile: vi.fn(),
    compileAsync: vi.fn(() => {
      events.push('compile');
      return compilation;
    }),
    getContext: () => ({ finish: () => events.push('finish') }),
  };
  const invalidate = vi.fn();
  state.current = { gl, scene, camera: new PerspectiveCamera(), invalidate };
  const onReady = vi.fn((ready: boolean) => events.push(ready ? 'ready' : 'waiting'));
  const root = createRoot(document.createElement('div'));
  const revision = {};
  try {
    await act(async () =>
      root.render(<ScenePreparation ready revision={revision} paused onReady={onReady} />),
    );
    expect(onReady.mock.calls).toEqual([[false]]);
    expect(gl.initTexture).toHaveBeenCalledWith(texture);
    await flushFrame();
    expect(gl.compileAsync).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalledWith(true);
    await act(async () => compiled());
    expect(invalidate).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalledWith(true);
    state.frame(); // R3F가 이 콜백 뒤 실제 장면을 그린다.
    events.push('draw');
    await flushFrame();
    expect(events).toEqual(['waiting', 'texture', 'compile', 'draw', 'finish', 'ready']);
    await act(async () =>
      root.render(<ScenePreparation ready revision={{}} paused={false} onReady={onReady} />),
    );
    expect(gl.compileAsync).toHaveBeenCalledOnce();
    expect(onReady.mock.calls).toEqual([[false], [true]]);
  } finally {
    act(() => root.unmount());
    geometry.dispose();
    material.dispose();
    texture.dispose();
  }
});

it('공유 질감과 셰이더 uniform 질감은 한 번씩만 올리고, 비동기 준비가 없으면 compile을 쓴다', async () => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  const texture = new Texture();
  const scene = new Scene();
  const material = new ShaderMaterial({ uniforms: { uAtlas: { value: texture } } });
  const geometry = new PlaneGeometry();
  scene.background = texture;
  scene.add(new Mesh(geometry, material));
  const renderer = { initTexture: vi.fn(), compile: vi.fn(), compileAsync: undefined };
  try {
    await prepareScene(renderer, scene, new PerspectiveCamera(), new AbortController().signal);
    expect(renderer.initTexture.mock.calls).toEqual([[texture]]);
    expect(renderer.compile).toHaveBeenCalledOnce();
    const cancelled = new AbortController();
    cancelled.abort();
    await prepareScene(renderer, scene, new PerspectiveCamera(), cancelled.signal);
    expect(renderer.initTexture).toHaveBeenCalledOnce();
    expect(renderer.compile).toHaveBeenCalledOnce();
  } finally {
    geometry.dispose();
    material.dispose();
    texture.dispose();
  }
});
