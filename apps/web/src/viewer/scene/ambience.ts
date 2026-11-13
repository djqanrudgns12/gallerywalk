import type { TemplateLook } from '@gallery/core/templates';
import { Color, type HemisphereLight, type Scene, type WebGLRenderer } from 'three';
import { bakedLight } from './materials.ts';

/**
 * 실내·바깥 분위기(look.ts): 0 = 광장 해 질 녘, 1 = 실내(살짝 어둡게). `Stage`가 등록하고, 걷기 화면이 구역에 따라
 * 부드럽게 바꾼다. 노출·반구광(세기·색)·환경맵 세기·구운 빛 색(`outdoor.bakedTint` ↔ `baked.color`)을 바꾼다 —
 * 작품 면·빛 웅덩이·정문 안쪽 빛은 톤 매핑을 받지 않아 그대로라, 주변이 어두울수록 그쪽이 또렷해진다.
 */

interface Target {
  readonly gl: WebGLRenderer;
  readonly scene: Scene;
  readonly hemi: HemisphereLight;
  readonly look: TemplateLook;
}

let target: Target | null = null;
let current = 1;
const tmp = new Color();
const tmp2 = new Color();

export const registerAmbience = (t: Target | null, initial = current): void => {
  target = t;
  if (t) applyAmbience(initial, true);
};

export const ambienceLevel = (): number => current;

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** k: 0(바깥)..1(실내) */
export const applyAmbience = (kIn: number, force = false): void => {
  const k = Math.max(0, Math.min(1, kIn));
  if (!force && Math.abs(k - current) < 1e-4) return;
  current = k;
  const t = target;
  if (!t) return;
  const o = t.look.outdoor;
  const i = t.look;
  t.gl.toneMappingExposure = lerp(o.exposure, i.exposure, k);
  t.scene.environmentIntensity = lerp(o.environment, i.environment, k);
  t.hemi.intensity = lerp(o.hemisphere.intensity, i.hemisphere.intensity, k);
  t.hemi.color.copy(tmp.set(o.hemisphere.sky).lerp(tmp2.set(i.hemisphere.sky), k));
  t.hemi.groundColor.copy(tmp.set(o.hemisphere.ground).lerp(tmp2.set(i.hemisphere.ground), k));
  bakedLight.tint.value.copy(tmp.set(o.bakedTint).lerp(tmp2.set(i.baked.color), k));
};
