import { config } from '@gallery/core/config';
import { type BubbleContent, bubbleShowSec } from '@gallery/core/live';

/**
 * 머리 위 말풍선의 상태와 계산(PRD_V2 W-02, 순수 — 그리기는 `Bubbles.tsx`).
 * - 판: 사람마다(다른 사람 sid · 나 `BUBBLE_ME`) 지금 말풍선 하나. 새 것은 이전 것을 바꿔 친다. 저장하지 않는다(메모리에만).
 * - 모양: 튀어 오름 `popSec`(크기 `popFrom` → 1) → 머묾(`bubbleShowSec`) → 사라짐 `fadeSec`. 동작 줄이기면 크기 1에 페이드만.
 * - 크기: 세계 높이를 화면 CSS px로 바꾼 뒤 기기 갈래 범위로 자른다(멀어도 작아지지 않고, 가까워도 화면을 덮지 않음).
 * - 보이기: `BUBBLE_MAX_DIST_M` 안 + 벽 너머가 아닌 구역(같은 구역, 또는 한쪽이 홀·회랑이고 다른 쪽이 그리는 관).
 */

/** 내 말풍선의 판 열쇠(서버 sid는 소문자·숫자 8자라 겹치지 않음) */
export const BUBBLE_ME = 'me';

export interface BubbleItem {
  readonly who: string;
  readonly b: BubbleContent;
  /** 띄운 기기 시각(ms) */
  readonly at: number;
}

export interface BubbleLookNow {
  readonly scale: number;
  readonly alpha: number;
  /** 튀어 오르거나 사라지는 중(그동안만 다시 그린다) */
  readonly moving: boolean;
}

/** 띄운 뒤 사라질 때까지 모두(초) */
export const bubbleTotalSec = (k: BubbleContent['k']): number => {
  const l = config().BUBBLE_LOOK;
  return l.popSec + bubbleShowSec(k) + l.fadeSec;
};

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** 띄운 지 `ageSec`초의 크기·불투명도. 끝났으면 null */
export const bubbleLook = (ageSec: number, k: BubbleContent['k'], reduced: boolean): BubbleLookNow | null => {
  const l = config().BUBBLE_LOOK;
  const show = bubbleShowSec(k);
  if (ageSec < 0) return { scale: reduced ? 1 : l.popFrom, alpha: 0, moving: true };
  if (ageSec < l.popSec) {
    const t = ageSec / l.popSec;
    return reduced
      ? { scale: 1, alpha: t, moving: true }
      : { scale: l.popFrom + (1 - l.popFrom) * easeOut(t), alpha: Math.min(1, t * 2), moving: true };
  }
  const fadeAt = l.popSec + show;
  if (ageSec < fadeAt) return { scale: 1, alpha: 1, moving: false };
  if (ageSec < fadeAt + l.fadeSec)
    return { scale: 1, alpha: 1 - (ageSec - fadeAt) / l.fadeSec, moving: true };
  return null;
};

export class BubbleBoard {
  private readonly items = new Map<string, BubbleItem>();

  /** 새 말풍선(같은 사람의 이전 것을 바꿔 친다) */
  put(who: string, b: BubbleContent, at: number): void {
    this.items.set(who, { who, b, at });
  }

  remove(who: string): void {
    this.items.delete(who);
  }

  clear(): void {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }

  /** 지금 떠 있는 것(끝난 것은 여기서 버린다) */
  active(now: number): BubbleItem[] {
    const out: BubbleItem[] = [];
    for (const [who, it] of this.items) {
      if ((now - it.at) / 1000 >= bubbleTotalSec(it.b.k)) this.items.delete(who);
      else out.push(it);
    }
    return out;
  }

  /**
   * 다음에 모양이 바뀌기 시작하는 기기 시각(ms) — 머무는 동안은 다시 그리지 않고 이때 한 번 깨운다.
   * 튀어 오르거나 사라지는 중인 것이 있으면 `now`, 아무것도 없으면 null
   */
  nextChange(now: number): number | null {
    const l = config().BUBBLE_LOOK;
    let next: number | null = null;
    for (const it of this.items.values()) {
      const fadeAt = it.at + (l.popSec + bubbleShowSec(it.b.k)) * 1000;
      const endAt = fadeAt + l.fadeSec * 1000;
      const t =
        now < it.at + l.popSec * 1000 || (now >= fadeAt && now < endAt) ? now : now < fadeAt ? fadeAt : null;
      if (t !== null && (next === null || t < next)) next = t;
    }
    return next;
  }
}

/**
 * 세계 높이 `worldH`(m)가 카메라에서 `depth`(m, 보는 방향 거리) 떨어져 있을 때의 화면 높이(CSS px)를 범위로 자른다.
 * `projY` = 투영 행렬의 [1][1](= 1 / tan(세로 화각 / 2)), `viewH` = 화면 CSS 높이.
 */
export const bubblePx = (
  worldH: number,
  depth: number,
  projY: number,
  viewH: number,
  range: { readonly min: number; readonly max: number },
): number => {
  if (depth <= 0) return range.min;
  const px = ((worldH * projY) / depth) * (viewH / 2);
  return Math.min(range.max, Math.max(range.min, px));
};

/** 스티커·말 풍선의 화면 높이 범위(CSS px) — 말은 글자가 `BUBBLE_TEXT_MIN_PX` 이상이 되게(`glyphRatio` = 글자 높이 / 풍선 높이) */
export const bubbleRange = (
  device: 'phone' | 'tablet' | 'desktop',
  kind: 'sticker' | 'text',
  glyphRatio: number,
): { min: number; max: number } => {
  const c = config();
  const r = c.BUBBLE_STICKER_PX[device];
  if (kind === 'sticker') return { min: r.min, max: r.max };
  const min = c.BUBBLE_TEXT_MIN_PX / glyphRatio;
  return { min, max: Math.max(min, r.max * c.BUBBLE_LOOK.textMaxRatio) };
};

/**
 * 벽 너머가 아닌가: 같은 구역이면 보이고, 바깥(광장·현관)은 바깥끼리만. 홀·회랑(`spine`)과 관 사이는 그 관이 지금 그리는 관
 * (`visibleParts`, 문 너머로 보이는 관)일 때만. 서로 다른 두 관은 벽으로 막혀 있다.
 */
export const bubbleSeen = (mine: string, theirs: string, visible: ReadonlySet<string>): boolean => {
  if (mine === theirs) return true;
  if (mine === 'exterior' || theirs === 'exterior') return false;
  if (mine === 'spine') return visible.has(theirs);
  if (theirs === 'spine') return visible.has(mine);
  return false;
};
