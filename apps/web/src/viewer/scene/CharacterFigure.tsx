import { config } from '@gallery/core/config';
import type { CharacterId } from '@gallery/core/types';
import { useFrame } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import {
  CapsuleGeometry,
  type Group,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  BoxGeometry,
} from 'three';
import { withDim } from './materials.ts';

/**
 * 관람객 캐릭터(ADR-057). 지금은 **임시 모형**(개념 그림 `.local/art/r4/`의 색·비율을 딴 단순 입체 + 손발 흔들기)이고,
 * R-4(이미지→3D·리깅·애니메이션) 결과 glb가 오면 같은 `CharacterHandle`로 바꿔 끼운다.
 * 바깥(걷기 엔진)이 매 프레임 `pose`를 넘기면 위치·방향·걸음 흔들기를 맞춘다. 실시간 그림자는 없다 — 발밑 동그란 그늘만.
 */

export interface FigurePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** m/s — 걸음 흔들기 빠르기 */
  speed: number;
  /** 0..1 — 카메라가 아주 가까우면 흐리게(머리 속이 보이지 않게) */
  opacity: number;
  /** 점프로 바닥 위에 뜬 높이(m) — `y`에 이미 더해져 있음. 발밑 그늘은 바닥에 남긴다 */
  air: number;
  /** 벽에 부딪힌 직후 1 → 0(움찔·납작) */
  bump: number;
  /** 손 흔들기 번호 — 바뀔 때마다 한 번 흔든다(glb에 `wave`가 있을 때) */
  wave: number;
}

/** 새 손잡이의 처음 값 */
export const restPose = (): FigurePose => ({
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  speed: 0,
  opacity: 1,
  air: 0,
  bump: 0,
  wave: 0,
});

/** 부딪힘 움찔: 세로로 살짝 납작·뒤로 젖힘(0..1 세기) */
export const bumpSquash = (bump: number): { sy: number; sxz: number; tilt: number } => {
  const k = Math.sin(Math.min(1, bump) * Math.PI);
  return { sy: 1 - 0.08 * k, sxz: 1 + 0.05 * k, tilt: -0.18 * k };
};

export interface CharacterHandle {
  readonly pose: FigurePose;
}

interface Palette {
  readonly top: string;
  readonly bottom: string;
  readonly hair: string;
  readonly shoe: string;
  readonly skirt: boolean;
  readonly bun: boolean;
}

const PALETTE: Readonly<Record<CharacterId, Palette>> = {
  'student-m': {
    top: '#1f2f55',
    bottom: '#8f7f6d',
    hair: '#4a2f22',
    shoe: '#ece4d2',
    skirt: false,
    bun: false,
  },
  'student-f': {
    top: '#6e1f2c',
    bottom: '#1f2a4d',
    hair: '#3d2a20',
    shoe: '#ece4d2',
    skirt: true,
    bun: false,
  },
  'teacher-m': {
    top: '#4c5a2a',
    bottom: '#4a4a4a',
    hair: '#3a2a20',
    shoe: '#6b4226',
    skirt: false,
    bun: false,
  },
  'teacher-f': {
    top: '#c99a2e',
    bottom: '#1f2a4d',
    hair: '#3d2a20',
    shoe: '#6b4226',
    skirt: false,
    bun: true,
  },
};

const STRIDE_M = 0.5;

