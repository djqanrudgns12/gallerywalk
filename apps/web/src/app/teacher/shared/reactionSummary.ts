import { copy, fill } from '@gallery/core/copy';
import type { ReactionSettings } from '@gallery/core/types';

const t = () => copy.teacher.reactionSettings;

/**
 * 반응 설정 한 줄 요약(PLAN §7.4 G-14 "반응: 스티커·메모 · 별점 꺼짐"). 수업 전에 평가 켜기를 잊지 않게
 * 별점이 꺼져 있으면 끝에 "별점 꺼짐"을 붙인다.
 */
export const reactionSummary = (r: ReactionSettings): string => {
  if (!r.enabled) return t().summaryOff;
  const items: string[] = [];
  if (r.collect.sticker) items.push(t().summarySticker);
  if (r.collect.memo) items.push(t().summaryMemo);
  if (r.collect.score) items.push(t().summaryScore);
  const head = fill(t().summary, { items: items.join('·') });
  return r.collect.score ? head : `${head} · ${t().summaryScoreOff}`;
};

/** 받기를 켰는데 받을 것이 하나도 없으면 저장할 수 없다(core `ReactionSettingsSchema`의 `nothing_collected`) */
export const nothingCollected = (r: ReactionSettings): boolean =>
  r.enabled && !r.collect.sticker && !r.collect.memo && !r.collect.score;
