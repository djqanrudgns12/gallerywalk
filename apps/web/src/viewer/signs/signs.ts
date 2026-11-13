import { copy } from '@gallery/core/copy';
import type { Fixture, Layout } from '@gallery/core/types';

/**
 * 3D 안 글자 사인(PRD G-02·G-12·9.3, FINISH_PLAN V-03): 배치 엔진이 둔 설비 가운데 글자 판이 있는 것에 무엇을 쓸지.
 * - `nameplate`(대표 벽 위): 전시실 이름 · `introPanel`(빈 벽): 전시실 이름 + 소개 글(교사가 쓴 200자)
 * - `corridorNameplate`(회랑): 다음 전시실 이름 · `hallSign`(홀 천장): 전시 이름 · `exitSign`(출구): 출구 인사
 * 순수 함수 — 그리기(`SignTexts.tsx`)와 따로 시험한다.
 */

export type SignKind = 'nameplate' | 'introPanel' | 'corridorNameplate' | 'hallSign' | 'exitSign';
export const SIGN_KINDS: readonly SignKind[] = [
  'nameplate',
  'introPanel',
  'corridorNameplate',
  'hallSign',
  'exitSign',
];

/** 판 위 글자 자리(템플릿 manifest `fixtures.models[종류].textArea`, m): 앞면(+Z)에서 `z`만큼 앞 */
export interface TextArea {
  readonly w: number;
  readonly h: number;
  readonly z: number;
}

export interface SignRoom {
  readonly title: string;
  readonly intro: string | null;
}

export interface SignItem {
  readonly key: string;
  readonly kind: SignKind;
  readonly partId: string | null;
  readonly pos: readonly [number, number, number];
  readonly rotY: number;
  readonly area: TextArea;
  /** 큰 글(이름) */
  readonly heading: string;
  /** 작은 글(소개·인사). 없으면 빈 글 */
  readonly body: string;
}

const isSign = (k: Fixture['kind']): k is SignKind => (SIGN_KINDS as readonly string[]).includes(k);

/** 관 ID → 전시실 글(이름·소개) */
export const signItems = (
  layout: Layout,
  roomOfPart: ReadonlyMap<string, SignRoom>,
  exhibitionTitle: string,
  areas: Readonly<Partial<Record<SignKind, TextArea>>>,
): SignItem[] => {
  const out: SignItem[] = [];
  layout.fixtures.forEach((f, i) => {
    if (!isSign(f.kind)) return;
    const area = areas[f.kind];
    if (!area) return;
    const room = roomOfPart.get(f.ref ?? f.partId ?? '');
    let heading = '';
    let body = '';
    switch (f.kind) {
      case 'nameplate':
      case 'corridorNameplate':
        heading = room?.title ?? '';
        break;
      case 'introPanel':
        heading = room?.title ?? '';
        body = room?.intro ?? '';
        break;
      case 'hallSign':
        heading = exhibitionTitle;
        body = copy.viewer.signHall;
        break;
      case 'exitSign':
        heading = copy.viewer.signExit;
        body = copy.viewer.exitThanks;
        break;
    }
    if (!heading && !body) return;
    out.push({
      key: `${f.kind}:${i}`,
      kind: f.kind,
      partId: f.partId,
      pos: f.pos,
      rotY: f.rotY,
      area,
      heading,
      body,
    });
  });
  return out;
};

/** 보이는 관의 사인만(관 밖 — 홀·출구 — 은 늘) */
export const visibleSigns = (items: readonly SignItem[], visible: ReadonlySet<string>): SignItem[] =>
  items.filter(s => s.partId === null || visible.has(s.partId));

export interface PackedRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 아틀라스 자리 나누기(선반 쌓기): 판마다 `pxPerM` 비율의 네모를 폭 `width` 캔버스에 줄줄이. 겹치지 않는다.
 * 높이는 쌓은 만큼(2의 거듭제곱으로 올림).
 */
export const packSigns = (
  areas: readonly TextArea[],
  pxPerM: number,
  width: number,
): { rects: PackedRect[]; height: number } => {
  const rects: PackedRect[] = [];
  let x = 0;
  let y = 0;
  let row = 0;
  for (const a of areas) {
    const w = Math.min(width, Math.ceil(a.w * pxPerM));
    const h = Math.ceil(a.h * pxPerM);
    if (x + w > width) {
      x = 0;
      y += row;
      row = 0;
    }
    rects.push({ x, y, w, h });
    x += w;
    row = Math.max(row, h);
  }
  const used = Math.max(1, y + row);
  return { rects, height: 2 ** Math.ceil(Math.log2(used)) };
};

/** 글을 폭에 맞춰 줄로(한글은 글자 단위로 끊는다). `maxLines`를 넘으면 마지막 줄 끝을 `…`로 */
export const wrapLines = (
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines: number,
): string[] => {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      const next = line + ch;
      if (measure(next) > maxWidth && line) {
        lines.push(line);
        line = ch.trimStart();
      } else line = next;
    }
    lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? '';
  while (last && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}…`;
  return kept;
};

export const signKeyOf = (items: readonly SignItem[]): string =>
  items.map(s => `${s.key}:${s.heading}:${s.body}`).join('|');
