import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { config, overrideConfig, resetConfig } from '../../config.ts';
import type { TourSettings } from '../../types/index.ts';
import {
  equalPowerGain,
  planTour,
  songGainDb,
  type TourArtworkSegment,
  type TourDoorSegment,
  type TourInput,
  type TourMusic,
  type TourNameplateSegment,
  type TourPlan,
  type TourRoomInput,
  type TourRoomPlan,
} from './tourSchedule.ts';

afterEach(() => resetConfig());

const MUSIC: TourSettings = { timeMode: 'MUSIC', secondsPerRoom: 40 };
const FIXED: TourSettings = { timeMode: 'FIXED', secondsPerRoom: 40 };

/** 들리는 길이 `audibleSec`의 합성 곡. 앞 1.2초·뒤 9초는 무음(Suno 곡 끝의 긴 무음 흉내). */
const song = (audibleSec: number, loudnessDb: number | null = -16): TourMusic => {
  const audibleStartMs = 1200;
  const audibleEndMs = audibleStartMs + audibleSec * 1000;
  return { audibleStartMs, audibleEndMs, durationMs: audibleEndMs + 9000, loudnessDb };
};

const room = (parts: number[], music: TourMusic | null, roomId = 'r'): TourRoomInput => ({
  roomId,
  parts,
  music,
});
const rooms = (...list: Array<[number[], TourMusic | null]>): TourRoomInput[] =>
  list.map(([parts, music], i) => room(parts, music, `room-${i}`));

const ms = (sec: number): number => Math.round(sec * 1000);
const len = (s: { startSec: number; endSec: number }): number => ms(s.endSec) - ms(s.startSec);

/** 앞 곡 겹침 길이(기본 설정): 4초 등전력 페이드아웃이 30% 이하가 되는 첫 밀리초부터 끝까지 */
const LEAD_MS = 4000 - Math.ceil((4000 * Math.acos(0.3) * 2) / Math.PI);

const doorsOf = (plan: TourPlan, roomIndex: number): TourDoorSegment[] =>
  plan.segments.filter((s): s is TourDoorSegment => s.kind === 'DOOR' && s.roomIndex === roomIndex);
const artworksOf = (plan: TourPlan, roomIndex: number): TourArtworkSegment[] =>
  plan.segments.filter((s): s is TourArtworkSegment => s.kind === 'ARTWORK' && s.roomIndex === roomIndex);
const lastDoor = (plan: TourPlan, roomIndex: number): TourDoorSegment => doorsOf(plan, roomIndex).at(-1)!;
const songOf = (r: TourRoomPlan | undefined) => {
  expect(r?.song).toBeTruthy();
  return r!.song!;
};

