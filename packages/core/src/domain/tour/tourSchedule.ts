import { config } from '../../config.ts';
import type { TourSettings } from '../../types/index.ts';

/**
 * 자동 투어 시간표(PRD G-16, PLAN §6.13, ADR-046). 순수 함수 — 카메라 경로·GSAP 타임라인·실제 음량 곡선은
 * 관람 엔진과 `audio/TourSoundtrack.ts`가 이 시간표를 받아 만든다.
 *
 * - 순서: 입구 홀 → 전시실마다, 관(1관·2관…)마다 [이름판 → 작품 구간 × n → 문 통과] → 출구.
 * - 전시실 시간: `MUSIC`이면 그 방 곡의 들리는 길이(안전 상한 `TOUR_MUSIC_MAX_SEC`), 곡이 없거나 `FIXED`이면
 *   `secondsPerRoom`. 최소 시간보다 짧으면 최소 시간을 쓰고 곡은 끝에서 페이드아웃한 뒤 조용히 간다(되풀이 없음).
 * - 소리: 곡은 `audibleStartMs`부터 등전력 페이드인, 전시실 끝에 맞춰 `TOUR_FADE_OUT_SEC` 페이드아웃
 *   (이 구간이 마지막 작품에서 떠나 문을 지나는 구간을 덮는다). 다음 곡은 앞 곡이 `TOUR_NEXT_SONG_AT_LEVEL`
 *   아래로 줄어든 때 시작한다 — 그래서 다음 곡은 앞 전시실 문 통과 중에 먼저 시작하고, `MUSIC`에서는 그만큼
 *   전시실 시간을 줄여 곡의 끝이 다시 문 통과와 맞물리게 한다. 겹침은 `TOUR_SONG_OVERLAP_SEC` 이하.
 *
 * 시간은 안에서 정수 밀리초로 계산하고(합계가 어긋나지 않게) 내보낼 때 초로 바꾼다. 구간은 빈틈·겹침 없이
 * 이어진다: 앞 구간의 `endSec`과 다음 구간의 `startSec`은 같은 값이다.
 */

// 단위 바꾸기(설정값이 아니라 시간 단위의 정의).
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** 전시실 배경음악: 파일 길이 + 서버 소리 분석값(PLAN §5.4 `AudioAnalysis`) */
export interface TourMusic {
  readonly durationMs: number;
  readonly audibleStartMs: number;
  readonly audibleEndMs: number;
  /** 들리는 구간의 평균 크기(dBFS). 완전한 무음은 null → 곡 없는 전시실로 다룬다 */
  readonly loudnessDb: number | null;
}

export interface TourRoomInput {
  readonly roomId: string;
  /** 관마다 작품 수(1 이상), 관 순서대로. 나뉘지 않은 전시실은 `[n]` */
  readonly parts: readonly number[];
  readonly music: TourMusic | null;
}

export interface TourInput {
  /** 투어 순서대로 */
  readonly rooms: readonly TourRoomInput[];
  readonly settings: TourSettings;
}

interface SegmentTime {
  readonly startSec: number;
  readonly endSec: number;
}

export interface TourHallSegment extends SegmentTime {
  readonly kind: 'HALL';
  /** 검은 화면에서 밝아지기가 끝나는 시각 */
  readonly fadeInEndSec: number;
}

export interface TourNameplateSegment extends SegmentTime {
  readonly kind: 'NAMEPLATE';
  readonly roomIndex: number;
  readonly partIndex: number;
}

export interface TourCloseup {
  /** 머무르기 한가운데: 이 시각에 가장 가까이 갔다가 물러난다 */
  readonly peakSec: number;
  readonly scale: number;
}

export interface TourArtworkSegment extends SegmentTime {
  readonly kind: 'ARTWORK';
  readonly roomIndex: number;
  readonly partIndex: number;
  /** 관 안에서의 작품 순서 */
  readonly artworkIndex: number;
  /** 다가가기가 끝나고 머무르기가 시작하는 시각 */
  readonly approachEndSec: number;
  /** 머무르기가 `TOUR_LINGER_CLOSEUP_AFTER_SEC`를 넘을 때만 한 번 가까이 가기 */
  readonly closeup: TourCloseup | null;
}

