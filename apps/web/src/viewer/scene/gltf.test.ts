import type { WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gltfLoaderFor } from './gltf.ts';

/** renderer 흉내: KTX2 지원 확인(`extensions.has`)과 `dispose`만 */
const fakeRenderer = () => {
  const disposed = vi.fn();
  const gl = { extensions: { has: () => false }, dispose: disposed } as unknown as WebGLRenderer;
  return { gl, disposed };
};

afterEach(() => vi.restoreAllMocks());

describe('gltfLoaderFor', () => {
  it('renderer마다 하나, renderer를 놓으면 KTX2 일꾼도 닫고 다음에는 새로 만든다', () => {
    const closed = vi.spyOn(KTX2Loader.prototype, 'dispose');
    const { gl, disposed } = fakeRenderer();
    const first = gltfLoaderFor(gl);
    expect(gltfLoaderFor(gl)).toBe(first);
    gl.dispose();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(gltfLoaderFor(gl)).not.toBe(first);
    gl.dispose();
    expect(closed).toHaveBeenCalledTimes(2);
    expect(disposed).toHaveBeenCalledTimes(2);
  });
});