/** 모든 시간표가 지켜야 하는 것(속성 시험과 예시 시험이 함께 쓴다) */
const expectWellFormed = (plan: TourPlan, input: TourInput): void => {
  const c = config();
  const segs = plan.segments;
  // 구간: 0에서 시작해 빈틈·겹침 없이 이어지고 전체 길이에서 끝난다.
  expect(segs[0]?.kind).toBe('HALL');
  expect(segs.at(-1)?.kind).toBe('EXIT');
  expect(segs[0]?.startSec).toBe(0);
  for (let i = 0; i < segs.length; i++) {
    expect(len(segs[i]!)).toBeGreaterThan(0);
    if (i > 0) expect(segs[i]!.startSec).toBe(segs[i - 1]!.endSec);
  }
  expect(segs.at(-1)?.endSec).toBe(plan.totalSec);
  expect(plan.rooms).toHaveLength(input.rooms.length);

  plan.rooms.forEach((r, roomIndex) => {
    const counts = input.rooms[roomIndex]!.parts;
    const inRoom = segs.filter(s => 'roomIndex' in s && s.roomIndex === roomIndex);
    expect(inRoom[0]?.kind).toBe('NAMEPLATE');
    expect(inRoom[0]?.startSec).toBe(r.startSec);
    expect(inRoom.at(-1)?.kind).toBe('DOOR');
    expect(inRoom.at(-1)?.endSec).toBe(r.endSec);
    expect(r.parts.map(p => p.artworkCount)).toEqual(counts);
    r.parts.forEach((p, partIndex) => {
      if (partIndex > 0) expect(p.startSec).toBe(r.parts[partIndex - 1]!.endSec);
      const n = counts[partIndex]!;
      // 관 최소 시간과 작품당 최소 시간
      const minPart = Math.max(
        ms(c.TOUR_MIN_SECONDS_PER_PART),
        ms(c.TOUR_NAMEPLATE_SEC) + n * ms(c.TOUR_MIN_SEC_PER_ARTWORK) + ms(c.TOUR_TRANSITION_SEC),
      );
      expect(len(p)).toBeGreaterThanOrEqual(minPart);
      const arts = artworksOf(plan, roomIndex).filter(a => a.partIndex === partIndex);
      expect(arts.map(a => a.artworkIndex)).toEqual(Array.from({ length: n }, (_, k) => k));
      for (const a of arts) expect(len(a)).toBeGreaterThanOrEqual(ms(c.TOUR_MIN_SEC_PER_ARTWORK));
    });
    expect(r.parts[0]?.startSec).toBe(r.startSec);
    expect(r.parts.at(-1)?.endSec).toBe(r.endSec);
    expect(doorsOf(plan, roomIndex).map(d => d.to)).toEqual(
      counts.map((_, k) =>
        k < counts.length - 1 ? 'PART' : roomIndex < input.rooms.length - 1 ? 'ROOM' : 'EXIT',
      ),
    );

    const s = r.song;
    const music = input.rooms[roomIndex]!.music;
    if (s === null) return;
    expect(music).not.toBeNull();
    // 곡은 되풀이하지 않는다: 재생한 곡 길이 = 투어에서 흐른 시간, 들리는 끝·안전 상한을 넘지 않음.
    expect(s.fromMs).toBe(music!.audibleStartMs);
    expect(s.toMs - s.fromMs).toBe(len(s));
    expect(s.toMs).toBeLessThanOrEqual(Math.min(music!.audibleEndMs, music!.durationMs));
    expect(s.toMs - s.fromMs).toBeLessThanOrEqual(ms(c.TOUR_MUSIC_MAX_SEC));
    expect(s.startSec).toBeLessThanOrEqual(s.fadeInEndSec);
    expect(s.fadeInEndSec).toBeLessThanOrEqual(s.fadeOutStartSec);
    expect(s.fadeOutStartSec).toBeLessThanOrEqual(s.endSec);
    expect(ms(r.startSec) - ms(s.startSec)).toBe(ms(s.overlapPrevSec));
    expect(ms(r.endSec) - ms(s.endSec)).toBe(ms(s.quietTailSec));
    expect(s.quietTailSec).toBeGreaterThanOrEqual(0);
    expect(Math.abs(s.gainDb)).toBeLessThanOrEqual(c.AUDIO_GAIN_LIMIT_DB);
    // 곡이 전시실 끝까지 가면 페이드아웃이 마지막 문 통과 구간을 덮는다.
    if (s.quietTailSec === 0) {
      const door = lastDoor(plan, roomIndex);
      expect(s.fadeOutStartSec).toBeLessThanOrEqual(door.startSec);
      expect(s.endSec).toBe(door.endSec);
    }
    // 다음 곡과의 겹침 ≤ TOUR_SONG_OVERLAP_SEC, 그리고 앞 곡이 기준 음량 아래로 줄어든 뒤에만 시작.
    const next = plan.rooms[roomIndex + 1]?.song ?? null;
    const overlap = next === null ? 0 : Math.max(0, ms(s.endSec) - ms(next.startSec));
    expect(ms(s.overlapNextSec)).toBe(overlap);
    expect(overlap).toBeLessThanOrEqual(ms(c.TOUR_SONG_OVERLAP_SEC));
    if (next !== null && overlap > 0) {
      expect(ms(next.overlapPrevSec)).toBe(overlap);
      const progress = (ms(next.startSec) - ms(s.fadeOutStartSec)) / (ms(s.endSec) - ms(s.fadeOutStartSec));
      expect(equalPowerGain('OUT', progress)).toBeLessThanOrEqual(c.TOUR_NEXT_SONG_AT_LEVEL);
    }
  });
};

