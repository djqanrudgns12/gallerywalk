import { type ImagePagePlan, planImagePages } from '@gallery/core/pages';
import {
  type ArtworkPublic,
  decodeImageAnalysis,
  type ImageAnalysisWire,
  type MediaVariant,
  mediaPath,
  type Viewport,
} from '@gallery/core/types';

/**
 * 줌 층의 쪽 만들기(P4-4, PLAN §5.6·§6.8, PRD 6.7). 작품 + 화면(캡션 자리를 뺀 CSS px) → 쪽마다 그릴 조각들.
 *
 * - 쪽 계획기(`planImagePages`)는 **내용 좌표**(저장된 줌·띠 이미지의 px)로 계산한다. 서버 분석값은 바로 세운
 *   원본 좌표라 내용 좌표로 바꿔 넣는다(줄 간격·칸 폭 × 내용/원본).
 * - 긴 세로·파노라마는 띠(`strip-i`, 긴 축 2048px)를 이어 붙인 좌표 하나로 계산하고, 쪽 경계는 띠 경계와 상관없이 자른다.
 * - 보통 그림은 `zoom`, 그 배율이 화면 화소보다 크게 늘이게 되면 `zoom-hi`로(있을 때).
 * - PDF는 쪽마다 따로(쪽 i/n 표시는 화면이 `source`·`index`로).
 */

export interface ZoomPiece {
  readonly url: string;
  /** 그 이미지 안의 사각형(이미지 px) */
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  /** 쪽 안에서 그릴 자리(CSS px, 쪽 왼쪽 위 기준) */
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

export interface ZoomPage {
  /** 쪽 크기(CSS px) */
  readonly w: number;
  readonly h: number;
  readonly pieces: readonly ZoomPiece[];
  /** 원본 쪽 번호(그림 = 1, PDF = 쪽 번호) */
  readonly source: number;
  readonly plan: Pick<ImagePagePlan, 'fit' | 'axis' | 'scale' | 'readable' | 'rotateHint'>;
}

interface Tile {
  readonly url: string;
  readonly w: number;
  readonly h: number;
}

/** 이어 붙인 이미지(띠 여러 장 또는 한 장)를 긴 축 구간 [start, end)로 자른 조각들 */
const cut = (
  tiles: readonly Tile[],
  axis: 'x' | 'y',
  start: number,
  end: number,
  scale: number,
): ZoomPiece[] => {
  const pieces: ZoomPiece[] = [];
  let offset = 0;
  for (const t of tiles) {
    const len = axis === 'y' ? t.h : t.w;
    const a = Math.max(start, offset);
    const b = Math.min(end, offset + len);
    if (b > a) {
      const along = (a - start) * scale;
      const span = (b - a) * scale;
      pieces.push(
        axis === 'y'
          ? {
              url: t.url,
              sx: 0,
              sy: a - offset,
              sw: t.w,
              sh: b - a,
              dx: 0,
              dy: along,
              dw: t.w * scale,
              dh: span,
            }
          : {
              url: t.url,
              sx: a - offset,
              sy: 0,
              sw: b - a,
              sh: t.h,
              dx: along,
              dy: 0,
              dw: span,
              dh: t.h * scale,
            },
      );
    }
    offset += len;
  }
  return pieces;
};

const pagesOf = (
  tiles: readonly Tile[],
  analysis: ImageAnalysisWire,
  sourceLong: number,
  artwork: Pick<ArtworkPublic, 'form' | 'textHeavy' | 'pageMode'>,
  vp: Viewport,
  source: number,
): ZoomPage[] => {
  const axisY = tiles.reduce((s, t) => s + t.h, 0) >= (tiles[0]?.w ?? 0);
  const content = axisY
    ? { w: tiles[0]?.w ?? 1, h: tiles.reduce((s, t) => s + t.h, 0) }
    : { w: tiles.reduce((s, t) => s + t.w, 0), h: tiles[0]?.h ?? 1 };
  const contentLong = Math.max(content.w, content.h);
  const k = contentLong / Math.max(1, sourceLong);
  const a = decodeImageAnalysis(analysis);
  const plan = planImagePages(
    {
      form: artwork.form,
      textHeavy: artwork.textHeavy,
      pageMode: artwork.pageMode,
      content,
      linePitchPx: a.linePitchPx === null ? null : a.linePitchPx * k,
      lineProfile: a.lineProfile,
      profileBinPx: a.profileBinPx * k,
    },
    vp,
  );
  const { fit, axis, scale, readable, rotateHint } = plan;
  return plan.pages.map(range => {
    const len = (range.end - range.start) * scale;
    return {
      w: axis === 'y' ? content.w * scale : len,
      h: axis === 'y' ? len : content.h * scale,
      pieces: cut(tiles, axis, range.start, range.end, scale),
      source,
      plan: { fit, axis, scale, readable, rotateHint },
    };
  });
};

const variant = (variants: readonly MediaVariant[], name: string): MediaVariant | undefined =>
  variants.find(v => v.name === name);

const strips = (variants: readonly MediaVariant[]): MediaVariant[] =>
  variants
    .filter(v => /^strip-\d+$/.test(v.name))
    .sort((p, q) => Number(p.name.slice(6)) - Number(q.name.slice(6)));

/** 한 장(그림·PDF 쪽): `zoom`으로 계획하고, 늘여야 하면 `zoom-hi`로 다시 */
const singleImagePages = (
  exhibitionId: string,
  asset: { assetId: string; variants: readonly MediaVariant[] },
  source: { w: number; h: number; analysis: ImageAnalysisWire },
  artwork: Pick<ArtworkPublic, 'form' | 'textHeavy' | 'pageMode'>,
  vp: Viewport,
  dpr: number,
  index: number,
): ZoomPage[] => {
  const sourceLong = Math.max(source.w, source.h);
  const tileOf = (v: MediaVariant): Tile => ({
    url: mediaPath(exhibitionId, asset.assetId, v),
    w: v.w,
    h: v.h,
  });
  const zoom = variant(asset.variants, 'zoom');
  const hi = variant(asset.variants, 'zoom-hi');
  const first = zoom ?? hi;
  if (!first) return [];
  const pages = pagesOf([tileOf(first)], source.analysis, sourceLong, artwork, vp, index);
  const scale = pages[0]?.plan.scale ?? 1;
  if (first === zoom && hi && scale * dpr > 1)
    return pagesOf([tileOf(hi)], source.analysis, sourceLong, artwork, vp, index);
  return pages;
};

/** 작품 → 줌 쪽들. 글 작품·소리는 다른 길(글 카드 조판·소리 명판)이라 빈 목록. */
export const zoomPagesFor = (
  exhibitionId: string,
  artwork: ArtworkPublic,
  vp: Viewport,
  dpr: number,
): ZoomPage[] => {
  if (artwork.kind === 'PDF') {
    return (artwork.pages ?? []).flatMap(p =>
      singleImagePages(exhibitionId, p.asset, p, artwork, vp, dpr, p.idx),
    );
  }
  const image = artwork.image;
  if (artwork.kind !== 'IMAGE' || !image) return [];
  const bands = strips(image.asset.variants);
  if ((artwork.form === 'TALL' || artwork.form === 'PANORAMA') && bands.length > 0) {
    const tiles = bands.map(v => ({ url: mediaPath(exhibitionId, image.asset.assetId, v), w: v.w, h: v.h }));
    return pagesOf(tiles, image.analysis, Math.max(image.w, image.h), artwork, vp, 1);
  }
  return singleImagePages(exhibitionId, image.asset, image, artwork, vp, dpr, 1);
};
