import { config } from '@gallery/core/config';
import {
  type AnimationClip,
  AnimationMixer,
  BufferGeometry,
  DataTexture,
  DataUtils,
  Float32BufferAttribute,
  HalfFloatType,
  Matrix3,
  Matrix4,
  type MeshStandardMaterial,
  NearestFilter,
  type Object3D,
  RGBAFormat,
  type SkinnedMesh,
  Vector3,
  Vector4,
  type WebGLRenderer,
} from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { z } from 'zod';
import { loadCharacterGlb } from '../scene/Character.tsx';
import { withDim } from '../scene/materials.ts';

/**
 * 다른 관람객의 몸(ADR-057, 규격 `tools/assets/spec/characters.md` §2 LOD): 먼 거리 LOD glb(`characterLodUrl`, ≤3천 삼각형)의
 * `idle`(서 있는 자세 1장)·`walk`·`run`을 장면마다 구워 **정점 애니메이션 텍스처**(꼭짓점 자리·법선, 반정밀도)에 담는다.
 * 뼈대 없이 몸 묶음(`peerGroups.ts`)마다 `InstancedMesh` 하나로 그리고, 사람마다 몇 번째 장면인지(`aVat` = 장면 A·B·섞음)만
 * 넘긴다 — 사람 수와 상관없이 그리기 4회 그대로 실제로 걷는다(사용자 의견 2026-11-12: "정지해서 떠다니는 것 같다").
 * 없거나 못 읽으면 null(부르는 쪽이 임시 모형을 그대로 둔다).
 */

export interface VatClip {
  /** 텍스처의 첫 장면 번호 */
  readonly base: number;
  readonly frames: number;
  /** 클립 길이(s) */
  readonly duration: number;
}

export interface PeerBody {
  /** 서 있는 자세의 정적 기하(경계·UV·삼각형 — 꼭짓점 자리는 셰이더가 텍스처에서 읽는다) */
  readonly geometry: BufferGeometry;
  readonly material: MeshStandardMaterial;
  readonly idle: VatClip;
  readonly walk: VatClip | null;
  readonly run: VatClip | null;
  /** 클립의 땅 빠르기(m/s, 변환 도구가 잼) — 재생 배속을 맞출 때 */
  readonly groundMps: { readonly walk?: number | undefined; readonly run?: number | undefined };
  readonly dispose: () => void;
}

const GroundMps = z.object({ walk: z.number().positive().optional(), run: z.number().positive().optional() });

const skinMatrix = (mesh: SkinnedMesh, index: number, out: Matrix4, tmp: Matrix4): Matrix4 => {
  const si = mesh.geometry.getAttribute('skinIndex');
  const sw = mesh.geometry.getAttribute('skinWeight');
  const idx = new Vector4(si.getX(index), si.getY(index), si.getZ(index), si.getW(index));
  const w = new Vector4(sw.getX(index), sw.getY(index), sw.getZ(index), sw.getW(index));
  const e = out.elements;
  e.fill(0);
  for (let k = 0; k < 4; k++) {
    const weight = w.getComponent(k);
    if (weight === 0) continue;
    const b = idx.getComponent(k);
    tmp.multiplyMatrices(mesh.skeleton.bones[b]!.matrixWorld, mesh.skeleton.boneInverses[b]!);
    for (let j = 0; j < 16; j++) e[j]! += tmp.elements[j]! * weight;
  }
  return out;
};

/** 지금 뼈 자세의 꼭짓점 i 자리·법선(장면 뿌리 기준)을 `p`·`n`에 */
const skinnedVertex = (
  mesh: SkinnedMesh,
  i: number,
  p: Vector3,
  n: Vector3 | null,
  m: { blend: Matrix4; tmp: Matrix4; full: Matrix4; normal: Matrix3 },
): void => {
  // 세계 = 메시 세계 · 바인드⁻¹ · Σ(뼈 세계·뼈 역바인드)·가중치 · 바인드
  skinMatrix(mesh, i, m.blend, m.tmp);
  m.full.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(m.blend).multiply(mesh.bindMatrix);
  p.fromBufferAttribute(mesh.geometry.getAttribute('position'), i).applyMatrix4(m.full);
  const nor = mesh.geometry.getAttribute('normal');
  if (n && nor) {
    m.normal.getNormalMatrix(m.full);
    n.fromBufferAttribute(nor, i).applyMatrix3(m.normal).normalize();
  }
};

