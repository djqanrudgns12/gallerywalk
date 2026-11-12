import { copy, fill, roAfter } from '@gallery/core/copy';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { dragSensorOptions, parseKey, resolveDrop, type DropIntent } from './dnd.ts';

/**
 * 관리 화면 끌어 옮기기(`@dnd-kit`, ADR-032). 칩 줄과 격자를 한 `DndContext`로 감싸 카드를 칩 위에 놓을 수 있게 한다.
 * 규칙은 `dnd.ts`(순수), 여기서는 센서·부딪힘 판정·안내 문구·끄는 동안 보이는 카드만.
 *
 * 부딪힘 판정
 * - 칩을 끌면 칩끼리만 본다.
 * - 카드를 손·마우스로 끌면 손끝이 칩 안에 있을 때만 칩(옮기기), 아니면 가장 가까운 카드(순서).
 * - 카드를 키보드로 끌면(손끝 좌표 없음) 카드가 칩에 겹칠 때 칩 — 맨 윗줄에서 ↑이면 칩 줄로 올라간다.
 */

const isKind = (kind: 'card' | 'chip') => (c: { id: UniqueIdentifier }) => parseKey(c.id)?.kind === kind;

export const collide: CollisionDetection = args => {
  const active = parseKey(args.active.id);
  const chips = args.droppableContainers.filter(isKind('chip'));
  if (active?.kind === 'chip') return closestCenter({ ...args, droppableContainers: chips });
  const chipArgs = { ...args, droppableContainers: chips };
  const onChip = args.pointerCoordinates ? pointerWithin(chipArgs) : rectIntersection(chipArgs);
  if (onChip.length > 0) return onChip;
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(isKind('card')) });
};

/**
 * 키보드로 옮길 다음 자리의 후보.
 * - 칩은 칩끼리만.
 * - 카드는 격자 안에서 카드끼리. 위(↑)로 갈 때만 칩도 후보라 맨 윗줄에서 ↑이면 칩 줄로 올라간다.
 *   칩 위에 있을 때는 ←/→가 칩끼리, ↓가 다시 격자다(칩 줄이 격자 위에 있어 →가 칩으로 튀지 않게).
 */
const keyboardCandidates = (active: UniqueIdentifier, overId: UniqueIdentifier | undefined, code: string) => {
  if (parseKey(active)?.kind === 'chip') return isKind('chip');
  const onChip = parseKey(overId)?.kind === 'chip';
  if (code === 'ArrowUp') return onChip ? () => false : () => true;
  if (code === 'ArrowDown') return isKind('card');
  return onChip ? isKind('chip') : isKind('card');
};

const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const all = args.context.droppableContainers;
  const keep = keyboardCandidates(args.active, args.context.over?.id, event.code);
  // `sortableKeyboardCoordinates`는 `getEnabled`·`get`만 쓴다(Map을 상속한 객체라 그 둘만 감싼다)
  const some = {
    getEnabled: () => all.getEnabled().filter(keep),
    get: (id: UniqueIdentifier) => all.get(id),
  } as unknown as typeof all;
  return sortableKeyboardCoordinates(event, {
    ...args,
    context: { ...args.context, droppableContainers: some },
  });
};

const isTouchEvent = (e: Event | null): boolean =>
  e !== null && (e.type.startsWith('touch') || (e as Partial<PointerEvent>).pointerType === 'touch');

export interface DragState {
  /** 끄는 것(`card:`·`chip:`) */
  readonly active: string | null;
  /** 카드를 끌고 위에 있는 전시실 칩 */
  readonly overRoom: string | null;
}

const DragStateContext = createContext<DragState>({ active: null, overRoom: null });
export const useDragState = (): DragState => useContext(DragStateContext);

export interface ManageDndProps {
  readonly children: ReactNode;
  readonly roomId: string | null;
  readonly artworkIds: readonly string[];
  readonly roomIds: readonly string[];
  readonly selected: readonly string[];
  /** 안내 문구에 넣을 이름(작품 제목·전시실 이름) */
  readonly nameOf: (key: string) => string;
  readonly onDrop: (intent: DropIntent) => void;
  /** 끄는 동안 손끝을 따라다니는 모양 */
  readonly renderOverlay: (key: string) => ReactNode;
}

export const ManageDnd = ({
  children,
  roomId,
  artworkIds,
  roomIds,
  selected,
  nameOf,
  onDrop,
  renderOverlay,
}: ManageDndProps) => {
  const opts = dragSensorOptions();
  const sensors = useSensors(
    useSensor(MouseSensor, opts.mouse),
    useSensor(TouchSensor, opts.touch),
    useSensor(KeyboardSensor, { ...opts.keyboard, coordinateGetter: keyboardCoordinates }),
  );
  const [state, setState] = useState<DragState>({ active: null, overRoom: null });
  const touch = useRef(false);

  const accessibility = useMemo(() => {
    const d = copy.teacher.dnd;
    const name = (id: UniqueIdentifier | undefined) => (id === undefined ? '' : nameOf(String(id)));
    const overText = (id: UniqueIdentifier | undefined): string | undefined => {
      const k = parseKey(id);
      if (!k) return undefined;
      const n = name(id);
      return k.kind === 'chip' ? fill(d.overRoom, { name: n, ro: roAfter(n) }) : fill(d.over, { name: n });
    };
    const announcements: Announcements = {
      onDragStart: ({ active }) => fill(d.picked, { name: name(active.id) }),
      onDragOver: ({ over }) => overText(over?.id),
      onDragEnd: ({ active }) => fill(d.dropped, { name: name(active.id) }),
      onDragCancel: () => d.cancelled,
    };
    return { announcements, screenReaderInstructions: { draggable: d.instructions } };
  }, [nameOf]);

  const reset = () => setState({ active: null, overRoom: null });

  const onDragStart = (e: DragStartEvent) => {
    touch.current = isTouchEvent(e.activatorEvent);
    setState({ active: String(e.active.id), overRoom: null });
  };

  const onDragOver = (e: DragOverEvent) => {
    const over = parseKey(e.over?.id);
    const overRoom = parseKey(e.active.id)?.kind === 'card' && over?.kind === 'chip' ? over.id : null;
    setState(s => (s.overRoom === overRoom ? s : { ...s, overRoom }));
  };

  const onDragEnd = (e: DragEndEvent) => {
    reset();
    const intent = resolveDrop({
      active: String(e.active.id),
      over: e.over ? String(e.over.id) : null,
      distance: Math.hypot(e.delta.x, e.delta.y),
      touch: touch.current,
      roomId,
      artworkIds,
      roomIds,
      selected,
    });
    if (intent) onDrop(intent);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collide}
      accessibility={accessibility}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
    >
      <DragStateContext value={state}>{children}</DragStateContext>
      <DragOverlay dropAnimation={null}>{state.active ? renderOverlay(state.active) : null}</DragOverlay>
    </DndContext>
  );
};
