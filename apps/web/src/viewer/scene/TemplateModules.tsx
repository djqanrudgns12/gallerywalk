import { config } from '@gallery/core/config';
import { surfaceSlotOf, type TemplateLook } from '@gallery/core/templates';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import {
  type BufferGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { withBakedLight, withDim } from './materials.ts';
import { gltfLoaderFor } from './gltf.ts';

/**
 * 템플릿 조각 조립(PLAN §6.2). 조각 종류마다(정확히는 조각의 재질 칸마다) `InstancedMesh` 하나 —
 * 같은 조각은 어디에 놓여도 같은 구운 빛을 갖도록 구웠기 때문에(ADR-013·051) 인스턴싱과 구운 빛이 함께 된다.
 * 구운 빛은 glTF에 lightMap 칸이 없어 `occlusionTexture`(texCoord 1)에 실려 온다. 여기서 `lightMap`(channel 1)으로
 * 옮겨 조도로 더한다(곱하는 `aoMap`으로 두면 반구광의 위아래 치우침이 구운 빛에 한 번 더 곱해진다).
 */

export interface ModulePlacement {
  readonly module: string;
  /** 세계 좌표(m). 조각 기준점(벽 시작 쪽 바닥) */
  readonly x: number;
  /** 바닥 높이(실내 0, 외관 조각은 광장 땅 높이) */
  readonly y: number;
  readonly z: number;
  /** 지역 +Z(방 안쪽)를 돌리는 각(라디안) */
  readonly rotY: number;
}

export interface ModulePart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  /** 조각 노드의 변환(meshopt 양자화 해제 포함) */
  readonly local: Matrix4;
}

/**
 * 조각 glb들을 **주어진 순서대로 하나씩** 받아 이름 → 부품 목록으로 합치고, 하나 받을 때마다 돌려준다(§2.5 R-8).
 * 자유 관람은 광장에서 시작하므로 외관을 먼저 주면 광장이 먼저 서고, 실내 핵심은 계단을 오르는 동안 받는다.
 * 받지 못한 파일은 건너뛴다. 주소가 없으면 null.
 * `onSettled`가 있으면 전체 목록을 다 시도했는지 알린다(포스터의 첫 화면 준비 관문).
 */
