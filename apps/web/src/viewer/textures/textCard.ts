import { config } from '@gallery/core/config';
import type { TemplateLook } from '@gallery/core/templates';
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

/**
 * 글 카드·소리 명판(PRD 6.8, PLAN §5.7): 그림 파일이 없는 작품을 기기가 캔버스로 종이 카드에 조판해 벽에 건다.
 * 저장하지 않는다(ADR-038). 크게 보기 HTML 층은 같은 글을 HTML 글자로 보인다(P4-4).
 * 줄바꿈·줄 자르기는 순수 함수(재는 함수 주입) — 캔버스 그리기와 나눠 시험한다.
 */

export interface CardText {
  readonly kind: 'TEXT' | 'AUDIO';
  readonly title: string;
  readonly author: string;
  /** 글 작품 본문(소리 명판은 빈 글) */
  readonly body: string;
}

export type Measure = (text: string) => number;

const ELLIPSIS = '…';
/** 본문 글자 크기 후보(카드 짧은 변 대비, 큰 것부터)와 줄 간격 */
const BODY_SIZES = [0.072, 0.064, 0.057, 0.051, 0.046, 0.042] as const;
const BODY_LEAD = 1.62;

/** 한 낱말이 줄보다 길면 글자 단위로 자른다 */
const splitLong = (word: string, maxWidth: number, measure: Measure): string[] => {
  const out: string[] = [];
  let cur = '';
  for (const ch of word) {
    if (cur && measure(cur + ch) > maxWidth) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};

/**
 * 줄바꿈: 줄바꿈 문자는 그대로(빈 줄 = 문단 사이), 띄어쓰기 단위로 채우고, 줄보다 긴 낱말은 글자 단위로.
 * 한국어는 어절 사이에서 끊는 편이 읽기 쉽다(글자 단위로 끊지 않음).
 */
export const wrapText = (text: string, maxWidth: number, measure: Measure): string[] => {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(w => w !== '');
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word) <= maxWidth) line = word;
      else {
        const parts = splitLong(word, maxWidth, measure);
        lines.push(...parts.slice(0, -1));
        line = parts[parts.length - 1] ?? '';
      }
    }
    if (line) lines.push(line);
  }
  return lines;
};

/** 줄을 `maxLines`까지. 넘치면 마지막 줄 끝을 말줄임표로(폭 안에 들게 글자를 덜어냄) */
export const clampLines = (
  lines: readonly string[],
  maxLines: number,
  maxWidth: number,
  measure: Measure,
): string[] => {
  if (lines.length <= maxLines) return [...lines];
  if (maxLines <= 0) return [];
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? '';
  while (last && measure(last + ELLIPSIS) > maxWidth) last = [...last].slice(0, -1).join('');
  kept[maxLines - 1] = last.trimEnd() + ELLIPSIS;
  return kept;
};

/** 앞뒤 빈 줄을 걷어 카드에 쓸 줄만(문단 사이 빈 줄은 하나로) */
export const tidyLines = (lines: readonly string[]): string[] => {
  const out: string[] = [];
  for (const l of lines) if (l !== '' || (out.length > 0 && out[out.length - 1] !== '')) out.push(l);
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
};

const cssVar = (name: string, fallback: string): string => {
  const v =
    typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name);
  return v.trim() || fallback;
};

/** 캔버스 크기: 긴 변 `TEXT_CARD_PX`, 비율은 배치의 그림 면(art) 그대로 */
export const cardCanvasSize = (aspect: number): { w: number; h: number } => {
  const long = config().TEXT_CARD_PX;
  return aspect >= 1
    ? { w: long, h: Math.max(1, Math.round(long / aspect)) }
    : { w: Math.max(1, Math.round(long * aspect)), h: long };
};

