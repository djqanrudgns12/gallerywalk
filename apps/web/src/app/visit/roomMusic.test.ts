import { songGainDb } from '@gallery/core/tour';
import type { ExhibitionView } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { testExhibitionView, uuid } from '../../dev/testView.ts';
import { roomTrackOf } from './roomMusic.ts';

const withBgm = (v: ExhibitionView): ExhibitionView => ({
  ...v,
  rooms: v.rooms.map((r, i) =>
    i === 0
      ? {
          ...r,
          bgm: {
            asset: {
              assetId: uuid(0x9999),
              variants: [{ name: 'audio', ext: 'mp3', w: 0, h: 0, bytes: 1000 }],
            },
            durationMs: 60_000,
            analysis: { audibleStartMs: 1200, audibleEndMs: 58_000, loudnessDb: -22 },
          },
        }
      : r,
  ),
});

describe('roomTrackOf', () => {
  it('관 → 그 전시실 곡(앞 무음 건너뛰기·크기 맞추기), 곡 없는 전시실·관 밖은 null', () => {
    const v = withBgm(testExhibitionView([3, 3]));
    const p0 = v.layout.parts.find(p => p.roomId === v.rooms[0]!.id)!;
    const p1 = v.layout.parts.find(p => p.roomId === v.rooms[1]!.id)!;
    const t = roomTrackOf(v, p0.partId);
    expect(t).toEqual({
      id: `${v.rooms[0]!.id}:${uuid(0x9999)}`,
      url: `/assets/g/m/${v.exhibition.id}/${uuid(0x9999)}/audio.mp3`,
      startMs: 1200,
      gainDb: songGainDb(-22),
    });
    expect(roomTrackOf(v, p1.partId)).toBeNull();
    expect(roomTrackOf(v, 'exterior')).toBeNull();
    expect(roomTrackOf(v, 'spine')).toBeNull();
  });
});