export const useTemplateModules = (
  urls: string | readonly string[],
  look: TemplateLook,
  onSettled?: (ready: boolean) => void,
): Map<string, ModulePart[]> | null => {
  const gl = useThree(s => s.gl);
  const invalidate = useThree(s => s.invalidate);
  const [modules, setModules] = useState<Map<string, ModulePart[]> | null>(null);
  const key = typeof urls === 'string' ? urls : urls.join('|');

  useEffect(() => {
    const list = key ? key.split('|') : [];
    onSettled?.(false);
    if (list.length === 0) {
      onSettled?.(true);
      return;
    }
    let cancelled = false;
    const loader = gltfLoaderFor(gl);
    void (async () => {
      const map = new Map<string, ModulePart[]>();
      for (const u of list) {
        const gltf = await loader.loadAsync(u).catch(() => null);
        if (cancelled) return;
        if (!gltf) continue;
        gltf.scene.updateMatrixWorld(true);
        for (const node of gltf.scene.children) collect(node, node.name, map, look);
        setModules(new Map(map));
        invalidate();
      }
      if (!cancelled) onSettled?.(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, gl, invalidate, look, onSettled]);

  return modules;
};

/**
 * 포장 줄눈(Antigravity 비평: 광장 바닥이 단조롭다): 앞서 붙은 셰이더(구운 빛·어둡게) 뒤에 이어서, 세계 좌표 기준 엇갈린 돌판의
 * 줄눈을 어둡게 하고 판마다 밝기를 조금씩 다르게 한다. 질감 이음과 상관없이 같은 판 줄이 광장 전체에 이어진다.
 */
const withPavingJoints = (material: MeshStandardMaterial): void => {
  const before = material.onBeforeCompile.bind(material);
  const j = config().PAVING_JOINT;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms['uPave'] = { value: [j.slabW, j.slabD, j.jointM, j.dark] };
    shader.uniforms['uPaveTone'] = { value: j.toneVar };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vPaveWorld;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 paveW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          paveW = instanceMatrix * paveW;
        #endif
        vPaveWorld = (modelMatrix * paveW).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform vec4 uPave;\nuniform float uPaveTone;\nvarying vec3 vPaveWorld;\nvoid main() {',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec2 cell = vPaveWorld.xz / uPave.xy;
          cell.x += 0.5 * mod(floor(cell.y), 2.0);
          vec2 f = abs(fract(cell) - 0.5);
          float edge = min((0.5 - f.x) * uPave.x, (0.5 - f.y) * uPave.y);
          float joint = 1.0 - smoothstep(uPave.z * 0.4, uPave.z, edge);
          vec2 id = floor(cell);
          float h = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb *= (1.0 + uPaveTone * (h * 2.0 - 1.0)) * (1.0 - uPave.w * joint);
        }`,
      );
  };
  material.customProgramCacheKey = () => `${key}-pave`;
  material.needsUpdate = true;
};

/** 셰이더에 세계 좌표 varying을 넣는다(인스턴스 행렬 포함) */
const worldVarying = (vertexShader: string, name: string): string =>
  vertexShader.replace(`void main() {`, `varying vec3 ${name};\nvoid main() {`).replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    vec4 ${name}W = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      ${name}W = instanceMatrix * ${name}W;
    #endif
    ${name} = (modelMatrix * ${name}W).xyz;`,
  );

/**
 * 석재 잔결: 앞서 붙은 셰이더 뒤에 이어서, 세계 좌표 값 잡음 두 겹으로 밝기·거칠기를 조금씩 흔든다(`STONE_GRAIN`).
 * 같은 조각이 여러 번 놓여도 자리마다 결이 달라 반복 티가 덜 난다.
 */
const withStoneGrain = (material: MeshStandardMaterial): void => {
  const before = material.onBeforeCompile.bind(material);
  const g = config().STONE_GRAIN;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms['uStone'] = { value: [g.coarse, g.fine, g.tone, g.rough] };
    shader.uniforms['uStoneBump'] = { value: g.bump };
    // gwPerturb: three 범프(perturbNormalArb)와 같은 방식 — 잔결 높이의 화면 기울기로 법선을 기울인다
    shader.vertexShader = worldVarying(shader.vertexShader, 'vStoneWorld');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec4 uStone;
        uniform float uStoneBump;
        varying vec3 vStoneWorld;
        vec3 gwPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
          vec3 sx = normalize(dFdx(surfPos));
          vec3 sy = normalize(dFdy(surfPos));
          vec3 r1 = cross(sy, surfNorm);
          vec3 r2 = cross(surfNorm, sx);
          float det = dot(sx, r1) * faceDir;
          vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
          return normalize(abs(det) * surfNorm - grad);
        }
        float gwHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float gwNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(gwHash(i), gwHash(i + vec3(1, 0, 0)), f.x), mix(gwHash(i + vec3(0, 1, 0)), gwHash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(gwHash(i + vec3(0, 0, 1)), gwHash(i + vec3(1, 0, 1)), f.x), mix(gwHash(i + vec3(0, 1, 1)), gwHash(i + vec3(1, 1, 1)), f.x), f.y),
            f.z);
        }
        void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float gwStone = gwNoise(vStoneWorld * uStone.x) * 0.6 + gwNoise(vStoneWorld * uStone.y) * 0.4;
        diffuseColor.rgb *= 1.0 + uStone.z * (gwStone * 2.0 - 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = gwPerturb(-vViewPosition, normal, vec2(dFdx(gwStone), dFdy(gwStone)) * uStoneBump, faceDirection);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + uStone.w * (gwStone * 2.0 - 1.0)), 0.0, 1.0);`,
      );
  };
  material.customProgramCacheKey = () => `${key}-stone`;
  material.needsUpdate = true;
};

/** 구운 빛을 `aoMap` 칸에서 `lightMap` 칸으로 옮긴다(같은 텍스처, channel 1 그대로). */
const toBakedLight = (material: MeshStandardMaterial, look: TemplateLook): void => {
  material.lightMap = material.aoMap;
  material.aoMap = null;
  material.lightMapIntensity = look.baked.intensity;
  material.envMapIntensity = look.baked.environmentScale;
  withBakedLight(material);
  material.needsUpdate = true;
};

/** 조각 노드 아래 메시(재질 칸마다 하나)를 모은다. 이름은 최상위 노드(조각) 이름으로. */
const collect = (
  obj: Object3D,
  moduleName: string,
  out: Map<string, ModulePart[]>,
  look: TemplateLook,
): void => {
  const mesh = obj as Mesh;
  if (mesh.isMesh) {
    const material = mesh.material as Material;
    if (material instanceof MeshStandardMaterial) {
      // 분위기 면 색(look.surfaces): 질감 결은 두고 바탕색만 곱한다
      const slot = surfaceSlotOf(material.name);
      const tint = slot ? look.surfaces[slot] : undefined;
      if (tint) material.color.set(tint);
      // 안내판 판 면(설비 glb, V-57): 남색 대신 숯색. 어두운 방에서도 판으로 읽히게 같은 색을 스스로 낸다(빛을 더하지 않음)
      if (material.name.startsWith('M_SignFace')) {
        material.color.set(look.signFace);
        material.emissive.set(look.signFace);
      }
      if (material.aoMap) toBakedLight(material, look);
      else withDim(material);
      // 면 마감(바닥 반사 낮추기): 구운 조각이면 구운 빛의 환경맵 세기에 곱한다. 같은 재질을 여러 메시가 써도 같은 값(덮어씀)
      const finish = slot ? look.finish[slot] : undefined;
      if (finish) {
        material.roughness = finish.roughness;
        material.envMapIntensity =
          (material.lightMap ? look.baked.environmentScale : 1) * finish.environmentScale;
      }
      if (material.name.startsWith('M_Paving')) withPavingJoints(material);
      if (/^M_(Stone|Ashlar)/.test(material.name)) withStoneGrain(material);
    }
    const parts = out.get(moduleName) ?? [];
    parts.push({ geometry: mesh.geometry, material, local: mesh.matrixWorld.clone() });
    out.set(moduleName, parts);
  }
  for (const child of obj.children) collect(child, moduleName, out, look);
};

export const TemplateModules = ({
  modules,
  placements,
}: {
  modules: Map<string, ModulePart[]>;
  placements: readonly ModulePlacement[];
}) => {
  const meshes = useMemo(() => {
    const byModule = new Map<string, ModulePlacement[]>();
    for (const p of placements) byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
    const out: InstancedMesh[] = [];
    const place = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    for (const [name, list] of byModule) {
      const parts = modules.get(name);
      if (!parts) continue;
      for (const part of parts) {
        const inst = new InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((p, i) => {
          place.compose(new Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.rotY), one);
          inst.setMatrixAt(i, place.clone().multiply(part.local));
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        out.push(inst);
      }
    }
    return out;
  }, [modules, placements]);

  useEffect(
    () => () => {
      for (const m of meshes) m.dispose();
    },
    [meshes],
  );

  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
};
