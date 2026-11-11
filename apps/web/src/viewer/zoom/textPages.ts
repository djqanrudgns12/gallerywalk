import {
  looksLikePoem,
  planTextPages,
  splitBlocks,
  splitOversizeBlock,
  type TextUnit,
} from '@gallery/core/pages';

/**
 * 글 작품 크게 보기의 쪽 나눔(PRD 6.8, PLAN §5.7): 덩어리(시는 연, 산문은 문단)마다 높이를 재고(`measure` — 화면이
 * 같은 CSS로 잰다), 쪽보다 긴 덩어리만 문장·줄 조각으로 쪼개 다시 잰 뒤 `planTextPages`로 쪽에 담는다.
 * 재는 함수를 주입받아 DOM 없이 시험한다.
 */
export interface TextPiece {
  /** 같은 덩어리에서 쪼갠 조각끼리 같은 번호(쪽 사이에 이어질 때 문단 여백을 주지 않으려고) */
  readonly group: number;
  readonly text: string;
}

export interface PagedText {
  readonly poem: boolean;
  /** 쪽마다 조각들 */
  readonly pages: readonly (readonly TextPiece[])[];
}

export const pageText = (
  text: string,
  pageHeight: number,
  measure: (piece: string, poem: boolean) => number,
): PagedText => {
  const poem = looksLikePoem(text);
  const pieces: TextPiece[] = [];
  const units: TextUnit[] = [];
  splitBlocks(text, poem).forEach((block, group) => {
    const h = measure(block, poem);
    if (h <= pageHeight) {
      pieces.push({ group, text: block });
      units.push({ group, height: h });
      return;
    }
    for (const part of splitOversizeBlock(block, poem)) {
      pieces.push({ group, text: part });
      units.push({ group, height: measure(part, poem) });
    }
  });
  const pages = planTextPages(units, pageHeight).map(p => pieces.slice(p.first, p.last + 1));
  return { poem, pages: pages.length > 0 ? pages : [[]] };
};
