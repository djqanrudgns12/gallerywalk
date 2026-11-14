import { config } from '@gallery/core/config';
import { describe, expect, it } from 'vitest';
import {
  BUBBLE_ME,
  BubbleBoard,
  bubbleLook,
  bubblePx,
  bubbleRange,
  bubbleSeen,
  bubbleTotalSec,
} from './bubbleBoard.ts';

/** 휴대폰 세로 화면(390×844 CSS px)에 걷기 카메라 세로 화각 60° */
const PHONE_VIEW_H = 844;
const projY = 1 / Math.tan(((60 / 2) * Math.PI) / 180);

describe('말풍선 화면 크기 고정(W-02 완료 기준)', () => {
  it('휴대폰 스티커는 10m·18m에서도 화면 높이 56px 이상, 아주 가까워도 88px 이하', () => {
    const l = config().BUBBLE_LOOK;
    const range = bubbleRange('phone', 'sticker', 1);
    for (const d of [10, 18])
      expect(bubblePx(l.stickerM, d, projY, PHONE_VIEW_H, range)).toBeGreaterThanOrEqual(56);
    expect(bubblePx(l.stickerM, 0.8, projY, PHONE_VIEW_H, range)).toBeLessThanOrEqual(88);
  });

  it('범위 안에서는 거리에 반비례(투영과 같은 식)', () => {
    const wide = { min: 0, max: 10_000 };
    const near = bubblePx(1, 5, projY, PHONE_VIEW_H, wide);
    const far = bubblePx(1, 10, projY, PHONE_VIEW_H, wide);
    expect(near / far).toBeCloseTo(2, 9);
    // 화각 60°에서 높이 1m가 거리 1m면 화면의 1/(2·tan30°) = 0.866배
    expect(bubblePx(1, 1, projY, 1000, wide)).toBeCloseTo(866.03, 1);
    expect(bubblePx(1, 0, projY, 1000, { min: 12, max: 99 })).toBe(12);
  });

  it('말 풍선은 글자가 BUBBLE_TEXT_MIN_PX 이상이 되는 높이부터, 최대는 스티커 최대 × 비', () => {
    const c = config();
    const r = bubbleRange('phone', 'text', 0.36);
    expect(r.min * 0.36).toBeCloseTo(c.BUBBLE_TEXT_MIN_PX, 9);
    expect(r.max).toBeCloseTo(c.BUBBLE_STICKER_PX.phone.max * c.BUBBLE_LOOK.textMaxRatio, 9);
    expect(bubbleRange('desktop', 'sticker', 1)).toEqual(c.BUBBLE_STICKER_PX.desktop);
  });
});

describe('말풍선 모양(튀어 오름 → 머묾 → 사라짐)', () => {
  const l = config().BUBBLE_LOOK;
  it('튀어 오름은 popFrom에서 1로, 머무는 동안은 그대로(다시 그리지 않음), 사라짐은 불투명도만', () => {
    const start = bubbleLook(0, 's', false)!;
    expect(start.scale).toBeCloseTo(l.popFrom, 9);
    expect(start.moving).toBe(true);
    expect(bubbleLook(l.popSec, 's', false)).toEqual({ scale: 1, alpha: 1, moving: false });
    expect(bubbleLook(l.popSec + 4.9, 's', false)).toEqual({ scale: 1, alpha: 1, moving: false });
    const fading = bubbleLook(l.popSec + 5 + l.fadeSec / 2, 's', false)!;
    expect(fading.alpha).toBeCloseTo(0.5, 9);
    expect(fading.moving).toBe(true);
    expect(bubbleLook(bubbleTotalSec('s'), 's', false)).toBeNull();
  });

  it('말·글은 스티커보다 1초 오래', () => {
    expect(bubbleTotalSec('p') - bubbleTotalSec('s')).toBeCloseTo(1, 9);
    // 스티커가 사라지는 중(머묾 5초 + 사라짐의 반)일 때 말은 아직 머문다
    const t = l.popSec + 5 + l.fadeSec / 2;
    expect(bubbleLook(t, 'p', false)?.alpha).toBe(1);
    expect(bubbleLook(t, 's', false)?.alpha).toBeLessThan(1);
    expect(bubbleLook(l.popSec + 5.5, 's', false)).toBeNull();
  });

  it('동작 줄이기: 크기는 늘 1, 나타날 때도 페이드', () => {
    for (const t of [0, l.popSec / 2, l.popSec, l.popSec + 5.1])
      expect(bubbleLook(t, 's', true)?.scale).toBe(1);
    expect(bubbleLook(l.popSec / 2, 's', true)?.alpha).toBeCloseTo(0.5, 9);
  });
});

describe('말풍선 판', () => {
  it('새 것은 같은 사람의 이전 것을 바꿔 치고, 끝난 것은 버린다', () => {
    const board = new BubbleBoard();
    board.put('bbbbbbbb', { k: 's', i: 0 }, 0);
    board.put('bbbbbbbb', { k: 'p', i: 2 }, 1000);
    board.put(BUBBLE_ME, { k: 's', i: 5 }, 500);
    expect(board.active(1500).map(it => [it.who, it.b])).toEqual([
      ['bbbbbbbb', { k: 'p', i: 2 }],
      [BUBBLE_ME, { k: 's', i: 5 }],
    ]);
    const meEnd = 500 + bubbleTotalSec('s') * 1000;
    expect(board.active(meEnd).map(it => it.who)).toEqual(['bbbbbbbb']);
    expect(board.size).toBe(1);
  });

  it('다음 깨울 때: 움직이는 중이면 지금, 머무는 중이면 사라지기 시작할 때, 없으면 null', () => {
    const l = config().BUBBLE_LOOK;
    const board = new BubbleBoard();
    expect(board.nextChange(0)).toBeNull();
    board.put('bbbbbbbb', { k: 's', i: 0 }, 0);
    expect(board.nextChange(100)).toBe(100);
    const fadeAt = (l.popSec + 5) * 1000;
    expect(board.nextChange(1000)).toBeCloseTo(fadeAt, 6);
    expect(board.nextChange(fadeAt + 10)).toBe(fadeAt + 10);
    board.put('cccccccc', { k: 'p', i: 0 }, 2000);
    expect(board.nextChange(2000)).toBe(2000);
  });
});

describe('말풍선 보이기(벽 너머 숨김)', () => {
  const visible = new Set(['g1', 'g2']);
  it('같은 구역은 보이고, 바깥은 바깥끼리만', () => {
    expect(bubbleSeen('g1', 'g1', visible)).toBe(true);
    expect(bubbleSeen('exterior', 'exterior', visible)).toBe(true);
    expect(bubbleSeen('exterior', 'spine', visible)).toBe(false);
    expect(bubbleSeen('spine', 'exterior', visible)).toBe(false);
  });

  it('홀·회랑과 관 사이는 그리는 관(문 너머)일 때만, 서로 다른 두 관은 숨김', () => {
    expect(bubbleSeen('spine', 'g2', visible)).toBe(true);
    expect(bubbleSeen('g1', 'spine', visible)).toBe(true);
    expect(bubbleSeen('spine', 'g3', visible)).toBe(false);
    expect(bubbleSeen('g1', 'g2', visible)).toBe(false);
  });
});
