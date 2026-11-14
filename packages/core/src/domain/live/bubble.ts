import { isBlocked } from '../reactions/profanity.ts';

/**
 * 머리 위 말풍선(PRD_V2 W-02)의 순수 규칙: 창 여러 개 속도 제한과 짧은 글 다듬기. 서버 hub가 보낼 때마다 부른다.
 */

/** 속도 제한 창: `ms` 안에 `max`개까지 */
export interface RateWindow {
  readonly ms: number;
  readonly max: number;
}

/**
 * 창 여러 개 속도 제한. `sent`는 지금까지 넘긴 시각(ms, 오래된 것부터). 모든 창을 만족하면 `now`를 더한 새 목록을, 아니면 undefined.
 * 가장 긴 창보다 오래된 시각은 버린다(목록 길이 ≤ 가장 긴 창의 `max`). 입력 배열은 바꾸지 않는다.
 */
export const takeRate = (
  sent: readonly number[],
  now: number,
  windows: readonly RateWindow[],
): number[] | undefined => {
  const longest = windows.reduce((m, w) => Math.max(m, w.ms), 0);
  const kept = sent.filter(at => now - at < longest);
  for (const w of windows) {
    const inWindow = kept.filter(at => now - at < w.ms).length;
    if (inWindow >= w.max) return undefined;
  }
  return [...kept, now];
};

export type BubbleTextResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'empty' | 'newline' | 'too_long' | 'blocked' };

/**
 * 짧은 글 다듬기: NFC · 앞뒤 공백 제거 · 안쪽 공백 하나로 · 줄바꿈(또는 탭 밖의 다른 제어 문자)은 거절 · 글자(코드 포인트) `max`개까지 ·
 * 메모와 같은 욕설 거름(`isBlocked`, `list`는 시험용).
 */
export const cleanBubbleText = (raw: string, max: number, list?: readonly string[]): BubbleTextResult => {
  if (/[\p{Cc}\u2028\u2029]/u.test(raw.replace(/\t/g, ' '))) return { ok: false, reason: 'newline' };
  const text = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (text === '') return { ok: false, reason: 'empty' };
  if (Array.from(text).length > max) return { ok: false, reason: 'too_long' };
  if (list === undefined ? isBlocked(text) : isBlocked(text, list)) return { ok: false, reason: 'blocked' };
  return { ok: true, text };
};
