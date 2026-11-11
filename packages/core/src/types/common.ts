import { z } from 'zod';
import { config } from '../config.ts';
import { TEMPLATE_IDS } from '../domain/templates/look.ts';
import { errorCatalog, type ErrorCode } from '../errors.ts';

/**
 * 공통 값과 열거형(PLAN §10.2와 같은 이름·대문자 상태값). DB는 snake_case, API·화면은 camelCase.
 */

/** 기기가 만든 UUID(전시·전시실·작품·쪽·반응 — 멱등 키, PLAN §9.2) */
export const UuidSchema = z.uuid();

/** 기기가 만든 256비트 토큰의 SHA-256(소문자 16진 64자). 서버는 토큰 원문을 받지 않는다(ADR-025). */
export const TokenHashSchema = z.string().regex(/^[0-9a-f]{64}$/, { message: 'token_hash' });

/** UTC 밀리초 */
export const EpochMsSchema = z.number().int().nonnegative();

/** 입장 코드: 숫자 `ENTRY_CODE_DIGITS`자리(ADR-023) */
export const EntryCodeSchema = z
  .string()
  .refine(s => s.length === config().ENTRY_CODE_DIGITS && /^\d+$/.test(s), { message: 'entry_code' });

/** 선생님 PIN: 숫자 `PIN_MIN_LENGTH`~`PIN_MAX_LENGTH`자리(ADR-024). 쉬운 PIN 거절은 서버 보안 모듈(§11.2). */
export const PinSchema = z
  .string()
  .refine(
    s => /^\d+$/.test(s) && s.length >= config().PIN_MIN_LENGTH && s.length <= config().PIN_MAX_LENGTH,
    {
      message: 'pin_format',
    },
  );

export const TemplateIdSchema = z.enum(TEMPLATE_IDS);

export const ExhibitionStatusSchema = z.enum(['DRAFT', 'OPEN', 'CLOSED']);
export type ExhibitionStatus = z.infer<typeof ExhibitionStatusSchema>;

export const ArtworkStatusSchema = z.enum(['PROCESSING', 'HIDDEN', 'PUBLISHED', 'FAILED']);
export type ArtworkStatus = z.infer<typeof ArtworkStatusSchema>;

/** 작품 종류. `VIDEO`는 예약(G-23) — 판정기·서버가 받지 않는다. */
export const ArtworkKindSchema = z.enum(['IMAGE', 'PDF', 'TEXT', 'AUDIO', 'VIDEO']);
export type ArtworkKind = z.infer<typeof ArtworkKindSchema>;

/** 작품 형태(PRD 6.4) */
export const ArtworkFormSchema = z.enum([
  'PANORAMA',
  'LANDSCAPE',
  'SQUARE',
  'PORTRAIT',
  'TALL',
  'MULTIPAGE',
  'TEXTCARD',
  'SOUND',
]);
export type ArtworkForm = z.infer<typeof ArtworkFormSchema>;

export const PageModeSchema = z.enum(['AUTO', 'SINGLE']);
export type PageMode = z.infer<typeof PageModeSchema>;

export const AssetKindSchema = z.enum(['IMAGE', 'PAGE', 'AUDIO', 'POSTER', 'COVER']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

/** 스티커 4종(G-07): 감동했어요 · 새로 알았어요 · 멋져요 · 궁금해요 */
export const StickerSchema = z.enum(['MOVED', 'LEARNED', 'GREAT', 'CURIOUS']);
export type Sticker = z.infer<typeof StickerSchema>;

/** 교사 세션: 선생님 링크(LINK) · PIN으로 들어옴(PIN) */
export const SessionKindSchema = z.enum(['LINK', 'PIN']);
export type SessionKind = z.infer<typeof SessionKindSchema>;

export const QualityTierSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type QualityTier = z.infer<typeof QualityTierSchema>;

export const ErrorCodeSchema = z.enum(Object.keys(errorCatalog) as [ErrorCode, ...ErrorCode[]]);

/** 처리 결과 경고(카드에 한 줄, PRD 6.9). 실패는 `failCode`(오류 코드)로 따로 둔다. */
export const ArtworkWarningSchema = z.enum([
  /** 짧은 변이 `WARN_SHORT_SIDE_PX`보다 작아 흐리게 보일 수 있음 */
  'LOW_RES',
  /** 소리가 거의 없음(들리는 구간이 아주 짧음) */
  'MOSTLY_SILENT',
]);
export type ArtworkWarning = z.infer<typeof ArtworkWarningSchema>;
