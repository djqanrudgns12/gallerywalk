import { config } from '@gallery/core/config';
import type { FrameAnchor, Vec3 } from '@gallery/core/layout';
import type { Texture } from 'three';

/**
 * 관람 엔진이 그리는 작품 한 점(P1-4 뼈대). P2에서는 배치 엔진의 `FramePlacement`와 미디어 주소로 채워진다.
 * 크기는 모두 m. 바깥 크기 = 그림 + 2×매트 + 2×테.
 */
export interface ViewerArtwork {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly caption: string;
  /**
   * 3D 벽용 텍스처(상주 관리가 올린 가장 좋은 변형, 받는 중이면 null — 매트 색 판으로 그림)와
   * 줌 HTML 층에 쓸 같은 그림의 주소(그림 없는 작품은 null)
   */
  readonly texture: Texture | null;
  readonly imageSrc: string | null;
  readonly art: { readonly w: number; readonly h: number };
  readonly mat: number;
  readonly frame: number;
  readonly matColor: string;
  readonly center: Vec3;
  readonly normal: Vec3;
  readonly maxDistance: number;
  /** 벽에 걸림 · 이젤에 놓임(ADR-057) — 이젤이면 벽에서 띄우지 않고 빛 웅덩이·접촉 그림자 대신 뒤판 */
  readonly mount: 'WALL' | 'EASEL';
}

export const outerOf = (a: ViewerArtwork): { w: number; h: number } => ({
  w: a.art.w + 2 * a.mat + 2 * a.frame,
  h: a.art.h + 2 * a.mat + 2 * a.frame,
});

/** 카메라 맞춤 기준: 벽이 아니라 액자 앞면(벽에서 띄워 건 만큼 앞으로) */
export const anchorOf = (a: ViewerArtwork): FrameAnchor => {
  const face = faceOffsetOf(a);
  return {
    center: { x: a.center.x + a.normal.x * face, y: a.center.y, z: a.center.z + a.normal.z * face },
    normal: a.normal,
    outer: outerOf(a),
    maxDistance: a.maxDistance - face,
  };
};

/** 액자 두께(뒷면 → 앞면, m) */
export const FRAME_DEPTH = 0.05;
/** 벽 회반죽 면에서 액자 뒷면까지(m). 벽 장식보다 앞에 걸리게(설정 `FRAME_HANG_OFFSET_M`) */
export const hangOffset = (): number => config().FRAME_HANG_OFFSET_M;
/** 벽에서 액자 앞면까지(m) */
export const ART_FACE_OFFSET = (): number => hangOffset() + FRAME_DEPTH;
/** 벽에서 그림 면까지(m). 테 안쪽으로 4mm 들어가 있다 — 줌 HTML 층을 맞출 때 이 면의 네 모서리를 투영한다 */
export const ART_PLANE_OFFSET = (): number => ART_FACE_OFFSET() - 0.004;

/** 액자 기준점(배치의 `center`)에서 뒷면까지: 벽이면 띄운 거리, 이젤이면 0(받침 위에 바로) */
export const hangOf = (a: Pick<ViewerArtwork, 'mount'>): number => (a.mount === 'EASEL' ? 0 : hangOffset());
export const faceOffsetOf = (a: Pick<ViewerArtwork, 'mount'>): number => hangOf(a) + FRAME_DEPTH;
export const artPlaneOffsetOf = (a: Pick<ViewerArtwork, 'mount'>): number => faceOffsetOf(a) - 0.004;
