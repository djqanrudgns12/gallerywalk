import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type ClientRect,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  boardOrder,
  diffArrangement,
  dragOver as moveOver,
  keyboardTarget,
  locate,
  moveColumn,
  placeGroup,
  type Arrangement,
  type Columns,
  type KeyMove,
  type Over,
} from './arrange.ts';
import { dragSensorOptions, isAfter, parseKey, roomKey, type DragKind } from './dnd.ts';

/**
 * 관리 화면 v3 끌어 놓기(`@dnd-kit`, ADR-032·ADR-074, FIELD_PLAN §5.5). 모든 전시실 판을 한 `DndContext`로 감싼다.
 * 배열 규칙은 `arrange.ts`(순수), 여기서는 센서·부딪힘 판정·끄는 중 임시 배열·안내 문구·손끝 모양만.
 *
 * - 폭이 다른 액자가 여러 줄로 꺾이므로 정렬 변형에 맡기지 않는다: `onDragOver`마다 임시 배열을 바꾸고 줄바꿈은 flex가 한다.
 *   판 경계에서 오가며 계속 바뀌지 않게, 판을 옮긴 바로 다음 그림까지는 놓일 곳을 끄는 액자 자신으로 둔다.
 * - 놓으면 처음 배열과 비교해 바뀐 판만 `onArrange` 한 번(요청 하나). 저장소가 바뀔 때까지 놓은 배열을 그대로 보여 준다.
 * - 여러 개 고른 채 끌면 나머지는 자리에서 흐려지고, 놓인 자리부터 보드 차례대로 들어간다.
 * - 판 머리 손잡이(`board:`)를 끌면 판 순서만 바뀐다.
 */

export interface DragState {
  /** 끄는 것(`card:`·`board:`) */
  readonly active: string | null;
  /** 지금 그릴 보드 배열(끄는 중이면 임시 배열) */
  readonly columns: Columns;
  /** 끄는 액자가 놓일 전시실 */
  readonly overRoom: string | null;
  /** 끄는 액자가 처음 있던 전시실 */
  readonly fromRoom: string | null;
  /** 함께 끌리는 나머지 고른 작품(자리에서 흐려짐) */
  readonly group: readonly string[];
}

const DragStateContext = createContext<DragState>({
  active: null,
  columns: [],
  overRoom: null,
  fromRoom: null,
  group: [],
});
export const useDragState = (): DragState => useContext(DragStateContext);

const kindIs =
  (kind: DragKind) =>
  (c: { id: UniqueIdentifier }): boolean =>
    parseKey(c.id)?.kind === kind;

const centerOf = (r: ClientRect): { x: number; y: number } => ({
  x: r.left + r.width / 2,
  y: r.top + r.height / 2,
});

const isTouchEvent = (e: Event | null): boolean =>
  e !== null && (e.type.startsWith('touch') || (e as Partial<PointerEvent>).pointerType === 'touch');

const startPoint = (e: Event | null): { x: number; y: number } | null => {
  if (!e) return null;
  const t = (e as Partial<TouchEvent>).touches?.[0] ?? (e as Partial<TouchEvent>).changedTouches?.[0];
  if (t) return { x: t.clientX, y: t.clientY };
  const m = e as Partial<MouseEvent>;
  return typeof m.clientX === 'number' && typeof m.clientY === 'number'
    ? { x: m.clientX, y: m.clientY }
    : null;
};

const MOVES: Readonly<Record<string, KeyMove>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** 키보드로 액자를 옮길 다음 자리 → 끄는 모양의 새 왼쪽 위 좌표(판 순서는 판끼리만) */
const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { active, context } = args;
  const all = context.droppableContainers;
  if (parseKey(active)?.kind === 'board') {
    const some = {
      getEnabled: () => all.getEnabled().filter(kindIs('board')),
      get: (id: UniqueIdentifier) => all.get(id),
    } as unknown as typeof all;
    return sortableKeyboardCoordinates(event, {
      ...args,
      context: { ...context, droppableContainers: some },
    });
  }
  const move = MOVES[event.code];
  const box = context.collisionRect;
  if (!move || !box) return undefined;
  event.preventDefault();
  const rectOf = (id: UniqueIdentifier) => context.droppableRects.get(id);
  const enabled = all.getEnabled();
  const items = enabled.filter(kindIs('card')).flatMap(c => {
    const rect = rectOf(c.id);
    const roomId = (c.data.current as { roomId?: string } | undefined)?.roomId;
    const id = parseKey(c.id)?.id;
    return rect && roomId && id ? [{ id, roomId, rect }] : [];
  });
  const boards = enabled.filter(kindIs('room')).flatMap(c => {
    const rect = rectOf(c.id);
    const roomId = parseKey(c.id)?.id;
    return rect && roomId ? [{ roomId, rect }] : [];
  });
  const activeId = parseKey(active)?.id ?? '';
  const target: Over | null = keyboardTarget(items, boards, activeId, move);
  if (!target) return undefined;
  const rect =
    target.kind === 'card'
      ? items.find(i => i.id === target.id)?.rect
      : boards.find(b => b.roomId === target.roomId)?.rect;
  if (!rect) return undefined;
  const quarter = config().MANAGE_KEYBOARD_EDGE;
  const point =
    target.kind === 'card'
      ? { x: rect.left + rect.width * (target.after ? 1 - quarter : quarter), y: rect.top + rect.height / 2 }
      : centerOf(rect);
  return { x: point.x - box.width / 2, y: point.y - box.height / 2 };
};

