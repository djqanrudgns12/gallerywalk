import { config } from '../../config.ts';
import { charCount, normalizeLine } from '../text/normalize.ts';
import { isBlocked } from './profanity.ts';

export type PreparedNickname =
  { readonly display: string; readonly norm: string } | { readonly error: 'empty' | 'too_long' | 'blocked' };

/**
 * 표시용은 바깥 입력과 같은 한 줄 정규화(`domain/text/normalize.ts`), 비교용 `norm`은 NFKC·소문자·공백 제거.
 * 같은 전시의 중복 여부는 서버가 norm으로 판단한다.
 */
export const prepareNickname = (raw: string): PreparedNickname => {
  const display = normalizeLine(raw);
  if (display === '') return { error: 'empty' };
  if (charCount(display) > config().NICKNAME_MAX_CHARS) return { error: 'too_long' };
  if (isBlocked(display)) return { error: 'blocked' };
  return { display, norm: display.normalize('NFKC').toLowerCase().replace(/\s+/gu, '') };
};
