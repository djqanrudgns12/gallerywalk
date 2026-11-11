/**
 * 반응(P4-6, G-07): 관람 화면(`app/visit`)이 붙이는 곳.
 * - `<ReactionLayer key={artworkId} view code artworkId onClose />`: 캡션의 `반응 남기기`가 여는 덮개(동의 → 시트)
 * - `reactionsEnabled(view)`: false면 `반응 남기기`를 숨긴다
 * - `<PublicReactionsFor view artworkId />`: 캡션 아래 공개 집계(없으면 null)
 * - `useReactionPending(exhibitionId)`: 보내기 줄에 남은 것이 있으면 true(반응 단추의 작은 점)
 */
export { PublicReactionsFor } from './PublicReactionsFor.tsx';
export { ReactionLayer, type ReactionLayerProps } from './ReactionLayer.tsx';
export { publicSummaryOf, reactionsEnabled } from './reactionModel.ts';
export {
  installReactionRuntime,
  reactionRuntime,
  useReactionPending,
  type ReactionRuntime,
  type ReactionRuntimeOptions,
} from './reactionRuntime.ts';
export { memoryOutboxStorage, reactionKey, type OutboxItem, type OutboxStorage } from './outbox.ts';
