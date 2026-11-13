import { CustomBlending, OneFactor, OneMinusSrcAlphaFactor, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { artMaterial, lightPoolMaterial } from './materials.ts';

/**
 * 투명 배경 PNG(PRD 15.3-3): 작품 면은 투명을 살려 그 뒤 매트(작품마다 매트 색 판)가 비치게 한다.
 * 상주 관리가 올리는 그림은 미리 곱한 알파(ImageBitmap `premultiplyAlpha`)라 섞기도 미리 곱한 식이어야
 * 가장자리가 검게 번지지 않는다(전에 투명 부분이 검게 보이던 결함).
 */
describe('작품 재질', () => {
  it('투명을 살리고, 미리 곱한 알파 그림이면 One · OneMinusSrcAlpha로 섞는다', () => {
    const tex = new Texture();
    tex.premultiplyAlpha = true;
    const m = artMaterial(tex, { value: 1 });
    expect(m.transparent).toBe(true);
    expect(m.blending).toBe(CustomBlending);
    expect(m.blendSrc).toBe(OneFactor);
    expect(m.blendDst).toBe(OneMinusSrcAlphaFactor);
    m.dispose();
  });

  it('미리 곱하지 않은 그림은 보통 섞기(그래도 투명)', () => {
    const m = artMaterial(new Texture(), { value: 1 });
    expect(m.transparent).toBe(true);
    expect(m.blending).not.toBe(CustomBlending);
    m.dispose();
  });
});

/** 빛 웅덩이 세기(V-40): 마우스 올림·크게 보기·빛 흔들림은 작품마다 `uBoost` 하나로 — 셰이더를 다시 만들지 않는다 */
describe('빛 웅덩이 재질', () => {
  it('작품마다 받은 세기 값을 `uBoost`로 싣고, 장면 어둡게(`uDim`)와 함께 곱한다', () => {
    const dim = { value: 1 };
    const boost = { value: 1.2 };
    const m = lightPoolMaterial(dim, undefined, boost);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '',
      fragmentShader: 'void main() {\n#include <dithering_fragment>\n}',
    };
    m.onBeforeCompile(shader as unknown as Parameters<typeof m.onBeforeCompile>[0], undefined as never);
    expect(shader.uniforms['uBoost']).toBe(boost);
    expect(shader.uniforms['uDim']).toBe(dim);
    expect(shader.fragmentShader).toContain('gl_FragColor.rgb *= uBoost;');
    expect(m.customProgramCacheKey()).toBe('gw-dim-pool');
    m.dispose();
  });
});
