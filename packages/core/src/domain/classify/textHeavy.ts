import { config } from '../../config.ts';
import type { ArtworkForm, ArtworkKind } from '../../types/index.ts';

/**
 * "글이 많은 작품" 자동 추정(PRD 6.4, PLAN §5.5). 교사가 바꿀 수 있는 자동값이다.
 * 켜는 경우: PDF, 글 카드, 긴 세로, 파일 이름에 `TEXT_HEAVY_NAME_WORDS` 낱말, 서버 분석이 글 줄 간격을 찾음.
 * 소리는 화면에 글이 없으므로 이름에 낱말이 있어도 끈다.
 */

export interface TextHeavyInput {
  readonly kind: ArtworkKind;
  /** 자동 분류한 형태(`classifyForm`) */
  readonly form: ArtworkForm;
  /** 원래 파일 이름(확장자가 있어도 됨) */
  readonly fileName: string;
  /**
   * 서버 분석의 글 줄 간격(PLAN §5.4). 서버는 신뢰도가 `LINE_PITCH_MIN_CONFIDENCE` 이상일 때만 값을 주고
   * 못 찾으면 null이므로, 값이 있으면 "글 줄이 규칙적으로 보인다"는 뜻이다. 분석 전이면 null.
   */
  readonly linePitchPx: number | null;
}

/** 파일 이름에 글 많음 낱말이 들어 있는가(NFC·소문자로 맞춰 비교) */
export const nameSuggestsText = (fileName: string): boolean => {
  const name = fileName.normalize('NFC').toLowerCase();
  return config().TEXT_HEAVY_NAME_WORDS.some(word => {
    const w = word.normalize('NFC').toLowerCase();
    return w.length > 0 && name.includes(w);
  });
};

export const guessTextHeavy = ({ kind, form, fileName, linePitchPx }: TextHeavyInput): boolean => {
  if (kind === 'AUDIO' || form === 'SOUND') return false;
  if (kind === 'PDF' || kind === 'TEXT' || form === 'TEXTCARD' || form === 'TALL') return true;
  if (nameSuggestsText(fileName)) return true;
  return linePitchPx !== null;
};
