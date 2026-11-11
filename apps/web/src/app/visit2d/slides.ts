import { config } from '@gallery/core/config';
import type { Layout } from '@gallery/core/types';

/**
 * 2D 대체 화면(P4-10, ADR-019, PLAN §6.12)의 순수 판정: 넘기는 순서·이어 볼 자리·넘기기·밀기·액자 크기.
 * DOM 없이 시험한다.
 */

/** 작품 한 점(배치의 작품 정지 지점 하나) */
export interface ArtworkSlide {
  readonly kind: 'artwork';
  readonly stopId: string;
  readonly artworkId: string;
  readonly partId: string | null;
  /** 관 안 번호(1부터)·관 작품 수(위치 표시 "{room} · {index}/{count}") */
  readonly index: number | null;
  readonly count: number | null;
}

/** 맨 끝 출구(고마움 인사 · `처음부터 다시 보기` · `처음으로`) */
export interface ExitSlide {
  readonly kind: 'exit';
  readonly stopId: string;
}

export type Slide2D = ArtworkSlide | ExitSlide;

/** 배치에 출구 정지 지점이 없을 때 쓰는 이름(배치 엔진의 출구 ID와 같음) */
export const EXIT_STOP_ID = 'exit';

/**
 * 넘기는 순서: 배치의 정지 지점 순서 그대로, 작품 정지 지점만(외관·홀·전시실 소개는 건너뜀) + 맨 끝에 출구 하나.
 * `has`가 false인 작품(보기 묶음에 없는 것)은 뺀다.
 */
export const slidesOf = (layout: Layout, has: (artworkId: string) => boolean = () => true): Slide2D[] => {
  const out: Slide2D[] = [];
  let exit: ExitSlide | null = null;
  for (const s of layout.stops) {
    if (s.kind === 'artwork' && s.artworkId !== null && has(s.artworkId))
      out.push({
        kind: 'artwork',
        stopId: s.id,
        artworkId: s.artworkId,
        partId: s.partId,
        index: s.index,
        count: s.count,
      });
    else if (s.kind === 'exit') exit = { kind: 'exit', stopId: s.id };
  }
  out.push(exit ?? { kind: 'exit', stopId: EXIT_STOP_ID });
  return out;
};

/** 이어 볼 곳을 찾을 실마리(보던 정지 지점) */
export interface SlideTarget {
  readonly stopId: string;
  readonly artworkId?: string | null | undefined;
  readonly partId?: string | null | undefined;
}

/**
 * 이어 볼 자리: 같은 정지 지점 → 같은 작품 → 같은 관의 첫 작품 → 처음.
 * 3D에서 넘어올 때(보던 정지 지점)와 배치가 바뀔 때(바뀜 확인) 쓴다.
 */
export const resumeSlide = (slides: readonly Slide2D[], target: SlideTarget | null | undefined): number => {
  if (!target) return 0;
  const byStop = slides.findIndex(s => s.stopId === target.stopId);
  if (byStop >= 0) return byStop;
  const artworkId = target.artworkId ?? null;
  if (artworkId !== null) {
    const same = slides.findIndex(s => s.kind === 'artwork' && s.artworkId === artworkId);
    if (same >= 0) return same;
  }
  const partId = target.partId ?? null;
  if (partId !== null) {
    const part = slides.findIndex(s => s.kind === 'artwork' && s.partId === partId);
    if (part >= 0) return part;
  }
  return 0;
};

/** 지금 자리: 몇 번째 장 · 글 작품이면 몇 쪽 */
export interface Nav2D {
  readonly index: number;
  readonly page: number;
}

/**
 * 한 칸 넘기기(`‹ ›`·좌우 키·밀기 모두 같음). 글 작품에 쪽이 여럿이면 쪽부터 넘기고, 끝 쪽에서 다음 장으로(PLAN §6.8).
 * 처음·끝(출구)에서는 그대로. 다른 장으로 가면 첫 쪽부터.
 */
export const step2d = (count: number, nav: Nav2D, dir: 1 | -1, pages: number): Nav2D => {
  if (pages > 1) {
    const page = nav.page + dir;
    if (page >= 0 && page < pages) return { index: nav.index, page };
  }
  const index = Math.max(0, Math.min(count - 1, nav.index + dir));
  return index === nav.index ? nav : { index, page: 0 };
};

/**
 * 밀기 판정(PRD 8.2·PLAN §6.9 스와이프 기준 — 크게 보기 글 카드와 같은 값): 가로로 충분히·빠르게 밀면 넘김.
 * 왼쪽으로 밀면 다음(1), 오른쪽으로 밀면 이전(-1), 아니면 0.
 */
export const swipeDir = (dx: number, dy: number, ms: number): 1 | -1 | 0 => {
  const c = config();
  if (Math.abs(dx) < c.SWIPE_MIN_PX) return 0;
  if (Math.abs(dx) < Math.abs(dy) * c.SWIPE_AXIS_RATIO) return 0;
  if (ms > c.SWIPE_MAX_MS) return 0;
  return dx < 0 ? 1 : -1;
};

/** 화면에 그릴 액자 크기(px): 바깥 테 · 매트 · 그림 */
export interface FrameBox {
  readonly outerW: number;
  readonly outerH: number;
  readonly frame: number;
  readonly mat: number;
  readonly artW: number;
  readonly artH: number;
}

/**
 * 액자 맞추기: 3D 벽의 그림·매트·테 비율(m) 그대로 상자 안에 가장 크게. 상자 크기를 아직 모르면 null.
 * 그림은 내림(상자를 넘지 않게), 테는 1px 이상.
 */
export const fitFrame = (
  box: { readonly w: number; readonly h: number },
  art: { readonly w: number; readonly h: number },
  matM: number,
  frameM: number,
): FrameBox | null => {
  if (box.w <= 0 || box.h <= 0 || art.w <= 0 || art.h <= 0) return null;
  const m = Math.max(0, matM);
  const f = Math.max(0, frameM);
  const scale = Math.min(box.w / (art.w + 2 * (m + f)), box.h / (art.h + 2 * (m + f)));
  const frame = Math.max(1, Math.round(f * scale));
  const mat = Math.round(m * scale);
  // 반올림한 테·매트를 뺀 자리에 그림 비율 그대로
  const edge = 2 * (frame + mat);
  const fit = Math.min((box.w - edge) / art.w, (box.h - edge) / art.h);
  if (fit <= 0) return null;
  const artW = Math.max(1, Math.floor(art.w * fit));
  const artH = Math.max(1, Math.floor(art.h * fit));
  return { outerW: artW + edge, outerH: artH + edge, frame, mat, artW, artH };
};

/**
 * 글 카드 크기(px): 자리 안에서 벽 카드 비율(가로/세로) 그대로 가장 크게, 폭은 한 줄 길이까지(그러면 높이도 줄임).
 * 자리를 모르면 null(CSS가 자리를 채움).
 */
export const cardSize = (
  box: { readonly w: number; readonly h: number },
  aspect: number,
  lineW: number,
): { w: number; h: number } | null => {
  if (box.w <= 0 || box.h <= 0 || !(aspect > 0)) return null;
  const w = Math.floor(Math.min(box.w, box.h * aspect, lineW));
  const h = Math.floor(Math.min(box.h, w / aspect));
  return { w, h };
};
