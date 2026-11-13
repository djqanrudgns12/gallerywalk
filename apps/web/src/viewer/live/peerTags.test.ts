import { describe, expect, it } from 'vitest';
import { placePeerTags, type ProjectedTag } from './peerTags.ts';

const tag = (id: string, depth: number, x = 0, y = 0): ProjectedTag => ({
  id,
  depth,
  x,
  y,
  hw: 0.2 / depth,
  hh: 0.05 / depth,
});

describe('화면 이름표 비켜 두기', () => {
  it('같은 자리에 30명이면 가까운 표를 먼저 두고 두 단 뒤의 먼 표는 숨긴다', () => {
    const input = Array.from({ length: 30 }, (_, i) => tag(`p${i}`, 2 + i * 0.01)).reverse();
    const shown = placePeerTags(input, { x: 0.01, y: 0.01 });
    expect(shown.map(t => t.id)).toEqual(['p0', 'p1']);
    expect(shown[0]!.lift).toBe(0);
    expect(shown[1]!.lift).toBeGreaterThan(0);
    expect(shown[1]!.y - shown[1]!.hh).toBeGreaterThan(shown[0]!.y + shown[0]!.hh);
  });

  it('서로 비낀 표는 모두 남기고, 겹치지 않은 표는 올리지 않는다', () => {
    const shown = placePeerTags([tag('a', 2, -0.6), tag('b', 3, 0.6)], { x: 0.01, y: 0.01 });
    expect(shown.map(t => [t.id, t.lift])).toEqual([
      ['a', 0],
      ['b', 0],
    ]);
  });

  it('밀집한 가짜 군중의 표시된 사각형은 서로 겹치지 않고 입력 순서를 바꿔도 같다', () => {
    const input = Array.from({ length: 30 }, (_, i) => tag(`p${i}`, 2 + i * 0.1, (i % 5) * 0.1));
    const gap = { x: 0.01, y: 0.01 };
    const shown = placePeerTags(input, gap);
    expect(placePeerTags([...input].reverse(), gap)).toEqual(shown);
    for (let i = 0; i < shown.length; i++) {
      for (const other of shown.slice(i + 1)) {
        const a = shown[i]!;
        expect(Math.abs(a.x - other.x) >= a.hw + other.hw || Math.abs(a.y - other.y) >= a.hh + other.hh).toBe(
          true,
        );
      }
    }
  });

  it('카메라 뒤·화면 밖의 표가 앞사람 표를 밀지 않고 위로 비키다 화면을 넘으면 숨긴다', () => {
    const shown = placePeerTags(
      [tag('back', -1), tag('outside', 1, 3), tag('near', 2, 0, 0.96), tag('far', 3, 0, 0.96)],
      { x: 0.01, y: 0.01 },
    );
    expect(shown.map(t => t.id)).toEqual(['near']);
  });
});
