import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareNatural, compareNaturalSegments } from './naturalSort.ts';

const sorted = (xs: readonly string[]): string[] => [...xs].sort(compareNatural);

describe('compareNatural', () => {
  it('숫자는 값으로: 2 < 10', () => {
    expect(compareNatural('2', '10')).toBeLessThan(0);
    expect(sorted(['10_바다.png', '2_하늘.png', '1_땅.png'])).toEqual([
      '1_땅.png',
      '2_하늘.png',
      '10_바다.png',
    ]);
  });

  it('같은 숫자면 한국어 순서', () => {
    expect(sorted(['3_다람쥐', '3_나비', '3_가지'])).toEqual(['3_가지', '3_나비', '3_다람쥐']);
  });

  it('Collator가 같다고 보는 두 글도 순서가 정해진다(02 · 2)', () => {
    const c = compareNatural('02_가', '2_가');
    expect(c).not.toBe(0);
    expect(compareNatural('2_가', '02_가')).toBe(-c);
  });

  it('0은 두 글이 완전히 같을 때만', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const ab = compareNatural(a, b);
        expect(ab === 0).toBe(a === b);
        // 뒤집으면 부호도 뒤집힌다(같으면 둘 다 0)
        expect(Math.sign(compareNatural(b, a)) + Math.sign(ab)).toBe(0);
      }),
      { seed: 20261111, numRuns: 500 },
    );
  });

  it('입력 순서를 섞어도 정렬 결과가 같다', () => {
    const pool = [
      '10',
      '2',
      '02',
      '1_가',
      '1_나',
      '가',
      'A',
      'a',
      '나10',
      '나2',
      '',
      '하늘 고래',
      '하늘_고래',
    ];
    fc.assert(
      fc.property(
        fc
          .array(fc.constantFrom(...pool), { maxLength: 20 })
          .chain(xs =>
            fc.tuple(
              fc.constant(xs),
              fc.shuffledSubarray(xs, { minLength: xs.length, maxLength: xs.length }),
            ),
          ),
        ([xs, shuffled]) => {
          expect(sorted(shuffled)).toEqual(sorted(xs));
        },
      ),
      { seed: 20261111, numRuns: 500 },
    );
  });
});

describe('compareNaturalSegments', () => {
  it('앞 조각부터 비교하고, 같으면 짧은 쪽(부모)이 앞', () => {
    expect(compareNaturalSegments(['2_가'], ['10_나'])).toBeLessThan(0);
    expect(compareNaturalSegments(['가', '10.png'], ['가', '2.png'])).toBeGreaterThan(0);
    expect(compareNaturalSegments(['가'], ['가', 'x.png'])).toBeLessThan(0);
    expect(compareNaturalSegments(['가', 'x.png'], ['가', 'x.png'])).toBe(0);
  });
});
