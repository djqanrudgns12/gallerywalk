import { config } from '@gallery/core/config';
import { acceptedFields } from '@gallery/core/reactions';
import {
  anythingPublic,
  charCount,
  normalizeLine,
  type ExhibitionView,
  type PublicReactionSummary,
} from '@gallery/core/types';
import type { ReactionBodyInput } from '../../ports/index.ts';
import type { ReactionSheetFields, ReactionSheetValue } from '../../ui/patterns/visitor/ReactionSheet.tsx';

/**
 * 반응 시트·공개 표시의 순수 판정(G-07, PLAN §7.3). 화면·저장과 떨어져 있어 시험이 쉽다.
 */

/** `반응 남기기`를 보일까: 반응 받기가 켜졌고 받는 칸이 하나라도 있으면(닫힌 전시는 보기 자체가 오지 않는다) */
export const reactionsEnabled = (view: ExhibitionView): boolean => {
  const a = acceptedFields(view.exhibition.reactions);
  return a.sticker || a.memo || a.score;
};

/** 지금 설정이 받는 칸 */
export const sheetFields = (view: ExhibitionView): ReactionSheetFields =>
  acceptedFields(view.exhibition.reactions);

export const EMPTY_VALUE: ReactionSheetValue = {
  sticker: null,
  memo: '',
  scoreFact: null,
  scoreDelivery: null,
};

/** 서버 반응·줄의 본문 → 시트 값 */
export const valueOf = (r: {
  readonly sticker: ReactionSheetValue['sticker'];
  readonly memo: string | null;
  readonly scoreFact: number | null;
  readonly scoreDelivery: number | null;
}): ReactionSheetValue => ({
  sticker: r.sticker,
  memo: r.memo ?? '',
  scoreFact: r.scoreFact,
  scoreDelivery: r.scoreDelivery,
});

/**
 * 보낼 본문(PUT, 네 칸 모두 — 안 받는 칸은 null). 메모는 한 줄 정규화, 비면 null.
 * 보낼 수 없으면 null: 아무것도 없음 · 평가 한 줄만 · 메모가 `MEMO_MAX_CHARS`를 넘음(core `ReactionBodySchema`와 같은 규칙).
 */
export const bodyOf = (value: ReactionSheetValue, fields: ReactionSheetFields): ReactionBodyInput | null => {
  const memo = fields.memo ? normalizeLine(value.memo) : '';
  const body: ReactionBodyInput = {
    sticker: fields.sticker ? value.sticker : null,
    memo: memo === '' ? null : memo,
    scoreFact: fields.score ? value.scoreFact : null,
    scoreDelivery: fields.score ? value.scoreDelivery : null,
  };
  if ((body.scoreFact === null) !== (body.scoreDelivery === null)) return null;
  if (body.sticker === null && body.memo === null && body.scoreFact === null) return null;
  if (body.memo !== null && charCount(body.memo) > config().MEMO_MAX_CHARS) return null;
  return body;
};

/**
 * 그 작품의 공개 집계(교사가 공개를 켰을 때만). 공개가 모두 꺼졌거나, 집계가 없거나, 보일 것이 하나도 없으면 null.
 */
export const publicSummaryOf = (view: ExhibitionView, artworkId: string): PublicReactionSummary | null => {
  if (!anythingPublic(view.exhibition.reactions)) return null;
  const summary = view.reactions.find(r => r.artworkId === artworkId);
  if (!summary) return null;
  const anySticker = Object.values(summary.stickers).some(n => (n ?? 0) > 0);
  if (!anySticker && summary.score === null && summary.memos.length === 0) return null;
  return summary;
};
