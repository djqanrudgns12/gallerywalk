import { config } from '@gallery/core/config';
import { matColorOf, templateGeometry, templateLooks } from '@gallery/core/templates';
import type { ArtworkPublic, ExhibitionView, Layout, MediaVariant } from '@gallery/core/types';
import { mediaPath } from '@gallery/core/types';
import type { ResidentArt, Variant } from '../textures/residency.ts';

/**
 * 학생 관람 화면의 데이터 변환(P4-2): 서버의 보기 묶음(`ExhibitionView`) → 관람 엔진 입력.
 * - 액자 자리·크기는 배치(`layout.frames`), 글·작가는 작품 공개 정보, 매트 색은 가장자리 밝기(PRD 6.5)
 * - 상주 관리(§6.5)가 쓸 변형별 화소 크기와 미디어 주소
 * 그림 없는 작품(글·소리)은 그림 텍스처 대신 화면이 그린다(글 카드·소리 명판) — 여기서는 `media: null`.
 */

export interface SceneArtwork {
  readonly id: string;
  readonly partId: string;
  readonly kind: ArtworkPublic['kind'];
  readonly title: string;
  readonly author: string;
  readonly caption: string;
  readonly description: string;
  readonly art: { readonly w: number; readonly h: number };
  readonly mat: number;
  readonly frame: number;
  readonly matColor: string;
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  readonly maxDistance: number;
  readonly mount: 'WALL' | 'EASEL';
  readonly featured: boolean;
  /** 벽에 걸 그림(여러 쪽이면 첫 쪽). 없으면 null */
  readonly media: { readonly assetId: string; readonly variants: readonly MediaVariant[] } | null;
}

export interface ExhibitionScene {
  readonly layout: Layout;
  readonly artworks: readonly SceneArtwork[];
  /** 상주 관리 입력(걷는 순서 = 정지 지점 순서) */
  readonly resident: readonly ResidentArt[];
  /** 작품 ID·변형 → 미디어 주소(없으면 null) */
  readonly urlOf: (artworkId: string, variant: Variant) => string | null;
}

const VARIANTS: readonly Variant[] = ['thumb', 'wall', 'wall-lo'];

export const sceneOf = (view: ExhibitionView): ExhibitionScene => {
  const layout = view.layout;
  const look = templateLooks[layout.templateId];
  const border = templateGeometry[layout.templateId].frameBorderM;
  const threshold = config().MAT_DARK_EDGE_LUMA;
  const byId = new Map(view.artworks.map(a => [a.id, a]));
  const stops = new Map(layout.stops.filter(s => s.artworkId).map(s => [s.artworkId!, s]));
  // 관 안 걷는 순서: 정지 지점 순서대로
  const orderInPart = new Map<string, number>();
  for (const s of layout.stops)
    if (s.artworkId && s.index !== null) orderInPart.set(s.artworkId, s.index - 1);

  const artworks: SceneArtwork[] = [];
  const resident: ResidentArt[] = [];
  const media = new Map<string, { assetId: string; variants: readonly MediaVariant[] }>();
  for (const f of layout.frames) {
    const a = byId.get(f.artworkId);
    if (!a) continue;
    const img = a.image ?? a.pages?.[0] ?? null;
    const m = img ? { assetId: img.asset.assetId, variants: img.asset.variants } : null;
    if (m) media.set(a.id, m);
    artworks.push({
      id: a.id,
      partId: f.partId,
      kind: a.kind,
      title: a.title,
      author: a.author ?? '',
      caption: a.caption ?? '',
      description: a.description ?? '',
      art: f.art,
      mat: f.mat.w,
      frame: border,
      matColor: matColorOf(look, img?.analysis.edgeLuma ?? null, threshold),
      center: { x: f.center[0], y: f.center[1], z: f.center[2] },
      normal: { x: f.normal[0], y: 0, z: f.normal[1] },
      maxDistance: stops.get(a.id)?.anchor.maxDistance ?? 4,
      mount: f.mount,
      featured: f.featured,
      media: m,
    });
    if (m) {
      const sizes: ResidentArt['sizes'] = {};
      for (const v of VARIANTS) {
        const found = m.variants.find(x => x.name === v);
        if (found) (sizes as Record<Variant, { w: number; h: number }>)[v] = { w: found.w, h: found.h };
      }
      resident.push({ id: a.id, partId: f.partId, order: orderInPart.get(a.id) ?? 0, sizes });
    }
  }
  const exhibitionId = view.exhibition.id;
  return {
    layout,
    artworks,
    resident,
    urlOf: (id, variant) => {
      const m = media.get(id);
      const v = m?.variants.find(x => x.name === variant);
      return m && v ? mediaPath(exhibitionId, m.assetId, v) : null;
    },
  };
};
