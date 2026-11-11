import { copy, facadeTitle, fill } from '@gallery/core/copy';
import { type TemplateLook, templateLooks } from '@gallery/core/templates';
import { songGainDb } from '@gallery/core/tour';
import { type ExhibitionView, type Layout, mediaPath } from '@gallery/core/types';
import type { Track } from '../../audio/AudioEngine.ts';
import { sceneOf } from '../../viewer/data/exhibitionScene.ts';
import type { DimHolder } from '../../viewer/scene/materials.ts';
import type { ViewerArtwork } from '../../viewer/scene/types.ts';
import type { CardText } from '../../viewer/textures/textCard.ts';
import type { ArtworkTextureSource } from '../../viewer/textures/useResidentTextures.ts';

/**
 * 학생 관람(P4-2): 서버의 보기 묶음 → 관람 화면 한 벌.
 * 작품 그림은 상주 관리(`textures`)가 올리므로 여기서는 `texture: null`(받는 동안 매트 색 판).
 * 크게 보기 HTML 층이 쓸 그림 주소는 벽용(`wall`) — 없으면 썸네일.
 */
export interface VisitModel {
  readonly layout: Layout;
  /** 전시명(정면 이름판·외관 자리 이름) */
  readonly title: string;
  /** 위 줄 이름(정면 이름판과 같은 글) */
  readonly facade: string;
  readonly look: TemplateLook;
  readonly artworks: readonly ViewerArtwork[];
  readonly holders: Readonly<Record<string, DimHolder>>;
  readonly textures: ArtworkTextureSource;
  /** 그림 파일 없는 글·소리 작품의 카드 글(벽에 기기가 조판) */
  readonly cards: ReadonlyMap<string, CardText>;
  /** 소리 작품의 곡(크게 보기에서 재생) */
  readonly tracks: ReadonlyMap<string, Track>;
  /** 구역(외관·회랑·관 ID) → 위 줄 자리 이름 */
  readonly placeOf: (region: string) => string;
}

export const visitModelOf = (view: ExhibitionView): VisitModel => {
  const scene = sceneOf(view);
  const title = view.exhibition.title;
  const facade = facadeTitle(title);
  const rooms = new Map(view.rooms.map(r => [r.id, r.title]));
  const parts = new Map(scene.layout.parts.map(p => [p.partId, p]));
  const artworks: ViewerArtwork[] = scene.artworks.map(a => ({
    id: a.id,
    title: a.title,
    author: a.author,
    caption: a.caption,
    texture: null,
    imageSrc: scene.urlOf(a.id, 'wall') ?? scene.urlOf(a.id, 'thumb'),
    art: a.art,
    mat: a.mat,
    frame: a.frame,
    matColor: a.matColor,
    center: a.center,
    normal: a.normal,
    maxDistance: a.maxDistance,
    mount: a.mount,
  }));
  const placeOf = (region: string): string => {
    if (region === 'exterior') return fill(copy.viewer.stopExterior, { title: facade });
    if (region === 'spine') return title;
    const part = parts.get(region);
    if (!part) return '';
    const room = rooms.get(part.roomId) ?? '';
    return part.partCount > 1 ? fill(copy.viewer.partName, { room, part: part.partIndex + 1 }) : room;
  };
  const cards = new Map<string, CardText>();
  const tracks = new Map<string, Track>();
  for (const a of view.artworks) {
    if (a.kind === 'AUDIO' && a.audio) {
      const v = a.audio.asset.variants.find(x => x.name === 'audio') ?? a.audio.asset.variants[0];
      if (v)
        tracks.set(a.id, {
          id: `art:${a.id}`,
          url: mediaPath(view.exhibition.id, a.audio.asset.assetId, v),
          startMs: a.audio.analysis.audibleStartMs,
          gainDb: songGainDb(a.audio.analysis.loudnessDb),
        });
    }
    const hasImage = a.image !== null || (a.pages?.length ?? 0) > 0;
    if (hasImage) continue;
    if (a.kind === 'TEXT')
      cards.set(a.id, { kind: 'TEXT', title: a.title, author: a.author ?? '', body: a.textBody ?? '' });
    else if (a.kind === 'AUDIO')
      cards.set(a.id, { kind: 'AUDIO', title: a.title, author: a.author ?? '', body: '' });
  }
  return {
    layout: scene.layout,
    title,
    facade,
    look: templateLooks[scene.layout.templateId],
    artworks,
    holders: Object.fromEntries(artworks.map(a => [a.id, { value: 1 }])),
    textures: { arts: scene.resident, urlOf: scene.urlOf },
    cards,
    tracks,
    placeOf,
  };
};
