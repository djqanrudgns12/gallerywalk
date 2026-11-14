import { z } from 'zod';
import { atLeastOne, UniqueIdsSchema } from './artwork.ts';
import { UuidSchema } from './common.ts';
import { AssetRefSchema, AudioAnalysisSchema } from './media.ts';
import { optionalTextField, textField } from './text.ts';

/** 전시실(PLAN §10.2 `rooms`, G-12). 분할된 관(1관·2관)은 저장하지 않고 배치가 만든다. */

const BgmSchema = z.object({
  asset: AssetRefSchema,
  durationMs: z.number().int().positive(),
  analysis: AudioAnalysisSchema,
});

export const RoomPublicSchema = z.object({
  id: UuidSchema,
  order: z.number().int().nonnegative(),
  title: z.string(),
  intro: z.string().nullable(),
  bgm: BgmSchema.nullable(),
});
export type RoomPublic = z.infer<typeof RoomPublicSchema>;

export const RoomTeacherSchema = RoomPublicSchema.extend({ rev: z.number().int().positive() });
export type RoomTeacher = z.infer<typeof RoomTeacherSchema>;

/** `POST …/{id}/rooms` (ID는 기기가 만든 UUID, 멱등) */
export const CreateRoomSchema = z.strictObject({
  id: UuidSchema,
  order: z.number().int().nonnegative(),
  title: textField('ROOM_TITLE_MAX_CHARS', { min: 1 }),
  intro: optionalTextField('ROOM_INTRO_MAX_CHARS', { multiline: true }).optional(),
});

/** `PATCH /rooms/{roomId}` (`If-Match: {rev}`) */
export const PatchRoomSchema = z
  .strictObject({
    title: textField('ROOM_TITLE_MAX_CHARS', { min: 1 }),
    intro: optionalTextField('ROOM_INTRO_MAX_CHARS', { multiline: true }),
  })
  .partial()
  .refine(atLeastOne, { message: 'empty_patch' });

/**
 * `PUT …/{id}/rooms/order`. `base`(선택, ADR-074): 클라이언트가 본 바꾸기 전 순서 — 서버의 지금 순서와 다르면 `E_CONFLICT`
 * (두 기기가 같은 판 순서를 바꿀 때 나중 것이 말없이 덮지 않게, 되돌리기는 `base`와 `ids`를 맞바꿔 보낸다)
 */
export const RoomOrderSchema = z.strictObject({ ids: UniqueIdsSchema, base: UniqueIdsSchema.optional() });