export interface TourDoorSegment extends SegmentTime {
  readonly kind: 'DOOR';
  readonly roomIndex: number;
  readonly partIndex: number;
  /** 문 너머: 같은 전시실의 다음 관 / 다음 전시실 / 출구 */
  readonly to: 'PART' | 'ROOM' | 'EXIT';
}

export interface TourExitSegment extends SegmentTime {
  readonly kind: 'EXIT';
  /** 마지막 화면 어두워지기가 시작하는 시각(끝은 `endSec`) */
  readonly fadeOutStartSec: number;
}

export type TourSegment =
  TourHallSegment | TourNameplateSegment | TourArtworkSegment | TourDoorSegment | TourExitSegment;

export interface TourSongPlan {
  /** 재생을 시작하는 투어 시각. 앞 곡과 겹치면 전시실 시작보다 `overlapPrevSec` 앞(앞 전시실 문 통과 중) */
  readonly startSec: number;
  /** 곡 안 시작 위치 = `audibleStartMs`(앞 무음을 건너뜀) */
  readonly fromMs: number;
  /** 등전력 페이드인이 끝나는 투어 시각 */
  readonly fadeInEndSec: number;
  /** 페이드아웃이 시작하는 투어 시각 */
  readonly fadeOutStartSec: number;
  /** 음량 0이 되어 멈추는 투어 시각 */
  readonly endSec: number;
  /** 곡 안 멈춤 위치: 들리는 끝·안전 상한·전시실 끝 중 먼저 오는 곳(곡을 되풀이하지 않는다) */
  readonly toMs: number;
  /** 곡 크기 맞추기 이득(dB, ±`AUDIO_GAIN_LIMIT_DB`) */
  readonly gainDb: number;
  /** 앞 전시실 곡과 겹치는 길이 */
  readonly overlapPrevSec: number;
  /** 다음 전시실 곡과 겹치는 길이 */
  readonly overlapNextSec: number;
  /** 곡이 멈춘 뒤 전시실 끝까지 조용히 가는 시간(곡이 전시실보다 짧을 때) */
  readonly quietTailSec: number;
}

export interface TourPartPlan {
  readonly partIndex: number;
  readonly artworkCount: number;
  readonly startSec: number;
  readonly endSec: number;
}

/** 전시실 시간을 정한 것: 곡 길이 / 설정 초(`FIXED`이거나 곡 없는 전시실) / 최소 시간 */
export type TourRoomTimeSource = 'MUSIC' | 'FIXED' | 'MINIMUM';

export interface TourRoomPlan {
  readonly roomId: string;
  readonly roomIndex: number;
  /** 첫 관 이름판 시작(GSAP 이름표 자리) */
  readonly startSec: number;
  /** 마지막 관 문 통과 끝 */
  readonly endSec: number;
  readonly timeSource: TourRoomTimeSource;
  readonly parts: TourPartPlan[];
  readonly song: TourSongPlan | null;
}

export interface TourPlan {
  readonly segments: TourSegment[];
  readonly rooms: TourRoomPlan[];
  readonly totalSec: number;
  /** 교사 투어 버튼 옆 "약 ○분": 분으로 반올림, 최소 1 */
  readonly approxMinutes: number;
}

/** 등전력 곡선(equal-power). 진행률 0~1 → 목표 음량 대비 비율. 들어올 때 sin, 나갈 때 cos. */
export const equalPowerGain = (direction: 'IN' | 'OUT', progress: number): number => {
  const angle = (Math.min(1, Math.max(0, progress)) * Math.PI) / 2;
  return direction === 'IN' ? Math.sin(angle) : Math.cos(angle);
};

/** 곡 크기 맞추기 이득(PLAN §6.13·§8.2): 목표 크기 쪽으로, ±`AUDIO_GAIN_LIMIT_DB` 안. 크기를 모르면 0. */
export const songGainDb = (loudnessDb: number | null): number => {
  if (loudnessDb === null || !Number.isFinite(loudnessDb)) return 0;
  const c = config();
  const gain = c.AUDIO_TARGET_LOUDNESS_DB - loudnessDb;
  return Math.min(c.AUDIO_GAIN_LIMIT_DB, Math.max(-c.AUDIO_GAIN_LIMIT_DB, gain));
};