describe('planTour — 전시실마다 고정 초(FIXED)', () => {
  it('5곳 × 40초 = 홀 5 + 200 + 출구 5 = 210초', () => {
    const input: TourInput = {
      rooms: rooms([[5], null], [[4], null], [[6], null], [[3], null], [[5], null]),
      settings: FIXED,
    };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    expect(plan.totalSec).toBe(210);
    expect(plan.approxMinutes).toBe(4);
    for (const r of plan.rooms) {
      expect(len(r)).toBe(40_000);
      expect(r.timeSource).toBe('FIXED');
      expect(r.song).toBeNull();
    }
    // 작품 구간 = (40 − 4 − 2) ÷ 5 = 6.8초, 다가가기 2.5초
    const first = artworksOf(plan, 0)[0]!;
    expect(len(first)).toBe(6800);
    expect(ms(first.approachEndSec) - ms(first.startSec)).toBe(2500);
  });

  it('곡이 전시실보다 길면 전시실 끝에서 페이드아웃해 문 통과와 맞물린다', () => {
    const input: TourInput = { rooms: rooms([[5], song(170)], [[5], song(165)]), settings: FIXED };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    // 두 번째 전시실 곡은 앞 곡 페이드아웃 중에 먼저 시작하지만, 전시실 시간은 설정 그대로 40초.
    expect(plan.rooms.map(r => len(r))).toEqual([40_000, 40_000]);
    const s0 = songOf(plan.rooms[0]);
    expect(s0.quietTailSec).toBe(0);
    expect(s0.toMs - s0.fromMs).toBe(40_000);
    expect(ms(songOf(plan.rooms[1]).overlapPrevSec)).toBe(LEAD_MS);
  });

  it('곡이 전시실보다 짧으면 끝에서 페이드아웃한 뒤 조용히 간다', () => {
    const input: TourInput = { rooms: rooms([[5], song(25)]), settings: FIXED };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    const s = songOf(plan.rooms[0]);
    expect(s.toMs - s.fromMs).toBe(25_000);
    expect(s.quietTailSec).toBe(15);
    expect(ms(s.endSec) - ms(s.fadeOutStartSec)).toBe(4000);
  });
});

