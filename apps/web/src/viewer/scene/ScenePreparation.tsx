import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { type Camera, type Material, type Mesh, type Scene, Texture, type WebGLRenderer } from 'three';

/** 첫 화면에서 쓰는 일반 재질·셰이더 uniform의 질감도 포스터 뒤에서 올린다. */
export const prepareScene = async (
  gl: Pick<WebGLRenderer, 'initTexture' | 'compile'> & {
    readonly compileAsync?: WebGLRenderer['compileAsync'] | undefined;
  },
  scene: Scene,
  camera: Camera,
  signal: AbortSignal,
): Promise<void> => {
  const textures = new Set<Texture>();
  const take = (value: unknown): void => {
    if (value instanceof Texture) textures.add(value);
  };
  const collect = (material: Material): void => {
    Object.values(material).forEach(take);
    if ('uniforms' in material && typeof material.uniforms === 'object' && material.uniforms !== null) {
      for (const uniform of Object.values(material.uniforms)) {
        if (typeof uniform === 'object' && uniform !== null && 'value' in uniform) take(uniform.value);
      }
    }
  };
  take(scene.environment);
  take(scene.background);
  scene.traverse(object => {
    const material = (object as Mesh).material;
    if (Array.isArray(material)) material.forEach(collect);
    else if (material) collect(material);
  });
  for (const texture of textures) {
    if (signal.aborted) return;
    gl.initTexture(texture);
    // 올리는 박자마다 포스터·준비 막대를 그릴 기회를 준다. 입장 뒤로 일을 미루지 않는다.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  if (signal.aborted) return;
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  if (typeof gl.compileAsync === 'function') await gl.compileAsync(scene, camera);
  else gl.compile(scene, camera);
};

/**
 * 모델 수신만으로 입장을 열지 않는다. 질감 올리기 → 셰이더 준비 → 첫 실제 그리기까지 마친 뒤에 연다.
 * 준비 동안에만 유한한 다시 그리기를 요청하고, 관람을 시작한 뒤에는 준비를 반복하지 않는다.
 */
export const ScenePreparation = ({
  ready,
  revision,
  paused,
  onReady,
}: {
  readonly ready: boolean;
  readonly revision: unknown;
  readonly paused: boolean;
  readonly onReady: ((ready: boolean) => void) | undefined;
}) => {
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);
  const invalidate = useThree(s => s.invalidate);
  const completed = useRef(false);
  const afterRender = useRef<(() => void) | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!onReady || (!paused && completed.current)) return;
    onReady(false);
    if (!ready) return;
    const controller = new AbortController();
    let frame: number | null = null;
    void prepareScene(gl, scene, camera, controller.signal)
      .then(() => {
        if (controller.signal.aborted) return;
        afterRender.current = () => {
          frame = requestAnimationFrame(() => {
            if (controller.signal.aborted) return;
            // GPU(소프트웨어 그리기 포함)의 첫 화면 작업도 입장 전에 끝낸다.
            gl.getContext().finish();
            completed.current = true;
            onReady(true);
          });
        };
        invalidate();
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause);
      });
    return () => {
      controller.abort();
      afterRender.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ready, revision, paused, onReady, gl, scene, camera, invalidate]);

  useFrame(() => {
    const done = afterRender.current;
    afterRender.current = null;
    done?.();
  });
  if (error !== null) throw error;
  return null;
};
