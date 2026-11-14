import { describe, expect, it } from 'vitest';
import { placeTags, type TagBox } from './tagLayout.ts';

const box = (x: number, y: number, dist = 5): TagBox => ({ x, y, hw: 0.1, hh: 0.03, step: 0.07, dist });
const opts = { maxDistM: 12, stackMax: 2 };

describe('placeTags', () => {
  it('겹치지 않으면 모두 제자리', () => {
    expect(placeTags([box(0, 0), box(0.5, 0)], opts)).toEqual([
      { stack: 0, hidden: false },
      { stack: 0, hidden: false },
    ]);
  });

  it('겹치면 가까운 것이 제자리, 뒤의 것이 한 칸씩 위로 — 최대 칸을 넘으면 숨김', () => {
    const r = placeTags([box(0, 0), box(0.02, 0), box(0.01, 0), box(0, 0.01)], opts);
    expect(r.map(p => p.stack)).toEqual([0, 1, 2, 0]);
    expect(r.map(p => p.hidden)).toEqual([false, false, false, true]);
  });

  it('너무 먼 사람의 이름표는 숨기고, 숨긴 것은 자리를 차지하지 않는다', () => {
    const r = placeTags([box(0, 0, 20), box(0, 0)], opts);
    expect(r).toEqual([
      { stack: 0, hidden: true },
      { stack: 0, hidden: false },
    ]);
  });

  it('카메라 뒤(null)는 그대로 둔다', () => {
    expect(placeTags([null, box(0, 0)], opts)).toEqual([
      { stack: 0, hidden: false },
      { stack: 0, hidden: false },
    ]);
  });
});
