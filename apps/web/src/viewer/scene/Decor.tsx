import { config } from '@gallery/core/config';
import { templateGeometry } from '@gallery/core/templates';
import type { Layout } from '@gallery/core/types';
import { useEffect, useMemo } from 'react';
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type DecorKind, decorGroups, decorZonesInView } from './decor.ts';
import type { Tier } from '../textures/residency.ts';
import { withDim } from './materials.ts';
import type { ModulePart } from './TemplateModules.tsx';

/**
 * 공간 v4 장식(PRD_V2 W-04, M5-3): 배치의 `decorSlots`를 종류마다 `InstancedMesh` 하나로(그리기 호출 = 보이는 종류 수,
 * 빛 구가 있는 펜던트 임시 모형만 재질 2칸이라 2회). 스키마 2 배치면 아무것도 없다. 묶음·보이는 범위·모델 대응은 `decor.ts`.
 *
 * 모양: `fixtures.glb`에 종류 이름의 모델(M5-1)이 있으면 그것, 없으면 비슷한 설비 모델(화분 → `plant`), 그것도 없으면 아래
 * **임시** 모형(`FixtureModels`와 같은 방식 — 꼭짓점 색 + 공유 재질 + `withDim`). 실시간 조명·그림자는 없다 — 펜던트의 빛 구는
 * 조명 계산 없는 밝은 재질일 뿐이다. 치수는 `config().DECOR`, 바닥 넓이는 배치 엔진과 같은 `LAYOUT_V4.decorFootprint`.
 */

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

const merge = (parts: BufferGeometry[], groups = false): BufferGeometry => {
  const g = mergeGeometries(parts, groups) ?? parts[0]!;
  for (const p of parts) if (p !== g) p.dispose();
  return g;
};

const STONE = '#ddd5c7';
const MARBLE = '#eee9e0';
const BRONZE = '#8a6a45';
const WATER = '#6f8e98';
const POT = '#d9cfbd';
const LEAF = '#4d6a3a';
const LEAF_LIGHT = '#5c7a45';
const WALNUT = '#5a3f2a';
const IRON = '#3b3329';
const GLOW = '#fff1d6';

interface Placeholder {
  readonly geometry: BufferGeometry;
  /** 재질 2칸(그룹 0 = 보통, 그룹 1 = 빛 구) */
  readonly glow: boolean;
}

