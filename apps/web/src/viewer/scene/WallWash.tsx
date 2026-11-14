import type { TemplateLook } from '@gallery/core/templates';
import type { Layout } from '@gallery/core/types';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, MeshBasicMaterial } from 'three';
import type { Tier } from '../textures/residency.ts';
import { withDim } from './materials.ts';
import { washGeometryData, washStrips } from './wallWash.ts';

/**
 * 공간 v4 전시실 벽 와시(PRD_V2 W-12 ①, M3-4): 코브 아래에서 아래로 사라지는 따뜻한 가산 띠. 보이는 관의 띠를 한
 * 기하로 합쳐 그리기 1회, 실시간 조명 아님. 크게 보기 어둡게(`sceneDim`)를 함께 받는다. 띠 계산은 `wallWash.ts`.
 */
export const WallWash = ({
  layout,
  visibleParts,
  look,
  tier,
}: {
  layout: Layout;
  visibleParts: ReadonlySet<string>;
  look: TemplateLook['wash'];
  /** 품질 단계: 낮음(LOW)도 그대로 그리고 세로 칸만 줄인다(`WALL_WASH.lowRows`) */
  tier: Tier;
}) => {
  const geometry = useMemo(() => {
    const strips = washStrips(layout, visibleParts, look);
    if (strips.length === 0) return null;
    const data = washGeometryData(strips, look, tier);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.positions, 3));
    // 꼭짓점 밝기를 회색 꼭짓점 색으로(재질 색 × 밝기 × 세기, 가산)
    const rgb = new Float32Array(data.shade.length * 3);
    data.shade.forEach((k, i) => rgb.fill(k, i * 3, i * 3 + 3));
    g.setAttribute('color', new BufferAttribute(rgb, 3));
    g.setIndex(new BufferAttribute(data.index, 1));
    g.computeBoundingSphere();
    return g;
  }, [layout, visibleParts, look, tier]);
  const material = useMemo(
    () =>
      withDim(
        new MeshBasicMaterial({
          color: look.color,
          vertexColors: true,
          transparent: true,
          opacity: look.opacity,
          blending: AdditiveBlending,
          depthWrite: false,
          side: DoubleSide,
          toneMapped: false,
        }),
      ),
    [look],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} />;
};
