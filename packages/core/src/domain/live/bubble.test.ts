import { describe, expect, it } from 'vitest';
import { config } from '../../config.ts';
import { copy } from '../../copy/ko.ts';
import { LiveBubbleSchema, LiveClientMessageSchema, LiveServerMessageSchema } from '../../types/live.ts';
import { ExhibitionSettingsSchema } from '../../types/settings.ts';
import { cleanBubbleText, takeRate } from './bubble.ts';

describe('말풍선 속도 제한(W-02 BUBBLE_RATE: 1초 1개 · 10초 5개)', () => {
  const rate = config().BUBBLE_RATE;

  it('1초 안 두 번째는 거절, 1초 뒤에는 통과', () => {
    const one = takeRate([], 0, rate);
    expect(one).toEqual([0]);
    expect(takeRate(one!, 999, rate)).toBeUndefined();
    expect(takeRate(one!, 1000, rate)).toEqual([0, 1000]);
  });

  it('10초 안 여섯 번째는 거절, 첫 것이 10초 지나면 다시 통과', () => {
    let sent: number[] = [];
    for (const at of [0, 1000, 2000, 3000, 4000]) sent = takeRate(sent, at, rate)!;
    expect(sent).toHaveLength(5);
    expect(takeRate(sent, 9999, rate)).toBeUndefined();
    expect(takeRate(sent, 10_000, rate)).toEqual([1000, 2000, 3000, 4000, 10_000]);
  });

  it('입력 목록을 바꾸지 않는다', () => {
    const sent = [0];
    takeRate(sent, 5000, rate);
    expect(sent).toEqual([0]);
  });
});

describe('짧은 글 다듬기(BUBBLE_TEXT_MAX·줄바꿈 금지·거름)', () => {
  const max = config().BUBBLE_TEXT_MAX;

  it('앞뒤·안쪽 공백을 다듬는다', () => {
    expect(cleanBubbleText('  같이   보자\t', max)).toEqual({ ok: true, text: '같이 보자' });
  });

  it('줄바꿈은 거절', () => {
    expect(cleanBubbleText('같이\n보자', max)).toEqual({ ok: false, reason: 'newline' });
    expect(cleanBubbleText('같이 보자', max)).toEqual({ ok: false, reason: 'newline' });
  });

  it('빈 글·길이 초과는 거절(글자 수는 코드 포인트)', () => {
    expect(cleanBubbleText('   ', max)).toEqual({ ok: false, reason: 'empty' });
    expect(cleanBubbleText('가'.repeat(max), max).ok).toBe(true);
    expect(cleanBubbleText('가'.repeat(max + 1), max)).toEqual({ ok: false, reason: 'too_long' });
  });

  it('메모와 같은 욕설 거름을 쓴다', () => {
    expect(cleanBubbleText('앞에 가짜욕', max, ['가짜욕'])).toEqual({ ok: false, reason: 'blocked' });
    expect(cleanBubbleText('즐거운 전시', max, ['가짜욕']).ok).toBe(true);
  });
});

describe('말풍선 메시지·설정 계약', () => {
  it('스티커·정해진 말·글 가운데 하나만', () => {
    expect(LiveBubbleSchema.safeParse({ t: 'bubble', s: 0 }).success).toBe(true);
    expect(LiveBubbleSchema.safeParse({ t: 'bubble', w: 11 }).success).toBe(true);
    expect(LiveBubbleSchema.safeParse({ t: 'bubble', text: '안녕' }).success).toBe(true);
    expect(LiveBubbleSchema.safeParse({ t: 'bubble' }).success).toBe(false);
    expect(LiveBubbleSchema.safeParse({ t: 'bubble', s: 1, w: 1 }).success).toBe(false);
  });

  it('번호는 개수 안에서만', () => {
    expect(LiveBubbleSchema.safeParse({ t: 'bubble', s: config().BUBBLE_STICKER_COUNT }).success).toBe(false);
    expect(LiveBubbleSchema.safeParse({ t: 'bubble', w: config().BUBBLE_PHRASE_COUNT }).success).toBe(false);
    expect(LiveBubbleSchema.safeParse({ t: 'bubble', s: -1 }).success).toBe(false);
  });

  it('기기 메시지 묶음과 서버 메시지 묶음이 말풍선을 안다', () => {
    expect(LiveClientMessageSchema.safeParse({ t: 'bubble', w: 0 }).success).toBe(true);
    expect(LiveServerMessageSchema.safeParse({ t: 'bubble', sid: 'abcd1234', at: 1, s: 3 }).success).toBe(
      true,
    );
    expect(LiveServerMessageSchema.safeParse({ t: 'bubble', sid: 'abcd1234', at: 1 }).success).toBe(false);
  });

  it('정해진 말 문구 수가 설정 개수와 같다', () => {
    expect(copy.bubble.phrases).toHaveLength(config().BUBBLE_PHRASE_COUNT);
  });

  it('설정 기본값: 켬 · 글은 끔(U-31)', () => {
    expect(ExhibitionSettingsSchema.parse({}).bubbles).toEqual({ enabled: true, text: false });
  });
});
