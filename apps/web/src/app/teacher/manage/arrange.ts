import type { ArtworkTeacher, TeacherExhibitionView } from '@gallery/core/types';

/**
 * 교사 작업 화면 v3 끌어 놓기의 배열 규칙(FIELD_PLAN §5.5, G-32). 순수 함수만.
 *
 * - 보드는 전시실마다 판 하나(`Column`). 판의 작품은 보드에 보이는 작품(숨김·처리 중 포함, 지운 것 제외)을 `order` 차례로.
 * - 끄는 동안은 보드 안 임시 배열(`Columns`)을 `dragOver`로 바꾸고, 놓으면 처음 배열과 비교해 바뀐 판만
 *   `PUT …/arrangement` 요청(`base` = 바꾸기 전, `rooms` = 바꾼 뒤)으로 만든다(`diffArrangement`).
 * - 되돌리기는 같은 요청의 `base`와 `rooms`를 맞바꾼다(`invertArrangement`).
 */

export interface Column {
  readonly roomId: string;
  readonly ids: readonly string[];
}
export type Columns = readonly Column[];

export interface Arrangement {
  /** 바꾸기 전(클라이언트가 본 것) */
  readonly base: readonly Column[];
  /** 바꾼 뒤. `base`와 같은 전시실 목록·같은 작품 집합 */
  readonly rooms: readonly Column[];
}

export interface Spot {
  readonly roomId: string;
  readonly index: number;
}

const byOrder = (a: ArtworkTeacher, b: ArtworkTeacher): number => a.order - b.order || (a.id < b.id ? -1 : 1);

/** 보드 배열: 전시실 차례대로, 판마다 보이는 작품 */
export const columnsOf = (view: TeacherExhibitionView | null): Columns => {
  if (!view) return [];
  const rooms = [...view.rooms].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  const live = view.artworks.filter(a => a.deletedAt === null);
  return rooms.map(room => ({
    roomId: room.id,
    ids: live
      .filter(a => a.roomId === room.id)
      .sort(byOrder)
      .map(a => a.id),
  }));
};

/** 작품이 있는 판과 자리 */
export const locate = (columns: Columns, id: string): Spot | null => {
  for (const column of columns) {
    const index = column.ids.indexOf(id);
    if (index >= 0) return { roomId: column.roomId, index };
  }
  return null;
};

/** 보드 읽는 차례(판 차례 → 판 안 차례)로 줄 세운다. 보드에 없는 ID는 뺀다 */
export const boardOrder = (columns: Columns, ids: readonly string[]): string[] => {
  const want = new Set(ids);
  return columns.flatMap(c => c.ids.filter(id => want.has(id)));
};

/**
 * 작품들을 `target` 판의 `index` 자리에 넣는다. `index`는 옮길 작품들을 뺀 뒤의 판 기준(0 = 맨 앞, 길이 = 끝).
 * 여러 개면 `ids` 차례대로 붙여 넣는다. 판이 없으면 그대로 돌려준다.
 */
export const placeCards = (columns: Columns, ids: readonly string[], target: Spot): Columns => {
  if (!columns.some(c => c.roomId === target.roomId) || ids.length === 0) return columns;
  const moving = new Set(ids);
  return columns.map(column => {
    const rest = column.ids.filter(id => !moving.has(id));
    if (column.roomId !== target.roomId)
      return rest.length === column.ids.length ? column : { ...column, ids: rest };
    const at = Math.max(0, Math.min(target.index, rest.length));
    return { ...column, ids: [...rest.slice(0, at), ...ids, ...rest.slice(at)] };
  });
};

/** 놓일 곳: 작품 위(그 앞 또는 뒤) 또는 판 자체(빈 판·판 머리·지도의 전시실 → 끝) */
export type Over =
  | { readonly kind: 'card'; readonly id: string; readonly after: boolean }
  | { readonly kind: 'room'; readonly roomId: string };

/**
 * 끄는 중 임시 배열 갱신(dnd-kit `onDragOver`). 놓일 곳이 바뀌지 않으면 같은 배열(참조)을 돌려준다.
 * 작품 위면 그 작품 앞(`after`면 뒤), 판이면 그 판 끝. 끄는 작품 자신 위면 그대로.
 */
export const dragOver = (columns: Columns, activeId: string, over: Over): Columns => {
  const from = locate(columns, activeId);
  if (!from) return columns;
  let target: Spot | null;
  if (over.kind === 'room') {
    const column = columns.find(c => c.roomId === over.roomId);
    if (!column) return columns;
    if (over.roomId === from.roomId) return columns;
    target = { roomId: over.roomId, index: column.ids.length };
  } else {
    if (over.id === activeId) return columns;
    const at = locate(columns, over.id);
    if (!at) return columns;
    const column = columns.find(c => c.roomId === at.roomId);
    const rest = (column?.ids ?? []).filter(id => id !== activeId);
    const overIndex = rest.indexOf(over.id);
    target = { roomId: at.roomId, index: overIndex + (over.after ? 1 : 0) };
  }
  const next = placeCards(columns, [activeId], target);
  const now = locate(next, activeId);
  return now && now.roomId === from.roomId && now.index === from.index ? columns : next;
};

/**
 * 여러 개 고른 채 끈 것을 놓을 때: 끈 작품이 놓인 자리부터 고른 작품들을 보드 차례대로 넣는다(FIELD_PLAN §5.5 ④).
 * `group`은 놓기 전 보드(`before`)의 차례로 줄 세운다.
 */