/** 종이 카드 한 장을 그린다(제목 · 선 · 본문 앞부분 · 작가). 소리 명판은 제목·작가·소리 표시 */
export const drawCard = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  text: CardText,
  colors: TemplateLook['card'],
): void => {
  const serif = cssVar('--font-display', 'serif');
  const short = Math.min(w, h);
  const pad = Math.round(short * 0.09);
  // 종이: 바탕 + 가장자리가 조금 짙은 결(빛 바랜 종이)
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, w, h);
  const edge = ctx.createRadialGradient(w / 2, h / 2, short * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(60,40,10,0.10)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = colors.rule;
  ctx.lineWidth = Math.max(2, Math.round(short * 0.006));
  const inset = Math.round(short * 0.035);
  ctx.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset);

  const innerW = w - 2 * pad;
  ctx.textBaseline = 'top';
  ctx.fillStyle = colors.ink;
  const titlePx = Math.round(short * (text.kind === 'AUDIO' ? 0.1 : 0.075));
  ctx.font = `700 ${titlePx}px ${serif}`;
  const measureTitle: Measure = s => ctx.measureText(s).width;
  const titleLines = clampLines(wrapText(text.title, innerW, measureTitle), 2, innerW, measureTitle);
  let y = pad;
  for (const l of titleLines) {
    ctx.fillText(l, pad, y);
    y += titlePx * 1.3;
  }
  y += titlePx * 0.25;
  ctx.fillStyle = colors.rule;
  ctx.fillRect(pad, y, Math.min(innerW, short * 0.3), Math.max(2, Math.round(short * 0.005)));
  y += titlePx * 0.6;

  const authorPx = Math.round(short * 0.045);
  const bottom = h - pad - (text.author ? authorPx * 1.6 : 0);
  if (text.kind === 'TEXT' && text.body) {
    // 짧은 글은 크게(카드를 채움), 길면 작게 — 다 들어가는 가장 큰 크기, 가장 작은 크기에서도 넘치면 말줄임
    const measure: Measure = st => ctx.measureText(st).width;
    let fit: { px: number; lines: string[] } | null = null;
    for (const r of BODY_SIZES) {
      const px = Math.round(short * r);
      ctx.font = `400 ${px}px ${serif}`;
      const lines = tidyLines(wrapText(text.body, innerW, measure));
      const maxLines = Math.max(0, Math.floor((bottom - y) / (px * BODY_LEAD)));
      fit = { px, lines: clampLines(lines, maxLines, innerW, measure) };
      if (lines.length <= maxLines) break;
    }
    if (fit) {
      ctx.font = `400 ${fit.px}px ${serif}`;
      ctx.fillStyle = colors.ink;
      for (const l of fit.lines) {
        ctx.fillText(l, pad, y);
        y += fit.px * BODY_LEAD;
      }
    }
  } else if (text.kind === 'AUDIO') drawSpeaker(ctx, pad, y + titlePx * 0.2, titlePx * 1.2, colors.inkSub);

  if (text.author) {
    ctx.font = `500 ${authorPx}px ${serif}`;
    ctx.fillStyle = colors.inkSub;
    ctx.textAlign = 'right';
    ctx.fillText(text.author, w - pad, h - pad - authorPx);
    ctx.textAlign = 'left';
  }
};

/** 소리 표시: 스피커 몸통 + 소리 물결 두 줄(아이콘 글꼴 없이 선으로) */
const drawSpeaker = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void => {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.lineCap = 'round';
  const s = size;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.lineTo(x + s * 0.22, y + s * 0.35);
  ctx.lineTo(x + s * 0.5, y + s * 0.1);
  ctx.lineTo(x + s * 0.5, y + s * 0.9);
  ctx.lineTo(x + s * 0.22, y + s * 0.65);
  ctx.lineTo(x, y + s * 0.65);
  ctx.closePath();
  ctx.fill();
  for (const r of [0.22, 0.4]) {
    ctx.beginPath();
    ctx.arc(x + s * 0.55, y + s * 0.5, s * r, -Math.PI / 4, Math.PI / 4);
    ctx.stroke();
  }
  ctx.restore();
};

/** 카드 텍스처 하나. 글꼴을 먼저 받은 뒤 그린다(그 글자만, R8) — 글꼴이 없으면 바로 대체 글꼴로 */
export const makeCardTexture = async (
  text: CardText,
  aspect: number,
  colors: TemplateLook['card'],
): Promise<CanvasTexture> => {
  const { w, h } = cardCanvasSize(aspect);
  const serif = cssVar('--font-display', 'serif');
  try {
    await document.fonts.load(`700 40px ${serif}`, text.title + text.body.slice(0, 400) + text.author);
  } catch {
    // 글꼴을 못 받아도 대체 글꼴로 그린다
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) drawCard(ctx, w, h, text, colors);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  return tex;
};
