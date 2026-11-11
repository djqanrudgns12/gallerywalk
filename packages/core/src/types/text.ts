import { z } from 'zod';
import { config, type Config } from '../config.ts';

/**
 * 글 칸 공통 규칙(PLAN §10.1: 길이 한도는 SQL이 아니라 zod + `config.ts`).
 * - 한도는 스키마를 만들 때가 아니라 **검사할 때** `config()`에서 읽는다(설정을 바꿔도 스키마를 다시 만들 필요 없음).
 * - 실패 메시지는 화면 문구가 아니라 짧은 코드다(`too_long` 등). 화면 문구는 `copy/ko.ts`에서만 만든다.
 */

export { charCount, normalizeLine, normalizeText } from '../domain/text/normalize.ts';
import { charCount, normalizeLine, normalizeText } from '../domain/text/normalize.ts';

type NumberKey = { [K in keyof Config]: Config[K] extends number ? K : never }[keyof Config];

export interface TextFieldOptions {
  /** 여러 줄 허용(글 작품 본문·긴 설명·소개 글) */
  readonly multiline?: boolean;
  /** 정규화 뒤 최소 글자 수(필수 칸은 1) */
  readonly min?: number;
}

/** 필수 글 칸: 정규화 → 길이 검사. */
export const textField = (maxKey: NumberKey, { multiline = false, min = 0 }: TextFieldOptions = {}) =>
  z
    .string()
    .transform(multiline ? normalizeText : normalizeLine)
    .refine(v => charCount(v) >= min, { message: min === 1 ? 'required' : 'too_short' })
    .refine(v => charCount(v) <= config()[maxKey], { message: 'too_long' });

/** 비울 수 있는 글 칸: `null` 또는 정규화 뒤 빈 글이면 `null`. */
export const optionalTextField = (maxKey: NumberKey, { multiline = false }: TextFieldOptions = {}) =>
  z
    .string()
    .nullable()
    .transform(v => {
      if (v === null) return null;
      const out = (multiline ? normalizeText : normalizeLine)(v);
      return out.length > 0 ? out : null;
    })
    .refine(v => v === null || charCount(v) <= config()[maxKey], { message: 'too_long' });
