import { config } from '../../config.ts';
import { charCount } from '../text/normalize.ts';

/**
 * 파일·폴더 이름에서 제목·이름판·정렬 번호를 만든다(PLAN §5.2, PRD G-10, PRD_REVIEW B3·B4).
 *
 * 규칙(파일): 확장자 제거 → 앞번호(`^\d+(?:[\s._-]+(?!\d)|$)`) 제거 → `_`·`-`를 띄어쓰기로 → 연속 공백 하나 →
 * 앞뒤 공백 제거 → `ARTWORK_TITLE_MAX_CHARS`(코드 포인트)로 자르기.
 * 결과가 비면 **빈 문자열**을 돌려준다. "제목 없는 작품" 같은 화면 문구는 `copy/ko.ts`에서 화면이 고른다.
 *
 * - 앞번호는 숫자 뒤에 구분자가 하나 이상 있고 그 뒤가 숫자가 아닐 때만 지운다(또는 이름 전체가 숫자).
 *   `3학년`·`5월`·`2반`처럼 숫자에 붙은 말, `3.1운동`·`2.5D`·`12-3`처럼 숫자가 이어지는 말은 지우지 않는다.
 * - 띄어쓰기는 `_`·`-`에서만 생긴다. "1905_을사늑약과의병"의 "을사늑약과 의병"처럼 단어 경계가 없는 곳의
 *   띄어쓰기는 규칙으로 만들 수 없다(B4) — 교사가 칩에서 고친다.
 * - 입력은 NFC로 맞춘다. macOS에서 온 파일 이름은 한글이 풀어 쓴 꼴(NFD)일 수 있다.
 */

/** 앞번호: 이름 맨 앞의 숫자 + 구분자(공백·`.`·`_`·`-`) 하나 이상(뒤가 숫자가 아님), 또는 숫자뿐인 이름 */
const LEADING_NUMBER = /^(\d+)(?:[\s._-]+(?!\d)|$)/;
/** 정렬 키: 맨 앞 숫자(이름판에서 지우는지와 상관없이 — 자연 정렬이 실제로 보는 값) */
const LEADING_DIGITS = /^\d+/;
/**
 * 폴더 이름판에서 남기는 앞번호: 연도처럼 보이는 네 자리(0으로 시작하지 않음).
 * `0001_…`처럼 0을 채운 번호는 순서 번호로 본다.
 */
const YEAR_LIKE = /^[1-9]\d{3}$/;
/**
 * 확장자: 마지막 `.` 뒤의 영문·숫자(영문 한 글자 이상). `3.1운동`·`비율 1.5`처럼 마지막 `.` 뒤가
 * 한글이거나 숫자뿐이면 확장자가 아니다.
 */
const EXTENSION = /\.([A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*)$/;

/** 확장자(소문자, `.` 없이). 없거나 이름 전체가 `.…`(숨김 파일)이면 null. */
export const extensionOf = (fileName: string): string | null => {
  const m = EXTENSION.exec(fileName);
  if (m === null || m.index === 0) return null;
  return m[1]!.toLowerCase();
};

/** 확장자를 뗀 이름. 확장자가 없으면 그대로. */
export const stripExtension = (fileName: string): string => {
  const m = EXTENSION.exec(fileName);
  if (m === null || m.index === 0) return fileName;
  return fileName.slice(0, m.index);
};

/** 정렬 키로 쓰는 맨 앞 숫자(`03_하늘고래` → 3, `3학년` → 3). 숫자로 시작하지 않으면 null. */
export const leadingNumber = (name: string): number | null => {
  const m = LEADING_DIGITS.exec(name);
  return m === null ? null : Number(m[0]);
};

/** `_`·`-` → 띄어쓰기, 연속 공백 하나, 앞뒤 공백 제거 */
const tidy = (s: string): string => s.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();

/** 코드 포인트 `max`개까지만 남기고 끝 공백을 지운다(글자 수 셈은 `domain/text/normalize.ts`의 `charCount`). */
const clip = (s: string, max: number): string =>
  charCount(s) <= max ? s : Array.from(s).slice(0, max).join('').trimEnd();

/** 파일 이름 → 작품 제목. 비면 ''. 경로가 아니라 파일 이름(마지막 조각)을 받는다. */
export const titleFromName = (fileName: string): string =>
  clip(
    tidy(stripExtension(fileName.normalize('NFC')).replace(LEADING_NUMBER, '')),
    config().ARTWORK_TITLE_MAX_CHARS,
  );

/**
 * 폴더 이름 → 전시실 이름판(`ROOM_TITLE_MAX_CHARS`로 자름). 비면 ''.
 * 파일과 같되 확장자를 떼지 않고(`1919_3.1운동`의 `.1운동`은 확장자가 아님), 앞번호가 연도처럼 네 자리이고
 * 뒤에 글자가 이어지면 남긴다(`1905_을사늑약과의병` → "1905 을사늑약과의병"). 정렬은 `leadingNumber`로.
 */
export const roomTitleFromFolder = (folderName: string): string => {
  const name = folderName.normalize('NFC');
  const m = LEADING_NUMBER.exec(name);
  const rest = m === null ? '' : tidy(name.slice(m[0].length));
  const keepNumber = m === null || (rest.length > 0 && YEAR_LIKE.test(m[1]!));
  return clip(keepNumber ? tidy(name) : rest, config().ROOM_TITLE_MAX_CHARS);
};
