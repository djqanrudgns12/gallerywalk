import { config } from '../../config.ts';
import type { ArtworkForm, PageMode, Viewport } from '../../types/index.ts';

/**
 * 그림·PDF 쪽의 쪽 나눔 계획기(PRD 6.7, PLAN §5.6, ADR-007·047). 학생 기기가 보는 순간 계산한다.
 *
 * 기준은 "원본 대비 배율"이 아니라 **화면에서 글자가 읽히는가**다. 원본 해상도로 판단하면
 * 같은 A4라도 고해상도로 올린 쪽이 더 잘게 쪼개진다(PRD_REVIEW C3).
 */

export interface ImagePageInput {
  readonly form: ArtworkForm;
  readonly textHeavy: boolean;
  readonly pageMode: PageMode;
  /** 내용 크기(px). 저장된 줌·띠 이미지 좌표계 */
  readonly content: { readonly w: number; readonly h: number };
  readonly linePitchPx: number | null;
  readonly lineProfile: Uint8Array | null;
  readonly profileBinPx: number;
}

export interface PageRange {
  /** 긴 축 방향 시작·끝(내용 px, 정수) */
  readonly start: number;
  readonly end: number;
}

export interface ImagePagePlan {
  /** `contain` = 한 장을 화면에 다 넣음, `split` = 긴 축으로 나눔 */
  readonly fit: 'contain' | 'split';
  readonly axis: 'x' | 'y';
  /** 화면 CSS px ÷ 내용 px */
  readonly scale: number;
  readonly pages: readonly PageRange[];
  /** 고른 배율에서 글자가 읽히는가(못 미치면 손가락 확대가 마지막 수단) */
  readonly readable: boolean;
  /** "가로로 돌리면 더 크게 보여요"를 보일지(글 많은 문서만, ADR-047) */
  readonly rotateHint: boolean;
}

/** 나눔 대상: 긴 세로·파노라마(항상), 글 많은 작품·PDF 쪽(읽히지 않을 때만). 그 밖은 나누지 않는다(PRD 6.7-3). */
const alwaysSplit = (form: ArtworkForm): boolean => form === 'TALL' || form === 'PANORAMA';

const isSplitCandidate = (input: ImagePageInput): boolean =>
  alwaysSplit(input.form) || input.textHeavy || input.form === 'MULTIPAGE';

/** 이 배율 이상이면 읽힌다. 줄 간격을 알면 화면 줄 간격으로, 모르면 기준 폭으로 판단한다. */
export const minReadableScale = (input: ImagePageInput): number => {
  const c = config();
  if (input.linePitchPx !== null && input.linePitchPx > 0)
    return c.READ_LINE_PITCH_MIN_PX / input.linePitchPx;
  const short = Math.min(input.content.w, input.content.h);
  const ref = alwaysSplit(input.form) ? c.READ_REF_WIDTH_TALL : c.READ_REF_WIDTH_DOC;
  return (c.READ_SCALE_MIN * Math.min(short, ref)) / short;
};

const containScale = (content: ImagePageInput['content'], vp: Viewport): number =>
  Math.min(vp.w / content.w, vp.h / content.h);

/** 긴 축을 따라 나눌 때 짧은 축을 화면에 맞춘 배율 */
const shortAxisScale = (content: ImagePageInput['content'], vp: Viewport, axis: 'x' | 'y'): number =>
  axis === 'y' ? vp.w / content.w : vp.h / content.h;