const scratch = () => ({
  blend: new Matrix4(),
  tmp: new Matrix4(),
  full: new Matrix4(),
  normal: new Matrix3(),
});

/** 스킨 메시를 지금 뼈 자세 그대로 정적 기하로(꼭짓점·법선은 장면 뿌리 기준, UV·삼각형은 그대로) */
export const bakeSkinned = (mesh: SkinnedMesh): BufferGeometry => {
  const g = mesh.geometry;
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const n = g.getAttribute('position').count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const U = new Float32Array(n * 2);
  const m = scratch();
  const p = new Vector3();
  const q = new Vector3();
  for (let i = 0; i < n; i++) {
    skinnedVertex(mesh, i, p, nor ? q : null, m);
    P.set([p.x, p.y, p.z], i * 3);
    if (nor) N.set([q.x, q.y, q.z], i * 3);
    if (uv) U.set([uv.getX(i), uv.getY(i)], i * 2);
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(P, 3));
  if (nor) out.setAttribute('normal', new Float32BufferAttribute(N, 3));
  else out.computeVertexNormals();
  if (uv) out.setAttribute('uv', new Float32BufferAttribute(U, 2));
  const index = g.getIndex();
  if (index) out.setIndex(index.clone());
  out.computeBoundingSphere();
  return out;
};

/** 텍스처 배치: 한 장면 = 꼭짓점 수를 `width`씩 자른 `rows`줄. 꼭짓점 i → (i % width, 장면·rows + ⌊i / width⌋) */
export const vatLayout = (vertexCount: number, maxWidth: number): { width: number; rows: number } => {
  const width = Math.min(vertexCount, maxWidth);
  return { width, rows: Math.ceil(vertexCount / width) };
};

const VAT_HEAD = /* glsl */ `
uniform sampler2D uVatPos;
uniform sampler2D uVatNor;
uniform int uVatW;
uniform int uVatRows;
attribute vec3 aVat;
vec3 vatAt(sampler2D t, float frame) {
  int id = gl_VertexID;
  return texelFetch(t, ivec2(id % uVatW, int(frame + 0.5) * uVatRows + id / uVatW), 0).xyz;
}
`;
const VAT_NORMAL = /* glsl */ `
vec3 objectNormal = normalize(mix(vatAt(uVatNor, aVat.x), vatAt(uVatNor, aVat.y), aVat.z));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
`;
const VAT_POS = /* glsl */ `
vec3 transformed = mix(vatAt(uVatPos, aVat.x), vatAt(uVatPos, aVat.y), aVat.z);
#ifdef USE_ALPHAHASH
  vPosition = vec3(position);
#endif
`;

const replaced = (src: string, from: string, to: string): string => {
  if (!src.includes(from)) throw new Error(`셰이더 조각을 찾지 못함: ${from}`);
  return src.replace(from, to);
};

