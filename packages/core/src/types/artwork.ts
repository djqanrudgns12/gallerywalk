import { z } from 'zod';
import { config } from '../config.ts';
import {
  ArtworkFormSchema,
  ArtworkKindSchema,
  ArtworkStatusSchema,
  ArtworkWarningSchema,
  EpochMsSchema,
  ErrorCodeSchema,
  PageModeSchema,
  UuidSchema,
} from './common.ts';
import { AssetRefSchema, AudioAnalysisSchema, ImageAnalysisWireSchema } from './media.ts';
import { optionalTextField, textField } from './text.ts';

/**
 * 작품(PLAN §10.2 `artworks`, §9.2 작품 경로). 학생 보기는 게시된 것만, 교사 보기는 숨김·처리 중·실패 포함.
 * 형태·글 많음은 **적용된 값**(교사가 바꿨으면 그 값)을 `form`·`textHeavy`로 내고, 교사 보기에만 자동값·바꾼 값을 따로 둔다.
 */

const ImageMediaSchema = z.object({
  asset: AssetRefSchema,
  /** 바로 세운 원본 화소 */
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  analysis: ImageAnalysisWireSchema,
});

const PageMediaSchema = ImageMediaSchema.extend({ idx: z.number().int().positive() });

const AudioMediaSchema = z.object({
  asset: AssetRefSchema,
  durationMs: z.number().int().positive(),
  analysis: AudioAnalysisSchema,
  /** MP3 태그에서 꺼낸 표지 그림(있으면) */
  cover: AssetRefSchema.nullable(),
});

const artworkFields = {
  id: UuidSchema,
  roomId: UuidSchema,
  order: z.number().int().nonnegative(),
  title: z.string(),
  author: z.string().nullable(),
  caption: z.string().nullable(),
  description: z.string().nullable(),
  kind: ArtworkKindSchema,
  form: ArtworkFormSchema,
  textHeavy: z.boolean(),
  featured: z.boolean(),
  pageMode: PageModeSchema,
  /** IMAGE */
  image: ImageMediaSchema.nullable(),
  /** PDF(쪽 번호 1부터, 순서대로) */
  pages: z.array(PageMediaSchema).nullable(),
  /** AUDIO */
  audio: AudioMediaSchema.nullable(),
  /** TEXT 본문 */
  textBody: z.string().nullable(),
};

export const ArtworkPublicSchema = z.object(artworkFields);
export type ArtworkPublic = z.infer<typeof ArtworkPublicSchema>;

export const ArtworkTeacherSchema = z.object({
  ...artworkFields,
  status: ArtworkStatusSchema,
  formAuto: ArtworkFormSchema,
  formOverride: ArtworkFormSchema.nullable(),
  textHeavyAuto: z.boolean(),
  textHeavyOverride: z.boolean().nullable(),
  warnings: z.array(ArtworkWarningSchema),
  /** FAILED의 사유(카드에 한 줄) */
  failCode: ErrorCodeSchema.nullable(),
  rev: z.number().int().positive(),
  deletedAt: EpochMsSchema.nullable(),
  createdAt: EpochMsSchema,
  updatedAt: EpochMsSchema,
});
export type ArtworkTeacher = z.infer<typeof ArtworkTeacherSchema>;

// ── 교사 요청 본문 ────────────────────────────────────────────

const createFields = {
  id: UuidSchema,
  roomId: UuidSchema,
  order: z.number().int().nonnegative(),
  /** 파일 이름에서 기기가 만든 제목(비어 있을 수 있음 — "제목 없는 작품" 점검 줄에 뜸) */
  title: textField('ARTWORK_TITLE_MAX_CHARS'),
};

/** 그림·HEIC·소리: multipart의 `meta` 칸(JSON) + `file` */
export const CreateFileArtworkMetaSchema = z.strictObject({
  ...createFields,
  kind: z.enum(['IMAGE', 'AUDIO']),
});

/** 글 작품: JSON 본문만 */
export const CreateTextArtworkSchema = z.strictObject({
  ...createFields,
  kind: z.literal('TEXT'),
  textBody: textField('TEXT_MAX_CHARS', { multiline: true, min: 1 }),
});

/** PDF 1단계: 쪽 수를 먼저 알리고 쪽은 `PUT …/pages/{i}`로(§9.2) */
export const CreatePdfArtworkSchema = z.strictObject({
  ...createFields,
  kind: z.literal('PDF'),
  pageCount: z
    .number()
    .int()
    .positive()
    .refine(n => n <= config().PDF_MAX_PAGES, { message: 'too_many_pages' }),
});

export const CreateJsonArtworkSchema = z.discriminatedUnion('kind', [
  CreateTextArtworkSchema,
  CreatePdfArtworkSchema,
]);

const atLeastOne = (o: object): boolean => Object.keys(o).length > 0;

