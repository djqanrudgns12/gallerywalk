import { config } from '../../config.ts';
import type { ArtworkForm, ArtworkKind } from '../../types/index.ts';

/**
 * 작품 형태 분류(PRD 6.4 표, PLAN §5.5). r = 가로 ÷ 세로, 경계는 `FORM_*_MIN_R` 설정 키.
 *
 * PRD 6.4 표의 경계(같을 때 어느 쪽인지):
 * | 형태   | 표의 기준          | r이 경계와 정확히 같으면                    |
 * |--------|--------------------|---------------------------------------------|
 * | 파노라마 | r > 2.2          | r = 2.2는 파노라마가 아님 → 가로             |
 * | 가로   | 1.2 < r ≤ 2.2      | r = 1.2는 가로가 아님 → 정사각               |
 * | 정사각 | 0.83 ≤ r ≤ 1.2     | 0.83·1.2 모두 정사각                         |
 * | 세로   | 0.45 ≤ r < 0.83    | r = 0.45는 세로(긴 세로 아님)                |
 * | 긴 세로 | r < 0.45          |                                             |
 *
 * 즉 위의 두 경계(파노라마·가로)는 "초과"여야 넘어가고, 아래 두 경계(정사각·세로)는 "이상"이면 그 형태다.
 * r은 `w / h` 나눗셈 한 번으로 구한다(곱셈으로 바꾸면 `2.2 * h` 같은 값에 반올림 오차가 생겨 경계가 흔들린다).
 */

/** 비율로만 정해지는 형태 */
export type AspectForm = Extract<ArtworkForm, 'PANORAMA' | 'LANDSCAPE' | 'SQUARE' | 'PORTRAIT' | 'TALL'>;

export interface FormInput {
  readonly kind: ArtworkKind;
  /** 그림 가로·세로(px, 회전 반영). PDF는 첫 쪽. 글·소리는 쓰지 않는다. 그림·PDF는 0보다 커야 한다(사전 검사가 막음) */
  readonly w: number;
  readonly h: number;
  /** 쪽 수. 그림은 1 */
  readonly pageCount: number;
}

/** 그림 비율만으로 고르는 형태. PDF(여러 쪽)가 "따르는" 첫 쪽 형태도 이것으로 구한다. */
export const formFromAspect = (w: number, h: number): AspectForm => {
  const c = config();
  const r = w / h;
  if (r > c.FORM_PANORAMA_MIN_R) return 'PANORAMA';
  if (r > c.FORM_LANDSCAPE_MIN_R) return 'LANDSCAPE';
  if (r >= c.FORM_SQUARE_MIN_R) return 'SQUARE';
  if (r >= c.FORM_PORTRAIT_MIN_R) return 'PORTRAIT';
  return 'TALL';
};

/**
 * 작품 형태. 글 → `TEXTCARD`, 소리 → `SOUND`, PDF·여러 쪽 → `MULTIPAGE`(첫 쪽 형태는 `formFromAspect`로 따로
 * 구해 벽 크기·쪽 수 표시에 쓴다), 그림 → 비율.
 * `VIDEO`는 예약(G-23)이라 판정기가 받지 않지만, 함수가 모든 종류에 답하도록 그림과 같이 비율로 나눈다.
 */
export const classifyForm = ({ kind, w, h, pageCount }: FormInput): ArtworkForm => {
  switch (kind) {
    case 'TEXT':
      return 'TEXTCARD';
    case 'AUDIO':
      return 'SOUND';
    case 'PDF':
      return 'MULTIPAGE';
    case 'IMAGE':
    case 'VIDEO':
      return pageCount > 1 ? 'MULTIPAGE' : formFromAspect(w, h);
  }
};