/** 페이드아웃 중 음량이 `level` 아래로 내려가는 때(페이드아웃 길이에 대한 비율). cos(πx/2) = level을 푼 값. */
const levelDropFraction = (level: number): number =>
  (Math.acos(Math.min(1, Math.max(0, level))) * 2) / Math.PI;

const toMs = (sec: number): number => Math.round(sec * MS_PER_SECOND);
const toSec = (ms: number): number => ms / MS_PER_SECOND;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** 틀린 입력은 부르는 쪽의 잘못이다(배치가 만든 관에는 작품이 1점 이상). */
const checkedParts = (room: TourRoomInput, roomIndex: number): readonly number[] => {
  if (room.parts.length === 0 || room.parts.some(n => !Number.isInteger(n) || n < 1)) {
    throw new RangeError(`rooms[${roomIndex}].parts`);
  }
  return room.parts;
};

/** 곡의 쓸 수 있는 길이(ms): 들리는 길이(파일 끝을 넘지 않음)를 안전 상한으로 자른 것. 들리지 않으면 null. */
const usableSongMs = (music: TourMusic | null, maxMs: number): number | null => {
  if (music === null || music.loudnessDb === null) return null;
  const audibleMs = Math.round(Math.min(music.audibleEndMs, music.durationMs) - music.audibleStartMs);
  if (!(audibleMs > 0)) return null;
  return Math.min(audibleMs, maxMs);
};

/**
 * 전시실 시간을 관의 작품 수 비율로 나눈다(나뉜 전시실, PRD_REVIEW B13). 비율 몫이 그 관의 최소 시간보다
 * 작은 관은 최소 시간으로 묶고, 남은 시간을 나머지 관에 다시 비율로 나눈다(합계는 그대로).
 * 남는 1밀리초들은 앞 관부터 하나씩 더한다. 부르는 쪽이 `roomMs >= sum(mins)`를 지킨다.
 */
const splitRoomMs = (roomMs: number, counts: readonly number[], mins: readonly number[]): number[] => {
  const pinned = counts.map(() => false);
  for (;;) {
    const freeMs = roomMs - sum(mins.filter((_, i) => pinned[i]));
    const freeCount = sum(counts.filter((_, i) => !pinned[i]));
    if (freeCount === 0) break;
    let changed = false;
    counts.forEach((n, i) => {
      if (!pinned[i] && (freeMs * n) / freeCount < mins[i]!) {
        pinned[i] = true;
        changed = true;
      }
    });
    if (!changed) break;
  }
  const freeMs = roomMs - sum(mins.filter((_, i) => pinned[i]));
  const freeCount = sum(counts.filter((_, i) => !pinned[i]));
  const out = counts.map((n, i) => (pinned[i] ? mins[i]! : Math.floor((freeMs * n) / freeCount)));
  let rest = roomMs - sum(out);
  for (let i = 0; rest > 0 && i < out.length; i++) {
    if (pinned[i]) continue;
    out[i] = out[i]! + 1;
    rest--;
  }
  return out;
};

/** 곡이 페이드인 + 페이드아웃보다 짧으면 둘을 같은 비율로 줄인다. */
const fadeLengths = (
  playMs: number,
  fadeInMs: number,
  fadeOutMs: number,
): { inMs: number; outMs: number } => {
  const both = fadeInMs + fadeOutMs;
  if (playMs >= both) return { inMs: fadeInMs, outMs: fadeOutMs };
  if (both === 0) return { inMs: 0, outMs: 0 };
  const inMs = Math.round((playMs * fadeInMs) / both);
  return { inMs, outMs: playMs - inMs };
};

