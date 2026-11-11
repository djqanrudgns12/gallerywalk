/**
 * 글 카드의 쪽 담기(PRD 6.8, PLAN §5.7). 높이 측정은 화면 쪽(`apps/web/src/viewer/zoom/measureText.ts`, DOM)이
 * 하고, 여기는 잰 값만 받아 쪽에 담는다 — domain은 DOM을 모른다(Codex 지적).
 */

import { config } from '../../config.ts';

export interface TextUnit {
  /** 문단(산문) 또는 연(시)의 번호. 같은 번호의 조각은 한 덩어리에서 쪼개진 것 */
  readonly group: number;
  /** 잰 높이(CSS px, 문단 사이 여백 포함) */
  readonly height: number;
}

export interface TextPage {
  /** units 배열의 [first, last] 색인 */
  readonly first: number;
  readonly last: number;
}

/**
 * 앞에서부터 쪽 높이를 넘지 않게 담는다. 덩어리를 쪽 사이에서 나누지 않는 것이 먼저이고,
 * 한 덩어리가 쪽보다 길 때만 측정 쪽이 미리 쪼갠 조각(문장·줄) 단위로 넘어간다.
 * 한 조각이 쪽보다 높으면(측정 쪽이 더 쪼개지 못한 경우) 그 조각 혼자 한 쪽을 쓴다.
 */
export const planTextPages = (units: readonly TextUnit[], pageHeight: number): TextPage[] => {
  const pages: TextPage[] = [];
  let first = 0;
  let used = 0;
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    if (i === first || used + unit.height <= pageHeight) {
      // 빈 쪽에는 무엇이든 하나는 담는다(쪽보다 높은 조각은 혼자 한 쪽).
      used += unit.height;
      continue;
    }
    // 넘친다. 이 조각의 덩어리가 이 쪽 중간에서 시작했고 덩어리 전체가 한 쪽에 들어가면 덩어리째 다음 쪽으로.
    const groupStart = firstIndexOfGroup(units, i, first);
    const cut = groupStart > first && heightOfGroup(units, groupStart) <= pageHeight ? groupStart : i;
    pages.push({ first, last: cut - 1 });
    first = cut;
    used = sumHeights(units, cut, i + 1);
  }
  if (first < units.length) pages.push({ first, last: units.length - 1 });
  return pages;
};

const firstIndexOfGroup = (units: readonly TextUnit[], i: number, floor: number): number => {
  const group = units[i]!.group;
  let j = i;
  while (j - 1 >= floor && units[j - 1]!.group === group) j--;
  return j;
};

const heightOfGroup = (units: readonly TextUnit[], start: number): number => {
  const group = units[start]!.group;
  let total = 0;
  for (let j = start; j < units.length && units[j]!.group === group; j++) total += units[j]!.height;
  return total;
};

const sumHeights = (units: readonly TextUnit[], from: number, to: number): number => {
  let total = 0;
  for (let j = from; j < to; j++) total += units[j]!.height;
  return total;
};

/** 붙여넣은 글이 시인지 산문인지(PLAN §5.7): 빈 줄로 나뉜 덩어리가 둘 이상이고 줄이 대체로 짧으면 시. */
export const looksLikePoem = (text: string): boolean => {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const stanzas = normalized.split(/\n\s*\n/).filter(s => s.trim().length > 0);
  const lines = normalized.split('\n').filter(l => l.trim().length > 0);
  const c = config();
  if (lines.length < c.POEM_MIN_LINES) return false;
  const shortLines = lines.filter(l => [...l.trim()].length <= c.POEM_SHORT_LINE_CHARS).length;
  return stanzas.length >= 2 && shortLines / lines.length >= c.POEM_SHORT_LINE_RATIO;
};

/** 덩어리로 나누기: 시는 연(빈 줄), 산문은 문단(빈 줄 또는 줄바꿈). */
export const splitBlocks = (text: string, poem: boolean): string[] => {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const parts = poem ? normalized.split(/\n\s*\n/) : normalized.split(/\n+/);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
};

/** 쪽보다 긴 문단을 문장 끝에서 쪼갠다(`다.` `요.` `?` `!` `.` 뒤). 시의 연은 줄 단위로 쪼갠다. */
export const splitOversizeBlock = (block: string, poem: boolean): string[] => {
  if (poem)
    return block
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
  const sentences = block.match(/[^.!?]+(?:[.!?]+["'”’)]*\s*|$)/g) ?? [block];
  return sentences.map(s => s.trim()).filter(s => s.length > 0);
};