const placeholderOf = (kind: DecorKind, n: number): Placeholder => {
  const d = config().DECOR;
  const fp = config().LAYOUT_V4.decorFootprint;
  switch (kind) {
    case 'fountain': {
      const f = d.fountain;
      const r = fp.fountain.w / 2;
      const columnTop = f.basinH + f.columnH;
      return {
        geometry: merge([
          tint(new CylinderGeometry(r, r, f.basinH, n * 2).translate(0, f.basinH / 2, 0), STONE),
          tint(
            new CylinderGeometry(r - f.rimW, r - f.rimW, f.waterDropM, n * 2).translate(0, f.basinH, 0),
            WATER,
          ),
          tint(
            new CylinderGeometry(f.columnR, f.columnR * 1.4, f.columnH, n).translate(
              0,
              f.basinH + f.columnH / 2,
              0,
            ),
            STONE,
          ),
          tint(
            new CylinderGeometry(f.bowlR, f.bowlR * 0.35, f.bowlH, n * 2).translate(
              0,
              columnTop + f.bowlH / 2,
              0,
            ),
            STONE,
          ),
          tint(
            new CylinderGeometry(f.bowlR - f.rimW / 2, f.bowlR - f.rimW / 2, f.waterDropM, n * 2).translate(
              0,
              columnTop + f.bowlH,
              0,
            ),
            WATER,
          ),
          tint(
            new CylinderGeometry(f.columnR * 0.5, f.columnR * 0.8, f.topH, n).translate(
              0,
              columnTop + f.bowlH + f.topH / 2,
              0,
            ),
            STONE,
          ),
        ]),
        glow: false,
      };
    }
    case 'sculpture': {
      const s = d.sculpture;
      const w = fp.sculpture.w * 0.75;
      const ring = s.formH * 0.18;
      const body = s.formH - 2 * ring;
      return {
        geometry: merge([
          tint(new BoxGeometry(w, s.plinthH, w).translate(0, s.plinthH / 2, 0), MARBLE),
          tint(
            new IcosahedronGeometry(0.5, 0)
              .scale(w * 0.7, body, w * 0.55)
              .rotateY(Math.PI / 5)
              .translate(0, s.plinthH + body / 2, 0),
            BRONZE,
          ),
          tint(
            new TorusGeometry(ring, ring * 0.22, 8, n).translate(0, s.plinthH + body + ring * 0.8, 0),
            BRONZE,
          ),
        ]),
        glow: false,
      };
    }
    case 'bust': {
      const b = d.bust;
      const w = fp.bust.w;
      const top = b.plinthH + b.shoulderH;
      return {
        geometry: merge([
          tint(new BoxGeometry(w, w * 0.15, w).translate(0, (w * 0.15) / 2, 0), STONE),
          tint(new CylinderGeometry(w * 0.32, w * 0.36, b.plinthH, n).translate(0, b.plinthH / 2, 0), STONE),
          tint(
            new BoxGeometry(w * 0.75, b.shoulderH, w * 0.38).translate(0, b.plinthH + b.shoulderH / 2, 0),
            MARBLE,
          ),
          tint(
            new CylinderGeometry(b.headR * 0.4, b.headR * 0.45, b.headR, n / 2).translate(
              0,
              top + b.headR / 2,
              0,
            ),
            MARBLE,
          ),
          tint(
            new SphereGeometry(b.headR, n, n / 2).scale(0.85, 1.1, 0.95).translate(0, top + b.headR * 1.9, 0),
            MARBLE,
          ),
        ]),
        glow: false,
      };
    }
    case 'planter': {
      const p = d.planter;
      const r = fp.planter.w / 2;
      return {
        geometry: merge([
          tint(new CylinderGeometry(r, r * 0.75, p.potH, n).translate(0, p.potH / 2, 0), POT),
          tint(new IcosahedronGeometry(p.leafR, 1).translate(0, p.potH + p.leafR * 0.7, 0), LEAF),
          tint(
            new IcosahedronGeometry(p.leafR * 0.7, 1).translate(
              p.leafR * 0.3,
              p.potH + p.leafR * 1.5,
              -p.leafR * 0.1,
            ),
            LEAF_LIGHT,
          ),
        ]),
        glow: false,
      };
    }
    case 'topiary': {
      const t = d.topiary;
      const r = (fp.topiary.w / 2) * 0.7;
      return {
        geometry: merge([
          tint(new CylinderGeometry(r, r * 0.8, t.potH, n).translate(0, t.potH / 2, 0), POT),
          tint(new SphereGeometry(t.ballR, n, n / 2).translate(0, t.potH + t.ballR * 0.9, 0), LEAF),
        ]),
        glow: false,
      };
    }
    case 'urn': {
      const h = d.urn.h;
      const r = fp.urn.w / 2;
      const base = h * 0.18;
      // 옆모습(반지름, 높이) — 받침 위 몸통이 부풀었다 목에서 좁아지고 입이 벌어진다
      const profile = [
        [0, base],
        [r * 0.45, base],
        [r * 0.85, base + h * 0.3],
        [r * 0.9, base + h * 0.42],
        [r * 0.5, base + h * 0.68],
        [r * 0.42, base + h * 0.74],
        [r * 0.62, base + h * 0.82],
        [r * 0.55, base + h * 0.82],
        [0, base + h * 0.7],
      ].map(([x, y]) => new Vector2(x, y));
      return {
        geometry: merge([
          tint(new BoxGeometry(r * 1.6, base, r * 1.6).translate(0, base / 2, 0), STONE),
          tint(new LatheGeometry(profile, n), STONE),
        ]),
        glow: false,
      };
    }
    case 'desk': {
      const k = d.desk;
      const { w, d: depth } = fp.desk;
      const bodyH = k.h - k.topT;
      return {
        geometry: merge([
          tint(new BoxGeometry(w - 0.1, k.plinthH, depth - 0.1).translate(0, k.plinthH / 2, 0), IRON),
          tint(
            new BoxGeometry(w, bodyH - k.plinthH, depth).translate(0, k.plinthH + (bodyH - k.plinthH) / 2, 0),
            WALNUT,
          ),
          tint(new BoxGeometry(w + 0.06, k.topT, depth + 0.06).translate(0, bodyH + k.topT / 2, 0), MARBLE),
        ]),
        glow: false,
      };
    }
    case 'pendant': {
      const p = d.pendant;
      const body = merge([
        // 막대 위 끝 = 자리 + `rodM`(배치의 펜던트 자리 = 천장 − `rodM`)
        tint(
          new CylinderGeometry(0.012, 0.012, p.rodM - p.shadeH, 6).translate(0, (p.shadeH + p.rodM) / 2, 0),
          IRON,
        ),
        tint(
          new CylinderGeometry(p.shadeR * 0.25, p.shadeR, p.shadeH, n).translate(0, p.shadeH / 2, 0),
          BRONZE,
        ),
      ]);
      const globe = tint(new SphereGeometry(p.globeR, n, n / 2).translate(0, -p.globeR * 0.4, 0), GLOW);
      return { geometry: merge([body, globe], true), glow: true };
    }
  }
};

