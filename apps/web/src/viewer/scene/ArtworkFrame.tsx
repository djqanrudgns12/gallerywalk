import { type TemplateLook, templateLooks } from '@gallery/core/templates';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BoxGeometry, type BufferGeometry, MeshStandardMaterial, type Texture } from 'three';
import { coverCrop } from '../textures/coverCrop.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  artMaterial,
  contactShadowMaterial,
  type DimHolder,
  lightPoolMaterial,
  matMaterial,
  type PoolStyle,
  standard,
  withDim,
} from './materials.ts';
import { artPlaneOffsetOf, FRAME_DEPTH, hangOf, outerOf, type ViewerArtwork } from './types.ts';

/**
 * 액자 한 점: 접촉 그림자 → 빛 웅덩이 → 테 → 매트 → 그림 면(PLAN §6.3·§6.4).
 * 실시간 그림자 없이 액자가 벽에 붙어 보이게 하는 것이 접촉 그림자, 스포트 조명 대신이 빛 웅덩이다.
 * P4-2에서는 관 단위로 테·매트를 한 기하로 합치고 `aArtworkIndex`로 줌 대상을 가른다(뼈대는 작품마다 따로).
 * 마우스를 올리면 `onHover`로 알리고, 빛 웅덩이 세기(`boost`)는 바깥(`MicroMotion`)이 `T_HOVER`에 걸쳐 바꾼다(V-40).
 * `fit: cover`(소리 명판 표지)는 그림을 판에 늘이지 않고 가운데를 잘라 채운다.
 * 나무 테는 테 폭(`artwork.frame`)의 `look.frame.faceRatio`만 그리고 나머지는 매트로 채운다 — 바깥 크기·배치는 그대로(V-57).
 */

/** 템플릿 `look` 중 액자가 쓰는 것 */
export type FrameLook = Pick<TemplateLook, 'frame' | 'art'>;

const DEFAULT_LOOK: FrameLook = templateLooks['modern-history'];

