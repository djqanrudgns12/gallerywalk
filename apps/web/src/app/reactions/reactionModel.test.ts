import { config } from '@gallery/core/config';
import { ExhibitionViewSchema } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { ART_A, ART_B, reactionView } from '../../dev/reactionFixtures.ts';
import { bodyOf, publicSummaryOf, reactionsEnabled, sheetFields } from './reactionModel.ts';

const ALL = { sticker: true, memo: true, score: true };

describe('반응 판정(reactionModel)', () => {
  it('반응 꺼짐이면 반응 남기기를 숨긴다', () => {
    expect(reactionsEnabled(reactionView())).toBe(true);
    expect(reactionsEnabled(reactionView({ enabled: false }))).toBe(false);
    expect(sheetFields(reactionView({ enabled: false }))).toEqual({
      sticker: false,
      memo: false,
      score: false,
    });
    expect(sheetFields(reactionView())).toEqual({ sticker: true, memo: true, score: false });
  });

  it('본문은 네 칸 모두 — 받지 않는 칸은 null, 메모는 한 줄 정리·빈 글은 null', () => {
    const fields = sheetFields(reactionView());
    expect(
      bodyOf({ sticker: 'GREAT', memo: '  가상의   메모 ', scoreFact: 2, scoreDelivery: 3 }, fields),
    ).toEqual({
      sticker: 'GREAT',
      memo: '가상의 메모',
      scoreFact: null,
      scoreDelivery: null,
    });
    expect(bodyOf({ sticker: 'MOVED', memo: '   ', scoreFact: null, scoreDelivery: null }, fields)).toEqual({
      sticker: 'MOVED',
      memo: null,
      scoreFact: null,
      scoreDelivery: null,
    });
  });

  it('보낼 수 없는 값은 null: 아무것도 없음 · 평가 한 줄만 · 메모가 너무 김', () => {
    expect(bodyOf({ sticker: null, memo: ' ', scoreFact: null, scoreDelivery: null }, ALL)).toBeNull();
    expect(bodyOf({ sticker: 'LEARNED', memo: '', scoreFact: 2, scoreDelivery: null }, ALL)).toBeNull();
    expect(bodyOf({ sticker: null, memo: '', scoreFact: 2, scoreDelivery: 1 }, ALL)).toEqual({
      sticker: null,
      memo: null,
      scoreFact: 2,
      scoreDelivery: 1,
    });
    const long = '가'.repeat(config().MEMO_MAX_CHARS + 1);
    expect(bodyOf({ sticker: null, memo: long, scoreFact: null, scoreDelivery: null }, ALL)).toBeNull();
  });

  it('공개 집계: 공개가 꺼졌거나 그 작품 집계가 없거나 보일 것이 없으면 null', () => {
    const summary = {
      artworkId: ART_A,
      stickers: { MOVED: 3 },
      score: null,
      memos: [],
    };
    const off = ExhibitionViewSchema.parse({ ...reactionView(), reactions: [summary] });
    expect(publicSummaryOf(off, ART_A)).toBeNull();

    const pub = reactionView({ stickerVisibility: 'PUBLIC' });
    const on = ExhibitionViewSchema.parse({
      ...pub,
      reactions: [summary, { artworkId: ART_B, stickers: {}, score: null, memos: [] }],
    });
    expect(publicSummaryOf(on, ART_A)?.stickers).toEqual({ MOVED: 3 });
    expect(publicSummaryOf(on, ART_B)).toBeNull();
    expect(publicSummaryOf(pub, ART_A)).toBeNull();
  });
});
