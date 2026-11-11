import type { ExhibitionView } from '@gallery/core/types';
import type { JSX } from 'react';
import { PublicReactions } from '../../ui/patterns/visitor/PublicReactions.tsx';
import { publicSummaryOf } from './reactionModel.ts';

/**
 * 크게 보기 캡션 아래 공개 반응 한 줄(G-07, PLAN §7.3). 교사가 공개를 켜지 않았거나 그 작품 집계가 없으면 null.
 * 집계는 `ExhibitionView.reactions`에 들어 있고 버전 확인(ADR-027) 때 새로 받는다.
 */
export const PublicReactionsFor = (p: {
  readonly view: ExhibitionView;
  readonly artworkId: string;
  readonly className?: string | undefined;
}): JSX.Element | null => {
  const summary = publicSummaryOf(p.view, p.artworkId);
  if (!summary) return null;
  return (
    <PublicReactions
      key={p.artworkId}
      stickers={summary.stickers}
      score={summary.score}
      memos={summary.memos}
      className={p.className}
    />
  );
};
