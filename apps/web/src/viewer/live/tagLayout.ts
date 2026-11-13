/**
 * 다른 관람객 이름표의 화면 자리(순수 함수, `Peers.tsx`가 매 장면 부름). 말풍선 규칙(PRD_V2 W-02)과 같게:
 * 가까운 사람부터 자리를 잡고, 화면에서 겹치면 뒤의 것을 한 칸씩 위로(최대 `stackMax`칸), 그래도 겹치거나
 * `maxDistM`보다 멀면 숨긴다 — 30명이 모인 회랑에서 이름표가 서로 덮여 읽을 수 없던 것(2026-11-14 e2e r1/tablet-05-crowd).
 */

/** 화면 좌표(세로 반 높이 = 1인 단위)의 이름표 상자. 카메라 뒤면 null */
export interface TagBox {
  readonly x: number;
  readonly y: number;
  readonly hw: number;
  readonly hh: number;
  /** 한 칸 올릴 때 화면에서 오르는 높이 */
  readonly step: number;
  /** 카메라에서 거리(m) */
  readonly dist: number;
}

export interface TagPlace {
  /** 올린 칸 수(0 = 머리 위 제자리) */
  readonly stack: number;
  readonly hidden: boolean;
}

/** `boxes`는 가까운 사람부터. 같은 길이로 자리를 돌려준다 */
export const placeTags = (
  boxes: readonly (TagBox | null)[],
  opts: { readonly maxDistM: number; readonly stackMax: number },
): TagPlace[] => {
  const placed: { x: number; y: number; hw: number; hh: number }[] = [];
  return boxes.map(b => {
    if (!b) return { stack: 0, hidden: false };
    if (b.dist > opts.maxDistM) return { stack: 0, hidden: true };
    const hit = (y: number): boolean =>
      placed.some(r => Math.abs(r.x - b.x) < r.hw + b.hw && Math.abs(r.y - y) < r.hh + b.hh);
    for (let stack = 0; stack <= opts.stackMax; stack++) {
      const y = b.y + stack * b.step;
      if (!hit(y)) {
        placed.push({ x: b.x, y, hw: b.hw, hh: b.hh });
        return { stack, hidden: false };
      }
    }
    return { stack: 0, hidden: true };
  });
};
