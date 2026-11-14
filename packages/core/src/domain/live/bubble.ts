import { config } from '../../config.ts';
import { isBlocked } from '../reactions/profanity.ts';
import { charCount, normalizeLine } from '../text/normalize.ts';

/**
 * 머리 위 말풍선(PRD_V2 W-02, M4) — 서버(`live/hub.ts`)와 기기(보내기 서랍·받기)가 같은 규칙을 쓰는 순수 함수.
 * 무엇을 보내는지는 셋 중 하나: 스티커 번호(`s`) · 정해진 말 번호(`p`) · 짧은 글(`x`, 교사가 켤 때만).
 * 번호의 그림·글은 기기가 가진다(스티커 아틀라스·`copy.bubble.phrases`) — 통로에는 번호만 오간다.
 */

export type BubbleContent =
  | { readonly k: 's'; readonly i: number }
  | { readonly k: 'p'; readonly i: number }
  | { readonly k: 'x'; readonly text: string };

export type PreparedBubbleText =
  { readonly text: string } | { readonly error: 'empty' | 'too_long' | 'blocked' };

/**
 * 짧은 글 다듬기: 한 줄 정규화(줄바꿈·탭 → 공백, 겹친 공백 하나, 앞뒤 공백 제거) → 길이(`BUBBLE_TEXT_MAX`자, 코드 포인트)
 * → 욕설 거름(별명·메모와 같은 `isBlocked`). 기기는 보내기 전에, 서버는 중계 전에 같은 것을 부른다.
 */
export const prepareBubbleText = (raw: string): PreparedBubbleText => {
  const text = normalizeLine(raw);
  if (text === '') return { error: 'empty' };
  if (charCount(text) > config().BUBBLE_TEXT_MAX) return { error: 'too_long' };
  if (isBlocked(text)) return { error: 'blocked' };
  return { text };
};

/** 번호가 범위 안인가(스티커 `BUBBLE_STICKERS`종 · 정해진 말 `BUBBLE_PHRASES`개) */
export const bubbleIndexOk = (k: 's' | 'p', i: number): boolean =>
  Number.isInteger(i) && i >= 0 && i < (k === 's' ? config().BUBBLE_STICKERS : config().BUBBLE_PHRASES);

/** 머리 위에 머무는 초(튀어 오름·사라짐 포함 전 — 그 둘은 `BUBBLE_LOOK`) */
export const bubbleShowSec = (k: BubbleContent['k']): number =>
  k === 's' ? config().BUBBLE_SHOW_SEC.sticker : config().BUBBLE_SHOW_SEC.phrase;

const SHORT_WINDOW_MS = 1000;
const LONG_WINDOW_MS = 10_000;

/**
 * 속도 제한(`BUBBLE_RATE`): 최근 보낸 시각(ms, 오래된 것부터)으로 지금 하나 더 보낼 수 있는가.
 * 1초 창에 `perSec`개, 10초 창에 `per10Sec`개까지. `sent`는 바꾸지 않는다(`recordBubble`이 줄이고 더한다).
 */
export const bubbleAllowed = (sent: readonly number[], now: number): boolean => {
  const { perSec, per10Sec } = config().BUBBLE_RATE;
  let short = 0;
  let long = 0;
  for (const at of sent) {
    const age = now - at;
    if (age < 0 || age >= LONG_WINDOW_MS) continue;
    long += 1;
    if (age < SHORT_WINDOW_MS) short += 1;
  }
  return short < perSec && long < per10Sec;
};

/** 보낸 시각을 더하고 10초 창 밖의 것을 버린다(배열을 고친다 — 사람마다 길이 ≤ `per10Sec`) */
export const recordBubble = (sent: number[], now: number): void => {
  while (sent.length > 0 && now - sent[0]! >= LONG_WINDOW_MS) sent.shift();
  sent.push(now);
};

/** 다음에 보낼 수 있는 가장 이른 시각(ms) — 서랍이 잠깐 잠그는 데 쓴다. 지금 보낼 수 있으면 `now` */
export const bubbleReadyAt = (sent: readonly number[], now: number): number => {
  if (bubbleAllowed(sent, now)) return now;
  const { perSec, per10Sec } = config().BUBBLE_RATE;
  const recent = sent.filter(at => now - at >= 0 && now - at < LONG_WINDOW_MS);
  let ready = now;
  // 짧은 창: 최근 1초 안의 것 중 앞에서 (개수 − perSec + 1)번째가 1초 지나면
  const short = recent.filter(at => now - at < SHORT_WINDOW_MS);
  if (short.length >= perSec) ready = Math.max(ready, short[short.length - perSec]! + SHORT_WINDOW_MS);
  if (recent.length >= per10Sec) ready = Math.max(ready, recent[recent.length - per10Sec]! + LONG_WINDOW_MS);
  return ready;
};
