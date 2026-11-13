import { config } from '@gallery/core/config';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { Tier } from '../textures/residency.ts';
import { useWalk } from '../walk/walkStore.ts';
import { ambienceLevel } from './ambience.ts';
import { type DimHolder, sceneDim } from './materials.ts';
import { dustCountOf, type GlowState, glowStep, glowWant, microLevelStep, shimmerOf } from './microMotion.ts';

/**
 * 연출 조종(V-40): 빛 웅덩이 세기(마우스 올림 `T_HOVER` · 크게 보기 `ZOOM_POOL_BOOST` · 빛 흔들림)와 먼지 입자.
 * - 먼지·빛 흔들림은 카메라가 움직이는 동안과 멈춘 뒤 `MICRO_MOTION_SETTLE_SEC`까지만, 실내에서만(ADR-013).
 *   '낮음'·동작 줄이기에서는 끈다(PRD 10.4·8.4). 다 끝나면 먼지를 숨기고(그리기 호출 0) 다시 그리기를 부르지 않는다.
 * - 먼지는 점 하나 묶음(그리기 1회): 카메라 둘레 상자 안에서 셰이더가 자리를 되풀이한다(CPU는 값 몇 개만 바꿈).
 * 카메라를 누가 몰든(걷기·투어·미리 보기) 카메라가 움직였는지만 본다.
 */

export interface MicroMotionProps {
  /** 작품 ID → 빛 웅덩이 세기(액자 재질 `uBoost`) */
  readonly boosts: Readonly<Record<string, DimHolder>>;
  /** 지금 마우스가 올라간 작품 */
  readonly hovered: () => string | null;
  readonly tier: Tier;
  readonly reducedMotion: boolean;
  /** 먼지 빛 색(템플릿 빛 웅덩이 색) */
  readonly color: string;
}

/** 작품마다 빛 흔들림 위상을 고르게 흩는다(황금각) */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export const MicroMotion = ({ boosts, hovered, tier, reducedMotion, color }: MicroMotionProps) => {
  const invalidate = useThree(s => s.invalidate);
  const gl = useThree(s => s.gl);
  const zoomId = useWalk(st => (st.mode === 'zoom' ? st.zoomId : null));
  const enabled = tier !== 'LOW' && !reducedMotion;
  const count = dustCountOf(tier, reducedMotion);
  const dust = useMemo(() => (count > 0 ? makeDust(count, color) : null), [count, color]);
  const st = useRef({
    level: 0,
    lastMoveAt: Number.NEGATIVE_INFINITY,
    t: 0,
    primed: false,
    animating: false,
    glow: new Map<string, GlowState>(),
    pos: new Vector3(),
    quat: new Quaternion(),
  });

  // 크게 보기가 바뀌면 빛 웅덩이를 움직이기 시작한다(마우스 올림은 액자가 깨운다)
  useEffect(() => invalidate(), [zoomId, invalidate]);
  useEffect(
    () => () => {
      dust?.points.geometry.dispose();
      dust?.material.dispose();
    },
    [dust],
  );
  useEffect(
    () => () => {
      for (const b of Object.values(boosts)) b.value = 1;
    },
    [boosts],
  );

  useFrame((state, dtIn) => {
    const c = config();
    const s = st.current;
    // 첫 프레임 이전의 정지 시간만 제외하고, 진행 중인 연출은 실제 경과 시간을 모두 쓴다.
    const dt = s.animating ? dtIn : 0;
    const now = state.clock.elapsedTime;
    const cam = state.camera;
    if (!s.primed) {
      s.pos.copy(cam.position);
      s.quat.copy(cam.quaternion);
      s.primed = true;
    } else if (
      s.pos.distanceToSquared(cam.position) > 1e-8 ||
      1 - Math.abs(s.quat.dot(cam.quaternion)) > 1e-10
    ) {
      s.lastMoveAt = now;
      s.pos.copy(cam.position);
      s.quat.copy(cam.quaternion);
    }
    const sinceMoveSec = s.lastMoveAt === now ? 0 : now - s.lastMoveAt;
    s.level = microLevelStep(s.level, { enabled, sinceMoveSec, dt });
    if (s.level > 0) s.t += dt;
    const indoor = ambienceLevel();
    const amount = s.level * indoor;

    // 빛 웅덩이: 밝히기(바라는 값까지) × 빛 흔들림(작은 움직임 세기만큼)
    const hoverId = hovered();
    const amp = c.MICRO_MOTION.shimmerAmp * amount;
    let glowing = false;
    let i = 0;
    for (const [id, holder] of Object.entries(boosts)) {
      const want = glowWant(id, { zoomId, hoverId });
      const next = glowStep(s.glow.get(id), want, { dt, zooming: zoomId === id, reducedMotion });
      if (next.transition !== null) glowing = true;
      if (next.value === 1 && next.transition === null) s.glow.delete(id);
      else s.glow.set(id, next);
      holder.value = next.value * shimmerOf(s.t, i * GOLDEN, amp, c.MICRO_MOTION);
      i++;
    }

    if (dust) {
      dust.points.visible = amount > 0;
      if (amount > 0) {
        const u = dust.material.uniforms;
        (u['uCam']!.value as Vector3).copy(cam.position);
        u['uTime']!.value = s.t;
        u['uLevel']!.value = amount;
        u['uPixel']!.value = gl.getPixelRatio();
      }
    }
    s.animating = glowing || s.level > 0;
    if (s.animating) invalidate();
  });

  return dust ? <primitive object={dust.points} /> : null;
};

