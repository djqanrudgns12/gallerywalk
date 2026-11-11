/**
 * 자연 정렬(PLAN §5.2): 숫자는 값으로(`2` < `10`), 같은 숫자면 한국어 정렬.
 * `Intl.Collator`가 같다고 보는 두 글(예: `02`와 `2`)은 원래 문자열의 코드 단위 순서로 동률을 깬다 —
 * 그래서 입력 순서와 상관없이 늘 같은 순서가 나온다(결정적).
 */

const collator = new Intl.Collator('ko', { numeric: true });

/** 두 글을 자연 정렬로 비교한다. 0은 두 글이 완전히 같을 때만 나온다. */
export const compareNatural = (a: string, b: string): number => {
  const byCollator = collator.compare(a, b);
  if (byCollator !== 0) return byCollator < 0 ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/**
 * 경로 조각 배열을 앞 조각부터 자연 정렬로 비교한다. 앞 조각이 모두 같으면 짧은 쪽(부모)이 앞.
 * 경로를 통째로 비교하면 `/`와 다른 글자의 순서가 끼어들어 폴더 안 순서가 흐트러진다.
 */
export const compareNaturalSegments = (a: readonly string[], b: readonly string[]): number => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = compareNatural(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return a.length - b.length;
};