interface SongDraft {
  startMs: number;
  fromMs: number;
  fadeInEndMs: number;
  fadeOutStartMs: number;
  endMs: number;
  toMs: number;
  gainDb: number;
  overlapPrevMs: number;
  overlapNextMs: number;
  quietTailMs: number;
  /** 음량이 `TOUR_NEXT_SONG_AT_LEVEL` 이하가 되는 첫 밀리초(올림 — 다음 곡은 이 시각보다 일찍 시작하지 않는다) */
  dropMs: number;
}

export const planTour = (input: TourInput): TourPlan => {
  const c = config();
  const { settings } = input;
  const hallMs = toMs(c.TOUR_HALL_SEC);
  const nameplateMs = toMs(c.TOUR_NAMEPLATE_SEC);
  const doorMs = toMs(c.TOUR_TRANSITION_SEC);
  const exitMs = toMs(c.TOUR_EXIT_SEC);
  const approachMs = toMs(c.TOUR_APPROACH_SEC);
  const minPerArtworkMs = toMs(c.TOUR_MIN_SEC_PER_ARTWORK);
  const minPerPartMs = toMs(c.TOUR_MIN_SECONDS_PER_PART);
  const musicMaxMs = toMs(c.TOUR_MUSIC_MAX_SEC);
  const fadeInMs = toMs(c.TOUR_FADE_IN_SEC);
  const fadeOutMs = toMs(c.TOUR_FADE_OUT_SEC);
  const overlapMaxMs = toMs(c.TOUR_SONG_OVERLAP_SEC);
  const closeupAfterMs = toMs(c.TOUR_LINGER_CLOSEUP_AFTER_SEC);
  const fixedRoomMs = toMs(settings.secondsPerRoom);
  const dropFraction = levelDropFraction(c.TOUR_NEXT_SONG_AT_LEVEL);
  const lastRoom = input.rooms.length - 1;

  const segments: TourSegment[] = [
    {
      kind: 'HALL',
      startSec: 0,
      endSec: toSec(hallMs),
      fadeInEndSec: toSec(Math.min(hallMs, toMs(c.TOUR_HALL_FADE_IN_SEC))),
    },
  ];
  const rooms: Array<Omit<TourRoomPlan, 'song'> & { song: SongDraft | null }> = [];
  let cursor = hallMs;
  let prevSong: SongDraft | null = null;

  input.rooms.forEach((room, roomIndex) => {
    const counts = checkedParts(room, roomIndex);
    // 관의 최소 시간: 이름판 + 작품당 최소 + 문 통과(작품 구간이 최소 시간 아래로 줄지 않게), 그리고 관 최소 시간.
    const mins = counts.map(n => Math.max(minPerPartMs, nameplateMs + n * minPerArtworkMs + doorMs));
    const minRoomMs = sum(mins);
    const songMs = usableSongMs(room.music, musicMaxMs);

    // 앞 곡이 이 전시실 시작까지 울리고 있었으면, 앞 곡이 기준 음량 아래로 줄어든 때 이 곡을 먼저 시작한다.
    let leadMs = 0;
    if (songMs !== null && prevSong !== null && prevSong.endMs === cursor) {
      leadMs = Math.min(overlapMaxMs, Math.max(0, cursor - prevSong.dropMs));
      if (songMs <= leadMs) leadMs = 0; // 전시실 시작 전에 끝나 버릴 만큼 짧은 곡은 겹치지 않는다
    }

    const musicMs = settings.timeMode === 'MUSIC' && songMs !== null ? songMs - leadMs : null;
    const wantedMs = musicMs ?? fixedRoomMs;
    const roomMs = Math.max(wantedMs, minRoomMs);
    const timeSource: TourRoomTimeSource =
      roomMs > wantedMs ? 'MINIMUM' : musicMs !== null ? 'MUSIC' : 'FIXED';
    const partMs = splitRoomMs(roomMs, counts, mins);

    const roomStart = cursor;
    const parts: TourPartPlan[] = [];
    partMs.forEach((pMs, partIndex) => {
      const n = counts[partIndex]!;
      const partStart = cursor;
      segments.push({
        kind: 'NAMEPLATE',
        roomIndex,
        partIndex,
        startSec: toSec(cursor),
        endSec: toSec(cursor + nameplateMs),
      });
      cursor += nameplateMs;
      // 작품 구간 = (관 시간 − 이름판 − 문 통과) ÷ n. 남는 1밀리초들은 앞 작품부터.
      const artworksMs = pMs - nameplateMs - doorMs;
      const baseMs = Math.floor(artworksMs / n);
      const extra = artworksMs - baseMs * n;
      for (let artworkIndex = 0; artworkIndex < n; artworkIndex++) {
        const lenMs = baseMs + (artworkIndex < extra ? 1 : 0);
        const endMs = cursor + lenMs;
        const approachEndMs = cursor + Math.min(approachMs, lenMs);
        const lingerMs = endMs - approachEndMs;
        segments.push({
          kind: 'ARTWORK',
          roomIndex,
          partIndex,
          artworkIndex,
          startSec: toSec(cursor),
          endSec: toSec(endMs),
          approachEndSec: toSec(approachEndMs),
          closeup:
            lingerMs > closeupAfterMs
              ? {
                  peakSec: toSec(Math.round((approachEndMs + endMs) / 2)),
                  scale: c.TOUR_LINGER_CLOSEUP_SCALE,
                }
              : null,
        });
        cursor = endMs;
      }
      const lastPart = partIndex === partMs.length - 1;
      segments.push({
        kind: 'DOOR',
        roomIndex,
        partIndex,
        to: !lastPart ? 'PART' : roomIndex < lastRoom ? 'ROOM' : 'EXIT',
        startSec: toSec(cursor),
        endSec: toSec(cursor + doorMs),
      });
      cursor += doorMs;
      parts.push({ partIndex, artworkCount: n, startSec: toSec(partStart), endSec: toSec(cursor) });
    });

    let song: SongDraft | null = null;
    if (songMs !== null && room.music !== null) {
      const startMs = roomStart - leadMs;
      const playMs = Math.min(songMs, leadMs + roomMs);
      const fades = fadeLengths(playMs, fadeInMs, fadeOutMs);
      const endMs = startMs + playMs;
      const fadeOutStartMs = endMs - fades.outMs;
      song = {
        startMs,
        fromMs: room.music.audibleStartMs,
        fadeInEndMs: startMs + fades.inMs,
        fadeOutStartMs,
        endMs,
        toMs: room.music.audibleStartMs + playMs,
        gainDb: songGainDb(room.music.loudnessDb),
        overlapPrevMs: leadMs,
        overlapNextMs: 0,
        quietTailMs: cursor - endMs,
        dropMs: fadeOutStartMs + Math.ceil(fades.outMs * dropFraction),
      };
      if (leadMs > 0 && prevSong !== null) prevSong.overlapNextMs = leadMs;
    }
    prevSong = song;
    rooms.push({
      roomId: room.roomId,
      roomIndex,
      startSec: toSec(roomStart),
      endSec: toSec(cursor),
      timeSource,
      parts,
      song,
    });
  });

  const exitEndMs = cursor + exitMs;
  segments.push({
    kind: 'EXIT',
    startSec: toSec(cursor),
    endSec: toSec(exitEndMs),
    fadeOutStartSec: toSec(exitEndMs - Math.min(exitMs, toMs(c.TOUR_EXIT_FADE_OUT_SEC))),
  });

  const totalSec = toSec(exitEndMs);
  return {
    segments,
    rooms: rooms.map(r => ({ ...r, song: r.song === null ? null : songPlan(r.song) })),
    totalSec,
    approxMinutes: Math.max(1, Math.round(totalSec / SECONDS_PER_MINUTE)),
  };
};

const songPlan = (s: SongDraft): TourSongPlan => ({
  startSec: toSec(s.startMs),
  fromMs: s.fromMs,
  fadeInEndSec: toSec(s.fadeInEndMs),
  fadeOutStartSec: toSec(s.fadeOutStartMs),
  endSec: toSec(s.endMs),
  toMs: s.toMs,
  gainDb: s.gainDb,
  overlapPrevSec: toSec(s.overlapPrevMs),
  overlapNextSec: toSec(s.overlapNextMs),
  quietTailSec: toSec(s.quietTailMs),
});
