/**
 * 안내판 글 맞추기(PRD_V2 W-03, ADR-071 결정 3) — 순수 함수. 공간 v4(`schemaVersion === 3`) 사인만 쓴다.
 *
 * - **가로 압축 금지**: 글 폭은 글꼴 크기에 비례한 그대로다(캔버스 `maxWidth`로 누르지 않는다).
 * - **`…` 자르기 금지**: 모든 글자가 어느 줄엔가 그대로 들어간다.
 * - 줄 나눔은 어절(띄어쓰기) 기준. 한 어절이 한 줄보다 길 때만 그 어절을 글자 단위로 나눈다.
 * - 상한 크기에서 시작해 들어갈 때까지 줄인다(1mm 단위). 하한에서도 넘치면 **상자를 키운 크기**를 돌려준다
 *   — 판이 커지는 쪽이 글이 잘리는 쪽보다 낫다.
 *
 * 글 폭은 넘겨받은 `measure`로 잰다(글꼴 크기 1에서의 폭). 기기에서는 캔버스 `measureText`, 시험에서는 가짜 함수.
 */

/** 글꼴 크기 1(단위 없음)에서 글의 앞폭 */
export type MeasureEm = (text: string) => number;

export interface FitBox {
  readonly w: number;
  readonly h: number;
}

export interface FitInput {
  readonly text: string;
  /** 글을 담는 상자(m) */
  readonly box: FitBox;
  /** 글꼴 크기 상한·하한(m) */
  readonly maxSize: number;
  readonly minSize: number;
  readonly maxLines: number;
  /** 줄 간격(글꼴 크기 배수) */
  readonly lineHeight: number;
  readonly measure: MeasureEm;
}

export interface FitResult {
  /** 고른 글꼴 크기(m, 1mm 단위) */
  readonly size: number;
  readonly lines: readonly string[];
  /** 실제로 차지하는 폭(가장 긴 줄)·높이(줄 수 × 줄 간격 × 크기), m */
  readonly width: number;
  readonly height: number;
  /** 글을 담은 상자: 들어가면 받은 상자 그대로, 하한에서도 넘치면 키운 상자 */
  readonly box: FitBox;
  readonly grown: boolean;
  /** 한 줄보다 긴 어절을 글자 단위로 나눴음 */
  readonly brokeWord: boolean;
}

/** 크기·폭을 찾는 단위(1mm) */
const PER_M = 1000;
/** 부동소수 비교 여유 */
const EPS = 1e-9;

interface Wrapped {
  readonly lines: string[];
  readonly broke: boolean;
}

/**
 * 어절 단위 줄 나눔(탐욕). 폭 `widthEm`은 글꼴 크기 1 기준. 한 어절이 폭보다 길면 `breakLong`일 때만 글자 단위로 나누고,
 * 아니면 `null`(이 크기에서는 들어가지 않음). 문단(`\n`)은 늘 새 줄에서 시작한다.
 */
export const wrapWords = (
  text: string,
  widthEm: number,
  measure: MeasureEm,
  breakLong: boolean,
): Wrapped | null => {
  const lines: string[] = [];
  let broke = false;
  for (const para of text.split('\n')) {
    const words = para.split(/[ \t]+/).filter(w => w.length > 0);
    let line = '';
    for (const word of words) {
      const joined = line ? `${line} ${word}` : word;
      if (measure(joined) <= widthEm + EPS) {
        line = joined;
        continue;
      }
      if (measure(word) <= widthEm + EPS) {
        if (line) lines.push(line);
        line = word;
        continue;
      }
      if (!breakLong) return null;
      // 한 줄보다 긴 어절: 지금 줄의 남은 자리부터 글자로 채운다(앞 줄을 먼저 밀어내면 줄 수만 늘어난다)
      broke = true;
      let chunk = line ? `${line} ` : '';
      for (const ch of Array.from(word)) {
        const next = chunk + ch;
        if (chunk.trim() && measure(next) > widthEm + EPS) {
          lines.push(chunk.trimEnd());
          chunk = ch;
        } else chunk = next;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return { lines, broke };
};

const widest = (lines: readonly string[], measure: MeasureEm): number =>
  lines.reduce((m, l) => Math.max(m, measure(l)), 0);

/** 같은 글을 여러 번 재므로 이 맞추기 동안만 기억한다 */
const cached = (measure: MeasureEm): MeasureEm => {
  const memo = new Map<string, number>();
  return t => {
    const hit = memo.get(t);
    if (hit !== undefined) return hit;
    const v = measure(t);
    memo.set(t, v);
    return v;
  };
};

export const fitSign = (input: FitInput): FitResult => {
  const { box, lineHeight, maxLines } = input;
  const text = input.text.replace(/\r/g, '').trim();
  const measure = cached(input.measure);
  const maxK = Math.max(1, Math.floor(input.maxSize * PER_M + EPS));
  const minK = Math.min(maxK, Math.max(1, Math.ceil(input.minSize * PER_M - EPS)));
  if (!text)
    return { size: maxK / PER_M, lines: [], width: 0, height: 0, box, grown: false, brokeWord: false };

  const tryAt = (k: number, breakLong: boolean): FitResult | null => {
    const size = k / PER_M;
    const r = wrapWords(text, box.w / size, measure, breakLong);
    if (!r || r.lines.length > maxLines) return null;
    const height = r.lines.length * lineHeight * size;
    const width = widest(r.lines, measure) * size;
    if (height > box.h + EPS || width > box.w + EPS) return null;
    return { size, lines: r.lines, width, height, box, grown: false, brokeWord: r.broke };
  };
  // 들어가는 가장 큰 크기(크기가 작을수록 한 줄에 더 많이 들어가므로 이분 탐색)
  const largest = (breakLong: boolean): FitResult | null => {
    let lo = minK;
    let hi = maxK;
    let best: FitResult | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = tryAt(mid, breakLong);
      if (r) {
        best = r;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  };
  // 어절을 나누지 않고 들어가면 그것, 아니면 긴 어절만 글자 단위로 나눠서
  const fit = largest(false) ?? largest(true);
  if (fit) return fit;

  // 하한에서도 넘침 → 줄 수 상한 안에 드는 가장 좁은 폭까지 상자를 넓히고, 높이는 글에 맞춘다
  const size = minK / PER_M;
  const lineCount = (wMm: number): number =>
    (wrapWords(text, wMm / PER_M / size, measure, true) ?? { lines: [] }).lines.length;
  const fromMm = Math.ceil(box.w * PER_M - EPS);
  const paragraphs = text.split('\n');
  const oneLineMm = Math.max(
    fromMm,
    Math.ceil(
      widest(
        paragraphs.map(p =>
          p
            .split(/[ \t]+/)
            .filter(Boolean)
            .join(' '),
        ),
        measure,
      ) *
        size *
        PER_M,
    ),
  );
  let lo = fromMm;
  let hi = oneLineMm;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lineCount(mid) <= maxLines) hi = mid;
    else lo = mid + 1;
  }
  const r = wrapWords(text, lo / PER_M / size, measure, true) ?? { lines: [text], broke: false };
  const width = widest(r.lines, measure) * size;
  const height = r.lines.length * lineHeight * size;
  return {
    size,
    lines: r.lines,
    width,
    height,
    box: { w: Math.max(box.w, width), h: Math.max(box.h, height) },
    grown: true,
    brokeWord: r.broke,
  };
};
