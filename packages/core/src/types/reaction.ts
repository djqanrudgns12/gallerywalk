import { z } from 'zod';
import { config } from '../config.ts';
import { EpochMsSchema, StickerSchema, TokenHashSchema, UuidSchema } from './common.ts';
import { optionalTextField, textField } from './text.ts';

/**
 * 반응(G-07·G-15, PLAN §9.2·§10.2). 기기 1대 = 작품 1개에 반응 1개(멱등 PUT).
 * 설정이 받지 않는 칸을 보냈는지·메모 걸러내기는 서버 유스케이스가 본다(`E_VALIDATION`·`E_MEMO_BLOCKED`).
 */

const ScoreSchema = z.number().int().min(1).max(3);

/** `PUT /api/e/{code}/reactions/{artworkId}`: 네 칸을 모두 보내고(안 쓰는 칸은 null), 하나는 채운다. */
export const ReactionBodySchema = z
  .strictObject({
    sticker: StickerSchema.nullable(),
    memo: optionalTextField('MEMO_MAX_CHARS'),
    scoreFact: ScoreSchema.nullable(),
    scoreDelivery: ScoreSchema.nullable(),
  })
  .refine(r => r.sticker !== null || r.memo !== null || r.scoreFact !== null || r.scoreDelivery !== null, {
    message: 'empty_reaction',
  })
  .refine(r => (r.scoreFact === null) === (r.scoreDelivery === null), {
    message: 'score_pair',
    path: ['scoreDelivery'],
  });
export type ReactionBody = z.infer<typeof ReactionBodySchema>;

export const ReactionViewSchema = z.object({
  artworkId: UuidSchema,
  sticker: StickerSchema.nullable(),
  memo: z.string().nullable(),
  scoreFact: ScoreSchema.nullable(),
  scoreDelivery: ScoreSchema.nullable(),
  updatedAt: EpochMsSchema,
});
export type ReactionView = z.infer<typeof ReactionViewSchema>;

/** 별명: 1~`NICKNAME_MAX_CHARS`자. 욕설 걸러내기·정규화는 `domain/reactions/nickname.ts`(P2-5) */
export const NicknameSchema = textField('NICKNAME_MAX_CHARS', { min: 1 });

/** `POST /api/e/{code}/visitor`: 토큰은 기기가 만든 256비트, 서버는 해시만(ADR-025) */
export const VisitorRegisterSchema = z.strictObject({
  tokenHash: TokenHashSchema,
  nickname: NicknameSchema.optional(),
  /** 동의한 문구 판(`CONSENT_VERSION`) */
  consentVersion: z.string().refine(v => v === config().CONSENT_VERSION, { message: 'consent_version' }),
});

/** `PATCH /api/e/{code}/visitor` */
export const NicknamePatchSchema = z.strictObject({ nickname: NicknameSchema });

/** 학생 화면의 공개 집계(교사가 공개를 켠 것만, PLAN §7.3) */
export const PublicReactionSummarySchema = z.object({
  artworkId: UuidSchema,
  /** 스티커별 수(공개가 꺼졌거나 0이면 칸이 없음) */
  stickers: z.partialRecord(StickerSchema, z.number().int().positive()),
  /** 평가 평균(공개가 꺼졌으면 null) */
  score: z
    .object({
      factAvg: z.number().min(1).max(3),
      deliveryAvg: z.number().min(1).max(3),
      count: z.number().int().positive(),
    })
    .nullable(),
  /** 교사가 고른 메모(별명 방식이면 별명, 아니면 null = "익명") */
  memos: z.array(z.object({ nickname: z.string().nullable(), memo: z.string() })),
});
export type PublicReactionSummary = z.infer<typeof PublicReactionSummarySchema>;

/** 교사 반응 모아 보기(G-15) */
export const TeacherReactionSchema = z.object({
  id: UuidSchema,
  artworkId: UuidSchema,
  sticker: StickerSchema.nullable(),
  memo: z.string().nullable(),
  scoreFact: ScoreSchema.nullable(),
  scoreDelivery: ScoreSchema.nullable(),
  nickname: z.string().nullable(),
  hidden: z.boolean(),
  publicSelected: z.boolean(),
  createdAt: EpochMsSchema,
  updatedAt: EpochMsSchema,
});
export type TeacherReaction = z.infer<typeof TeacherReactionSchema>;

/** `PATCH /api/teacher/reactions/{rid}`: 숨기기·공개로 고르기 */
export const ReactionPatchSchema = z
  .strictObject({ hidden: z.boolean(), publicSelected: z.boolean() })
  .partial()
  .refine(o => o.hidden !== undefined || o.publicSelected !== undefined, { message: 'empty_patch' });