describe('planTour — 노래 길이에 맞춤(MUSIC)', () => {
  const five = [150, 158, 166, 173, 180];

  it('노래 5곡(150~180초): 전시실 시간 = 곡 길이 − 앞 곡과 겹친 시간, 합계가 맞다', () => {
    const input: TourInput = {
      rooms: rooms(...five.map((sec, i): [number[], TourMusic] => [[4 + i], song(sec)])),
      settings: MUSIC,
    };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    expect(LEAD_MS).toBeGreaterThan(0);
    expect(LEAD_MS).toBeLessThanOrEqual(1000);
    expect(plan.rooms.map(r => len(r))).toEqual(five.map((sec, i) => sec * 1000 - (i === 0 ? 0 : LEAD_MS)));
    expect(ms(plan.totalSec)).toBe(5000 + five.reduce((a, b) => a + b, 0) * 1000 - 4 * LEAD_MS + 5000);
    expect(plan.approxMinutes).toBe(14);
    plan.rooms.forEach((r, i) => {
      expect(r.timeSource).toBe('MUSIC');
      const s = songOf(r);
      // 곡 전체(들리는 구간)를 끝까지 튼다.
      expect(s.toMs - s.fromMs).toBe(five[i]! * 1000);
      expect(s.quietTailSec).toBe(0);
    });
  });

  it('페이드아웃 4초가 마지막 작품에서 떠나는 2초 + 문 통과 2초를 덮는다', () => {
    const input: TourInput = { rooms: rooms([[3], song(150)], [[4], song(160)]), settings: MUSIC };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    for (const i of [0, 1]) {
      const s = songOf(plan.rooms[i]);
      const door = lastDoor(plan, i);
      const lastArt = artworksOf(plan, i).at(-1)!;
      expect(ms(s.fadeOutStartSec)).toBe(ms(door.startSec) - 2000);
      expect(s.fadeOutStartSec).toBeGreaterThan(lastArt.approachEndSec);
      expect(s.endSec).toBe(door.endSec);
      expect(ms(s.fadeInEndSec) - ms(s.startSec)).toBe(2500);
    }
  });

  it('다음 곡은 앞 곡이 30% 아래로 줄어든 때 시작하고 겹침은 1초 이하', () => {
    const input: TourInput = { rooms: rooms([[3], song(150)], [[4], song(160)]), settings: MUSIC };
    const plan = planTour(input);
    const a = songOf(plan.rooms[0]);
    const b = songOf(plan.rooms[1]);
    const overlap = ms(a.endSec) - ms(b.startSec);
    expect(overlap).toBe(LEAD_MS);
    expect(overlap).toBeLessThanOrEqual(1000);
    expect(ms(a.overlapNextSec)).toBe(overlap);
    const atStart = equalPowerGain('OUT', (ms(b.startSec) - ms(a.fadeOutStartSec)) / 4000);
    expect(atStart).toBeLessThanOrEqual(0.3);
    expect(atStart).toBeGreaterThan(0.29);
    // 다음 곡은 앞 전시실 문 통과 중에 시작하고, 그 전시실 이름판 시작이 전시실 시작이다.
    expect(b.startSec).toBeGreaterThan(lastDoor(plan, 0).startSec);
    expect(b.startSec).toBeLessThan(plan.rooms[1]!.startSec);
  });

  it('겹침 상한을 넘는 설정이면 상한만큼만 겹친다', () => {
    overrideConfig({ TOUR_NEXT_SONG_AT_LEVEL: 0.9 });
    const input: TourInput = { rooms: rooms([[3], song(150)], [[4], song(160)]), settings: MUSIC };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    expect(ms(songOf(plan.rooms[1]).overlapPrevSec)).toBe(1000);
  });

  it('곡 없는 전시실은 설정 초(기본 40초), 그 앞뒤 곡은 겹치지 않는다', () => {
    const input: TourInput = {
      rooms: rooms([[5], song(150)], [[5], null], [[5], song(150)]),
      settings: MUSIC,
    };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    expect(len(plan.rooms[1]!)).toBe(40_000);
    expect(plan.rooms[1]!.timeSource).toBe('FIXED');
    expect(plan.rooms[1]!.song).toBeNull();
    expect(songOf(plan.rooms[0]).overlapNextSec).toBe(0);
    expect(songOf(plan.rooms[2]).overlapPrevSec).toBe(0);
    expect(songOf(plan.rooms[2]).startSec).toBe(plan.rooms[2]!.startSec);
    expect(len(plan.rooms[2]!)).toBe(150_000);
  });

  it('곡 없는 전시실의 시간은 교사 설정을 따른다', () => {
    const input: TourInput = {
      rooms: rooms([[5], null]),
      settings: { timeMode: 'MUSIC', secondsPerRoom: 55 },
    };
    expect(len(planTour(input).rooms[0]!)).toBe(55_000);
  });

  it('완전한 무음(크기 null)이나 들리는 구간이 없는 곡은 곡 없는 전시실로 다룬다', () => {
    const flat: TourMusic = { audibleStartMs: 0, audibleEndMs: 0, durationMs: 30_000, loudnessDb: -20 };
    const input: TourInput = { rooms: rooms([[5], song(150, null)], [[5], flat]), settings: MUSIC };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    expect(plan.rooms.map(r => r.song)).toEqual([null, null]);
    expect(plan.rooms.map(r => len(r))).toEqual([40_000, 40_000]);
  });

  it('아주 짧은 곡: 최소 시간(이름판 + 작품당 5초 + 문)을 쓰고 곡은 끝에서 페이드아웃 뒤 조용히', () => {
    const input: TourInput = { rooms: rooms([[4], song(12)], [[2], song(150)]), settings: MUSIC };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    const r = plan.rooms[0]!;
    expect(r.timeSource).toBe('MINIMUM');
    expect(len(r)).toBe(26_000); // 4 + 4×5 + 2
    const s = songOf(r);
    expect(s.toMs - s.fromMs).toBe(12_000); // 되풀이하지 않음
    expect(s.quietTailSec).toBe(14);
    expect(ms(s.fadeOutStartSec) - ms(s.startSec)).toBe(8000);
    // 앞 곡이 일찍 끝났으니 다음 곡은 겹치지 않고 제 전시실 시작에.
    expect(songOf(plan.rooms[1]).overlapPrevSec).toBe(0);
    expect(songOf(plan.rooms[1]).startSec).toBe(plan.rooms[1]!.startSec);
  });

  it('페이드인 + 페이드아웃보다 짧은 곡은 두 페이드를 같은 비율로 줄인다', () => {
    const input: TourInput = { rooms: rooms([[1], song(3)]), settings: MUSIC };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    const s = songOf(plan.rooms[0]);
    const inMs = ms(s.fadeInEndSec) - ms(s.startSec);
    const outMs = ms(s.endSec) - ms(s.fadeOutStartSec);
    expect(inMs + outMs).toBe(3000);
    expect(inMs).toBe(Math.round((3000 * 2.5) / 6.5));
    expect(len(plan.rooms[0]!)).toBe(20_000); // 관 최소 20초
  });

  it('안전 상한 360초: 긴 곡은 상한에서 페이드아웃한다', () => {
    const input: TourInput = { rooms: rooms([[8], song(500)]), settings: MUSIC };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    expect(len(plan.rooms[0]!)).toBe(360_000);
    const s = songOf(plan.rooms[0]);
    expect(s.toMs - s.fromMs).toBe(360_000);
    expect(ms(s.endSec) - ms(s.fadeOutStartSec)).toBe(4000);
    expect(s.quietTailSec).toBe(0);
  });
});

