import { describe, expect, it } from 'vitest';
import { facadeTitle } from './ko.ts';

describe('정면 이름판 제목(facadeTitle)', () => {
  it('전시 이름 뒤에 전시관을 붙인다', () => {
    expect(facadeTitle('S.O.S. 연대기')).toBe('S.O.S. 연대기 전시관');
  });

  it('이미 전시를 뜻하는 말로 끝나면 덧붙이지 않는다("합성 전시 전시관"처럼 겹치지 않게)', () => {
    expect(facadeTitle('우리 반 그림 전시')).toBe('우리 반 그림 전시');
    expect(facadeTitle('S.O.S. 연대기 전시관')).toBe('S.O.S. 연대기 전시관');
    expect(facadeTitle(' 봄 미술관 ')).toBe('봄 미술관');
  });
});
