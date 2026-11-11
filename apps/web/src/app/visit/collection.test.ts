import { describe, expect, it } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import { collectionOf } from './collection.ts';

describe('모아 보기 목록', () => {
  it('전시실 순서대로, 나뉜 관은 한 전시실로, 작품은 정지 지점 순서·번호와 함께', () => {
    const view = testExhibitionView([3, 40]);
    const rooms = collectionOf(
      view.layout,
      view.rooms.map(r => r.id),
    );
    expect(rooms.map(r => r.roomId)).toEqual(view.rooms.map(r => r.id));
    expect(rooms[0]!.items).toHaveLength(3);
    expect(rooms[1]!.items).toHaveLength(40);
    for (const r of rooms) {
      const idx = r.items.map(i => i.stopIndex);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      for (const i of r.items) expect(view.layout.stops[i.stopIndex]!.artworkId).toBe(i.artworkId);
    }
    // 둘째 전시실은 여러 관으로 나뉘었어도 하나
    expect(view.layout.parts.filter(p => p.roomId === view.rooms[1]!.id).length).toBeGreaterThan(1);
  });

  it('작품이 없는 전시실은 빠진다', () => {
    const view = testExhibitionView([2]);
    expect(collectionOf(view.layout, ['없는 전시실', view.rooms[0]!.id]).map(r => r.roomId)).toEqual([
      view.rooms[0]!.id,
    ]);
  });
});
