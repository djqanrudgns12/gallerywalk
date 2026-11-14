import { ALLOWED_WORD_ENDINGS, ALLOWED_WORDS, DEFAULT_LIST } from './profanityList.ts';

/** 숫자도 삽입 우회로 보아 뺀다. 제거 후 다시 NFKC하여 나뉜 조합형 자모도 합친다. */
const compact = (text: string): string =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '')
    .normalize('NFKC');

/** 목록의 비교용 모양. 연속된 같은 코드 포인트는 하나로 줄인다. */
export const normalizeForProfanity = (text: string): string => compact(text).replace(/(.)\1+/gu, '$1');

// 완성형을 전부 초성으로 바꾸면 서로 다른 정상 낱말도 같아진다.
// 목록 음절과 정확히 같거나, 그 자리에 독립 초성이 온 경우만 같은 것으로 본다.
const patternFor = (term: string): RegExp | null => {
  const normalized = normalizeForProfanity(term);
  if (normalized === '') return null;
  const chars = Array.from(normalized);
  return new RegExp(
    chars
      .map(char => {
        const initial = /^[가-힣]$/u.test(char) ? char.normalize('NFD').charAt(0) : undefined;
        const alternatives = initial !== undefined && chars.length > 1 ? `${char}|${initial}` : char;
        // 입력의 반복을 패턴에서 소비한다. 초성이 같은 두 음절도 한 글자로 합쳐지지 않는다.
        return `(?:${alternatives})+`;
      })
      .join(''),
    'u',
  );
};

const patternsFor = (list: readonly string[]): RegExp[] =>
  list.map(patternFor).filter((pattern): pattern is RegExp => pattern !== null);
const DEFAULT_PATTERNS = patternsFor(DEFAULT_LIST);
const ALLOWED_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${ALLOWED_WORDS.join('|')})(?:${ALLOWED_WORD_ENDINGS.join('|')})?(?![\\p{L}\\p{N}])`,
  'gu',
);

/**
 * 별명·메모의 최소 필터. 예외는 정규화 전 낱말 단위로 나눠 제거하여, 예외 양옆이 이어지지 않게 한다.
 * 목록은 이미 정규화한 모양이 기본이지만 시험·호출자가 넣은 목록도 같은 규칙을 거친다.
 */
export const isBlocked = (text: string, list: readonly string[] = DEFAULT_LIST): boolean => {
  const patterns = list === DEFAULT_LIST ? DEFAULT_PATTERNS : patternsFor(list);
  const segments = text.normalize('NFKC').toLowerCase().split(ALLOWED_PATTERN).map(compact);
  return segments.some(segment => patterns.some(pattern => pattern.test(segment)));
};
