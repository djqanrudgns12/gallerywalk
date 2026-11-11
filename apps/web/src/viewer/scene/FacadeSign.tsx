import { facadeTitle } from '@gallery/core/copy';
import type { Fixture } from '@gallery/core/types';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, MeshStandardMaterial, SRGBColorSpace } from 'three';
import { withDim } from './materials.ts';

/**
 * 미술관 정면 이름판 "{전시명} 전시관"(ADR-057). 현관 엔타블러처의 비워 둔 띠(y 4.3~5.1)에 청동 글자처럼 얹는다.
 * 전시명이 이미 '전시관·미술관·박물관·전시회·갤러리'로 끝나면 그대로 쓴다.
 */

export { facadeTitle };

/** 띠 크기(m): 현관 폭 12m 안, 글자 높이 ≈ 0.5m */
const SIGN_W = 8.4;
const SIGN_H = 0.78;
const PX_PER_M = 300;

const signTexture = (text: string): CanvasTexture => {
  const w = Math.round(SIGN_W * PX_PER_M);
  const h = Math.round(SIGN_H * PX_PER_M);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    let px = Math.round(h * 0.62);
    const font = (size: number) => `700 ${size}px "Hahmlet", "Noto Serif KR", "AppleMyungjo", serif`;
    ctx.font = font(px);
    // 띠를 넘으면 줄인다(긴 전시명)
    while (ctx.measureText(text).width > w * 0.94 && px > h * 0.25) {
      px -= 4;
      ctx.font = font(px);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 새긴 글자: 아래쪽 밝은 테(빛 받는 모서리) + 어두운 청동 면
    ctx.fillStyle = 'rgba(255,248,232,0.55)';
    ctx.fillText(text, w / 2, h / 2 + px * 0.04);
    ctx.fillStyle = '#4a3a24';
    ctx.fillText(text, w / 2, h / 2);
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};

export const FacadeSign = ({ fixture, title }: { fixture: Fixture; title: string }) => {
  const text = facadeTitle(title);
  const parts = useMemo(() => {
    const map = signTexture(text);
    const material = withDim(
      new MeshStandardMaterial({
        map,
        transparent: true,
        roughness: 0.45,
        metalness: 0.55,
        depthWrite: false,
      }),
    );
    return { map, material };
  }, [text]);
  useEffect(
    () => () => {
      parts.map.dispose();
      parts.material.dispose();
    },
    [parts],
  );
  return (
    <mesh
      position={[fixture.pos[0], fixture.pos[1], fixture.pos[2]]}
      rotation-y={fixture.rotY}
      material={parts.material}
      renderOrder={3}
    >
      <planeGeometry args={[SIGN_W, SIGN_H]} />
    </mesh>
  );
};