describe('planTour — 나뉜 전시실(1관·2관)', () => {
  it('곡 시간을 관 작품 수 비율로 나누고, 관 사이에서 곡이 끊기지 않는다', () => {
    const input: TourInput = { rooms: rooms([[7, 6], song(130)]), settings: MUSIC };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    const r = plan.rooms[0]!;
    expect(r.parts.map(p => len(p))).toEqual([70_000, 60_000]);
    // 곡 하나가 두 관을 덮고, 관 사이 문 통과는 곡의 페이드인·페이드아웃 사이(제 음량)에 있다.
    const s = songOf(r);
    expect(s.startSec).toBe(r.startSec);
    expect(s.endSec).toBe(r.endSec);
    const between = doorsOf(plan, 0)[0]!;
    expect(between.to).toBe('PART');
    expect(between.startSec).toBeGreaterThan(s.fadeInEndSec);
    expect(between.endSec).toBeLessThan(s.fadeOutStartSec);
    // 관마다 이름판이 있다(`{이름판} · 1관`).
    const plates = plan.segments.filter((x): x is TourNameplateSegment => x.kind === 'NAMEPLATE');
    expect(plates.map(x => x.partIndex)).toEqual([0, 1]);
  });

  it('비율 몫이 관 최소 20초보다 작은 관은 20초를 받고, 전시실 합계는 그대로', () => {
    const input: TourInput = {
      rooms: rooms([[5, 1], null]),
      settings: { timeMode: 'FIXED', secondsPerRoom: 60 },
    };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    expect(plan.rooms[0]!.parts.map(p => len(p))).toEqual([40_000, 20_000]);
    expect(len(plan.rooms[0]!)).toBe(60_000);
  });

  it('40초 전시실을 7·6으로 나누면 두 관 모두 최소 20초(작품당 최소를 낮춘 설정)', () => {
    overrideConfig({ TOUR_MIN_SEC_PER_ARTWORK: 1 });
    const input: TourInput = { rooms: rooms([[7, 6], null]), settings: FIXED };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    expect(plan.rooms[0]!.parts.map(p => len(p))).toEqual([20_000, 20_000]);
  });

  it('작품당 최소 시간을 채우지 못하면 전시실이 그만큼 길어진다(13점 · 40초 → 41 + 36초)', () => {
    const input: TourInput = { rooms: rooms([[7, 6], null]), settings: FIXED };
    const plan = planTour(input);
    expectWellFormed(plan, input);
    expect(plan.rooms[0]!.timeSource).toBe('MINIMUM');
    expect(plan.rooms[0]!.parts.map(p => len(p))).toEqual([41_000, 36_000]);
  });
});

describe('planTour — 화면', () => {
  it('입구 홀은 검은 화면에서 2초 페이드인, 출구는 마지막 3초 페이드아웃', () => {
    const plan = planTour({ rooms: rooms([[3], null]), settings: FIXED });
    const hall = plan.segments[0]!;
    const exit = plan.segments.at(-1)!;
    expect(hall.kind === 'HALL' && hall.fadeInEndSec).toBe(2);
    expect(len(hall)).toBe(5000);
    expect(len(exit)).toBe(5000);
    expect(exit.kind === 'EXIT' && ms(exit.endSec) - ms(exit.fadeOutStartSec)).toBe(3000);
  });

  it('한 작품에 30초를 넘게 머무르면 머무르기 한가운데에서 1.2배까지 가까이 간다', () => {
    const plan = planTour({ rooms: rooms([[3], song(180)]), settings: MUSIC });
    const arts = artworksOf(plan, 0);
    expect(arts.map(a => len(a))).toEqual([58_000, 58_000, 58_000]);
    for (const a of arts) {
      expect(a.closeup?.scale).toBe(1.2);
      expect(ms(a.closeup!.peakSec)).toBe(Math.round((ms(a.approachEndSec) + ms(a.endSec)) / 2));
    }
  });

  it('머무르기가 30초 이하이면 가까이 가지 않는다', () => {
    // 작품 구간 32.5초 = 다가가기 2.5 + 머무르기 30
    const plan = planTour({ rooms: rooms([[2], null]), settings: { timeMode: 'FIXED', secondsPerRoom: 71 } });
    const arts = artworksOf(plan, 0);
    expect(arts.map(a => len(a))).toEqual([32_500, 32_500]);
    expect(arts.map(a => a.closeup)).toEqual([null, null]);
  });

  it('전시실이 없으면 홀과 출구만', () => {
    const plan = planTour({ rooms: [], settings: MUSIC });
    expect(plan.segments.map(s => s.kind)).toEqual(['HALL', 'EXIT']);
    expect(plan.totalSec).toBe(10);
  });

  it('작품이 없는 관은 받지 않는다', () => {
    expect(() => planTour({ rooms: rooms([[3, 0], null]), settings: MUSIC })).toThrow(RangeError);
    expect(() => planTour({ rooms: rooms([[], null]), settings: MUSIC })).toThrow(RangeError);
    expect(() => planTour({ rooms: rooms([[1.5], null]), settings: MUSIC })).toThrow(RangeError);
  });
});

