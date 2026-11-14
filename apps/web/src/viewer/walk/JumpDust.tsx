import { config } from '@gallery/core/config';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { type InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { blobShadowMaterial } from '../scene/materials.ts';
import type { DustCue } from './jumpPose.ts';

/**
 * 착지 먼지(PRD_V2 W-05): 인스턴스 판 하나(그리기 +1)에 부드러운 원 조각 `JUMP_DUST.count`개가 발밑에서 바깥으로 퍼지며 옅어진다.
 * 걷기 화면이 내려앉을 때 `cue.n`을 올리고 그 자리를 적는다. 보일 때만 그리고, 보이는 동안만 스스로 다음 장면을 부른다
 * (멈추면 다시 그리지 않는 장면, `frameloop="demand"`). 동작 줄이기면 걷기 화면이 `cue`를 올리지 않는다.
 */

/** 지난 비율 u(0..1)의 먼지 모양: 가운데에서 조각까지 거리·조각 지름·짙기 */
export const dustFrame = (u: number): { r: number; size: number; opacity: number } => {
  const d = config().JUMP_DUST;
  const k = Math.min(1, Math.max(0, u));
  const out = 1 - (1 - k) * (1 - k);
  return {
    r: d.radiusM * out,
    size: d.radiusM * (d.puffFrom + (d.puffTo - d.puffFrom) * out),
    opacity: d.opacity * (1 - k),
  };
};

const m4 = new Matrix4();
const q0 = new Quaternion();
const vp = new Vector3();
const vs = new Vector3();

export const JumpDust = ({ cue }: { cue: DustCue }) => {
  const invalidate = useThree(s => s.invalidate);
  const mesh = useRef<InstancedMesh>(null);
  const [parts] = useState(() => {
    const material = blobShadowMaterial(config().JUMP_DUST.opacity);
    material.color.set(config().JUMP_DUST.color);
    return {
      material,
      geometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      count: config().JUMP_DUST.count,
    };
  });
  const st = useRef({ seen: cue.n, t: Number.POSITIVE_INFINITY, x: 0, y: 0, z: 0 }).current;
  useEffect(
    () => () => {
      parts.geometry.dispose();
      parts.material.dispose();
    },
    [parts],
  );
  useFrame((_, dtIn) => {
    const m = mesh.current;
    if (!m) return;
    const c = config();
    if (cue.n !== st.seen) {
      st.seen = cue.n;
      st.t = 0;
      st.x = cue.x;
      st.y = cue.y;
      st.z = cue.z;
    }
    if (st.t >= c.JUMP_DUST.sec) {
      if (m.visible) m.visible = false;
      return;
    }
    // 멈춰 있던 장면을 깨운 첫 프레임의 긴 시간은 한 조각만큼만
    st.t += Math.min(Math.max(0, dtIn), c.WALK_PHYSICS_STEP_SEC);
    const f = dustFrame(st.t / c.JUMP_DUST.sec);
    for (let i = 0; i < parts.count; i++) {
      const a = (2 * Math.PI * i) / parts.count;
      vp.set(st.x + Math.cos(a) * f.r, st.y + config().JUMP_DUST.liftM, st.z + Math.sin(a) * f.r);
      vs.set(f.size, 1, f.size);
      m.setMatrixAt(i, m4.compose(vp, q0, vs));
    }
    m.instanceMatrix.needsUpdate = true;
    parts.material.opacity = f.opacity;
    m.visible = st.t < c.JUMP_DUST.sec;
    invalidate();
  });
  return (
    <instancedMesh
      ref={mesh}
      args={[parts.geometry, parts.material, parts.count]}
      visible={false}
      frustumCulled={false}
      renderOrder={2}
    />
  );
};