/** `PATCH /api/teacher/artworks/{aid}` (`If-Match: {rev}`). 빠진 칸은 그대로, null은 비움. */
export const PatchArtworkSchema = z
  .strictObject({
    title: textField('ARTWORK_TITLE_MAX_CHARS'),
    author: optionalTextField('AUTHOR_MAX_CHARS'),
    caption: optionalTextField('CAPTION_MAX_CHARS'),
    description: optionalTextField('DESCRIPTION_MAX_CHARS', { multiline: true }),
    textBody: textField('TEXT_MAX_CHARS', { multiline: true, min: 1 }),
    roomId: UuidSchema,
    status: z.enum(['HIDDEN', 'PUBLISHED']),
    featured: z.boolean(),
    formOverride: ArtworkFormSchema.nullable(),
    textHeavyOverride: z.boolean().nullable(),
    pageMode: PageModeSchema,
  })
  .partial()
  .refine(atLeastOne, { message: 'empty_patch' });
export type PatchArtwork = z.infer<typeof PatchArtworkSchema>;

const uniqueIds = z
  .array(UuidSchema)
  .min(1)
  .refine(ids => new Set(ids).size === ids.length, { message: 'duplicate_ids' });

/** `PUT /api/teacher/rooms/{roomId}/artwork-order`: 전체 순서. 집합이 지금과 다르면 E_CONFLICT */
export const ArtworkOrderSchema = z.strictObject({ ids: uniqueIds });

export const ArtworkBatchSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('HIDE'), ids: uniqueIds }),
  z.strictObject({ action: z.literal('PUBLISH'), ids: uniqueIds }),
  z.strictObject({ action: z.literal('MOVE'), ids: uniqueIds, roomId: UuidSchema }),
]);
export type ArtworkBatch = z.infer<typeof ArtworkBatchSchema>;

// ── 한 번에 놓기(ADR-074, FIELD_PLAN §5.5) ─────────────────────

/** 판 하나: 전시실과 그 안의 작품 차례. 마지막 작품을 빼낸 판도 보낼 수 있게 빈 배열을 허용한다(`uniqueIds`와 따로) */
export const ArrangementRoomSchema = z.strictObject({ roomId: UuidSchema, ids: z.array(UuidSchema) });
export type ArrangementRoom = z.infer<typeof ArrangementRoomSchema>;

const idsOf = (rooms: readonly ArrangementRoom[]): string[] => rooms.flatMap(r => r.ids);
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return set.size === b.length && b.every(x => set.has(x));
};

/** 한쪽 배열: 판 1개 이상, 같은 전시실은 한 번만, 작품 ID는 판을 통틀어 한 번만, 상한은 설정에서 그때그때 */
const arrangementSide = z
  .array(ArrangementRoomSchema)
  .min(1)
  .refine(rooms => rooms.length <= config().ARRANGEMENT_MAX_ROOMS, { message: 'too_many_rooms' })
  .refine(rooms => idsOf(rooms).length <= config().ARRANGEMENT_MAX_IDS, { message: 'too_many_ids' })
  .refine(rooms => new Set(rooms.map(r => r.roomId)).size === rooms.length, { message: 'duplicate_rooms' })
  .refine(rooms => new Set(idsOf(rooms)).size === idsOf(rooms).length, { message: 'duplicate_ids' });

/**
 * `PUT /api/teacher/exhibitions/{id}/arrangement`: 바꾸기 전 배열 `base`(클라이언트가 본 것)와 바꾼 뒤 배열 `rooms`.
 * 바뀐 전시실들만 보내고, 두 쪽은 같은 전시실 목록·같은 작품 집합이어야 한다(옮기기는 판 사이에서만 일어난다).
 * `restoreFeatured`: 되돌리기가 되살릴 대표작(옮기면 풀린 것) — `rooms` 안의 작품만.
 */
export const ArrangementSchema = z
  .strictObject({
    base: arrangementSide,
    rooms: arrangementSide,
    restoreFeatured: z
      .array(UuidSchema)
      .refine(ids => ids.length <= config().ARRANGEMENT_MAX_ROOMS, { message: 'too_many_ids' })
      .refine(ids => new Set(ids).size === ids.length, { message: 'duplicate_ids' })
      .optional(),
  })
  .refine(
    b =>
      sameSet(
        b.base.map(r => r.roomId),
        b.rooms.map(r => r.roomId),
      ),
    { message: 'rooms_mismatch', path: ['rooms'] },
  )
  .refine(b => sameSet(idsOf(b.base), idsOf(b.rooms)), { message: 'ids_mismatch', path: ['rooms'] })
  .refine(b => (b.restoreFeatured ?? []).every(id => idsOf(b.rooms).includes(id)), {
    message: 'not_in_rooms',
    path: ['restoreFeatured'],
  });
export type Arrangement = z.infer<typeof ArrangementSchema>;

/** 응답: 놓은 뒤 서버 배열(그사이 올라온 작품은 끝에 붙어 있음), 그 판들 작품의 새 rev, 전시 내용 판(`versions.contentVersion`) */
export const ArrangementResultSchema = z.object({
  rooms: z.array(ArrangementRoomSchema),
  revs: z.record(UuidSchema, z.number().int().positive()),
  revision: z.number().int().positive(),
});
export type ArrangementResult = z.infer<typeof ArrangementResultSchema>;

export { uniqueIds as UniqueIdsSchema, atLeastOne };
