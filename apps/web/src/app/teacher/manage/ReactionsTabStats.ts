import { StickerSchema, type ArtworkTeacher, type Sticker, type TeacherReaction } from '@gallery/core/types';

/** 반응 탭의 작품별 한 줄(G-15): 스티커별 수 · 메모 수 · 평가 평균(평가가 있을 때만) */
export interface ArtworkReactionRow {
  readonly artwork: ArtworkTeacher;
  readonly total: number;
  readonly stickers: Readonly<Record<Sticker, number>>;
  readonly memoCount: number;
  /** 평가 평균(사실 정확성·전달력, 소수 한 자리로 보임). 평가가 없으면 null */
  readonly score: { readonly fact: number; readonly delivery: number; readonly count: number } | null;
  /** 메모가 있는 반응(최신 순) */
  readonly memos: readonly TeacherReaction[];
}

const zeroStickers = (): Record<Sticker, number> =>
  Object.fromEntries(StickerSchema.options.map(k => [k, 0])) as Record<Sticker, number>;

/**
 * 작품 순서대로 한 줄씩(지운 작품은 빼고). 숨긴 반응도 센다 — 숨김은 학생 공개에서만 빠지고 교사는 모두 본다.
 * 목록에 없는 작품(지운 작품)의 반응은 줄을 만들지 않는다.
 */
export const reactionRows = (
  artworks: readonly ArtworkTeacher[],
  reactions: readonly TeacherReaction[],
): readonly ArtworkReactionRow[] => {
  const byArtwork = new Map<string, TeacherReaction[]>();
  for (const r of reactions) {
    const list = byArtwork.get(r.artworkId);
    if (list) list.push(r);
    else byArtwork.set(r.artworkId, [r]);
  }
  return artworks
    .filter(a => a.deletedAt === null)
    .map(artwork => {
      const list = byArtwork.get(artwork.id) ?? [];
      const stickers = zeroStickers();
      let fact = 0;
      let delivery = 0;
      let scored = 0;
      for (const r of list) {
        if (r.sticker !== null) stickers[r.sticker] += 1;
        if (r.scoreFact !== null && r.scoreDelivery !== null) {
          fact += r.scoreFact;
          delivery += r.scoreDelivery;
          scored += 1;
        }
      }
      const memos = list
        .filter(r => r.memo !== null && r.memo !== '')
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
      return {
        artwork,
        total: list.length,
        stickers,
        memoCount: memos.length,
        score: scored === 0 ? null : { fact: fact / scored, delivery: delivery / scored, count: scored },
        memos,
      };
    });
};

/** 평균 한 자리(1.0~3.0) */
export const avg1 = (n: number): string => n.toFixed(1);
