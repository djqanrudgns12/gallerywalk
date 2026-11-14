import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, overrideConfig, resetConfig } from '../../config.ts';
import { copy } from '../../copy/ko.ts';
import * as profanity from '../reactions/profanity.ts';
import {
  bubbleAllowed,
  bubbleIndexOk,
  bubbleReadyAt,
  bubbleShowSec,
  prepareBubbleText,
  recordBubble,
} from './bubble.ts';

afterEach(() => {
  resetConfig();
  vi.restoreAllMocks();
});

describe('말풍선 짧은 글 다듬기(W-02)', () => {
  it('한 줄로 정규화하고 앞뒤 공백을 지운다', () => {
    expect(prepareBubbleText('  같이\n보자   요 ')).toEqual({ text: '같이 보자 요' });
  });

  it('빈 글·20자 넘는 글은 거른다', () => {
    expect(prepareBubbleText(' \n\t ')).toEqual({ error: 'empty' });
    expect(prepareBubbleText('가'.repeat(20))).toEqual({ text: '가'.repeat(20) });
    expect(prepareBubbleText('가'.repeat(21))).toEqual({ error: 'too_long' });
  });

  it('욕설 거름은 별명·메모와 같은 isBlocked(가상 목록으로 실제 정규화 경로 검사)', () => {
    const actual = profanity.isBlocked;
    vi.spyOn(profanity, 'isBlocked').mockImplementation(text => actual(text, ['가짜욕']));
    expect(prepareBubbleText(' 가.짜1욕 ')).toEqual({ error: 'blocked' });
    expect(prepareBubbleText('같이 보자')).toEqual({ text: '같이 보자' });
  });

  it('길이는 코드 포인트로 센다(설정값을 따른다)', () => {
    overrideConfig({ BUBBLE_TEXT_MAX: 3 });
    expect(prepareBubbleText('와와와')).toEqual({ text: '와와와' });
    expect(prepareBubbleText('와와와와')).toEqual({ error: 'too_long' });
  });
});

describe('말풍선 번호·머묾', () => {
  it('스티커·정해진 말 번호는 0 ~ 개수−1 정수만', () => {
    expect(bubbleIndexOk('s', 0)).toBe(true);
    expect(bubbleIndexOk('s', 11)).toBe(true);
    expect(bubbleIndexOk('s', 12)).toBe(false);
    expect(bubbleIndexOk('p', -1)).toBe(false);
    expect(bubbleIndexOk('p', 1.5)).toBe(false);
  });

  it('화면 문구 개수가 설정값과 같다(번호 ↔ 글)', () => {
    expect(copy.bubble.stickers).toHaveLength(config().BUBBLE_STICKERS);
    expect(copy.bubble.phrases).toHaveLength(config().BUBBLE_PHRASES);
  });

  it('스티커 5초, 말·글 6초', () => {
    expect(bubbleShowSec('s')).toBe(5);
    expect(bubbleShowSec('p')).toBe(6);
    expect(bubbleShowSec('x')).toBe(6);
  });
});

describe('말풍선 속도 제한(1초 1개 · 10초 5개)', () => {
  it('1초 안에 두 번째는 막고, 1초 지나면 연다', () => {
    const sent: number[] = [];
    expect(bubbleAllowed(sent, 0)).toBe(true);
    recordBubble(sent, 0);
    expect(bubbleAllowed(sent, 999)).toBe(false);
    expect(bubbleReadyAt(sent, 500)).toBe(1000);
    expect(bubbleAllowed(sent, 1000)).toBe(true);
  });

  it('10초 안에 다섯 개를 보내면 여섯 번째는 첫 것이 10초 지날 때까지 막는다', () => {
    const sent: number[] = [];
    for (const at of [0, 1000, 2000, 3000, 4000]) {
      expect(bubbleAllowed(sent, at)).toBe(true);
      recordBubble(sent, at);
    }
    expect(bubbleAllowed(sent, 5000)).toBe(false);
    expect(bubbleReadyAt(sent, 5000)).toBe(10_000);
    expect(bubbleAllowed(sent, 9999)).toBe(false);
    expect(bubbleAllowed(sent, 10_000)).toBe(true);
  });

  it('기록은 10초 창 밖을 버려 길이가 늘지 않는다', () => {
    const sent: number[] = [];
    for (let at = 0; at < 60_000; at += 2000) recordBubble(sent, at);
    expect(sent.length).toBeLessThanOrEqual(5);
    expect(sent[0]).toBeGreaterThan(60_000 - 2000 - 10_000);
  });

  it('미래 시각(시계가 뒤로 감)은 세지 않는다', () => {
    expect(bubbleAllowed([5000], 1000)).toBe(true);
  });
});
