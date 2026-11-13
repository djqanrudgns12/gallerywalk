import { useEffect, useMemo } from 'react';
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
} from 'three';
import { withDim } from '../scene/materials.ts';
import { packSigns, type SignItem, signKeyOf, wrapLines } from './signs.ts';

/**
 * 3D 안 사인 글자(V-03): 보이는 사인 전부를 한 캔버스(아틀라스)에 그리고, 판마다 글자 자리 네모를 한 기하에 모아
 * **그리기 호출 1회**. 판 모양(참나무·놋쇠 틀)은 `FixtureModels`가 `fixtures.glb`로 그린다.
 * 빛은 장면 어둡게(`sceneDim`)만 따른다(실시간 빛 없음). 글은 판 앞면(+Z)에서 `area.z`만큼 앞.
 */

/** 아틀라스 해상도(픽셀/m)와 폭 — 소개판(0.88×1.28m)이 약 350×510px */
const PX_PER_M = 400;
const ATLAS_W = 2048;
const INK = '#2a2219';
const SUB = '#4d4236';
const PAPER = '#f4eddc';
const SERIF = '"Hahmlet", "Noto Serif KR", "AppleMyungjo", serif';
const SANS = '"Pretendard", "Apple SD Gothic Neo", sans-serif';
const PAD = 0.08;
const BODY_LINES = 9;

const drawSign = (
  ctx: CanvasRenderingContext2D,
  s: SignItem,
  r: { x: number; y: number; w: number; h: number },
): void => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  // 이름판·사인은 판 색 그대로(글만), 소개판은 종이 바탕
  if (s.kind === 'introPanel') {
    ctx.fillStyle = PAPER;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  } else ctx.clearRect(r.x, r.y, r.w, r.h);
  const pad = Math.round(Math.min(r.w, r.h) * PAD);
  const maxW = r.w - pad * 2;
  ctx.textBaseline = 'top';
  ctx.fillStyle = s.kind === 'introPanel' ? INK : '#f3e7c8';
  if (s.kind === 'introPanel') {
    let px = Math.round(r.w * 0.11);
    ctx.font = `700 ${px}px ${SERIF}`;
    while (ctx.measureText(s.heading).width > maxW && px > 18) {
      px -= 2;
      ctx.font = `700 ${px}px ${SERIF}`;
    }
    ctx.fillText(s.heading, r.x + pad, r.y + pad, maxW);
    ctx.fillStyle = SUB;
    const bodyPx = Math.round(r.w * 0.06);
    ctx.font = `500 ${bodyPx}px ${SANS}`;
    const lines = wrapLines(s.body, maxW, t => ctx.measureText(t).width, BODY_LINES);
    const top = r.y + pad + px * 1.6;
    lines.forEach((l, i) => ctx.fillText(l, r.x + pad, top + i * bodyPx * 1.55, maxW));
  } else {
    // 한 줄 이름판: 가운데 정렬, 판 높이에 맞춘 글자
    ctx.textAlign = 'center';
    const hasBody = s.body.length > 0;
    let px = Math.round(r.h * (hasBody ? 0.42 : 0.56));
    ctx.font = `700 ${px}px ${SERIF}`;
    while (ctx.measureText(s.heading).width > maxW && px > 14) {
      px -= 2;
      ctx.font = `700 ${px}px ${SERIF}`;
    }
    const cx = r.x + r.w / 2;
    if (hasBody) {
      ctx.fillText(s.heading, cx, r.y + pad * 0.6, maxW);
      const sub = Math.round(px * 0.48);
      ctx.font = `500 ${sub}px ${SANS}`;
      ctx.fillText(s.body, cx, r.y + pad * 0.6 + px * 1.15, maxW);
    } else ctx.fillText(s.heading, cx, r.y + (r.h - px) / 2, maxW);
  }
  ctx.restore();
};

export const SignTexts = ({ items }: { items: readonly SignItem[] }) => {
  const key = signKeyOf(items);
  const parts = useMemo(() => {
    const { rects, height } = packSigns(
      items.map(s => s.area),
      PX_PER_M,
      ATLAS_W,
    );
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) items.forEach((s, i) => drawSign(ctx, s, rects[i]!));
    const atlas = new CanvasTexture(canvas);
    atlas.colorSpace = SRGBColorSpace;
    atlas.anisotropy = 4;
    // 판마다 네모 하나(정점 4·삼각형 2): 판의 오른쪽 = (cos θ, 0, −sin θ), 앞 = (sin θ, 0, cos θ)
    const pos: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    items.forEach((s, i) => {
      const r = rects[i]!;
      const c = Math.cos(s.rotY);
      const n = Math.sin(s.rotY);
      const fx = s.pos[0] + n * s.area.z;
      const fz = s.pos[2] + c * s.area.z;
      const hw = s.area.w / 2;
      const hh = s.area.h / 2;
      const base = i * 4;
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        pos.push(fx + c * hw * sx, s.pos[1] + hh * sy, fz - n * hw * sx);
        const u = (r.x + (sx > 0 ? r.w : 0)) / ATLAS_W;
        const v = 1 - (r.y + (sy > 0 ? 0 : r.h)) / height;
        uv.push(u, v);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    const material = withDim(
      new MeshBasicMaterial({ map: atlas, transparent: true, depthWrite: false, toneMapped: false }),
    );
    const mesh = new Mesh(geo, material);
    return { atlas, geo, material, mesh };
    // key가 같으면(같은 사인들) 다시 만들지 않는다
  }, [key]);
  useEffect(
    () => () => {
      parts.atlas.dispose();
      parts.geo.dispose();
      parts.material.dispose();
    },
    [parts],
  );
  if (items.length === 0) return null;
  return <primitive object={parts.mesh} />;
};
