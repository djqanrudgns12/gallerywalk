import { config } from '../../config.ts';
import type { ArtworkForm } from '../../types/common.ts';
import { formFromAspect } from '../classify/form.ts';

/**
 * 벽에 거는 크기(PLAN §4.2, PRD 6.4·6.5): 형태별 기준 크기 → 대표작 1.3배 → 매트(긴 변 6%, 최소·최대, 대표작 ×1.4) → 테
 * → 바깥 높이 상한(`FRAME_MAX_OUTER_H_M`, ADR-057).
 * 긴 세로·파노라마는 벽에서 **창 부분만** 보인다(창 비율 `TALL_WINDOW_RATIO`·`PANORAMA_WINDOW_RATIO`, 서버 파생과 같음).
 */

export interface SizeInput {
  readonly form: ArtworkForm;
  /** 바로 세운 원본 화소(여러 쪽은 첫 쪽, 글·소리는 0×0) */
  readonly pixel: { readonly w: number; readonly h: number };
}

export interface FrameSize {
  readonly art: { readonly w: number; readonly h: number };
  readonly mat: number;
  readonly outer: { readonly w: number; readonly h: number };
}

type PlainForm = Exclude<ArtworkForm, 'MULTIPAGE'>;

const ratioOf = (pixel: SizeInput['pixel']): number | null =>
  pixel.w > 0 && pixel.h > 0 ? pixel.w / pixel.h : null;

/** 대표작 배율을 곱하기 전의 그림 크기(m) */
const baseArt = (form: PlainForm, r: number | null): { w: number; h: number } => {
  const c = config();
  const base = c.FORM_BASE_M;
  switch (form) {
    case 'PANORAMA':
      return { w: base.PANORAMA.w, h: base.PANORAMA.w / c.PANORAMA_WINDOW_RATIO };
    case 'LANDSCAPE':
      return { w: base.LANDSCAPE.w, h: base.LANDSCAPE.w / (r ?? c.FORM_LANDSCAPE_MIN_R) };
    case 'SQUARE': {
      const rr = r ?? 1;
      return rr >= 1
        ? { w: base.SQUARE.w, h: base.SQUARE.w / rr }
        : { w: base.SQUARE.h * rr, h: base.SQUARE.h };
    }
    case 'PORTRAIT':
      return { w: base.PORTRAIT.h * (r ?? c.FORM_PORTRAIT_MIN_R), h: base.PORTRAIT.h };
    case 'TALL':
      return { w: base.TALL.h * c.TALL_WINDOW_RATIO, h: base.TALL.h };
    case 'TEXTCARD':
      return { w: base.TEXTCARD.h * c.TEXTCARD_ASPECT, h: base.TEXTCARD.h };
    case 'SOUND':
      return { w: base.SOUND.w, h: base.SOUND.h };
  }
};

export const frameSize = (input: SizeInput, featured: boolean, frameBorderM: number): FrameSize => {
  const c = config();
  const r = ratioOf(input.pixel);
  // 여러 쪽은 첫 쪽 형태를 따른다(PLAN §5.5). 쪽 크기를 모르면 A4 세로.
  const form: PlainForm = input.form === 'MULTIPAGE' ? formFromAspect(r ?? c.TEXTCARD_ASPECT, 1) : input.form;
  const scale = featured ? c.FEATURED_SCALE : 1;
  const b = baseArt(form, input.form === 'MULTIPAGE' ? (r ?? c.TEXTCARD_ASPECT) : r);
  const art = { w: b.w * scale, h: b.h * scale };
  if (form === 'SOUND') return { art, mat: 0, outer: art };
  const matBase = Math.min(c.MAT_MAX_M, Math.max(c.MAT_MIN_M, Math.max(art.w, art.h) * c.MAT_RATIO));
  const mat = matBase * (featured ? c.MAT_FEATURED_SCALE : 1);
  return fitWithin(art, mat, frameBorderM, Number.POSITIVE_INFINITY, c.FRAME_MAX_OUTER_H_M);
};

/** 바깥 크기가 상한 안에 들도록 그림을 비율 그대로 줄인다(매트·테 폭은 그대로) */
const fitWithin = (
  art: { w: number; h: number },
  mat: number,
  border: number,
  maxW: number,
  maxH: number,
): FrameSize => {
  const pad = 2 * (mat + border);
  const k = Math.min(1, (maxW - pad) / art.w, (maxH - pad) / art.h);
  const a = { w: art.w * k, h: art.h * k };
  return { art: a, mat, outer: { w: a.w + pad, h: a.h + pad } };
};

/** 이젤 위 크기: 벽 크기를 이젤 상한(`EASEL_MAX_OUTER_M`) 안으로 줄인다(ADR-057) */
export const easelSize = (size: FrameSize, frameBorderM: number): FrameSize => {
  const max = config().EASEL_MAX_OUTER_M;
  return fitWithin(size.art, size.mat, frameBorderM, max.w, max.h);
};

/** 이젤에 놓을 수 있는 형태(소리·파노라마·긴 세로 제외) */
export const easelForm = (form: ArtworkForm): boolean =>
  form !== 'SOUND' && form !== 'PANORAMA' && form !== 'TALL';
