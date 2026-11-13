import { config } from '@gallery/core/config';
import { useEffect, useMemo } from 'react';
import { Mesh, PlaneGeometry, ShaderMaterial } from 'three';

/**
 * 아주 약한 가장자리 어둡게(PRD 10.3 "후처리 효과는 톤 매핑과 아주 약한 가장자리 어둡게만", V-40).
 * 후처리 단계를 따로 두지 않고 화면을 덮는 판 하나를 맨 마지막에 그린다(그리기 1회, 깊이 보지 않음).
 * 장면이 그려질 때만 함께 그려지므로 정지 상태 다시 그리기는 늘지 않는다. 세기 0('낮음')이면 붙이지 않는다.
 */

/** 맨 마지막(투명한 것 가운데서도 뒤) */
const LAST = 1000;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uStrength;
uniform float uInner;
uniform float uOuter;
varying vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * 2.0);
  gl_FragColor = vec4(0.0, 0.0, 0.0, uStrength * smoothstep(uInner, uOuter, r));
}
`;

export const Vignette = ({ strength }: { strength: number }) => {
  const mesh = useMemo(() => {
    const material = new ShaderMaterial({
      uniforms: {
        uStrength: { value: 0 },
        uInner: { value: config().VIGNETTE.inner },
        uOuter: { value: Math.SQRT2 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const m = new Mesh(new PlaneGeometry(2, 2), material);
    m.frustumCulled = false;
    m.renderOrder = LAST;
    m.raycast = () => undefined;
    return m;
  }, []);
  mesh.material.uniforms['uStrength']!.value = strength;
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
    [mesh],
  );
  return strength > 0 ? <primitive object={mesh} /> : null;
};
