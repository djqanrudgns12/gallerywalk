import { describe, expect, it } from 'vitest';
import { fitSign, type FitInput, type MeasureEm, wrapWords } from './fitSign.ts';

/** 가짜 글 폭: 한글 1em, 띄어쓰기 0.3em, 숫자·라틴 0.55em(캔버스 없이 결정적) */
const fake: MeasureEm = t =>
  Array.from(t).reduce((s, ch) => s + (ch === ' ' ? 0.3 : /[가-힣]/.test(ch) ? 1 : 0.55), 0);

/** 줄들을 다시 이어 붙이면 띄어쓰기를 뺀 원문과 같아야 한다(자르기·`…` 없음) */
const squash = (s: string): string => s.replace(/\s+/g, '');

const base = (over: Partial<FitInput>): FitInput => ({
  text: '',
  box: { w: 5.6, h: 0.9 },
  maxSize: 0.42,
  minSize: 0.22,
  maxLines: 2,
  lineHeight: 1.15,
  measure: fake,
  ...over,
});

/** 30자(전시실 이름 상한) — 띄어쓰기 있는 것과 없는 것 */
const LONG_SPACED = '우리 반 친구들이 함께 만든 사계절 그림 이야기 전시실';
const LONG_SOLID = '가나다라마바사아자차카타파하가나다라마바사아자차카타파하거너';

describe('안내판 글 맞추기(W-03)', () => {
  it('짧은 글은 상한 크기 한 줄', () => {
    const r = fitSign(base({ text: '봄 그림' }));
    expect(r.size).toBe(0.42);
    expect(r.lines).toEqual(['봄 그림']);
    expect(r.grown).toBe(false);
    expect(r.width).toBeCloseTo(fake('봄 그림') * 0.42, 6);
  });

  it('긴 방 이름 30자도 가로 압축·자르기 없이 들어간다(레터링 상자 5.6×0.9m)', () => {
    for (const text of [LONG_SPACED, LONG_SOLID]) {
      expect(Array.from(text)).toHaveLength(30);
      const r = fitSign(base({ text }));
      expect(squash(r.lines.join(''))).toBe(squash(text));
      expect(r.lines.some(l => l.includes('…'))).toBe(false);
      expect(r.lines.length).toBeLessThanOrEqual(2);
      expect(r.size).toBeGreaterThanOrEqual(0.22);
      // 줄마다 실제 폭(크기 비례 그대로)이 상자 안
      for (const l of r.lines) expect(fake(l) * r.size).toBeLessThanOrEqual(5.6 + 1e-9);
      expect(r.height).toBeLessThanOrEqual(0.9 + 1e-9);
      expect(r.grown).toBe(false);
    }
  });

  it('줄 나눔은 어절 기준 — 어절 안에서 끊지 않는다', () => {
    const r = fitSign(base({ text: LONG_SPACED }));
    const words = new Set(LONG_SPACED.split(' '));
    expect(r.brokeWord).toBe(false);
    for (const l of r.lines) for (const w of l.split(' ')) expect(words.has(w)).toBe(true);
  });

  it('너무 긴 어절만 글자 단위로 나눈다', () => {
    const r = fitSign(base({ text: `1관 ${LONG_SOLID}` }));
    expect(r.brokeWord).toBe(true);
    expect(r.lines[0]?.startsWith('1관 ')).toBe(true);
    expect(squash(r.lines.join(''))).toBe(squash(`1관 ${LONG_SOLID}`));
    // 나누지 않아도 들어가는 짧은 어절들은 그대로
    // '봄 여름' = 1 + 0.3 + 2 = 3.3em
    const w = wrapWords('봄 여름 가을', 3.5, fake, false);
    expect(w?.lines).toEqual(['봄 여름', '가을']);
    expect(wrapWords('가나다라마', 3, fake, false)).toBeNull();
    expect(wrapWords('가나다라마', 3, fake, true)?.lines).toEqual(['가나다', '라마']);
  });

  it('줄 수 상한을 지킨다 — 상한 안에서 가장 큰 크기', () => {
    const r = fitSign(
      base({ text: '하나 둘 셋 넷 다섯 여섯', box: { w: 2, h: 3 }, minSize: 0.1, maxLines: 1 }),
    );
    expect(r.lines).toHaveLength(1);
    // 한 줄 폭이 2m 안에 드는 가장 큰 1mm 크기
    const em = fake('하나 둘 셋 넷 다섯 여섯');
    expect(r.size).toBe(Math.floor((2 / em) * 1000) / 1000);
  });

  it('줄 수가 상한을 넘으면 하한까지 줄이다가, 하한에서도 넘치면 상자를 넓힌다', () => {
    const r = fitSign(
      base({ text: LONG_SOLID, box: { w: 1.2, h: 0.4 }, maxSize: 0.16, minSize: 0.12, maxLines: 2 }),
    );
    expect(r.grown).toBe(true);
    expect(r.size).toBe(0.12);
    expect(r.lines.length).toBeLessThanOrEqual(2);
    expect(r.box.w).toBeGreaterThan(1.2);
    expect(r.box.w).toBeGreaterThanOrEqual(r.width - 1e-9);
    expect(squash(r.lines.join(''))).toBe(squash(LONG_SOLID));
    // 넓힌 폭은 꼭 필요한 만큼(1mm 좁으면 3줄)
    const narrower = wrapWords(LONG_SOLID, (r.box.w - 0.002) / 0.12, fake, true);
    expect(narrower?.lines.length ?? 0).toBeGreaterThan(2);
  });

  it('줄 수는 들어가도 높이가 넘치면 높이만 키운다', () => {
    const body = Array.from({ length: 12 }, (_, i) => `${i + 1} 합성 전시실`).join('\n');
    const r = fitSign(
      base({
        text: body,
        box: { w: 1, h: 0.5 },
        maxSize: 0.075,
        minSize: 0.045,
        maxLines: 24,
        lineHeight: 1.45,
      }),
    );
    expect(r.grown).toBe(true);
    expect(r.size).toBe(0.045);
    expect(r.lines).toHaveLength(12);
    expect(r.box.w).toBe(1);
    expect(r.box.h).toBeCloseTo(12 * 1.45 * 0.045, 6);
  });

  it('문단(줄바꿈)은 새 줄에서 시작하고 빈 글은 줄이 없다', () => {
    const r = fitSign(base({ text: '첫째 줄\n둘째 줄', box: { w: 5, h: 2 } }));
    expect(r.lines).toEqual(['첫째 줄', '둘째 줄']);
    const e = fitSign(base({ text: '   ' }));
    expect(e.lines).toEqual([]);
    expect(e.height).toBe(0);
  });

  it('하한이 상한보다 크게 들어와도 상한을 넘지 않는다', () => {
    const r = fitSign(base({ text: '봄', maxSize: 0.2, minSize: 0.3 }));
    expect(r.size).toBe(0.2);
  });
});
