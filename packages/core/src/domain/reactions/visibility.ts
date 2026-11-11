import type { ReactionBody, PublicReactionSummary } from '../../types/reaction.ts';
import type { ReactionSettings } from '../../types/settings.ts';

/** zod로 검사한 입력·저장소 값을 어댑터가 이 모양으로 바꿔 넘긴다. 작품별 목록이며 id는 고유하다. */
export interface SummaryReaction extends Readonly<ReactionBody> {
  readonly hidden: boolean;
  readonly publicSelected: boolean;
  readonly nickname: string | null;
  readonly updatedAt: number;
  readonly id: string;
}

export interface AcceptedFields {
  readonly sticker: boolean;
  readonly memo: boolean;
  readonly score: boolean;
}

/** 과거에 받은 칸이어도 현재 받기가 꺼졌으면 허용·공개하지 않는다. */
export const acceptedFields = (settings: ReactionSettings): AcceptedFields => ({
  sticker: settings.enabled && settings.collect.sticker,
  memo: settings.enabled && settings.collect.memo,
  score: settings.enabled && settings.collect.score,
});

export type ReactionCheck = 'OK' | 'REACTIONS_OFF' | 'FIELD_NOT_ACCEPTED';

/** 본문 자체의 모양·빈 반응·평가 쌍 검사는 ReactionBodySchema의 몫이다. */
export const checkReaction = (settings: ReactionSettings, body: ReactionBody): ReactionCheck => {
  if (!settings.enabled) return 'REACTIONS_OFF';
  const accepted = acceptedFields(settings);
  if (
    (!accepted.sticker && body.sticker !== null) ||
    (!accepted.memo && body.memo !== null) ||
    (!accepted.score && (body.scoreFact !== null || body.scoreDelivery !== null))
  )
    return 'FIELD_NOT_ACCEPTED';
  return 'OK';
};

/** 숨김·현재 수집 설정·공개 설정을 모두 적용한다. 입력 행과 배열은 바꾸지 않는다. */
export const publicSummary = (
  settings: ReactionSettings,
  artworkId: string,
  reactions: readonly SummaryReaction[],
): PublicReactionSummary => {
  const accepted = acceptedFields(settings);
  const summary: PublicReactionSummary = { artworkId, stickers: {}, score: null, memos: [] };
  const stickerPublic = accepted.sticker && settings.stickerVisibility === 'PUBLIC';
  const scorePublic = accepted.score && settings.scoreVisibility === 'PUBLIC';
  const memoPublic = accepted.memo && settings.memoVisibility === 'SELECTED';
  if (!stickerPublic && !scorePublic && !memoPublic) return summary;

  const visible = reactions.filter(reaction => !reaction.hidden);
  let scoreCount = 0;
  let factSum = 0;
  let deliverySum = 0;
  for (const reaction of visible) {
    if (stickerPublic && reaction.sticker !== null)
      summary.stickers[reaction.sticker] = (summary.stickers[reaction.sticker] ?? 0) + 1;
    if (scorePublic && reaction.scoreFact !== null && reaction.scoreDelivery !== null) {
      scoreCount++;
      factSum += reaction.scoreFact;
      deliverySum += reaction.scoreDelivery;
    }
  }
  if (scoreCount > 0)
    summary.score = {
      factAvg: factSum / scoreCount,
      deliveryAvg: deliverySum / scoreCount,
      count: scoreCount,
    };

  if (memoPublic)
    summary.memos = visible
      .filter(
        (reaction): reaction is SummaryReaction & { memo: string } =>
          reaction.publicSelected && reaction.memo !== null,
      )
      .sort((a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(reaction => ({
        memo: reaction.memo,
        nickname: settings.naming === 'NICKNAME' ? reaction.nickname : null,
      }));
  return summary;
};
