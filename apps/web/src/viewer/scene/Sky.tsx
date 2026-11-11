import type { Exterior } from '@gallery/core/types';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BackSide,
  CanvasTexture,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
} from 'three';
import { withDim } from './materials.ts';

/**
 * 미술관 바깥(ADR-057): 하늘 공과 땅(잔디). 하늘은 카메라를 따라다니는 공이라 먼 곳까지 그리지 않아도 하늘이 보인다
 * (카메라 `far` 안쪽 반지름). 실내에서는 벽·천장이 가려 그리지 않는 것과 같다. 실시간 빛을 더하지 않는다.
 */

export interface SkyLook {
  readonly zenith: string;
  readonly horizon: string;
  readonly ground: string;
}

export const DAY_SKY: SkyLook = { zenith: '#8fb4d6', horizon: '#eef1ee', ground: '#6f8452' };

const SKY_RADIUS = 48;
const GROUND_RADIUS = 90;

const skyGeometry = (look: SkyLook): SphereGeometry => {
  const g = new SphereGeometry(SKY_RADIUS, 32, 16);
  const pos = g.getAttribute('position');
  const top = new Color(look.zenith);
  const low = new Color(look.horizon);
  const colors: number[] = [];
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i) / SKY_RADIUS);
    c.copy(low).lerp(top, Math.pow(h, 0.6));
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
};

/** 잔디 질감: 작은 캔버스에 얼룩을 찍어 반복(외부 파일 없음) */
const lawnTexture = (base: string): CanvasTexture => {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 2400; i++) {
      const v = rnd();
      ctx.fillStyle = v < 0.5 ? 'rgba(40,58,30,0.10)' : 'rgba(170,190,120,0.08)';
      ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(GROUND_RADIUS / 2, GROUND_RADIUS / 2);
  t.anisotropy = 4;
  return t;
};

export const Sky = ({ exterior, look = DAY_SKY }: { exterior: Exterior; look?: SkyLook }) => {
  const sky = useRef<Mesh>(null);
  const parts = useMemo(() => {
    const geometry = skyGeometry(look);
    const material = new MeshBasicMaterial({
      vertexColors: true,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    const lawn = lawnTexture(look.ground);
    const groundMaterial = withDim(new MeshStandardMaterial({ map: lawn, roughness: 0.95, metalness: 0 }));
    const ground = new CircleGeometry(GROUND_RADIUS, 48);
    ground.rotateX(-Math.PI / 2);
    return { geometry, material, lawn, groundMaterial, ground };
  }, [look]);
  useEffect(
    () => () => {
      parts.geometry.dispose();
      parts.material.dispose();
      parts.lawn.dispose();
      parts.groundMaterial.dispose();
      parts.ground.dispose();
    },
    [parts],
  );
  // 하늘 공은 카메라 자리를 따라간다(먼 곳까지 늘 하늘)
  useFrame(({ camera }) => {
    sky.current?.position.copy(camera.position);
  });
  const cx = (exterior.plaza.min[0] + exterior.plaza.max[0]) / 2;
  const cz = (exterior.plaza.min[1] + exterior.plaza.max[1]) / 2;
  return (
    <group>
      <mesh
        ref={sky}
        geometry={parts.geometry}
        material={parts.material}
        renderOrder={-10}
        frustumCulled={false}
      />
      {/* 광장 포장 조각 아래로 살짝 — 포장이 없는 곳(나무 둘레)이 잔디 */}
      <mesh
        geometry={parts.ground}
        material={parts.groundMaterial}
        position={[cx, exterior.groundY - 0.02, cz]}
        renderOrder={-5}
      />
    </group>
  );
};