export const CharacterFigure = forwardRef<CharacterHandle, { character: CharacterId }>(
  ({ character }, ref) => {
    const pose = useRef<FigurePose>(restPose()).current;
    useImperativeHandle(ref, () => ({ pose }), [pose]);
    const root = useRef<Group>(null);
    const legL = useRef<Group>(null);
    const legR = useRef<Group>(null);
    const armL = useRef<Group>(null);
    const armR = useRef<Group>(null);
    const body = useRef<Group>(null);
    const shadeRef = useRef<Mesh>(null);
    const phase = useRef(0);

    const isTeacher = character.startsWith('teacher');
    const h = isTeacher ? config().CHAR_HEIGHT_M.teacher : config().CHAR_HEIGHT_M.student;
    const p = PALETTE[character];
    // 비율: 학생은 머리가 키의 약 0.36(3등신 남짓), 선생님은 0.3
    const headR = h * (isTeacher ? 0.15 : 0.18);
    const legLen = h * (isTeacher ? 0.4 : 0.3);
    const torso = h - legLen - headR * 2;

    const mats = useMemo(() => {
      const m = (color: string, rough = 0.7): MeshStandardMaterial =>
        withDim(new MeshStandardMaterial({ color, roughness: rough, metalness: 0, transparent: true }));
      return {
        skin: m('#f1c9a5', 0.55),
        hair: m(p.hair, 0.5),
        top: m(p.top),
        bottom: m(p.bottom),
        shoe: m(p.shoe, 0.6),
        eye: m('#241a14', 0.3),
        shade: new MeshStandardMaterial({
          color: '#000000',
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
        }),
      };
    }, [p]);
    const geos = useMemo(
      () => ({
        head: new SphereGeometry(headR, 28, 20),
        hair: new SphereGeometry(headR * 1.06, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.58),
        bun: new SphereGeometry(headR * 0.42, 16, 12),
        eye: new SphereGeometry(headR * 0.1, 10, 8),
        torso: new CapsuleGeometry(h * 0.13, Math.max(0.01, torso - h * 0.2), 6, 16),
        skirt: new CapsuleGeometry(h * 0.17, h * 0.04, 4, 16),
        leg: new CapsuleGeometry(h * 0.055, Math.max(0.01, legLen - h * 0.11), 4, 10),
        arm: new CapsuleGeometry(h * 0.045, torso * 0.62, 4, 10),
        hand: new SphereGeometry(h * 0.05, 12, 10),
        shoe: new BoxGeometry(h * 0.1, h * 0.05, h * 0.16),
        shade: new SphereGeometry(h * 0.24, 20, 6),
      }),
      [h, headR, torso, legLen],
    );
    useEffect(
      () => () => {
        for (const g of Object.values(geos)) g.dispose();
        for (const m of Object.values(mats)) (m as Material).dispose();
      },
      [geos, mats],
    );

    useFrame((_, dt) => {
      const g = root.current;
      if (!g) return;
      g.position.set(pose.x, pose.y, pose.z);
      g.rotation.y = pose.yaw;
      const walk = Math.min(1, pose.speed / config().CHAR_WALK_MPS);
      phase.current += (pose.speed * dt * Math.PI * 2) / (STRIDE_M * 2);
      const s = Math.sin(phase.current) * 0.55 * walk;
      if (legL.current) legL.current.rotation.x = s;
      if (legR.current) legR.current.rotation.x = -s;
      if (armL.current) armL.current.rotation.x = -s * 0.8;
      if (armR.current) armR.current.rotation.x = s * 0.8;
      if (body.current) body.current.position.y = Math.abs(Math.cos(phase.current)) * 0.025 * walk;
      // 점프: 다리를 접고 팔을 든다 / 부딪힘: 움찔
      const up = Math.min(1, pose.air / 0.25);
      if (up > 0) {
        if (legL.current) legL.current.rotation.x = -0.7 * up;
        if (legR.current) legR.current.rotation.x = 0.35 * up;
        if (armL.current) armL.current.rotation.x = -2.2 * up;
        if (armR.current) armR.current.rotation.x = -2.2 * up;
      }
      const sq = bumpSquash(pose.bump);
      g.scale.set(sq.sxz, sq.sy, sq.sxz);
      g.rotation.order = 'YXZ';
      g.rotation.x = sq.tilt;
      const sh = shadeRef.current;
      if (sh) {
        sh.position.y = 0.01 - pose.air;
        const k = 1 - Math.min(0.5, pose.air);
        sh.scale.set(k, 0.02, k);
      }
      for (const [k, m] of Object.entries(mats)) {
        if (k === 'shade') continue;
        (m as MeshStandardMaterial).opacity = pose.opacity;
        (m as MeshStandardMaterial).depthWrite = pose.opacity > 0.99;
      }
    });

    const hipY = legLen;
    const shoulderY = legLen + torso * 0.92;
    const headY = legLen + torso + headR * 0.92;
    const legX = h * 0.07;
    const armX = h * 0.17;
    return (
      <group ref={root}>
        <mesh
          ref={shadeRef}
          geometry={geos.shade}
          material={mats.shade}
          scale={[1, 0.02, 1]}
          position={[0, 0.01, 0]}
          renderOrder={2}
        />
        <group ref={body}>
          {([legL, legR] as const).map((r, i) => (
            <group key={i} ref={r} position={[i === 0 ? legX : -legX, hipY, 0]}>
              <mesh geometry={geos.leg} material={mats.bottom} position={[0, -legLen / 2, 0]} />
              <mesh geometry={geos.shoe} material={mats.shoe} position={[0, -legLen + h * 0.025, h * 0.03]} />
            </group>
          ))}
          {p.skirt && (
            <mesh geometry={geos.skirt} material={mats.bottom} position={[0, hipY + h * 0.02, 0]} />
          )}
          <mesh geometry={geos.torso} material={mats.top} position={[0, hipY + torso / 2, 0]} />
          {([armL, armR] as const).map((r, i) => (
            <group
              key={i}
              ref={r}
              position={[i === 0 ? armX : -armX, shoulderY, 0]}
              rotation-z={i === 0 ? -0.28 : 0.28}
            >
              <mesh geometry={geos.arm} material={mats.top} position={[0, -torso * 0.36, 0]} />
              <mesh geometry={geos.hand} material={mats.skin} position={[0, -torso * 0.72, 0]} />
            </group>
          ))}
          <group position={[0, headY, 0]}>
            <mesh geometry={geos.head} material={mats.skin} />
            <mesh
              geometry={geos.hair}
              material={mats.hair}
              position={[0, headR * 0.06, -headR * 0.06]}
              rotation-x={-0.35}
            />
            {p.bun && (
              <mesh geometry={geos.bun} material={mats.hair} position={[0, headR * 0.1, -headR * 1.0]} />
            )}
            {[-1, 1].map(sx => (
              <mesh
                key={sx}
                geometry={geos.eye}
                material={mats.eye}
                position={[sx * headR * 0.36, -headR * 0.05, headR * 0.92]}
              />
            ))}
          </group>
        </group>
      </group>
    );
  },
);
CharacterFigure.displayName = 'CharacterFigure';
