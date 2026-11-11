/**
 * 글 정규화(순수 함수, zod 없음). 바깥 입력 스키마(`types/text.ts`)와 도메인(별명·제목 정리)이 같은 규칙을 쓴다.
 */

/** 글자 수 = 코드 포인트 수(한글 한 글자 = 1, 이모지 대부분 = 1~2). */
export const charCount = (s: string): number => Array.from(s).length;

/** 한 줄 글: NFC, 줄바꿈·탭을 공백으로, 겹친 공백을 하나로, 앞뒤 공백 제거. */
export const normalizeLine = (s: string): string =>
  s
    .normalize('NFC')
    .replace(/[\r\n\t\v\f]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();

/** 여러 줄 글: NFC, CRLF·CR → LF, 줄 끝 공백 제거, 앞뒤 빈 줄 제거(가운데 빈 줄은 문단이라 둔다). */
export const normalizeText = (s: string): string =>
  s
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+|\n+$/g, '');
