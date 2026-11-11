import { describe, expect, it } from 'vitest';
import { clampLines, tidyLines, wrapText } from './textCard.ts';

/** 글자마다 폭 1(시험용) */
const measure = (s: string): number => [...s].length;

describe('글 카드 줄바꿈', () => {
  it('띄어쓰기 단위로 채우고, 줄바꿈 문자와 빈 줄(문단 사이)은 그대로', () => {
    expect(wrapText('하나 둘 셋 넷\n\n다섯', 7, measure)).toEqual(['하나 둘 셋', '넷', '', '다섯']);
  });

  it('줄보다 긴 낱말은 글자 단위로 자른다', () => {
    expect(wrapText('가나다라마바사아', 3, measure)).toEqual(['가나다', '라마바', '사아']);
    expect(wrapText('앞 가나다라마', 3, measure)).toEqual(['앞', '가나다', '라마']);
  });

  it('넘치면 마지막 줄 끝을 말줄임표로, 폭 안에 들게 글자를 덜어낸다', () => {
    expect(clampLines(['가나다', '라마바', '사아'], 2, 3, measure)).toEqual(['가나다', '라마…']);
    expect(clampLines(['가나', '다'], 5, 3, measure)).toEqual(['가나', '다']);
    expect(clampLines(['가나'], 0, 3, measure)).toEqual([]);
  });

  it('앞뒤 빈 줄을 걷고 문단 사이 빈 줄은 하나로', () => {
    expect(tidyLines(['', '가', '', '', '나', ''])).toEqual(['가', '', '나']);
  });
});
