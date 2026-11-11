import type { TemplateLook } from '@gallery/core/templates';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { AgXToneMapping, Color, type HemisphereLight, PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { registerAmbience } from './ambience.ts';
import { bakedLight } from './materials.ts';

/**
 * 템플릿 장면 빛(PLAN §6.1·§6.3, ADR-051): 톤 매핑·배경·작은 환경맵·반구광 하나.
 * 실시간 그림자·반사·후처리는 없다(AGENTS.md §4). 벽·천장은 구운 빛이 맡는다(`TemplateModules`).
 */
export const Stage = ({
  look,
  indoor = 1,
}: {
  look: TemplateLook;
  /** 처음 분위기: 1 실내(기본, 관 화면) · 0 광장(자유 관람 시작) — 이후 걷기 화면이 `applyAmbience`로 바꾼다 */
  indoor?: number;
}) => {
  const gl = useThree(s => s.gl);
  const hemi = useRef<HemisphereLight>(null);
  const scene = useThree(s => s.scene);
  const invalidate = useThree(s => s.invalidate);

  useEffect(() => {
    gl.toneMapping = AgXToneMapping;
    scene.background = new Color(look.background);
    // 작은 환경맵: 액자·황동의 광택과 바닥 반사(§6.3). 만든 뒤 방 장면은 바로 버린다.
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    scene.environment = env;
    bakedLight.tint.value.set(look.baked.color);
    bakedLight.hemisphere.value = look.baked.hemisphereScale;
    if (hemi.current) registerAmbience({ gl, scene, hemi: hemi.current, look }, indoor);
    invalidate();
    return () => {
      registerAmbience(null);
      scene.environment = null;
      scene.background = null;
      env.dispose();
    };
    // 처음 값만 쓴다(이후는 걷기 화면이 바꿈)
  }, [gl, scene, invalidate, look]);

  return (
    <hemisphereLight
      ref={hemi}
      args={[look.hemisphere.sky, look.hemisphere.ground, look.hemisphere.intensity]}
    />
  );
};