export const planImagePages = (input: ImagePageInput, vp: Viewport): ImagePagePlan => {
  const { w, h } = input.content;
  const axis: 'x' | 'y' = h >= w ? 'y' : 'x';
  const longLen = axis === 'y' ? h : w;
  const contain = containScale(input.content, vp);
  const need = minReadableScale(input);
  const single = (scale: number, rotateHint: boolean): ImagePagePlan => ({
    fit: 'contain',
    axis,
    scale,
    pages: [{ start: 0, end: longLen }],
    readable: scale >= need,
    rotateHint,
  });

  if (input.pageMode === 'SINGLE' || !isSplitCandidate(input)) return single(contain, false);

  const forced = alwaysSplit(input.form);
  if (!forced && contain >= need) return single(contain, false);

  const shortFit = shortAxisScale(input.content, vp, axis);
  // 읽히는 가장 작은 배율로 그려 한 쪽에 가장 많이 담는다. 화면이 좁아 거기까지 못 가면 짧은 축 맞춤이 최선.
  const scale = Math.min(shortFit, Math.max(need, contain));

  if (!forced && scale <= contain * config().PAGE_SPLIT_MIN_GAIN) {
    // 나눠도 글자가 커지지 않는다(휴대폰 세로의 A4, PRD_REVIEW C4). 확대와 회전 안내로 푼다(ADR-047).
    return single(contain, rotationHelps(input, vp, axis, scale));
  }

  const viewportLong = axis === 'y' ? vp.h : vp.w;
  const pages = splitAlongAxis(longLen, viewportLong / scale, input);
  return {
    fit: pages.length === 1 ? 'contain' : 'split',
    axis,
    scale,
    pages,
    readable: scale >= need,
    rotateHint: !forced && scale < need && rotationHelps(input, vp, axis, scale),
  };
};

/** 화면을 돌렸을 때 짧은 축 맞춤 배율이 20% 넘게 커지는 글 문서만. 웹툰은 세로로 보게 만든 것이라 권하지 않는다. */
const rotationHelps = (input: ImagePageInput, vp: Viewport, axis: 'x' | 'y', current: number): boolean => {
  if (alwaysSplit(input.form)) return false;
  const rotated: Viewport = { w: vp.h, h: vp.w };
  return shortAxisScale(input.content, rotated, axis) > current * config().ROTATE_HINT_MIN_GAIN;
};

/**
 * 긴 축을 화면 길이 V(내용 px)씩 나눈다. 이웃 쪽은 O = ⌈겹침 × V⌉만큼 겹친다.
 * 자를 자리는 ±`CUT_SEARCH_RATIO`·V 안에서 가장 비어 있는 줄로 옮긴다(웹툰 컷 사이·문단 사이).
 * 덮기 불변식: 첫 쪽 start = 0, 마지막 쪽 end = L, 이웃 겹침 = O, 쪽 길이 ≤ V.
 */
export const splitAlongAxis = (longLen: number, viewLen: number, input: ImagePageInput): PageRange[] => {
  const c = config();
  const V = Math.max(1, Math.floor(viewLen));
  if (longLen <= V) return [{ start: 0, end: longLen }];
  const O = Math.ceil(c.PAGE_OVERLAP * V);
  const pages: PageRange[] = [];
  let start = 0;
  // 진행량은 쪽마다 최소 (CUT_MIN_PAGE_RATIO − PAGE_OVERLAP)·V라 반드시 끝난다.
  while (longLen - start > V) {
    const nominal = start + V;
    const end = refineCut(nominal, start, V, input);
    pages.push({ start, end });
    start = end - O;
  }
  pages.push({ start, end: longLen });
  return pages;
};

const refineCut = (nominal: number, start: number, V: number, input: ImagePageInput): number => {
  const c = config();
  const profile = input.lineProfile;
  const bin = input.profileBinPx;
  if (profile === null || profile.length === 0 || bin <= 0) return nominal;
  const radius = c.CUT_SEARCH_RATIO * V;
  const lo = Math.max(0, Math.floor((nominal - radius) / bin));
  const hi = Math.min(profile.length - 1, Math.ceil((nominal + radius) / bin));
  let best = nominal;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = lo; i <= hi; i++) {
    const center = Math.round((i + 0.5) * bin);
    const length = center - start;
    if (length < c.CUT_MIN_PAGE_RATIO * V || length > V) continue;
    const score = profile[i] ?? 255;
    const dist = Math.abs(center - nominal);
    if (score < bestScore || (score === bestScore && dist < bestDist)) {
      best = center;
      bestScore = score;
      bestDist = dist;
    }
  }
  return best;
};

/** 페이지 범위 덮기 불변식 검사(시험·개발 확인용). */
export const coversExactly = (
  pages: readonly PageRange[],
  longLen: number,
  overlap: number,
  viewLen: number,
): boolean => {
  if (pages.length === 0) return false;
  if (pages[0]?.start !== 0 || pages[pages.length - 1]?.end !== longLen) return false;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    if (p.end - p.start > Math.floor(viewLen) || p.end <= p.start) return false;
    if (i > 0 && pages[i - 1]!.end - p.start < overlap) return false;
  }
  return true;
};
