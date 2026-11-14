import { config } from '@gallery/core/config';
import { EntryCodeSchema } from '@gallery/core/types';

/**
 * 경로 판정(PLAN §7.1). `/{6자리}`만 학생 전시이고, 그 밖의 주소는 `/`로 보낸다.
 * 입장 코드는 ASCII 숫자 `ENTRY_CODE_DIGITS`자리(core `EntryCodeSchema`와 같은 규칙).
 */

/** 경로 조각이 입장 코드면 그 코드, 아니면 null */
export const entryCodeOf = (segment: string | undefined): string | null =>
  segment !== undefined && EntryCodeSchema.safeParse(segment).success ? segment : null;

/** 입력 글에서 ASCII 숫자만 남기고 `max`자리까지 자른다(붙여넣기·숫자 아닌 글자) */
export const digitsOnly = (raw: string, max: number = config().ENTRY_CODE_DIGITS): string =>
  raw.replace(/[^0-9]/g, '').slice(0, max);

export const PATHS = {
  home: '/',
  teacher: '/t',
  /** 학교망 점검(G-24 HW-00) — 입장 코드 6자리와 겹치지 않는다 */
  check: '/check',
  exhibition: (code: string) => `/${code}`,
} as const;
