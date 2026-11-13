import { templateLooks } from '@gallery/core/templates';
import { Color, CustomBlending, DataTexture, OneFactor, OneMinusSrcAlphaFactor, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { artMaterial, lightPoolMaterial, matMaterial } from './materials.ts';

const look = templateLooks['modern-history'];

/** 셰이더 조립(onBeforeCompile)만 돌려 본다 — WebGL 없이 */
const compiled = (m: { onBeforeCompile: (...args: never[]) => void }) => {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '',
    fragmentShader: 'void main() {\n#include <dithering_fragment>\n}',
  };
  (m.onBeforeCompile as (s: unknown, r: unknown) => void)(shader, undefined);
  return shader;
};

/**
 * 투명 배경 PNG(PRD 15.3-3): 작품 면은 투명을 살려 그 뒤 매트(작품마다 매트 색 판)가 비치게 한다.
 * 상주 관리가 올리는 그림은 미리 곱한 알파(ImageBitmap `premultiplyAlpha`)라 섞기도 미리 곱한 식이어야
 * 가장자리가 검게 번지지 않는다(전에 투명 부분이 검게 보이던 결함).
 */
describe('작품 재질', () => {
  it('투명을 살리고, 미리 곱한 알파 그림이면 One · OneMinusSrcAlpha로 섞는다', () => {
    const tex = new Texture();
    tex.premultiplyAlpha = true;
    const m = artMaterial(tex, { value: 1 }, look.art);
    expect(m.transparent).toBe(true);
    expect(m.blending).toBe(CustomBlending);
    expect(m.blendSrc).toBe(OneFactor);
    expect(m.blendDst).toBe(OneMinusSrcAlphaFactor);
    m.dispose();
  });

  it('미리 곱하지 않은 그림은 보통 섞기(그래도 투명)', () => {
    const m = artMaterial(new Texture(), { value: 1 }, look.art);
    expect(m.transparent).toBe(true);
    expect(m.blending).not.toBe(CustomBlending);
    m.dispose();
  });

  it('톤 매핑 없이 제 색으로, 밝기는 가운데(`look.art.center`)에서 가장자리(`edge`)로 — 위아래 치우침 없음(V-57)', () => {
    const m = artMaterial(new Texture(), { value: 1 }, { center: 1, edge: 0.9 });
    expect(m.toneMapped).toBe(false);
    const shader = compiled(m);
    expect(shader.uniforms['uArtCenter']?.value).toBe(1);
    expect(shader.uniforms['uArtEdge']?.value).toBe(0.9);
    expect(shader.fragmentShader).toContain('mix(uArtCenter, uArtEdge');
    // 뒤집은 그림(ImageBitmap)도 같은 프로그램 — 밝기가 가운데 대칭이라 뒤집기와 상관없다
    const flipped = new Texture();
    flipped.repeat.y = -1;
    const m2 = artMaterial(flipped, { value: 1 }, look.art);
    expect(m2.customProgramCacheKey()).toBe(m.customProgramCacheKey());
    m.dispose();
    m2.dispose();
  });
});

describe('매트 재질', () => {
  it('조명·톤 매핑 없이 매트 색 × 밝기(`look.frame.matLight`) — 어두운 방에서 검게 죽지 않게(V-57)', () => {
    const m = matMaterial('#f3eee3', 0.5, { value: 1 });
    expect(m.toneMapped).toBe(false);
    const want = new Color('#f3eee3').multiplyScalar(0.5);
    expect(m.color.r).toBeCloseTo(want.r, 6);
    expect(m.color.b).toBeCloseTo(want.b, 6);
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

  it('모양 텍스처는 세 채널이 같은 회색·불투명 — 채널마다 다른 오차로 색 점이 생기지 않고, 가운데가 가장 밝다(V-57)', () => {
    const m = lightPoolMaterial({ value: 1 });
    const tex = m.map;
    expect(tex).toBeInstanceOf(DataTexture);
    const img = (tex as DataTexture).image as { data: Uint8Array; width: number; height: number };
    const { data, width, height } = img;
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i + 1]).toBe(data[i]);
      expect(data[i + 2]).toBe(data[i]);
      expect(data[i + 3]).toBe(255);
    }
    const at = (x: number, y: number) => data[(y * width + x) * 4]!;
    const cx = width / 2;
    const cy = height / 2;
    expect(at(cx, cy)).toBeGreaterThan(at(cx, cy - height / 4));
    // 위아래 대칭(빛 중심이 가운데)
    expect(at(cx, cy - height / 4)).toBe(at(cx, cy + height / 4 - 1));
    expect(at(0, 0)).toBe(0);
    m.dispose();
  });
});