/** 자리는 카메라 둘레 상자 안에서 되풀이, 상자 끝(되풀이되는 곳)과 눈앞 아주 가까운 곳은 흐리게(`vFade`) */
const VERTEX = /* glsl */ `
uniform vec3 uCam;
uniform float uTime;
uniform float uBox;
uniform float uSize;
uniform float uPixel;
uniform float uDrift;
uniform vec3 uWobbleRate;
uniform vec2 uWobblePhase;
uniform vec3 uDriftDirection;
uniform vec2 uFadeBoxRatio;
uniform vec2 uNearFade;
uniform float uMinDepth;
attribute float aSeed;
varying float vFade;
void main() {
  float tau = 6.2831853;
  vec3 wobble = vec3(sin(uTime * uWobbleRate.x + aSeed * tau), sin(uTime * uWobbleRate.y + aSeed * uWobblePhase.x), cos(uTime * uWobbleRate.z + aSeed * uWobblePhase.y));
  vec3 p = position + uDriftDirection * uDrift * uTime + wobble * uDrift;
  vec3 rel = mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
  float d = length(rel);
  vFade = (1.0 - smoothstep(uFadeBoxRatio.x * uBox, uFadeBoxRatio.y * uBox, d)) * smoothstep(uNearFade.x, uNearFade.y, -mv.z);
  gl_PointSize = uSize * uPixel / max(uMinDepth, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
uniform float uOpacity;
uniform float uDim;
varying float vFade;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  gl_FragColor = vec4(uColor, a * a * vFade * uLevel * uOpacity * uDim);
}
`;

interface Dust {
  readonly points: Points;
  readonly material: ShaderMaterial;
}

/** 먼지 묶음: 자리는 상자 안에 고르게(정해진 순서의 준난수 — 매번 같은 모양), 깜빡임 위상 하나씩 */
const makeDust = (count: number, hex: string): Dust => {
  const c = config().MICRO_MOTION;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  // 축마다 다른 무리수 배수(가법 순환열) — 뭉치지 않고 고르게 흩어진다
  const step = [0.7548776662, 0.569840291, 0.4142135624] as const;
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = (((i + 1) * step[k]!) % 1) * c.dustBoxM;
    seed[i] = ((i + 1) * 0.6180339887) % 1;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
  const material = new ShaderMaterial({
    uniforms: {
      uCam: { value: new Vector3() },
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uPixel: { value: 1 },
      uBox: { value: c.dustBoxM },
      uSize: { value: c.dustSizePx },
      uOpacity: { value: c.dustOpacity },
      uDrift: { value: c.dustDriftMps },
      uWobbleRate: { value: new Vector3(...c.dustWobbleRadPerSec) },
      uWobblePhase: { value: new Vector2(...c.dustWobbleSeedPhaseRad) },
      uDriftDirection: { value: new Vector3(...c.dustDriftDirection) },
      uFadeBoxRatio: { value: new Vector2(...c.dustFadeBoxRatio) },
      uNearFade: { value: new Vector2(...c.dustNearFadeM) },
      uMinDepth: { value: c.dustMinDepthM },
      uColor: { value: new Color(hex).convertLinearToSRGB() },
      uDim: sceneDim,
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 4;
  // 누르기·마우스 올림 광선에 걸리지 않게
  points.raycast = () => undefined;
  return { points, material };
};