export const placeGroup = (
  before: Columns,
  dropped: Columns,
  activeId: string,
  group: readonly string[],
): Columns => {
  const ids = boardOrder(before, group.includes(activeId) ? group : [...group, activeId]);
  const others = new Set(ids.filter(id => id !== activeId));
  const withoutOthers = dropped.map(c => ({ ...c, ids: c.ids.filter(id => !others.has(id)) }));
  const at = locate(withoutOthers, activeId);
  if (!at) return dropped;
  return placeCards(withoutOthers, ids, at);
};

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => b[i] === id);

/** 바뀐 판만 골라 요청을 만든다. 바뀐 것이 없으면 null */
export const diffArrangement = (before: Columns, after: Columns): Arrangement | null => {
  const changed = after.filter(column => {
    const old = before.find(c => c.roomId === column.roomId);
    return !old || !sameIds(old.ids, column.ids);
  });
  if (changed.length === 0) return null;
  const roomIds = changed.map(c => c.roomId);
  return {
    base: roomIds.map(roomId => ({ roomId, ids: before.find(c => c.roomId === roomId)?.ids ?? [] })),
    rooms: changed.map(c => ({ roomId: c.roomId, ids: c.ids })),
  };
};

/** 되돌리기 요청: 바꾸기 전과 뒤를 맞바꾼다 */
export const invertArrangement = (a: Arrangement): Arrangement => ({ base: a.rooms, rooms: a.base });

/** 보드 배열에 요청을 덮어쓴다(화면 먼저 바꾸기) */
export const applyArrangement = (columns: Columns, a: Arrangement): Columns =>
  columns.map(column => {
    const next = a.rooms.find(c => c.roomId === column.roomId);
    return next ? { ...column, ids: next.ids } : column;
  });

/** 판 순서 바꾸기(전시실 끌기): `from` 판을 `to` 자리로 */
export const moveColumn = (roomIds: readonly string[], from: string, to: string): string[] | null => {
  const i = roomIds.indexOf(from);
  const j = roomIds.indexOf(to);
  if (i < 0 || j < 0 || i === j) return null;
  const out = [...roomIds];
  out.splice(i, 1);
  out.splice(j, 0, from);
  return out;
};

// ── 키보드로 옮길 다음 자리 ────────────────────────────────────

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface KeyItem {
  readonly id: string;
  readonly roomId: string;
  readonly rect: Rect;
}

export interface KeyBoard {
  readonly roomId: string;
  readonly rect: Rect;
}

export type KeyMove = 'left' | 'right' | 'up' | 'down';

const midX = (r: Rect): number => r.left + r.width / 2;
const midY = (r: Rect): number => r.top + r.height / 2;

/** 판 안 작품을 줄로 묶는다(세로 가운데가 앞 줄 높이 안이면 같은 줄) */
const rowsOf = (items: readonly KeyItem[]): KeyItem[][] => {
  const rows: KeyItem[][] = [];
  for (const item of [...items].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)) {
    const row = rows[rows.length - 1];
    const head = row?.[0];
    if (row && head && midY(item.rect) < head.rect.top + head.rect.height) row.push(item);
    else rows.push([item]);
  }
  return rows.map(row => row.sort((a, b) => a.rect.left - b.rect.left));
};

const nearestX = (row: readonly KeyItem[], x: number): KeyItem | undefined =>
  [...row].sort((a, b) => Math.abs(midX(a.rect) - x) - Math.abs(midX(b.rect) - x))[0];

/**
 * 키보드 끌기에서 다음 놓일 곳(FIELD_PLAN §5.5 입력별 키).
 * - ←→: 판 안 읽는 차례로 한 칸. 판 끝에서는 그대로.
 * - ↑↓: 판 안 위·아래 줄의 가장 가까운 자리. 첫 줄·끝 줄이면 위·아래 판의 가장 가까운 자리(빈 판이면 그 판).
 * `currentId`는 끄는 작품(임시 배열에서 지금 자리)이다. 다음 곳이 없으면 null.
 */
export const keyboardTarget = (
  items: readonly KeyItem[],
  boards: readonly KeyBoard[],
  currentId: string,
  move: KeyMove,
): Over | null => {
  const current = items.find(i => i.id === currentId);
  if (!current) return null;
  const inRoom = items.filter(i => i.roomId === current.roomId);
  const rows = rowsOf(inRoom);
  const flat = rows.flat();
  const at = flat.findIndex(i => i.id === currentId);
  if (move === 'left' || move === 'right') {
    const next = flat[at + (move === 'left' ? -1 : 1)];
    return next ? { kind: 'card', id: next.id, after: move === 'right' } : null;
  }
  const r = rows.findIndex(row => row.some(i => i.id === currentId));
  const x = midX(current.rect);
  const nextRow = rows[r + (move === 'up' ? -1 : 1)];
  if (nextRow) {
    const near = nearestX(nextRow, x);
    return near ? { kind: 'card', id: near.id, after: midX(near.rect) < x } : null;
  }
  const order = [...boards].sort((a, b) => a.rect.top - b.rect.top);
  const b = order.findIndex(board => board.roomId === current.roomId);
  const board = order[b + (move === 'up' ? -1 : 1)];
  if (!board) return null;
  const theirs = rowsOf(items.filter(i => i.roomId === board.roomId));
  const edgeRow = move === 'up' ? theirs[theirs.length - 1] : theirs[0];
  const near = edgeRow ? nearestX(edgeRow, x) : undefined;
  return near
    ? { kind: 'card', id: near.id, after: midX(near.rect) < x }
    : { kind: 'room', roomId: board.roomId };
};