describe('songGainDb', () => {
  it('목표 −16 쪽으로, ±6dB 안', () => {
    expect(songGainDb(-16)).toBe(0);
    expect(songGainDb(-13)).toBe(-3);
    expect(songGainDb(-20)).toBe(4);
    expect(songGainDb(-30)).toBe(6);
    expect(songGainDb(-5)).toBe(-6);
    expect(songGainDb(null)).toBe(0);
  });
});

describe('equalPowerGain', () => {
  it('들어올 때 0 → 1, 나갈 때 1 → 0, 가운데서 두 곡의 힘 합이 1', () => {
    expect(equalPowerGain('IN', 0)).toBe(0);
    expect(equalPowerGain('IN', 1)).toBeCloseTo(1, 12);
    expect(equalPowerGain('OUT', 0)).toBe(1);
    expect(equalPowerGain('OUT', 1)).toBeCloseTo(0, 12);
    const p = 0.37;
    expect(equalPowerGain('IN', p) ** 2 + equalPowerGain('OUT', p) ** 2).toBeCloseTo(1, 12);
    expect(equalPowerGain('IN', -1)).toBe(0);
    expect(equalPowerGain('OUT', 2)).toBeCloseTo(0, 12);
  });
});

describe('planTour — 속성', () => {
  const musicArb: fc.Arbitrary<TourMusic | null> = fc.option(
    fc
      .record({
        audibleStartMs: fc.integer({ min: 0, max: 5000 }),
        audibleMs: fc.integer({ min: 0, max: 420_000 }),
        tailMs: fc.integer({ min: 0, max: 20_000 }),
        loudnessDb: fc.option(fc.integer({ min: -40, max: -3 }), { nil: null, freq: 8 }),
      })
      .map(m => ({
        audibleStartMs: m.audibleStartMs,
        audibleEndMs: m.audibleStartMs + m.audibleMs,
        durationMs: m.audibleStartMs + m.audibleMs + m.tailMs,
        loudnessDb: m.loudnessDb,
      })),
    { nil: null, freq: 4 },
  );
  const inputArb: fc.Arbitrary<TourInput> = fc.record({
    rooms: fc.array(
      fc.record({
        roomId: fc.uuid(),
        parts: fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 3 }),
        music: musicArb,
      }),
      { minLength: 0, maxLength: 7 },
    ),
    settings: fc.record({
      timeMode: fc.constantFrom('MUSIC' as const, 'FIXED' as const),
      secondsPerRoom: fc.integer({ min: 20, max: 360 }),
    }),
  });

  it('구간이 빈틈·겹침 없이 이어지고, 최소 시간·겹침 상한·페이드 맞물림을 지킨다', () => {
    fc.assert(
      fc.property(inputArb, input => {
        const plan = planTour(input);
        expectWellFormed(plan, input);
        // 같은 입력 → 같은 결과
        expect(planTour(input)).toEqual(plan);
      }),
      { numRuns: 300 },
    );
  });

  it('MUSIC에서 곡이 최소 시간보다 길면 전시실 시간 = 곡 길이 − 앞 곡 겹침, 곡이 전시실 끝까지 간다', () => {
    fc.assert(
      fc.property(inputArb, input => {
        const plan = planTour({ ...input, settings: { ...input.settings, timeMode: 'MUSIC' } });
        for (const r of plan.rooms) {
          if (r.timeSource !== 'MUSIC') continue;
          const s = r.song!;
          expect(len(r)).toBe(s.toMs - s.fromMs - ms(s.overlapPrevSec));
          expect(s.quietTailSec).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});
