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

/** `PUT …/{id}/rooms/order` */
export const RoomOrderSchema = z.strictObject({ ids: UniqueIdsSchema });
