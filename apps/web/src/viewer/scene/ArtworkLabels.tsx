import { useEffect, useMemo } from 'react';
import {
  CanvasTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
} from 'three';
import { bakedLight } from './materials.ts';

/**
 * 작품 명판(PLAN §4.5 `labels`, 미술관 느낌 — ADR-057): 액자 옆 벽(이젤은 받침 아래)의 작은 판에 제목·작가.
 * 보이는 명판 전부를 한 캔버스(아틀라스)에 그리고 벽에 붙은 네모를 인스턴스로 — 그리기 호출 1회.
 * 빛은 구운 실내와 어울리게 장면 어둡게(`sceneDim`)·구운 빛 색만 곱한다(실시간 빛 없음).
 */

export interface LabelItem {
  readonly artworkId: string;
  readonly pos: readonly [number, number, number];
  readonly normal: readonly [number, number];
  readonly title: string;
  readonly author: string;
  /** 셋째 줄(이어서 보기·쪽 수, V-23). 빈 글이면 그리지 않음 */
  readonly note?: string | undefined;
}

const SLOT_W = 512;
const SLOT_H = 256;
const COLS = 4;
const MAX = 48;
/** 판 크기(m) */
const PLATE_W = 0.3;
const PLATE_H = 0.15;
/** 벽에서 띄우는 거리(m) */
const LIFT = 0.012;

const drawPlate = (ctx: CanvasRenderingContext2D, i: number, item: LabelItem): void => {
  const x = (i % COLS) * SLOT_W;
  const y = Math.floor(i / COLS) * SLOT_H;
  ctx.fillStyle = '#f6f1e6';
  ctx.fillRect(x, y, SLOT_W, SLOT_H);
  ctx.strokeStyle = '#cbbd9f';
  ctx.lineWidth = 4;
  ctx.strokeRect(x + 2, y + 2, SLOT_W - 4, SLOT_H - 4);
  ctx.fillStyle = '#1e1b18';
  ctx.textBaseline = 'top';
  let px = 50;
  const title = (size: number) => `700 ${size}px "Hahmlet", "Noto Serif KR", "AppleMyungjo", serif`;
  ctx.font = title(px);
  while (ctx.measureText(item.title).width > SLOT_W - 56 && px > 26) {
    px -= 2;
    ctx.font = title(px);
  }
  ctx.fillText(item.title, x + 28, y + 40, SLOT_W - 56);
  ctx.fillStyle = '#564d42';
  ctx.font = `500 34px "Pretendard", "Apple SD Gothic Neo", sans-serif`;
  ctx.fillText(item.author, x + 28, y + 40 + px + 26, SLOT_W - 56);
  if (item.note) {
    ctx.fillStyle = '#7a5a2a';
    ctx.font = `700 30px "Pretendard Variable", "Pretendard", "Apple SD Gothic Neo", sans-serif`;
    ctx.fillText(item.note, x + 28, y + SLOT_H - 58, SLOT_W - 56);
  }
};

export const ArtworkLabels = ({ items }: { items: readonly LabelItem[] }) => {
  const shown = items.slice(0, MAX);
  const key = shown.map(i => `${i.artworkId}:${i.title}:${i.author}:${i.note ?? ''}`).join('|');
  const parts = useMemo(() => {
    const rows = Math.ceil(MAX / COLS);
    const canvas = document.createElement('canvas');
    canvas.width = COLS * SLOT_W;
    canvas.height = rows * SLOT_H;
    const ctx = canvas.getContext('2d');
    if (ctx) shown.forEach((item, i) => drawPlate(ctx, i, item));
    const atlas = new CanvasTexture(canvas);
    atlas.colorSpace = SRGBColorSpace;
    atlas.anisotropy = 4;
    const quad = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const center = new Float32Array(MAX * 3);
    const normal = new Float32Array(MAX * 2);
    const slot = new Float32Array(MAX);
    shown.forEach((item, i) => {
      center.set(
        [item.pos[0] + item.normal[0] * LIFT, item.pos[1], item.pos[2] + item.normal[1] * LIFT],
        i * 3,
      );
      normal.set([item.normal[0], item.normal[1]], i * 2);
      slot[i] = i;
    });
    geo.setAttribute('aCenter', new InstancedBufferAttribute(center, 3));
    geo.setAttribute('aNormal', new InstancedBufferAttribute(normal, 2));
    geo.setAttribute('aSlot', new InstancedBufferAttribute(slot, 1));
    geo.instanceCount = shown.length;
    // 정점: 판의 오른쪽 = cross(위, 법선) — 벽을 바라볼 때 오른쪽(글이 뒤집히지 않음)
    const material = new ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas },
        uCols: { value: COLS },
        uRows: { value: rows },
        uSize: { value: [PLATE_W, PLATE_H] },
        uTint: bakedLight.tint,
      },
      vertexShader: /* glsl */ `
        attribute vec3 aCenter;
        attribute vec2 aNormal;
        attribute float aSlot;
        uniform float uCols;
        uniform float uRows;
        uniform vec2 uSize;
        varying vec2 vUv;
        void main() {
          vec3 n = vec3(aNormal.x, 0.0, aNormal.y);
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), n));
          vec3 p = aCenter + right * position.x * uSize.x + vec3(0.0, position.y * uSize.y, 0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          float col = mod(aSlot, uCols);
          float row = floor(aSlot / uCols);
          vUv = vec2((col + uv.x) / uCols, 1.0 - (row + 1.0 - uv.y) / uRows);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform vec3 uTint;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(uAtlas, vUv);
          gl_FragColor = vec4(c.rgb * mix(vec3(1.0), uTint, 0.35), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new Mesh(geo, material);
    mesh.frustumCulled = false;
    return { atlas, quad, geo, material, mesh };
    // key가 같으면(같은 명판들) 다시 만들지 않는다 — `shown`은 key에서 정해짐
  }, [key]);
  useEffect(
    () => () => {
      parts.atlas.dispose();
      parts.quad.dispose();
      parts.geo.dispose();
      parts.material.dispose();
    },
    [parts],
  );
  if (shown.length === 0) return null;
  return <primitive object={parts.mesh} />;
};