export const ArtworkFrame = ({
  artwork,
  holder,
  onTap,
  pool,
  boost,
  onHover,
  look = DEFAULT_LOOK,
}: {
  artwork: ViewerArtwork;
  holder: DimHolder;
  onTap: (id: string) => void;
  /** 빛 웅덩이 모양(템플릿 `look.pool`). 없으면 기본 */
  pool?: PoolStyle | undefined;
  /** 빛 웅덩이 세기 배율(마우스 올림·크게 보기·빛 흔들림). 없으면 1 */
  boost?: DimHolder | undefined;
  /** 실제 마우스 이동의 광선 적중 — 장면에서 한 사건으로 모아 밝힐 작품을 정한다 */
  onHover?: ((id: string, event: PointerEvent) => void) | undefined;
  /** 액자 색·작품 면 밝기(템플릿 `look`). 없으면 근대 역사관 기본 */
  look?: FrameLook | undefined;
}) => {
  const outer = outerOf(artwork);
  const depth = FRAME_DEPTH;
  const hang = hangOf(artwork);
  const easel = artwork.mount === 'EASEL';
  const style = look.frame;
  const light = look.art;
  // 눈에 보이는 나무 테 폭(나머지 테 폭은 매트가 덮는다)
  const face = artwork.frame * style.faceRatio;
  const frameGeometry = useMemo(
    () => buildFrame(outer.w, outer.h, face, depth),
    [outer.w, outer.h, face, depth],
  );
  const materials = useMemo(
    () => ({
      frame: withDim(
        new MeshStandardMaterial({ color: style.wood, roughness: 0.38, metalness: 0.25 }),
        holder,
      ),
      lip: standard({ color: style.lip, roughness: 0.3, metalness: 0.85 }, holder),
      mat: matMaterial(artwork.matColor, style.matLight, holder),
      // 텍스처를 받는 중이면 매트 색 판(빈 벽처럼 보이지 않게, 받으면 바꿔 끼움)
      art: artwork.texture
        ? artMaterial(fitted(artwork.texture, artwork), holder, light)
        : matMaterial(artwork.matColor, style.matLight, holder),
      pool: lightPoolMaterial(holder, pool, boost),
      shadow: contactShadowMaterial(holder),
      back: standard({ color: style.back, roughness: 0.85 }, holder),
    }),
    // `fitted`가 읽는 `fit`·판 크기도 함께 본다
    [
      artwork.matColor,
      artwork.texture,
      artwork.fit,
      artwork.art.w,
      artwork.art.h,
      holder,
      pool,
      boost,
      style,
      light,
    ],
  );
  useEffect(
    () => () => {
      frameGeometry.dispose();
      for (const m of Object.values(materials)) m.dispose();
    },
    [frameGeometry, materials],
  );

  const rotationY = Math.atan2(artwork.normal.x, artwork.normal.z);
  const tap = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onTap(artwork.id);
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (e.pointerType === 'mouse') onHover?.(artwork.id, e.nativeEvent);
  };
  const pointer = { onClick: tap, onPointerMove: move };
  // 나무 테 안쪽(놋쇠 띠·매트가 여기까지 — 배치의 테 폭 중 나무가 덮지 않는 부분도 매트)
  const innerW = outer.w - 2 * face;
  const innerH = outer.h - 2 * face;

  return (
    <group position={[artwork.center.x, artwork.center.y, artwork.center.z]} rotation-y={rotationY}>
      {/* 빛 웅덩이는 벽 회반죽 면에(벽 장식이 가리는 곳은 가려진다). 이젤은 벽이 없어 뒤판으로 막는다 */}
      {!easel && (
        <mesh position={[0, pool?.lift ?? 0.15, 0.003]} material={materials.pool} renderOrder={2}>
          <planeGeometry args={[outer.w * (pool?.scale ?? 1.6), outer.h * (pool?.scale ?? 1.6)]} />
        </mesh>
      )}
      {/* 액자는 벽 장식보다 앞에 건다. 접촉 그림자는 액자 바로 뒤 */}
      <group position={[0, 0, hang]}>
        {easel ? (
          <mesh position={[0, 0, 0.002]} rotation-y={Math.PI} material={materials.back}>
            <planeGeometry args={[outer.w - 0.004, outer.h - 0.004]} />
          </mesh>
        ) : (
          <mesh position={[0, -0.03, -0.004]} material={materials.shadow} renderOrder={1}>
            <planeGeometry args={[outer.w * 1.12, outer.h * 1.12]} />
          </mesh>
        )}
        <mesh geometry={frameGeometry} material={materials.frame} {...pointer} />
        {/* 테 안쪽 황동 띠 */}
        <mesh position={[0, 0, depth - 0.012]} material={materials.lip}>
          <planeGeometry args={[innerW + 0.012, innerH + 0.012]} />
        </mesh>
        <mesh position={[0, 0, depth - 0.008]} material={materials.mat} {...pointer}>
          <planeGeometry args={[innerW, innerH]} />
        </mesh>
        <mesh position={[0, 0, artPlaneOffsetOf(artwork) - hang]} material={materials.art} {...pointer}>
          <planeGeometry args={[artwork.art.w, artwork.art.h]} />
        </mesh>
      </group>
    </group>
  );
};

/** `fit: cover`면 그림 크기와 판 비율로 가운데 자르기를 텍스처 UV 변환에 넣는다(같은 값이면 몇 번 불러도 같음) */
const fitted = (tex: Texture, a: ViewerArtwork): Texture => {
  if (a.fit !== 'cover') return tex;
  const img = tex.image as { width?: unknown; height?: unknown } | null;
  const w = typeof img?.width === 'number' ? img.width : 0;
  const h = typeof img?.height === 'number' ? img.height : 0;
  if (w <= 0 || h <= 0) return tex;
  const crop = coverCrop({ w, h }, a.art, tex.repeat.y < 0);
  tex.repeat.set(crop.repeat[0], crop.repeat[1]);
  tex.offset.set(crop.offset[0], crop.offset[1]);
  return tex;
};

/** 테: 네 변을 상자로 만들어 한 기하로 합친다(그리기 1회). 앞면이 그림 면보다 살짝 앞에 온다. */
const buildFrame = (w: number, h: number, t: number, depth: number): BufferGeometry => {
  const parts: BoxGeometry[] = [];
  const z = depth / 2;
  const top = new BoxGeometry(w, t, depth);
  top.translate(0, h / 2 - t / 2, z);
  const bottom = new BoxGeometry(w, t, depth);
  bottom.translate(0, -h / 2 + t / 2, z);
  const left = new BoxGeometry(t, h - 2 * t, depth);
  left.translate(-w / 2 + t / 2, 0, z);
  const right = new BoxGeometry(t, h - 2 * t, depth);
  right.translate(w / 2 - t / 2, 0, z);
  parts.push(top, bottom, left, right);
  const merged = mergeGeometries(parts) ?? top;
  for (const p of parts) if (p !== merged) p.dispose();
  return merged;
};
