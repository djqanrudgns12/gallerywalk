/**
 * 교사 관리 화면의 편집 되돌리기(FIELD_PLAN HT-08).
 * 옮기기·순서·숨기기·전시실 바꾸기·삭제를 한 줄 스택에 쌓고, 되돌리기는 반대 요청을 보낸다(서버 rev 그대로).
 * 이 파일은 순수하다: 스택과 단축키 판정만. 반대 요청을 만드는 일은 `useManage.ts`가 한다.
 */

export interface UndoEntry {
  /** 토스트에 보인 문장(무엇을 했는지) */
  readonly text: string;
  /** 반대 요청. 실패는 던져서 알린다 */
  readonly undo: () => Promise<void>;
}

export interface UndoStack {
  push(entry: UndoEntry): void;
  /** 가장 최근 것을 꺼낸다 */
  pop(): UndoEntry | undefined;
  /** 다른 길(삭제 토스트의 되살리기 등)로 이미 되돌린 것을 뺀다 */
  remove(entry: UndoEntry): void;
  clear(): void;
  readonly size: number;
}

/** 가장 오래된 것부터 버려 `max`개까지만 둔다 */
export const createUndoStack = (max: number): UndoStack => {
  const items: UndoEntry[] = [];
  return {
    push(entry) {
      items.push(entry);
      while (items.length > Math.max(0, max)) items.shift();
    },
    pop: () => items.pop(),
    remove(entry) {
      const i = items.lastIndexOf(entry);
      if (i >= 0) items.splice(i, 1);
    },
    clear() {
      items.length = 0;
    },
    get size() {
      return items.length;
    },
  };
};

/** 순서를 바꾼 뒤 가장 많이 움직인 작품과 새 자리(0부터). 바뀐 것이 없으면 null */
export const movedItem = (
  before: readonly string[],
  after: readonly string[],
): { readonly id: string; readonly index: number } | null => {
  let best: { id: string; index: number; dist: number } | null = null;
  after.forEach((id, index) => {
    const from = before.indexOf(id);
    if (from < 0) return;
    const dist = Math.abs(index - from);
    if (dist > 0 && (best === null || dist > best.dist)) best = { id, index, dist };
  });
  if (best === null) return null;
  const { id, index } = best;
  return { id, index };
};

interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly target: unknown;
}

const isEditable = (target: unknown): boolean => {
  if (typeof target !== 'object' || target === null) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/** Ctrl+Z · ⌘Z(Shift·Alt 없이). 글을 고치는 칸 안에서는 그 칸의 되돌리기를 쓰게 둔다 */
export const isUndoKey = (e: KeyLike): boolean =>
  (e.ctrlKey || e.metaKey) &&
  !e.shiftKey &&
  !e.altKey &&
  e.key.toLowerCase() === 'z' &&
  !isEditable(e.target);
