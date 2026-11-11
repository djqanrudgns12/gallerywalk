import { describe, expect, it } from 'vitest';
import { pageText } from './textPages.ts';

/** 글자 10자마다 한 줄(높이 10), 문단 여백 5 — 시험용 재기 */
const measure = (s: string): number => Math.ceil([...s].length / 10) * 10 + 5;

describe('글 크게 보기 쪽 나눔', () => {
  it('문단을 쪽 높이 안에 앞에서부터 담고, 문단은 쪽 사이에서 나누지 않는다', () => {
    const text = ['가'.repeat(25), '나'.repeat(25), '다'.repeat(25)].join('\n');
    const r = pageText(text, 70, measure);
    expect(r.poem).toBe(false);
    // 문단 높이 35 — 두 개(70)씩
    expect(r.pages.map(p => p.map(x => x.group))).toEqual([[0, 1], [2]]);
  });

  it('쪽보다 긴 문단만 문장 끝에서 쪼개 이어 담는다(같은 덩어리 번호)', () => {
    const long = `${'가'.repeat(30)}다. ${'나'.repeat(30)}요. ${'라'.repeat(30)}다.`;
    const r = pageText(long, 50, measure);
    expect(r.pages.length).toBeGreaterThan(1);
    expect(r.pages.flat().every(p => p.group === 0)).toBe(true);
    expect(
      r.pages
        .flat()
        .map(p => p.text)
        .join(' '),
    ).toBe(long);
  });

  it('시(연 단위): 연을 쪽 사이에서 나누지 않는다', () => {
    const poem = ['첫 줄', '둘째 줄', '셋째 줄', '', '넷째 줄', '다섯째 줄', '여섯째 줄'].join('\n');
    const r = pageText(poem, 30, (s, isPoem) => (isPoem ? s.split('\n').length * 10 : 999));
    expect(r.poem).toBe(true);
    expect(r.pages.map(p => p.map(x => x.text))).toEqual([
      ['첫 줄\n둘째 줄\n셋째 줄'],
      ['넷째 줄\n다섯째 줄\n여섯째 줄'],
    ]);
  });

  it('빈 글은 빈 쪽 하나', () => {
    expect(pageText('', 100, measure).pages).toEqual([[]]);
  });
});