/** `url` = 먼 거리 LOD 주소(`characterLodUrl`) — 같은 주소를 쓰는 캐릭터들은 같은 몸 하나를 함께 쓴다 */
export const loadPeerBody = async (url: string, gl: WebGLRenderer): Promise<PeerBody | null> => {
  const loaded = await loadCharacterGlb(url, gl);
  if (!loaded) return null;
  // 받아 둔 장면은 함께 쓰므로 복제해서 자세를 잡는다
  const root = cloneSkinned(loaded.scene);
  let skinned: SkinnedMesh | null = null;
  root.traverse(o => {
    if (!skinned && (o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh;
  });
  const mesh = skinned as SkinnedMesh | null;
  if (!mesh) return null;
  const c = config();
  const count = mesh.geometry.getAttribute('position').count;
  const { width, rows } = vatLayout(count, c.PEER_VAT_TEX_W);
  const plan: { name: 'idle' | 'walk' | 'run'; clip: AnimationClip; frames: number }[] = [];
  const idleClip = loaded.clips.get('idle');
  const walkClip = loaded.clips.get('walk');
  const runClip = loaded.clips.get('run');
  if (idleClip) plan.push({ name: 'idle', clip: idleClip, frames: 1 });
  if (walkClip) plan.push({ name: 'walk', clip: walkClip, frames: c.PEER_VAT_FRAMES.walk });
  if (runClip) plan.push({ name: 'run', clip: runClip, frames: c.PEER_VAT_FRAMES.run });
  const total = Math.max(
    1,
    plan.reduce((s, x) => s + x.frames, 0),
  );
  const pos = new Uint16Array(width * rows * total * 4);
  const nor = new Uint16Array(width * rows * total * 4);
  const mixer = new AnimationMixer(root);
  const m = scratch();
  const p = new Vector3();
  const q = new Vector3();
  const write = (frame: number): void => {
    root.updateMatrixWorld(true);
    for (let i = 0; i < count; i++) {
      skinnedVertex(mesh, i, p, q, m);
      const t = ((frame * rows + Math.floor(i / width)) * width + (i % width)) * 4;
      pos[t] = DataUtils.toHalfFloat(p.x);
      pos[t + 1] = DataUtils.toHalfFloat(p.y);
      pos[t + 2] = DataUtils.toHalfFloat(p.z);
      nor[t] = DataUtils.toHalfFloat(q.x);
      nor[t + 1] = DataUtils.toHalfFloat(q.y);
      nor[t + 2] = DataUtils.toHalfFloat(q.z);
    }
  };
  const clips: Partial<Record<'idle' | 'walk' | 'run', VatClip>> = {};
  let base = 0;
  if (plan.length === 0) write(0);
  for (const step of plan) {
    mixer.stopAllAction();
    mixer.clipAction(step.clip).play();
    // 반복 클립은 끝 = 처음이라 끝 장면은 빼고 고르게(0 … (n−1)/n)
    for (let f = 0; f < step.frames; f++) {
      mixer.setTime((step.clip.duration * f) / step.frames);
      write(base + f);
    }
    clips[step.name] = { base, frames: step.frames, duration: step.clip.duration };
    base += step.frames;
  }
  // 정적 기하: 서 있는 자세(경계용), UV·삼각형
  mixer.stopAllAction();
  if (idleClip) {
    mixer.clipAction(idleClip).play();
    mixer.setTime(0);
  }
  root.updateMatrixWorld(true);
  const geometry = bakeSkinned(mesh);
  mixer.stopAllAction();
  mixer.uncacheRoot(root as Object3D);

  const texture = (data: Uint16Array): DataTexture => {
    const t = new DataTexture(data, width, rows * total, RGBAFormat, HalfFloatType);
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const posTex = texture(pos);
  const norTex = texture(nor);
  const material = withDim((mesh.material as MeshStandardMaterial).clone());
  material.transparent = false;
  const dim = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    dim(shader, renderer);
    shader.uniforms['uVatPos'] = { value: posTex };
    shader.uniforms['uVatNor'] = { value: norTex };
    shader.uniforms['uVatW'] = { value: width };
    shader.uniforms['uVatRows'] = { value: rows };
    let v = replaced(shader.vertexShader, 'void main() {', `${VAT_HEAD}\nvoid main() {`);
    v = replaced(v, '#include <beginnormal_vertex>', VAT_NORMAL);
    v = replaced(v, '#include <begin_vertex>', VAT_POS);
    shader.vertexShader = v;
  };
  material.customProgramCacheKey = () => 'gw-dim-plain-vat';
  const ground = GroundMps.safeParse(loaded.scene.userData['groundMps']);
  const idle = clips.idle ?? { base: 0, frames: 1, duration: 0 };
  return {
    geometry,
    material,
    idle,
    walk: clips.walk ?? null,
    run: clips.run ?? null,
    groundMps: ground.success ? ground.data : {},
    dispose: () => {
      posTex.dispose();
      norTex.dispose();
    },
  };
};

/** 그 사람이 지금 보일 장면(A·B·섞음) — 클립 시각 `t`의 앞뒤 장면을 섞는다(반복) */
export const vatFrame = (clip: VatClip, t: number): { a: number; b: number; mix: number } => {
  const u = clip.duration > 0 ? (((t / clip.duration) % 1) + 1) % 1 : 0;
  const f = u * clip.frames;
  const i = Math.floor(f) % clip.frames;
  return { a: clip.base + i, b: clip.base + ((i + 1) % clip.frames), mix: f - Math.floor(f) };
};
