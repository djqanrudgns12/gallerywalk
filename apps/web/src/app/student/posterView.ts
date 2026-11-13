import {
  anythingPublic,
  mediaPath,
  type ArtworkPublic,
  type AssetRef,
  type ExhibitionView,
  type ReactionSettings,
} from '@gallery/core/types';

/**
 * 포스터·동의 시트에 보일 값(순수 함수). 주소는 저장하지 않고 core `mediaPath`로 만든다(PLAN §9.2).
 */

/** 포스터 칸(가로 약 600px)에 맞는 파생부터. 소리 파생은 쓰지 않는다 */
const POSTER_VARIANTS = ['wall', 'zoom', 'wall-lo', 'zoom-hi', 'thumb'] as const;

export const posterImageUrl = (view: ExhibitionView): string | null => {
  const poster = view.exhibition.poster;
  if (!poster) return null;
  const images = poster.variants.filter(v => v.ext === 'webp');
  const pick =
    POSTER_VARIANTS.map(name => images.find(v => v.name === name)).find(v => v !== undefined) ?? images[0];
  return pick ? mediaPath(view.exhibition.id, poster.assetId, pick) : null;
};

/** 포스터 위 절반에 거는 작품 수(시안 A: 가운데 큰 액자 1 + 양옆 2). 화면 모양에 묶인 값이라 설정값이 아니다 */
const POSTER_ARTWORKS_MAX = 3;

export interface PosterArtwork {
  readonly url: string;
  readonly w: number;
  readonly h: number;
}

/** 액자에 걸리는 그림: 그림 작품은 그림, PDF는 첫 쪽, 소리 작품은 표지(글 작품은 파일이 없다) — 미리 받기 목록과 같은 규칙 */
const wallAssetOf = (art: ArtworkPublic | undefined): AssetRef | undefined =>
  art?.image?.asset ?? art?.pages?.[0]?.asset ?? art?.audio?.cover ?? undefined;

/**
 * 포스터 위 절반의 "조명 아래 걸린 작품들"(F8 V-53): 첫 전시실 액자의 `thumb` — 포스터 동안 미리 받는 주소와 같다
 * (`adapters/sw/mediaCache.ts` `planPreload` FIRST_ROOM). 대표작이 먼저, 그다음 걸린 차례. 그림 없는 글 작품은 뺀다.
 */
export const posterArtworks = (view: ExhibitionView): readonly PosterArtwork[] => {
  const first = view.layout.parts[0];
  if (!first) return [];
  const artOf = new Map(view.artworks.map(a => [a.id, a]));
  const frames = view.layout.frames.filter(frame => frame.partId === first.partId);
  const ordered = [...frames.filter(f => f.featured), ...frames.filter(f => !f.featured)];
  const out: PosterArtwork[] = [];
  for (const frame of ordered) {
    if (out.length >= POSTER_ARTWORKS_MAX) break;
    const asset = wallAssetOf(artOf.get(frame.artworkId));
    const thumb = asset?.variants.find(v => v.name === 'thumb');
    if (asset && thumb)
      out.push({ url: mediaPath(view.exhibition.id, asset.assetId, thumb), w: thumb.w, h: thumb.h });
  }
  return out;
};

/** 교사가 학교·학급 표시를 켰을 때만(있는 것만 띄어 잇는다) */
export const schoolSummary = (view: ExhibitionView): string | null => {
  const school = view.exhibition.school;
  if (!school) return null;
  const text = [school.schoolName, school.className]
    .filter((s): s is string => s !== null && s.trim() !== '')
    .join(' ');
  return text === '' ? null : text;
};

/** 화면 날짜 "{월} {일}"(이 기기 시간대). 시험은 시간대를 정해 부른다 */
export const formatDay = (epochMs: number, timeZone?: string): string =>
  new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(epochMs);

export type ConsentAudience = 'everyone' | 'teacher';

/**
 * 동의 문구 판(PRD 13.2, PLAN §7.3): 공개 설정에 '모두에게'가 하나라도 있거나, 별명이 함께 관람 이름표로 다른 친구에게
 * 보이면(ADR-057) "다른 친구들도 볼 수 있어요".
 */
export const consentAudience = (reactions: ReactionSettings, showsNameTag: boolean): ConsentAudience =>
  showsNameTag || anythingPublic(reactions) ? 'everyone' : 'teacher';