export interface ManageDndProps {
  readonly children: ReactNode;
  /** 저장소의 보드 배열(전시실 차례, 판마다 보이는 작품) */
  readonly columns: Columns;
  readonly selected: readonly string[];
  /** 안내 문구에 넣을 이름(작품 제목·전시실 이름) */
  readonly nameOf: (key: string) => string;
  readonly onArrange: (a: Arrangement, moved: readonly string[]) => void;
  readonly onReorderRooms: (ids: readonly string[]) => void;
  /** 손가락으로 길게 누르고 그대로 떼면 고르기 */
  readonly onToggleSelect: (id: string) => void;
  /** 끄는 동안 손끝을 따라다니는 모양(여러 개면 `count`) */
  readonly renderOverlay: (key: string, count: number) => ReactNode;
  /** 지도에 놓기(HT-03d): 화면 좌표가 지도의 어느 전시실 바닥 위인가(지도가 없거나 바깥이면 null) */
  readonly mapHit?: (point: { x: number; y: number }) => string | null;
}

export const ManageDnd = ({
  children,
  columns,
  selected,
  nameOf,
  onArrange,
  onReorderRooms,
  onToggleSelect,
  renderOverlay,
  mapHit,
}: ManageDndProps) => {
  const opts = dragSensorOptions();
  const sensors = useSensors(
    useSensor(MouseSensor, opts.mouse),
    useSensor(TouchSensor, opts.touch),
    useSensor(KeyboardSensor, { ...opts.keyboard, coordinateGetter: keyboardCoordinates }),
  );
  const [active, setActive] = useState<string | null>(null);
  const [temp, setTemp] = useState<Columns | null>(null);
  const [pending, setPending] = useState<Columns | null>(null);
  const [group, setGroup] = useState<readonly string[]>([]);
  const snapshot = useRef<Columns>(columns);
  const touch = useRef(false);
  const keyboard = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const movedRoom = useRef(false);

  // 저장소가 바뀌면(놓은 것이 반영됐거나 실패로 되돌림) 놓은 배열을 내려놓는다
  useEffect(() => setPending(null), [columns]);
  // 판을 옮긴 다음 그림부터 다시 판정
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      movedRoom.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [temp]);

  const shown = temp ?? pending ?? columns;
  const activeKey = parseKey(active);
  const activeCard = activeKey?.kind === 'card' ? activeKey.id : null;
  const state = useMemo<DragState>(
    () => ({
      active,
      columns: shown,
      overRoom: activeCard ? (locate(shown, activeCard)?.roomId ?? null) : null,
      fromRoom: activeCard ? (locate(snapshot.current, activeCard)?.roomId ?? null) : null,
      group,
    }),
    [active, shown, activeCard, group],
  );

  const collide: CollisionDetection = args => {
    const containers = args.droppableContainers;
    if (parseKey(args.active.id)?.kind === 'board')
      return closestCenter({ ...args, droppableContainers: containers.filter(kindIs('board')) });
    if (movedRoom.current) return [{ id: args.active.id }];
    const point = args.pointerCoordinates ?? (args.collisionRect ? centerOf(args.collisionRect) : null);
    if (!point) return [];
    const at = { ...args, pointerCoordinates: point };
    // 지도의 전시실 바닥 위 → 그 판 끝(투영을 거꾸로 풀어 판정)
    const onMap = args.pointerCoordinates ? mapHit?.(point) : null;
    if (onMap) {
      const key = roomKey(onMap);
      if (containers.some(c => c.id === key)) return [{ id: key }];
    }
    const onCard = pointerWithin({ ...at, droppableContainers: containers.filter(kindIs('card')) });
    if (onCard.length > 0) return onCard;
    const onRoom = pointerWithin({ ...at, droppableContainers: containers.filter(kindIs('room')) });
    const room = onRoom[0] ? parseKey(onRoom[0].id)?.id : undefined;
    if (room !== undefined) {
      const inRoom = containers.filter(
        c => kindIs('card')(c) && (c.data.current as { roomId?: string } | undefined)?.roomId === room,
      );
      return inRoom.length > 0 ? closestCenter({ ...at, droppableContainers: inRoom }) : onRoom;
    }
    // 판 머리(손잡이 줄) 위 → 그 판 끝
    return pointerWithin({ ...at, droppableContainers: containers.filter(kindIs('board')) });
  };

  const accessibility = useMemo(() => {
    const d = copy.teacher.dnd;
    const name = (id: UniqueIdentifier | undefined) => (id === undefined ? '' : nameOf(String(id)));
    const announcements: Announcements = {
      onDragStart: ({ active: a }) => fill(d.picked, { name: name(a.id) }),
      onDragOver: ({ active: a, over }) => {
        const card = parseKey(a.id);
        if (card?.kind !== 'card' || !over) return over ? fill(d.over, { name: name(over.id) }) : undefined;
        const at = locate(temp ?? columns, card.id);
        return at ? fill(d.overSlot, { room: nameOf(roomKey(at.roomId)), n: at.index + 1 }) : undefined;
      },
      onDragEnd: ({ active: a }) => fill(d.dropped, { name: name(a.id) }),
      onDragCancel: () => d.cancelled,
    };
    return { announcements, screenReaderInstructions: { draggable: d.instructions } };
  }, [nameOf, temp, columns]);

  const reset = () => {
    setActive(null);
    setTemp(null);
    setGroup([]);
    lastOver.current = null;
    movedRoom.current = false;
  };

  const onDragStart = (e: DragStartEvent) => {
    const key = String(e.active.id);
    touch.current = isTouchEvent(e.activatorEvent);
    keyboard.current = e.activatorEvent instanceof KeyboardEvent;
    start.current = startPoint(e.activatorEvent);
    snapshot.current = columns;
    setActive(key);
    const card = parseKey(key);
    if (card?.kind !== 'card') return;
    setTemp(columns);
    setGroup(selected.includes(card.id) && selected.length > 1 ? selected.filter(id => id !== card.id) : []);
  };

  const onDragOver = (e: DragOverEvent) => {
    const card = parseKey(e.active.id);
    const over = parseKey(e.over?.id);
    if (card?.kind !== 'card' || !over || !e.over || !temp) return;
    lastOver.current = e.over.id;
    const translated = e.active.rect.current.translated;
    const point =
      !keyboard.current && start.current
        ? { x: start.current.x + e.delta.x, y: start.current.y + e.delta.y }
        : translated
          ? centerOf(translated)
          : null;
    let target: Over;
    if (over.kind === 'card') {
      if (!point) return;
      target = { kind: 'card', id: over.id, after: isAfter(point, e.over.rect) };
    } else target = { kind: 'room', roomId: over.id };
    const next = moveOver(temp, card.id, target);
    if (next === temp) return;
    if (locate(next, card.id)?.roomId !== locate(temp, card.id)?.roomId) movedRoom.current = true;
    setTemp(next);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const key = parseKey(e.active.id);
    const over = parseKey(e.over?.id);
    const final = temp;
    const others = group;
    const before = snapshot.current;
    reset();
    if (!key) return;
    if (key.kind === 'board') {
      if (over?.kind !== 'board') return;
      const ids = moveColumn(
        before.map(c => c.roomId),
        key.id,
        over.id,
      );
      if (ids) onReorderRooms(ids);
      return;
    }
    if (key.kind !== 'card') return;
    const still = Math.hypot(e.delta.x, e.delta.y) < config().DRAG_START_PX;
    if (touch.current && still && (over === null || over.id === key.id)) {
      onToggleSelect(key.id);
      return;
    }
    if (!e.over || !final) return;
    const placed = others.length > 0 ? placeGroup(before, final, key.id, [key.id, ...others]) : final;
    const a = diffArrangement(before, placed);
    if (!a) return;
    setPending(placed);
    onArrange(a, others.length > 0 ? boardOrder(before, [key.id, ...others]) : [key.id]);
    if (keyboard.current) {
      // 판을 옮기며 DOM이 새로 만들어져도 옮긴 액자에 초점을 되돌린다
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-cell-id="${key.id}"]`)?.focus());
    }
  };

  const threshold = config().MANAGE_AUTOSCROLL_THRESHOLD;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collide}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      autoScroll={{ threshold: { x: 0, y: threshold } }}
      accessibility={accessibility}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
    >
      <DragStateContext value={state}>{children}</DragStateContext>
      <DragOverlay dropAnimation={null}>
        {active ? renderOverlay(active, group.length + 1) : null}
      </DragOverlay>
    </DndContext>
  );
};
