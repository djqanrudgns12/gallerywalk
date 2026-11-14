import { standable } from '@gallery/core/layout';
import { describe, expect, it } from 'vitest';
import { testArtworkId, testExhibitionView } from '../../dev/testView.ts';
import { standSpot } from './guide.ts';
import { startAtArtwork } from './startAt.ts';

describe('고른 작품 앞에서 걷기 시작(HT-06)', () => {
  const { layout } = testExhibitionView([4, 3]);

  it('그 작품의 정지 지점 번호와, 걸어가 설 때와 같은 자리·방향', () => {
    const id = testArtworkId(1, 2);
    const start = startAtArtwork(layout, id, 16 / 10);
    const i = layout.stops.findIndex(s => s.artworkId === id);
    expect(i).toBeGreaterThan(0);
    expect(start?.stopIndex).toBe(i);
    const spot = standSpot(layout, layout.stops[i]!, 16 / 10);
    expect(start).toEqual({ x: spot.at[0], z: spot.at[1], yaw: spot.yaw, stopIndex: i });
    expect(standable(layout.walk, [start!.x, start!.z])).toBe(true);
  });

  it('배치에 없는 작품이면 undefined(처음 자리에서 시작)', () => {
    expect(startAtArtwork(layout, testArtworkId(9, 9), 16 / 10)).toBeUndefined();
  });
});