export const Decor = ({
  layout,
  region,
  visibleParts,
  tier,
  models,
}: {
  layout: Layout;
  /** 캐릭터가 있는 구역(`exterior` · 관 ID · 홀) */
  region: string;
  /** 그리는 관(`visibleParts`) */
  visibleParts: ReadonlySet<string>;
  /** 품질 단계: 낮음(LOW)은 `DECOR.lowTierKinds`만, 둥근 임시 모형은 `DECOR.lowSegments` 칸 */
  tier: Tier;
  /** `fixtures.glb`의 부품(종류 이름별) — 장식 종류 이름의 모델(M5-1)이 오면 그것으로 */
  models?: ReadonlyMap<string, readonly ModulePart[]> | null | undefined;
}) => {
  // 보이는 구역이 바뀔 때만 다시 묶는다(1m 칸마다 새로 오는 `visibleParts` 집합에 끌려가지 않게)
  const zonesKey = decorZonesInView(layout.decorSlots ?? [], region, visibleParts).join('|');
  // 임시 모형 기하·재질은 한 번 만들어 끝까지 함께 쓴다(묶음이 바뀌어도 다시 만들지 않음)
  const shared = useMemo(
    () => ({
      geometries: new Map<string, Placeholder>(),
      solid: withDim(new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 })),
      glow: withDim(new MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const p of shared.geometries.values()) p.geometry.dispose();
      shared.geometries.clear();
      shared.solid.dispose();
      shared.glow.dispose();
    },
    [shared],
  );
  const meshes = useMemo(() => {
    const zones = new Set(zonesKey === '' ? [] : zonesKey.split('|'));
    const hasModel = (name: string): boolean => (models?.get(name)?.length ?? 0) > 0;
    const groups = decorGroups(layout, zones, hasModel, templateGeometry[layout.templateId].footprints, tier);
    const segments = tier === 'LOW' ? config().DECOR.lowSegments : config().DECOR.segments;
    const out: InstancedMesh[] = [];
    const m = new Matrix4();
    const local = new Matrix4();
    for (const g of groups) {
      if (g.shape.type === 'model') {
        // 진짜 모델: 재질 칸마다 인스턴스 하나(기하·재질은 받은 것을 함께 씀 — 여기서 버리지 않음)
        for (const part of models?.get(g.shape.name) ?? []) {
          const inst = new InstancedMesh(part.geometry, part.material, g.count);
          for (let i = 0; i < g.count; i++) {
            m.fromArray(g.matrices, i * 16);
            inst.setMatrixAt(i, local.multiplyMatrices(m, part.local));
          }
          inst.instanceMatrix.needsUpdate = true;
          inst.computeBoundingSphere();
          out.push(inst);
        }
        continue;
      }
      const key = `${g.shape.key}:${segments}`;
      let ph = shared.geometries.get(key);
      if (!ph) {
        ph = placeholderOf(g.shape.key, segments);
        shared.geometries.set(key, ph);
      }
      const material: Material | Material[] = ph.glow ? [shared.solid, shared.glow] : shared.solid;
      const inst = new InstancedMesh(ph.geometry, material, g.count);
      for (let i = 0; i < g.count; i++) inst.setMatrixAt(i, m.fromArray(g.matrices, i * 16));
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      out.push(inst);
    }
    return out;
  }, [layout, zonesKey, models, shared, tier]);
  // 인스턴스 버퍼만 버린다(기하·재질은 받은 모델이거나 `shared`)
  useEffect(
    () => () => {
      for (const i of meshes) i.dispose();
    },
    [meshes],
  );
  if (meshes.length === 0) return null;
  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
};
