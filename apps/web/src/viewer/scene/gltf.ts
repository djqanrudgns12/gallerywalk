import type { WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** Basis 변환기는 three 판을 붙인 경로로 자체 배포한다(외부 출처 없음, ADR-014). */
const TRANSCODER_PATH = '/assets/g/basis-r187/';

const loaders = new WeakMap<WebGLRenderer, GLTFLoader>();

/**
 * 그리는 쪽(renderer)마다 glTF 불러오기 도구 하나(템플릿 조각·설비·캐릭터가 함께 씀). KTX2 변환 일꾼을 여럿 띄우면
 * 메모리·시작 시간이 늘어 three가 경고한다 — 일꾼 묶음은 renderer와 같이 산다: renderer를 놓을 때(`dispose`,
 * 캔버스를 떼거나 컨텍스트 손실 뒤 새로 붙일 때 R3F가 부름) 일꾼도 닫는다.
 */
export const gltfLoaderFor = (gl: WebGLRenderer): GLTFLoader => {
  const hit = loaders.get(gl);
  if (hit) return hit;
  const ktx2 = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH).detectSupport(gl);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  loaders.set(gl, loader);
  const release = gl.dispose.bind(gl);
  gl.dispose = () => {
    gl.dispose = release;
    loaders.delete(gl);
    ktx2.dispose();
    release();
  };
  return loader;
};
