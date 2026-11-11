import { z } from 'zod';
import { ArtworkPublicSchema, ArtworkTeacherSchema, atLeastOne } from './artwork.ts';
import {
  EntryCodeSchema,
  EpochMsSchema,
  ExhibitionStatusSchema,
  PinSchema,
  SessionKindSchema,
  TemplateIdSchema,
  TokenHashSchema,
  UuidSchema,
} from './common.ts';
import { LayoutSchema } from './layout.ts';
import { AssetRefSchema } from './media.ts';
import { PublicReactionSummarySchema } from './reaction.ts';
import { RoomPublicSchema, RoomTeacherSchema } from './room.ts';
import { ExhibitionSettingsSchema, ReactionSettingsSchema } from './settings.ts';
import { optionalTextField, textField } from './text.ts';

/** 전시(PLAN §9.2·§10.2). 학생 보기 묶음 `ExhibitionView`와 교사 보기 `TeacherExhibitionView`. */

export const VersionsSchema = z.object({
  layoutVersion: z.number().int().nonnegative(),
  contentVersion: z.number().int().positive(),
  settingsVersion: z.number().int().positive(),
});

/** `GET /api/e/{code}/v` (60초 확인, ADR-027) */
export const VersionInfoSchema = VersionsSchema.extend({ status: ExhibitionStatusSchema });
export type VersionInfo = z.infer<typeof VersionInfoSchema>;

export const ExhibitionPublicSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  subtitle: z.string().nullable(),
  templateId: TemplateIdSchema,
  poster: AssetRefSchema.nullable(),
  /** 교사가 "학교·학급 표시"를 켰을 때만 */
  school: z.object({ schoolName: z.string().nullable(), className: z.string().nullable() }).nullable(),
  expiresAt: EpochMsSchema,
  /** 반응 시트에 어떤 칸을 보일지 */
  reactions: ReactionSettingsSchema,
});
export type ExhibitionPublic = z.infer<typeof ExhibitionPublicSchema>;

/** `GET /api/e/{code}`: OPEN 전시만(DRAFT·CLOSED·없음은 오류 코드) */
export const ExhibitionViewSchema = z.object({
  exhibition: ExhibitionPublicSchema,
  rooms: z.array(RoomPublicSchema),
  artworks: z.array(ArtworkPublicSchema),
  layout: LayoutSchema,
  versions: VersionsSchema,
  reactions: z.array(PublicReactionSummarySchema),
});
export type ExhibitionView = z.infer<typeof ExhibitionViewSchema>;

export const ExhibitionTeacherSchema = z.object({
  id: UuidSchema,
  entryCode: EntryCodeSchema,
  title: z.string(),
  subtitle: z.string().nullable(),
  templateId: TemplateIdSchema,
  poster: AssetRefSchema.nullable(),
  schoolName: z.string().nullable(),
  className: z.string().nullable(),
  showSchool: z.boolean(),
  settings: ExhibitionSettingsSchema,
  status: ExhibitionStatusSchema,
  rev: z.number().int().positive(),
  createdAt: EpochMsSchema,
  expiresAt: EpochMsSchema,
  openedAt: EpochMsSchema.nullable(),
  closedAt: EpochMsSchema.nullable(),
});
export type ExhibitionTeacher = z.infer<typeof ExhibitionTeacherSchema>;

/** `GET /api/teacher/exhibitions/{id}`: 숨김·처리 중 포함. 배치는 게시 작품이 없으면 null */
export const TeacherExhibitionViewSchema = z.object({
  exhibition: ExhibitionTeacherSchema,
  rooms: z.array(RoomTeacherSchema),
  artworks: z.array(ArtworkTeacherSchema),
  layout: LayoutSchema.nullable(),
  versions: VersionsSchema,
});
export type TeacherExhibitionView = z.infer<typeof TeacherExhibitionViewSchema>;

// ── 교사 요청 본문 ────────────────────────────────────────────

/** `POST /api/teacher/exhibitions`. 같은 ID·같은 본문으로 다시 오면 처음 결과(멱등, §9.2) */
export const CreateExhibitionSchema = z.strictObject({
  exhibitionId: UuidSchema,
  title: textField('EXHIBITION_TITLE_MAX_CHARS', { min: 1 }),
  templateId: TemplateIdSchema,
  subtitle: optionalTextField('SUBTITLE_MAX_CHARS').optional(),
  pin: PinSchema,
  /** 선생님 링크 토큰(기기가 만든 256비트)의 해시 */
  linkTokenHash: TokenHashSchema,
  settings: ExhibitionSettingsSchema.optional(),
  /** 처음 쓰는 기기의 시작 코드(ADR-048) */
  startCode: z.string().max(32).optional(),
});
export type CreateExhibition = z.infer<typeof CreateExhibitionSchema>;

export const CreateExhibitionResultSchema = z.object({
  exhibitionId: UuidSchema,
  entryCode: EntryCodeSchema,
  expiresAt: EpochMsSchema,
});

/** `PATCH /api/teacher/exhibitions/{id}` (`If-Match: {rev}`). 설정은 통째로 바꾼다. */
export const PatchExhibitionSchema = z
  .strictObject({
    title: textField('EXHIBITION_TITLE_MAX_CHARS', { min: 1 }),
    subtitle: optionalTextField('SUBTITLE_MAX_CHARS'),
    templateId: TemplateIdSchema,
    settings: ExhibitionSettingsSchema,
    schoolName: optionalTextField('SCHOOL_NAME_MAX_CHARS'),
    className: optionalTextField('CLASS_NAME_MAX_CHARS'),
    showSchool: z.boolean(),
  })
  .partial()
  .refine(atLeastOne, { message: 'empty_patch' });
export type PatchExhibition = z.infer<typeof PatchExhibitionSchema>;

/** `GET /api/teacher/me`: 링크만 가진 새 기기가 전시를 찾는 길 */
export const TeacherMeSchema = z.object({
  exhibitionId: UuidSchema,
  title: z.string(),
  sessionKind: SessionKindSchema,
});

/** `POST /api/teacher/pin` */
export const PinLoginSchema = z.strictObject({ pin: PinSchema, sessionTokenHash: TokenHashSchema });
export const PinLoginResultSchema = z.object({ exhibitionId: UuidSchema });

/** `POST …/{id}/link/rotate` */
export const LinkRotateSchema = z.strictObject({ linkTokenHash: TokenHashSchema });
