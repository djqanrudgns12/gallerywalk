import { config } from '@gallery/core/config';
import { describe, expect, it } from 'vitest';
import { testArtworkId, testExhibitionView } from '../../dev/testView.ts';
import {
  cardSize,
  EXIT_STOP_ID,
  fitFrame,
  resumeSlide,
  type Slide2D,
  slidesOf,
  step2d,
  swipeDir,
} from './slides.ts';

describe('slidesOf 넘기는 순서', () => {
  it('정지 지점 순서 그대로 작품만(외관·홀·소개는 건너뜀), 맨 끝에 출구 하나', () => {
    const view = testExhibitionView([4, 3]);
    const slides = slidesOf(view.layout);
    const artworkStops = view.layout.stops.filter(s => s.kind === 'artwork');
    expect(slides.map(s => s.stopId)).toEqual([...artworkStops.map(s => s.id), 'exit']);
    expect(slides.at(-1)?.kind).toBe('exit');
    // 외관·홀·소개가 실제로 있었는데 빠졌다
    expect(view.layout.stops.some(s => s.kind === 'roomIntro')).toBe(true);
    expect(view.layout.stops.some(s => s.kind === 'exterior')).toBe(true);
    expect(slides.filter(s => s.kind === 'artwork')).toHaveLength(7);
    // 첫 관이 먼저, 관 안 번호 순
    const first = slides[0];
    expect(first?.kind === 'artwork' && first.index).toBe(1);
    expect(first?.kind === 'artwork' && first.count).toBe(4);
  });

  it('보기 묶음에 없는 작품은 뺀다', () => {
    const view = testExhibitionView([4]);
    const gone = testArtworkId(0, 1);
    const slides = slidesOf(view.layout, id => id !== gone);
    expect(slides.some(s => s.kind === 'artwork' && s.artworkId === gone)).toBe(false);
    expect(slides).toHaveLength(4);
  });

  it('출구 정지 지점이 없어도 끝에 출구', () => {
    const view = testExhibitionView([2]);
    const layout = { ...view.layout, stops: view.layout.stops.filter(s => s.kind !== 'exit') };
    expect(slidesOf(layout).at(-1)).toEqual({ kind: 'exit', stopId: EXIT_STOP_ID });
  });
});

describe('step2d 넘기기', () => {
  it('처음에서 이전은 그대로, 끝(출구)에서 다음은 그대로, 한 번에 한 칸', () => {
    expect(step2d(5, { index: 0, page: 0 }, -1, 1)).toEqual({ index: 0, page: 0 });
    expect(step2d(5, { index: 0, page: 0 }, 1, 1)).toEqual({ index: 1, page: 0 });
    expect(step2d(5, { index: 3, page: 0 }, 1, 1)).toEqual({ index: 4, page: 0 });
    expect(step2d(5, { index: 4, page: 0 }, 1, 1)).toEqual({ index: 4, page: 0 });
    expect(step2d(5, { index: 4, page: 0 }, -1, 1)).toEqual({ index: 3, page: 0 });
  });

  it('글 작품에 쪽이 여럿이면 쪽부터, 끝 쪽에서 다음 장(첫 쪽)으로', () => {
    expect(step2d(5, { index: 2, page: 0 }, 1, 3)).toEqual({ index: 2, page: 1 });
    expect(step2d(5, { index: 2, page: 2 }, 1, 3)).toEqual({ index: 3, page: 0 });
    expect(step2d(5, { index: 2, page: 1 }, -1, 3)).toEqual({ index: 2, page: 0 });
    expect(step2d(5, { index: 2, page: 0 }, -1, 3)).toEqual({ index: 1, page: 0 });
  });
});

