import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { config } from '../../config.ts';
import { coversExactly, planImagePages, splitAlongAxis, type ImagePageInput } from './planImagePages.ts';

/** 시험용 화면(줌에서 작품이 차지할 수 있는 영역, 캡션 자리를 뺀 CSS px) */
const DESKTOP = { w: 1200, h: 780 };
const TABLET_PORTRAIT = { w: 768, h: 900 };
const PHONE_PORTRAIT = { w: 360, h: 560 };
const PHONE_LANDSCAPE = { w: 740, h: 300 };

/** 글자 큰 A4 포스터: 줄 간격 8mm → 300dpi 94px, 150dpi 47px */
const a4Poster = (dpi: 150 | 300): ImagePageInput => ({
  form: 'PORTRAIT',
  textHeavy: true,
  pageMode: 'AUTO',
  content: dpi === 300 ? { w: 2480, h: 3508 } : { w: 1240, h: 1754 },
  linePitchPx: dpi === 300 ? 94 : 47,
  lineProfile: null,
  profileBinPx: 8,
});

const webtoon = (profile: Uint8Array | null = null): ImagePageInput => ({
  form: 'TALL',
  textHeavy: true,
  pageMode: 'AUTO',
  content: { w: 800, h: 20000 },
  linePitchPx: null,
  lineProfile: profile,
  profileBinPx: 8,
});

describe('planImagePages — A4 글 작품', () => {
  it('데스크톱에서는 한 장으로 보인다', () => {
    const plan = planImagePages(a4Poster(300), DESKTOP);
    expect(plan.fit).toBe('contain');
    expect(plan.pages).toHaveLength(1);
    expect(plan.readable).toBe(true);
  });

  it('고해상도로 올려도 저해상도와 같은 결과다 (C3 회귀)', () => {
    for (const vp of [DESKTOP, TABLET_PORTRAIT, PHONE_PORTRAIT, PHONE_LANDSCAPE]) {
      const hi = planImagePages(a4Poster(300), vp);
      const lo = planImagePages(a4Poster(150), vp);
      expect(hi.fit).toBe(lo.fit);
      expect(hi.pages.length).toBe(lo.pages.length);
      expect(hi.rotateHint).toBe(lo.rotateHint);
    }
  });

  it('휴대폰 세로에서는 나눠도 글자가 커지지 않아 한 장 + 회전 안내 (ADR-047)', () => {
    const plan = planImagePages(a4Poster(300), PHONE_PORTRAIT);
    expect(plan.fit).toBe('contain');
    expect(plan.readable).toBe(false);
    expect(plan.rotateHint).toBe(true);
  });

  it('휴대폰 가로에서는 긴 축으로 나눠 글자가 읽힌다', () => {
    const plan = planImagePages(a4Poster(300), PHONE_LANDSCAPE);
    expect(plan.fit).toBe('split');
    expect(plan.axis).toBe('y');
    expect(plan.pages.length).toBeGreaterThan(1);
    expect(plan.readable).toBe(true);
    expect(plan.rotateHint).toBe(false);
  });

  it('교사가 한 장으로 보기를 고르면 나누지 않는다', () => {
    const plan = planImagePages({ ...a4Poster(300), pageMode: 'SINGLE' }, PHONE_LANDSCAPE);
    expect(plan.pages).toHaveLength(1);
  });

  it('글 많음이 아닌 보통 그림은 나누지 않는다 (PRD 6.7-3)', () => {
    const plan = planImagePages({ ...a4Poster(300), textHeavy: false }, PHONE_LANDSCAPE);
    expect(plan.pages).toHaveLength(1);
    expect(plan.rotateHint).toBe(false);
  });
});

describe('planImagePages — 웹툰(긴 세로)', () => {
  it('항상 긴 축으로 나누고, 데스크톱이 휴대폰보다 쪽이 적다', () => {
    const desktop = planImagePages(webtoon(), DESKTOP);
    const phone = planImagePages(webtoon(), PHONE_PORTRAIT);
    expect(desktop.fit).toBe('split');
    expect(phone.fit).toBe('split');
    expect(desktop.pages.length).toBeLessThan(phone.pages.length);
  });

  it('웹툰에는 회전 안내를 하지 않는다 (세로로 보게 만든 작품)', () => {
    expect(planImagePages(webtoon(), PHONE_PORTRAIT).rotateHint).toBe(false);
  });

  it('자를 자리 근처의 비어 있는 줄(컷 사이)에서 자른다', () => {
    const bin = 8;
    const profile = new Uint8Array(Math.ceil(20000 / bin)).fill(200);
    profile[Math.floor(960 / bin)] = 0; // 화면 길이 1000 기준 처음 자를 자리(1000) 40px 앞의 컷 사이
    const pages = splitAlongAxis(20000, 1000, webtoon(profile));
    expect(Math.abs(pages[0]!.end - 960)).toBeLessThanOrEqual(bin);
  });

  it('활동이 고르면 처음 정한 자리 가까이에서 자른다', () => {
    const profile = new Uint8Array(Math.ceil(20000 / 8)).fill(120);
    const pages = splitAlongAxis(20000, 1000, webtoon(profile));
    expect(Math.abs(pages[0]!.end - 1000)).toBeLessThanOrEqual(8);
  });
});

describe('splitAlongAxis — 덮기 불변식', () => {
  it('어떤 길이·화면·활동 배열이든 빈틈 없이 덮는다', () => {
    const c = config();
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 40000 }),
        fc.integer({ min: 200, max: 3000 }),
        fc.uint8Array({ minLength: 0, maxLength: 600 }),
        (longLen, viewLen, profile) => {
          const input: ImagePageInput = {
            ...webtoon(profile.length > 0 ? profile : null),
            content: { w: 800, h: longLen },
          };
          const pages = splitAlongAxis(longLen, viewLen, input);
          const overlap = longLen <= viewLen ? 0 : Math.ceil(c.PAGE_OVERLAP * viewLen);
          expect(coversExactly(pages, longLen, overlap, viewLen)).toBe(true);
          // 마지막 쪽 말고는 화면의 60% 이상
          for (const p of pages.slice(0, -1)) {
            expect(p.end - p.start).toBeGreaterThanOrEqual(Math.floor(c.CUT_MIN_PAGE_RATIO * viewLen));
          }
        },
      ),
      { seed: 20261111, numRuns: 300 },
    );
  });

  it('쪽 수는 겹침을 반영한 식과 같다 (활동 배열이 없을 때)', () => {
    const c = config();
    const L = 20000;
    const V = 1231;
    const O = Math.ceil(c.PAGE_OVERLAP * V);
    const pages = splitAlongAxis(L, V, webtoon());
    expect(pages).toHaveLength(Math.max(1, Math.ceil((L - O) / (V - O))));
  });
});
