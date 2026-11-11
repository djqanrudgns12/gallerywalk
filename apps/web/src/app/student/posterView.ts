import { anythingPublic, mediaPath, type ExhibitionView, type ReactionSettings } from '@gallery/core/types';

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
