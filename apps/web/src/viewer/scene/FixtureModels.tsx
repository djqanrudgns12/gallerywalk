import { config } from '@gallery/core/config';
import type { Fixture } from '@gallery/core/types';
import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { withDim } from './materials.ts';
import type { ModulePart } from './TemplateModules.tsx';

/**
 * 바닥 설비(이젤·벤치·화분·가로등·나무)를 종류마다 `InstancedMesh` 하나로(그리기 호출 = 종류 수).
 *
 * 모양: R-3 Blender 설비 모델(`fixtures.glb`, 최상위 노드 이름 = 종류)이 있으면 그것을, 없거나 받기 전이면 아래 **임시** 모형.
 * 크기는 배치 엔진의 설비 바닥(`templateGeometry.footprints`)과 이젤 받침 높이(`EASEL_LEDGE_Y_M`)에 맞춘다.
 */

type Kind = 'easel' | 'bench' | 'plant' | 'lamp' | 'tree';
const KINDS: readonly Kind[] = ['easel', 'bench', 'plant', 'lamp', 'tree'];
/** 글자 사인 판(V-03): `fixtures.glb`에 모델이 있을 때만 그린다(임시 모형 없음 — 글은 `SignTexts`) */
const BOARD_KINDS: readonly Fixture['kind'][] = [
  'nameplate',
  'introPanel',
  'corridorNameplate',
  'hallSign',
  'exitSign',
];

const tint = (g: BufferGeometry, hex: string): BufferGeometry => {
  const c = new Color(hex);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  // 합칠 때 속성이 같아야 한다
  if (g.index) return g.toNonIndexed();
  return g;
};

/** 두 점을 잇는 각진 막대(이젤 다리) */
const bar = (a: Vector3, b: Vector3, w: number, d: number, hex: string): BufferGeometry => {
  const dir = new Vector3().subVectors(b, a);
  const g = new BoxGeometry(w, dir.length(), d);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return tint(g, hex);
};

const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string) => {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return tint(g, hex);
};

const OAK = '#b48a5a';
const DARK_OAK = '#7a5636';

const shapes: Record<Kind, () => BufferGeometry> = {
  easel: () => {
    const ledge = config().EASEL_LEDGE_Y_M;
    const parts = [
      bar(new Vector3(-0.44, 0, 0.2), new Vector3(-0.07, 2.15, 0.02), 0.045, 0.035, OAK),
      bar(new Vector3(0.44, 0, 0.2), new Vector3(0.07, 2.15, 0.02), 0.045, 0.035, OAK),
      bar(new Vector3(0, 0, -0.5), new Vector3(0, 1.95, -0.04), 0.04, 0.035, OAK),
      box(1.0, 0.045, 0.11, 0, ledge - 0.0225, 0.07, DARK_OAK),
      box(0.62, 0.035, 0.03, 0, 1.62, 0.04, OAK),
    ];
    return mergeGeometries(parts) ?? parts[0]!;
  },
  bench: () => {
    const parts = [
      box(1.5, 0.1, 0.46, 0, 0.42, 0, '#4b3426'),
      box(1.56, 0.04, 0.5, 0, 0.36, 0, DARK_OAK),
      ...[-0.68, 0.68].flatMap(x => [
        box(0.06, 0.34, 0.06, x, 0.17, 0.19, DARK_OAK),
        box(0.06, 0.34, 0.06, x, 0.17, -0.19, DARK_OAK),
      ]),
    ];
    return mergeGeometries(parts) ?? parts[0]!;
  },
  plant: () => {
    const pot = tint(new CylinderGeometry(0.22, 0.17, 0.44, 16).translate(0, 0.22, 0), '#e6ddcc');
    const a = tint(new IcosahedronGeometry(0.34, 1).translate(0, 0.86, 0), '#4d6a3a');
    const b = tint(new IcosahedronGeometry(0.24, 1).translate(0.12, 1.18, -0.05), '#5c7a45');
    return mergeGeometries([pot, a, b]) ?? pot;
  },
  lamp: () => {
    const post = tint(new CylinderGeometry(0.05, 0.08, 3.2, 10).translate(0, 1.6, 0), '#3b3329');
    const base = tint(new CylinderGeometry(0.16, 0.2, 0.3, 12).translate(0, 0.15, 0), '#3b3329');
    const globe = tint(new SphereGeometry(0.2, 16, 10).translate(0, 3.34, 0), '#fff4dc');
    return mergeGeometries([post, base, globe]) ?? post;
  },
  tree: () => {
    const trunk = tint(new CylinderGeometry(0.12, 0.18, 2.2, 10).translate(0, 1.1, 0), '#6b4e34');
    const a = tint(new IcosahedronGeometry(1.35, 1).translate(0, 3.0, 0), '#5a7744');
    const b = tint(new IcosahedronGeometry(1.0, 1).translate(0.6, 3.8, 0.2), '#6a8a4f');
    const c = tint(new IcosahedronGeometry(0.9, 1).translate(-0.55, 3.6, -0.3), '#4f6b3c');
    return mergeGeometries([trunk, a, b, c]) ?? trunk;
  },
};

export const FixtureModels = ({
  fixtures,
  models,
}: {
  fixtures: readonly Fixture[];
  /** `fixtures.glb`의 부품(종류 이름별) — 있는 종류는 진짜 모델로 */
  models?: ReadonlyMap<string, readonly ModulePart[]> | null | undefined;
}) => {
  const meshes = useMemo(() => {
    const material = withDim(new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }));
    const out: InstancedMesh[] = [];
    const shared = new Set<InstancedMesh>();
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    for (const kind of [...KINDS, ...BOARD_KINDS]) {
      const list = fixtures.filter(f => f.kind === kind);
      if (list.length === 0) continue;
      const real = models?.get(kind);
      if (real && real.length > 0) {
        // 진짜 모델: 재질 칸마다 인스턴스 하나(기하·재질은 받은 것을 함께 씀 — 여기서 버리지 않음)
        for (const part of real) {
          const inst = new InstancedMesh(part.geometry, part.material, list.length);
          list.forEach((f, i) => {
            m.compose(new Vector3(f.pos[0], f.pos[1], f.pos[2]), q.setFromAxisAngle(up, f.rotY), one);
            inst.setMatrixAt(i, m.clone().multiply(part.local));
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.computeBoundingSphere();
          shared.add(inst);
          out.push(inst);
        }
        continue;
      }
      if (!(KINDS as readonly string[]).includes(kind)) continue;
      const geometry = shapes[kind as Kind]();
      const inst = new InstancedMesh(geometry, material, list.length);
      list.forEach((f, i) => {
        inst.setMatrixAt(
          i,
          m.compose(new Vector3(f.pos[0], f.pos[1], f.pos[2]), q.setFromAxisAngle(up, f.rotY), one),
        );
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      out.push(inst);
    }
    return { out, material, shared };
  }, [fixtures, models]);
  useEffect(
    () => () => {
      for (const i of meshes.out) {
        if (!meshes.shared.has(i)) i.geometry.dispose();
        i.dispose();
      }
      meshes.material.dispose();
    },
    [meshes],
  );
  return (
    <group>
      {meshes.out.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
};