describe('resumeSlide 이어 볼 자리', () => {
  const slides: Slide2D[] = [
    { kind: 'artwork', stopId: 'a', artworkId: 'A', partId: 'p0', index: 1, count: 2 },
    { kind: 'artwork', stopId: 'b', artworkId: 'B', partId: 'p0', index: 2, count: 2 },
    { kind: 'artwork', stopId: 'c', artworkId: 'C', partId: 'p1', index: 1, count: 1 },
    { kind: 'exit', stopId: 'exit' },
  ];
  it('같은 정지 지점 → 같은 작품 → 같은 관 첫 작품 → 처음', () => {
    expect(resumeSlide(slides, { stopId: 'exit' })).toBe(3);
    expect(resumeSlide(slides, { stopId: 'old-b', artworkId: 'B', partId: 'p9' })).toBe(1);
    expect(resumeSlide(slides, { stopId: 'intro-p1', artworkId: null, partId: 'p1' })).toBe(2);
    expect(resumeSlide(slides, { stopId: 'exterior', artworkId: null, partId: null })).toBe(0);
    expect(resumeSlide(slides, null)).toBe(0);
  });
});

describe('swipeDir 밀기', () => {
  const c = config();
  it('왼쪽으로 충분히·빠르게 → 다음, 오른쪽 → 이전', () => {
    expect(swipeDir(-c.SWIPE_MIN_PX, 0, 100)).toBe(1);
    expect(swipeDir(c.SWIPE_MIN_PX + 20, 4, 100)).toBe(-1);
  });
  it('짧거나·세로가 크거나·느리면 넘기지 않음', () => {
    expect(swipeDir(-(c.SWIPE_MIN_PX - 1), 0, 100)).toBe(0);
    expect(swipeDir(-c.SWIPE_MIN_PX * 2, c.SWIPE_MIN_PX * 2, 100)).toBe(0);
    expect(swipeDir(-c.SWIPE_MIN_PX * 2, 0, c.SWIPE_MAX_MS + 1)).toBe(0);
  });
});

describe('fitFrame 액자 맞추기', () => {
  it('3D 비율 그대로 상자 안에 가장 크게(가로가 꽉 참)', () => {
    const f = fitFrame({ w: 400, h: 400 }, { w: 1.5, h: 1 }, 0.1, 0.05)!;
    expect(f.outerW).toBeLessThanOrEqual(400);
    expect(f.outerW).toBeGreaterThanOrEqual(398);
    expect(f.outerH).toBeLessThan(400);
    expect(f.frame).toBe(11);
    expect(f.mat).toBe(22);
    expect(Math.abs(f.artW / f.artH - 1.5)).toBeLessThan(0.02);
    expect(f.outerW).toBe(f.artW + 2 * (f.frame + f.mat));
  });
  it('세로로 긴 상자는 세로가 꽉 참, 테는 1px 이상', () => {
    const f = fitFrame({ w: 1000, h: 300 }, { w: 1, h: 1 }, 0, 0.0001)!;
    expect(f.outerH).toBeLessThanOrEqual(300);
    expect(f.frame).toBe(1);
    expect(f.mat).toBe(0);
  });
  it('상자 크기를 모르면 null', () => {
    expect(fitFrame({ w: 0, h: 300 }, { w: 1, h: 1 }, 0.1, 0.05)).toBeNull();
  });
});

describe('cardSize 글 카드 크기', () => {
  it('넓은 자리: 높이가 꽉 차고 벽 카드 비율(세로 A4)', () => {
    expect(cardSize({ w: 886, h: 636 }, 0.707, 788)).toEqual({ w: 449, h: 635 });
  });
  it('좁은 자리: 폭이 꽉 차고 높이는 비율대로', () => {
    expect(cardSize({ w: 366, h: 600 }, 0.707, 600)).toEqual({ w: 366, h: 517 });
  });
  it('한 줄 길이보다 넓게는 만들지 않는다(높이도 함께 줄임)', () => {
    expect(cardSize({ w: 2000, h: 2000 }, 0.707, 700)).toEqual({ w: 700, h: 990 });
  });
  it('자리를 모르면 null', () => {
    expect(cardSize({ w: 0, h: 600 }, 0.707, 600)).toBeNull();
  });
});
