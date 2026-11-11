import { describe, expect, it } from 'vitest';
import {
  looksLikePoem,
  planTextPages,
  splitBlocks,
  splitOversizeBlock,
  type TextUnit,
} from './planTextPages.ts';

const units = (...spec: Array<[group: number, height: number]>): TextUnit[] =>
  spec.map(([group, height]) => ({ group, height }));

describe('planTextPages', () => {
  it('넘치기 전까지 한 쪽에 담는다', () => {
    expect(planTextPages(units([0, 100], [1, 100], [2, 100]), 250)).toEqual([
      { first: 0, last: 1 },
      { first: 2, last: 2 },
    ]);
  });

  it('덩어리(연)를 쪽 사이에서 나누지 않는다', () => {
    // 1번 연이 두 조각(100+100)인데 첫 쪽에 하나만 들어간다 → 연 전체를 다음 쪽으로
    expect(planTextPages(units([0, 150], [1, 100], [1, 100]), 300)).toEqual([
      { first: 0, last: 0 },
      { first: 1, last: 2 },
    ]);
  });

  it('쪽보다 긴 덩어리만 조각 단위로 넘어간다', () => {
    expect(planTextPages(units([0, 120], [0, 120], [0, 120]), 300)).toEqual([
      { first: 0, last: 1 },
      { first: 2, last: 2 },
    ]);
  });

  it('쪽보다 높은 조각은 혼자 한 쪽을 쓴다', () => {
    expect(planTextPages(units([0, 50], [1, 500], [2, 50]), 300)).toEqual([
      { first: 0, last: 0 },
      { first: 1, last: 1 },
      { first: 2, last: 2 },
    ]);
  });

  it('모든 조각이 정확히 한 번씩 담긴다', () => {
    const u = units([0, 80], [0, 90], [1, 300], [2, 40], [2, 40], [3, 260], [4, 10]);
    const pages = planTextPages(u, 280);
    const covered = pages.flatMap(p => Array.from({ length: p.last - p.first + 1 }, (_, k) => p.first + k));
    expect(covered).toEqual(u.map((_, i) => i));
  });
});

describe('글 나누기 도우미', () => {
  const poem = '하늘에 별이\n하나 둘 셋\n\n바람이 불면\n별도 흔들려\n\n나는 그 별을\n오래 본다';

  it('빈 줄로 나뉜 짧은 줄들은 시로 본다', () => {
    expect(looksLikePoem(poem)).toBe(true);
    expect(looksLikePoem('을사늑약이 맺어진 1905년, 사람들은 크게 분노했다. 의병이 곳곳에서 일어났다.')).toBe(
      false,
    );
  });

  it('시는 연 단위, 산문은 문단 단위로 나눈다', () => {
    expect(splitBlocks(poem, true)).toHaveLength(3);
    expect(splitBlocks('첫 문단입니다.\n둘째 문단입니다.', false)).toHaveLength(2);
  });

  it('긴 문단은 문장 끝에서, 긴 연은 줄에서 쪼갠다', () => {
    expect(splitOversizeBlock('의병이 일어났다. 사람들이 모였다! 무엇을 했을까? 끝.', false)).toEqual([
      '의병이 일어났다.',
      '사람들이 모였다!',
      '무엇을 했을까?',
      '끝.',
    ]);
    expect(splitOversizeBlock('하늘에 별이\n하나 둘 셋', true)).toEqual(['하늘에 별이', '하나 둘 셋']);
  });
});
