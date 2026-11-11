import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ReactionBody } from '../../types/reaction.ts';
import type { ReactionSettings } from '../../types/settings.ts';
import { acceptedFields, checkReaction, publicSummary, type SummaryReaction } from './visibility.ts';

const ARTWORK_ID = '00000000-0000-4000-8000-000000000001';
const ALL_SETTINGS: ReactionSettings[] = [];
for (const enabled of [false, true])
  for (const sticker of [false, true])
    for (const memo of [false, true])
      for (const score of [false, true])
        for (const naming of ['ANONYMOUS', 'NICKNAME'] as const)
          for (const stickerVisibility of ['TEACHER', 'PUBLIC'] as const)
            for (const memoVisibility of ['TEACHER', 'SELECTED'] as const)
              for (const scoreVisibility of ['TEACHER', 'PUBLIC'] as const)
                ALL_SETTINGS.push({
                  enabled,
                  collect: { sticker, memo, score },
                  naming,
                  stickerVisibility,
                  memoVisibility,
                  scoreVisibility,
                });

const PUBLIC: ReactionSettings = {
  enabled: true,
  collect: { sticker: true, memo: true, score: true },
  naming: 'NICKNAME',
  stickerVisibility: 'PUBLIC',
  memoVisibility: 'SELECTED',
  scoreVisibility: 'PUBLIC',
};
const bodyArb: fc.Arbitrary<ReactionBody> = fc.record({
  sticker: fc.constantFrom(null, 'MOVED', 'LEARNED', 'GREAT', 'CURIOUS'),
  memo: fc.constantFrom(null, '새로 알았어요'),
  scoreFact: fc.constantFrom(null, 1, 2, 3),
  scoreDelivery: fc.constantFrom(null, 1, 2, 3),
});
const row = (patch: Partial<SummaryReaction> = {}): SummaryReaction => ({
  id: 'a',
  sticker: 'MOVED',
  memo: '가상 감상',
  scoreFact: 1,
  scoreDelivery: 3,
  hidden: false,
  publicSelected: true,
  nickname: '하늘',
  updatedAt: 10,
  ...patch,
});
const reactionArb: fc.Arbitrary<SummaryReaction> = fc
  .tuple(bodyArb, fc.boolean(), fc.boolean(), fc.nat({ max: 100 }), fc.string())
  .map(([body, hidden, publicSelected, updatedAt, id]) =>
    row({ ...body, hidden, publicSelected, updatedAt, id }),
  );

describe('acceptedFields · checkReaction', () => {
  it('모든 설정 조합에서 현재 받는 칸만 허용하고 반응 꺼짐을 먼저 판정한다', () => {
    fc.assert(
      fc.property(bodyArb, body => {
        for (const settings of ALL_SETTINGS) {
          expect(acceptedFields(settings)).toEqual({
            sticker: settings.enabled && settings.collect.sticker,
            memo: settings.enabled && settings.collect.memo,
            score: settings.enabled && settings.collect.score,
          });
          const forbidden =
            (!settings.collect.sticker && body.sticker !== null) ||
            (!settings.collect.memo && body.memo !== null) ||
            (!settings.collect.score && (body.scoreFact !== null || body.scoreDelivery !== null));
          expect(checkReaction(settings, body)).toBe(
            !settings.enabled ? 'REACTIONS_OFF' : forbidden ? 'FIELD_NOT_ACCEPTED' : 'OK',
          );
        }
      }),
      { seed: 20261111, numRuns: 30 },
    );
  });

  it('허용하지 않는 평가의 어느 한쪽만 있어도 거절한다', () => {
    const settings = { ...PUBLIC, collect: { sticker: true, memo: true, score: false } };
    for (const body of [
      { sticker: null, memo: null, scoreFact: 1, scoreDelivery: null },
      { sticker: null, memo: null, scoreFact: null, scoreDelivery: 1 },
    ])
      expect(checkReaction(settings, body)).toBe('FIELD_NOT_ACCEPTED');
  });
});

