import { z } from 'zod';
import { config } from '../config.ts';

/**
 * 전시 설정(`exhibitions.settings_json`, PLAN §10.2). 기본값은 PRD G-07·G-16 표 그대로 — 빈 객체를 넣으면 기본값이 채워진다.
 */

/** 반응 설정(G-07). 기본: 받기 켬 · 스티커 + 메모 · 별명 · 공개는 모두 "교사만". */
export const ReactionSettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    collect: z
      .object({
        sticker: z.boolean().default(true),
        memo: z.boolean().default(true),
        /** 별점: 사실 정확성·전달력 각 1~3 */
        score: z.boolean().default(false),
      })
      .prefault({}),
    naming: z.enum(['ANONYMOUS', 'NICKNAME']).default('NICKNAME'),
    /** 스티커 공개: 교사만 / 모두에게(작품별 수) */
    stickerVisibility: z.enum(['TEACHER', 'PUBLIC']).default('TEACHER'),
    /** 메모 공개: 교사만 / 교사가 고른 것만 모두에게 */
    memoVisibility: z.enum(['TEACHER', 'SELECTED']).default('TEACHER'),
    /** 별점 공개: 교사만 / 모두에게(평균) */
    scoreVisibility: z.enum(['TEACHER', 'PUBLIC']).default('TEACHER'),
  })
  .refine(s => !s.enabled || s.collect.sticker || s.collect.memo || s.collect.score, {
    message: 'nothing_collected',
    path: ['collect'],
  });
export type ReactionSettings = z.infer<typeof ReactionSettingsSchema>;

/** 자동 투어(G-16, ADR-046): 노래 길이에 맞춤(MUSIC) 또는 전시실마다 고정 초(FIXED). */
export const TourSettingsSchema = z.object({
  timeMode: z.enum(['MUSIC', 'FIXED']).default(() => config().TOUR_TIME_MODE_DEFAULT),
  /** FIXED이거나 배경음악이 없는 전시실의 시간 */
  secondsPerRoom: z
    .number()
    .int()
    .default(() => config().TOUR_SECONDS_PER_ROOM)
    .refine(v => v >= config().TOUR_MIN_SECONDS_PER_PART && v <= config().TOUR_MUSIC_MAX_SEC, {
      message: 'out_of_range',
    }),
});
export type TourSettings = z.infer<typeof TourSettingsSchema>;

/**
 * 함께 관람 머리 위 말풍선(PRD_V2 W-02, U-31): 켬/끔(기본 켬) · 짧은 글까지 받기(기본 끔 — 스티커·정해진 말만).
 * 수업 중 교사가 바로 끌 수 있다(수업 탭). 서버는 보낼 때마다 이 값을 다시 읽는다.
 */
export const BubbleSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  text: z.boolean().default(false),
});
export type BubbleSettings = z.infer<typeof BubbleSettingsSchema>;

export const ExhibitionSettingsSchema = z.object({
  reactions: ReactionSettingsSchema.prefault({}),
  tour: TourSettingsSchema.prefault({}),
  bubbles: BubbleSettingsSchema.prefault({}),
});
export type ExhibitionSettings = z.infer<typeof ExhibitionSettingsSchema>;
/** 만들기·고치기 본문에서 받는 모양(빠진 칸은 기본값) */
export type ExhibitionSettingsInput = z.input<typeof ExhibitionSettingsSchema>;

/** 학생이 볼 수 있는 공개 여부가 하나라도 켜졌는가(별명·동의 문구가 "다른 친구들도 볼 수 있어요"로 바뀜, PLAN §7.3) */
export const anythingPublic = (r: ReactionSettings): boolean =>
  (r.collect.sticker && r.stickerVisibility === 'PUBLIC') ||
  (r.collect.memo && r.memoVisibility === 'SELECTED') ||
  (r.collect.score && r.scoreVisibility === 'PUBLIC');
