import { config } from '@gallery/core/config';
import { moveItem } from './teacherStore.ts';

/**
 * 관리 화면 끌어 옮기기의 순수 규칙(ADR-032, PLAN §7.4 G-10). 화면 연결은 `ManageDnd.tsx`.
 *
 * - 끌 수 있는 것: 작품 카드(`card:{id}`), 전시실 칩(`chip:{id}`). 한 `DndContext` 안이라 카드를 칩 위에 놓을 수 있다.
 * - 마우스: `DRAG_START_PX`만큼 움직이면 시작. 누르기·Shift+누르기는 그대로 누르기다.
 * - 터치: `LONG_PRESS_MS` 길게 누르면 시작(그 전에 `DRAG_START_PX`보다 움직이면 스크롤로 넘김).
 *   길게 누른 뒤 움직이지 않고 떼면 "길게 누르기 = 여러 장 고르기"(PLAN §7.4)로 본다.
 * - 키보드: 카드·칩에 초점을 두고 `M`(옮기기)으로 집고, 화살표로 옮긴 뒤 Space·Enter로 놓는다. Esc는 그만두기.
 *   Space(고르기)·Enter(열기)·Alt+←/→(한 칸)는 카드의 원래 뜻 그대로 둔다. 키는 자판 위치(`code`)라 한글 입력 중에도 같다.
 */

export type DragKind = 'card' | 'chip';

export const cardKey = (id: string): string => `card:${id}`;
export const chipKey = (id: string): string => `chip:${id}`;

export const parseKey = (key: string | number | null | undefined): { kind: DragKind; id: string } | null => {
  if (typeof key !== 'string') return null;
  const at = key.indexOf(':');
  const kind = key.slice(0, at);
  if (kind !== 'card' && kind !== 'chip') return null;
  return { kind, id: key.slice(at + 1) };
};

/** 키보드 끌기 키(`KeyboardEvent.code`) */
export const KEYBOARD_CODES = {
  start: ['KeyM'],
  cancel: ['Escape'],
  end: ['Space', 'Enter'],
};

/** 센서 설정. `@dnd-kit`의 `useSensor(…, options)`에 그대로 넣는다 */
export const dragSensorOptions = () => {
  const cfg = config();
  return {
    mouse: { activationConstraint: { distance: cfg.DRAG_START_PX } },
    touch: { activationConstraint: { delay: cfg.LONG_PRESS_MS, tolerance: cfg.DRAG_START_PX } },
    keyboard: { keyboardCodes: KEYBOARD_CODES },
  };
};

export type DropIntent =
  | { readonly kind: 'reorderArtworks'; readonly roomId: string; readonly ids: readonly string[] }
  | { readonly kind: 'moveToRoom'; readonly roomId: string; readonly ids: readonly string[] }
  | { readonly kind: 'reorderRooms'; readonly ids: readonly string[] }
  | { readonly kind: 'toggleSelect'; readonly id: string };

export interface DropInput {
  /** 집은 것(`card:`·`chip:`) */
  readonly active: string;
  /** 놓은 곳(없으면 null) */
  readonly over: string | null;
  /** 집은 뒤 움직인 거리(px) */
  readonly distance: number;
  /** 손가락으로 길게 눌러 집었나 */
  readonly touch: boolean;
  /** 지금 전시실 */
  readonly roomId: string | null;
  /** 지금 전시실 작품 순서 */
  readonly artworkIds: readonly string[];
  /** 전시실 순서 */
  readonly roomIds: readonly string[];
  readonly selected: readonly string[];
}

/** 놓은 결과 → 할 일(없으면 null) */
export const resolveDrop = (d: DropInput): DropIntent | null => {
  const active = parseKey(d.active);
  const over = parseKey(d.over);
  if (!active) return null;

  if (active.kind === 'chip') {
    if (over?.kind !== 'chip' || over.id === active.id) return null;
    const from = d.roomIds.indexOf(active.id);
    const to = d.roomIds.indexOf(over.id);
    if (from < 0 || to < 0) return null;
    return { kind: 'reorderRooms', ids: moveItem(d.roomIds, from, to) };
  }

  const still = d.distance < config().DRAG_START_PX;
  if (d.touch && still && (over === null || over.id === active.id))
    return { kind: 'toggleSelect', id: active.id };
  if (!over) return null;

  if (over.kind === 'chip') {
    if (over.id === d.roomId) return null;
    const ids = d.selected.includes(active.id) ? d.selected : [active.id];
    return { kind: 'moveToRoom', roomId: over.id, ids };
  }

  if (d.roomId === null) return null;
  const from = d.artworkIds.indexOf(active.id);
  const to = d.artworkIds.indexOf(over.id);
  if (from < 0 || to < 0 || from === to) return null;
  return { kind: 'reorderArtworks', roomId: d.roomId, ids: moveItem(d.artworkIds, from, to) };
};
