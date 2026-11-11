import { config } from '@gallery/core/config';
import { planTour, type TourInput } from '@gallery/core/tour';
import { describe, expect, it } from 'vitest';
import { songsAt } from './tourSoundtrack.ts';

const song = (sec: number, loudnessDb = -16) => ({
  durationMs: sec * 1000,
  audibleStartMs: 1500,
  audibleEndMs: sec * 1000 - 1000,
  loudnessDb,
});

const input: TourInput = {
  settings: { timeMode: 'MUSIC', secondsPerRoom: 40 },
  rooms: [
    { roomId: 'r1', parts: [5], music: song(150) },
    { roomId: 'r2', parts: [4], music: song(165, -22) },
    { roomId: 'r3', parts: [3], music: null },
    { roomId: 'r4', parts: [6], music: song(180) },
  ],
};
const plan = planTour(input);

describe('songsAt(투어 소리 이음)', () => {
  it('곡은 들리는 시작 위치에서 시작해 등전력으로 밝아진다', () => {
    const s = plan.rooms[0]!.song!;
    const [first] = songsAt(plan, s.startSec + 1e-6);
    expect(first?.roomId).toBe('r1');
    expect(first!.positionSec).toBeCloseTo(1.5, 3);
    expect(first!.gain).toBeLessThan(0.01);
    const full = songsAt(plan, s.fadeInEndSec + 0.01)[0]!;
    expect(full.gain).toBeCloseTo(1, 2); // 크기가 목표(−16)와 같아 이득 0dB
  });

  it('두 곡이 겹치는 것은 1초 이하, 그 밖에는 늘 한 곡 이하', () => {
    let overlap = 0;
    for (let t = 0; t <= plan.totalSec; t += 0.02) if (songsAt(plan, t).length > 1) overlap += 0.02;
    expect(songsAt(plan, 0)).toHaveLength(0);
    for (let i = 0; i + 1 < plan.rooms.length; i++) {
      const a = plan.rooms[i]!.song;
      const b = plan.rooms[i + 1]!.song;
      if (a && b)
        expect(Math.max(0, a.endSec - b.startSec)).toBeLessThanOrEqual(config().TOUR_SONG_OVERLAP_SEC + 1e-6);
    }
    expect(overlap).toBeLessThanOrEqual(config().TOUR_SONG_OVERLAP_SEC * plan.rooms.length + 0.1);
  });

  it('조용한 곡은 이득을 올리되 ±6dB 안, 곡 없는 전시실은 조용하다', () => {
    const s2 = plan.rooms[1]!.song!;
    const mid = songsAt(plan, (s2.fadeInEndSec + s2.fadeOutStartSec) / 2).find(x => x.roomId === 'r2')!;
    expect(mid.gain).toBeCloseTo(10 ** (6 / 20), 2);
    const r3 = plan.rooms[2]!;
    const t = (r3.startSec + r3.endSec) / 2;
    expect(songsAt(plan, t).some(x => x.roomId === 'r3')).toBe(false);
  });

  it('페이드아웃은 전시실 끝(마지막 문 통과)과 맞물려 0으로', () => {
    const room = plan.rooms[3]!;
    const s = room.song!;
    expect(s.endSec).toBeCloseTo(room.endSec, 6);
    const late = songsAt(plan, s.endSec - 0.01).find(x => x.roomId === 'r4');
    expect(late?.gain ?? 0).toBeLessThan(0.02);
    expect(songsAt(plan, s.endSec + 0.01).some(x => x.roomId === 'r4')).toBe(false);
  });
});
