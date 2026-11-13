import { config } from '@gallery/core/config';
import { describe, expect, it } from 'vitest';
import { MAG_NONE, magnifyTo, panBy, toggleMagnify } from './pageMagnify.ts';

describe('쪽 크게 보기 안 확대(PRD G-03)', () => {
  it('두 번 누르면 2배 ↔ 1배, 두 손가락 배율은 1~ZOOM_MAX_SCALE, 1 가까이면 1로 붙는다', () => {
    const two = toggleMagnify(MAG_NONE, 300, 400);
    expect(two.s).toBe(2);
    expect(toggleMagnify(two, 300, 400)).toEqual(MAG_NONE);
    expect(magnifyTo(MAG_NONE, 10, 300, 400).s).toBe(config().ZOOM_MAX_SCALE);
    expect(magnifyTo(two, 1.01, 300, 400)).toEqual(MAG_NONE);
  });

  it('옮기기는 확대했을 때만, 상자 밖 빈 곳이 보이지 않게 묶인다', () => {
    expect(panBy(MAG_NONE, 50, 50, 300, 400)).toEqual(MAG_NONE);
    const two = toggleMagnify(MAG_NONE, 300, 400);
    const far = panBy(two, 1000, -1000, 300, 400);
    expect(far).toEqual({ s: 2, x: 150, y: -200 });
  });
});
