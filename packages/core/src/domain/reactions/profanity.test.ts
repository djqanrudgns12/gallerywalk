import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isBlocked, normalizeForProfanity } from './profanity.ts';
import { DEFAULT_LIST } from './profanityList.ts';

const FAKE_LIST = ['가짜욕', '나쁜말', 'fakeword'];

describe('isBlocked', () => {
  it('가상 목록의 낱말·문장 속 낱말을 찾고 나머지는 허용한다', () => {
    expect(isBlocked('가짜욕', FAKE_LIST)).toBe(true);
    expect(isBlocked('앞에 나쁜말 뒤에', FAKE_LIST)).toBe(true);
    expect(isBlocked('즐거운 전시', FAKE_LIST)).toBe(false);
    expect(isBlocked('', FAKE_LIST)).toBe(false);
    expect(isBlocked('가짜욕', [])).toBe(false);
    expect(isBlocked('평범한 말', ['', '  ', '123', '...'])).toBe(false);
  });

  it('NFKC·소문자·숫자·공백·기호·반복 우회를 함께 처리한다', () => {
    for (const text of [
      '가 짜 욕',
      '가.짜!욕',
      '가1짜2욕',
      '가１짜２욕',
      '가가짜짜짜욕욕',
      '가\u200b짜\u200d욕',
      '가\u0301짜욕',
      '가\ufe0f짜욕',
      'ＦＡＫＥＷＯＲＤ',
      'F.a1K2E-W_o_R_d',
      '가짜욕'.normalize('NFD'),
    ])
      expect(isBlocked(text, FAKE_LIST)).toBe(true);
  });

  it('호환 자모·정규 자모·일부 음절을 초성으로 바꾼 우회를 잡는다', () => {
    for (const text of ['ㄱㅉㅇ', 'ㄱ.ㅉ1ㅇ', 'ㄱㄱㅉㅉㅇㅇ', '가ㅉ욕', 'ㄱ짜ㅇ'])
      expect(isBlocked(text, FAKE_LIST)).toBe(true);
    expect(isBlocked('ᄀᄍᄋ', FAKE_LIST)).toBe(true);
    // 초성이 같은 정상 음절까지 전부 같은 말로 보지는 않는다.
    expect(isBlocked('가짜역', FAKE_LIST)).toBe(false);
    expect(isBlocked('나쁜물', FAKE_LIST)).toBe(false);
  });

  it('반복되는 초성을 가진 가상 낱말도 두 글자 이상을 요구한다', () => {
    expect(isBlocked('ㄱㄱ', ['고기'])).toBe(true);
    expect(isBlocked('ㄱ', ['고기'])).toBe(false);
    expect(isBlocked('ㄱ', ['가'])).toBe(false);
  });

  it('정상 낱말 예외는 낱말 단위로만 적용하고 다른 차단어를 가리지 않는다', () => {
    // 목록에는 욕설 대신 정상 낱말의 짧은 조각만 넣는다.
    for (const text of ['시발점', '시발역', '개나리', '수박씨', '출발은 시발점에서 해요'])
      expect(isBlocked(text, ['시', '개', '씨'])).toBe(false);
    expect(isBlocked('시발점 가짜욕', FAKE_LIST)).toBe(true);
    expect(isBlocked('시발점가짜욕', FAKE_LIST)).toBe(true);
    expect(isBlocked('가 시발점 짜욕', FAKE_LIST)).toBe(false);
  });

  it('가상 목록도 입력과 같은 정규화를 거친다', () => {
    expect(isBlocked('가짜욕', [' 가.짜1욕 '])).toBe(true);
    expect(isBlocked('fakeword', ['ＦＡＫＥＷＯＲＤ'])).toBe(true);
    expect(isBlocked('ㄱㅉㅇ', ['ㄱㅉㅇ'])).toBe(true);
  });

  it('삽입 문자와 반복 횟수가 바뀌어도 가상 차단어를 찾는다', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(' ', '.', '-', '_', '1', '９', '\u200b'), {
          minLength: 2,
          maxLength: 2,
        }),
        fc.integer({ min: 1, max: 6 }),
        (separators, repeats) => {
          const text = ['가', '짜', '욕']
            .map((char, index) => char.repeat(repeats) + (separators[index] ?? ''))
            .join('');
          expect(isBlocked(text, FAKE_LIST)).toBe(true);
        },
      ),
      { seed: 20261111, numRuns: 100 },
    );
  });

  it('기본 목록은 비어 있지 않고 중복 없이 정규화되어 있다', () => {
    expect(DEFAULT_LIST.length).toBeGreaterThan(0);
    expect(new Set(DEFAULT_LIST).size).toBe(DEFAULT_LIST.length);
    for (const entry of DEFAULT_LIST) {
      expect(entry.length).toBeGreaterThan(0);
      expect(normalizeForProfanity(entry)).toBe(entry);
    }
  });
});