describe('publicSummary', () => {
  it('숨김은 모든 집계에서 빼고, 선택한 메모만 시각·id 순으로 보여 준다', () => {
    const reactions = [
      row({ id: 'b', nickname: '바다', memo: '둘째' }),
      row({ id: 'z', updatedAt: 1, memo: '처음', sticker: 'GREAT' }),
      row({ id: 'a', memo: '첫째' }),
      row({ id: 'c', hidden: true, memo: '숨김', scoreFact: 3, scoreDelivery: 1 }),
      row({ id: 'd', publicSelected: false, memo: '미선택', sticker: null }),
    ];
    const before = structuredClone(reactions);
    expect(publicSummary(PUBLIC, ARTWORK_ID, reactions)).toEqual({
      artworkId: ARTWORK_ID,
      stickers: { MOVED: 2, GREAT: 1 },
      score: { factAvg: 1, deliveryAvg: 3, count: 4 },
      memos: [
        { nickname: '하늘', memo: '처음' },
        { nickname: '하늘', memo: '첫째' },
        { nickname: '바다', memo: '둘째' },
      ],
    });
    expect(reactions).toEqual(before);
  });

  it('평균은 반올림하지 않으며, 평가 두 칸이 모두 있는 반응만 센다', () => {
    expect(
      publicSummary(PUBLIC, ARTWORK_ID, [
        row(),
        row({ id: 'b' }),
        row({ id: 'c', scoreFact: 2, scoreDelivery: 2 }),
        row({ id: 'd', scoreFact: null }),
        row({ id: 'e', scoreDelivery: null }),
      ]).score,
    ).toEqual({ factAvg: 4 / 3, deliveryAvg: 8 / 3, count: 3 });
  });

  it('반응이 없거나 모두 숨겼으면 빈 집계다', () => {
    for (const reactions of [[], [row({ hidden: true })]])
      expect(publicSummary(PUBLIC, ARTWORK_ID, reactions)).toEqual({
        artworkId: ARTWORK_ID,
        stickers: {},
        score: null,
        memos: [],
      });
  });

  it('모든 설정 조합에서 비공개 값·이름이 새지 않고 입력 순서와 무관하다', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(reactionArb, { maxLength: 12, selector: reaction => reaction.id }),
        reactions => {
          for (const settings of ALL_SETTINGS) {
            const summary = publicSummary(settings, ARTWORK_ID, reactions);
            expect(summary.artworkId).toBe(ARTWORK_ID);
            expect(publicSummary(settings, ARTWORK_ID, [...reactions].reverse())).toEqual(summary);
            const visible = reactions.filter(r => !r.hidden);
            const stickerPublic =
              settings.enabled && settings.collect.sticker && settings.stickerVisibility === 'PUBLIC';
            for (const sticker of ['MOVED', 'LEARNED', 'GREAT', 'CURIOUS'] as const) {
              const count = stickerPublic ? visible.filter(r => r.sticker === sticker).length : 0;
              if (count === 0) expect(summary.stickers).not.toHaveProperty(sticker);
              else expect(summary.stickers[sticker]).toBe(count);
            }
            const scorePublic =
              settings.enabled && settings.collect.score && settings.scoreVisibility === 'PUBLIC';
            const scored = visible.filter(r => r.scoreFact !== null && r.scoreDelivery !== null);
            if (!scorePublic || scored.length === 0) expect(summary.score).toBeNull();
            else {
              expect(summary.score).toEqual({
                count: scored.length,
                factAvg: scored.reduce((sum, r) => sum + r.scoreFact!, 0) / scored.length,
                deliveryAvg: scored.reduce((sum, r) => sum + r.scoreDelivery!, 0) / scored.length,
              });
            }
            const memoPublic =
              settings.enabled && settings.collect.memo && settings.memoVisibility === 'SELECTED';
            const selected = visible
              .filter(r => memoPublic && r.publicSelected && r.memo !== null)
              .sort((a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            expect(summary.memos).toEqual(
              selected.map(r => ({
                nickname: settings.naming === 'NICKNAME' ? r.nickname : null,
                memo: r.memo,
              })),
            );
          }
        },
      ),
      { seed: 20261111, numRuns: 20 },
    );
  });
});
