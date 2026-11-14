import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import type { ArtworkForm, ArtworkTeacher, RoomTeacher } from '@gallery/core/types';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type SyntheticEvent,
} from 'react';
import { Icon } from '../../../ui/index.ts';
import { Frame, type FrameShape, type FrameSize } from '../../../ui/patterns/teacher/index.ts';
import { dragHasFiles } from '../upload/collectFiles.ts';
import { isBlurry, isUntitled, thumbOf } from './artworkLook.ts';
import { boardKey, cardKey, roomKey } from './dnd.ts';
import { cellKeyAction } from './keys.ts';
import { isDragActive, useDragState } from './ManageDnd.tsx';
import s from './RoomBoard.module.css';

/**
 * 전시실 줄 보드(G-26·G-32, FIELD_PLAN HT-03a). 전시실마다 판 하나: 큰 번호·이름·가는 레일·작품 수·배경음악·손잡이·`고치기`,
 * 그 아래 액자를 벽에 걸듯 한 줄로(넘치면 다음 줄). 대표작은 1.2배·황동 테, 확인할 것은 귀퉁이 점.
 * - 액자를 누르면 살펴보기. Shift+누르기·마우스 길게 누르기·`여러 개 고르기` 중이면 고르기.
 * - 끌기: 액자는 같은 판 안·다른 판 n번째로, 판 머리 손잡이는 판 순서(`ManageDnd`).
 * - 키: Enter 살펴보기 · Space 고르기 · Alt+←/→ 한 칸 · M 집기.
 * - 판에 파일을 떨어뜨리면 그 전시실로 올린다(올리기 자체는 창 전체 놓기가 받는다 — 여기서는 대상 전시실만 정함).
 */

const FORM_SHAPE: Readonly<Record<ArtworkForm, FrameShape>> = {
  LANDSCAPE: 'landscape',
  PORTRAIT: 'portrait',
  SQUARE: 'square',
  PANORAMA: 'wide',
  TALL: 'tall',
  TEXTCARD: 'portrait',
  MULTIPAGE: 'portrait',
  SOUND: 'square',
};

/** 액자 비율: 그림의 실제 비율(너무 길면 형태 갈래로) */
const ratioOf = (a: ArtworkTeacher): number | undefined => {
  const media = a.image ?? a.pages?.[0] ?? null;
  if (!media || a.form === 'TEXTCARD' || a.form === 'SOUND') return undefined;
  const r = media.w / media.h;
  const { MANAGE_FRAME_RATIO_MIN: min, MANAGE_FRAME_RATIO_MAX: max } = config();
  return r >= min && r <= max ? r : undefined;
};

/** 정렬 변형을 쓰지 않는다 — 줄바꿈은 임시 배열과 flex가 맡는다(FIELD_PLAN §5.5 구현 방식) */
const noMove: SortingStrategy = () => null;

/** 칸 안의 입력·버튼에서 시작한 누르기는 끌기·고르기로 보지 않는다 */
const fromControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('input,textarea,button') !== null;

const two = (n: number): string => String(n).padStart(2, '0');

const captionOf = (a: ArtworkTeacher): string | null => {
  if (a.status === 'PUBLISHED') return a.featured ? copy.teacher.board.featured : null;
  return copy.teacher.status[a.status];
};

interface CellProps {
  readonly exhibitionId: string;
  readonly artwork: ArtworkTeacher;
  readonly roomId: string;
  readonly index: number;
  readonly size: FrameSize;
  readonly inspected: boolean;
  readonly selected: boolean;
  readonly selecting: boolean;
  readonly flashing: boolean;
  /** 함께 끌리는 고른 작품(자리에서 흐려짐) */
  readonly inGroup: boolean;
  readonly onOpen: (id: string) => void;
  readonly onToggleSelect: (id: string) => void;
  readonly onNudge: (id: string, delta: -1 | 1) => void;
  readonly keys: CellKeys;
}

/** 액자 키(HT-09)가 부르는 일 */
export interface CellKeys {
  /** ←/→로 이웃 액자에 초점이 갔을 때(살펴보는 중이면 그 작품을 살펴본다) */
  readonly onStep: (id: string) => void;
  readonly onToggleHidden: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onHelp: () => void;
}

const Cell = memo(function Cell({
  exhibitionId,
  artwork: a,
  roomId,
  index,
  size,
  inspected,
  selected,
  selecting,
  flashing,
  inGroup,
  onOpen,
  onToggleSelect,
  onNudge,
  keys,
}: CellProps) {
  const processing = a.status === 'PROCESSING';
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: cardKey(a.id),
    data: { roomId },
    disabled: processing,
    attributes: { roleDescription: copy.teacher.dnd.roleCard },
  });
  const press = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  useEffect(() => () => clearTimeout(pressTimer.current), []);
  // 끌기가 시작되면 길게 누르기(고르기)는 그만둔다(검토 L5)
  useEffect(() => {
    if (!isDragging) return;
    press.current = null;
    clearTimeout(pressTimer.current);
  }, [isDragging]);

  const sensor = (name: string) => (e: SyntheticEvent) => {
    if (fromControl(e.target)) return;
    (listeners?.[name] as ((ev: SyntheticEvent) => void) | undefined)?.(e);
  };

  // 마우스 길게 누르기 → 고르기(터치는 끌기 센서가 맡는다)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (e.pointerType !== 'mouse' || e.button !== 0 || fromControl(e.target)) return;
    press.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      if (press.current === null) return;
      press.current = null;
      suppressClick.current = true;
      onToggleSelect(a.id);
    }, config().LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointer !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < config().DRAG_START_PX) return;
    press.current = null;
    clearTimeout(pressTimer.current);
  };
  const endPress = () => {
    press.current = null;
    clearTimeout(pressTimer.current);
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (fromControl(e.target)) return;
    if (e.shiftKey || selecting) onToggleSelect(a.id);
    else onOpen(a.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    // 키보드로 끄는 중이면 Space·Enter·화살표는 끌기 센서의 것
    const action = isDragActive() ? null : cellKeyAction(e);
    if (action === null) {
      sensor('onKeyDown')(e);
      return;
    }
    e.preventDefault();
    switch (action) {
      case 'open':
        onOpen(a.id);
        return;
      case 'select':
        onToggleSelect(a.id);
        return;
      case 'nudgePrev':
      case 'nudgeNext':
        onNudge(a.id, action === 'nudgePrev' ? -1 : 1);
        return;
      case 'prev':
      case 'next': {
        const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-cell-id]'));
        const to = cells[cells.indexOf(e.currentTarget) + (action === 'prev' ? -1 : 1)];
        const id = to?.dataset.cellId;
        if (to && id) {
          to.focus();
          keys.onStep(id);
        }
        return;
      }
      case 'toggleHidden':
        keys.onToggleHidden(a.id);
        return;
      case 'delete':
        keys.onDelete(a.id);
        return;
      case 'help':
        keys.onHelp();
    }
  };

  const title = isUntitled(a) ? copy.teacher.manage.untitled : a.title;
  const flag = a.status === 'FAILED' || isUntitled(a) || isBlurry(a);
  const flagLabel =
    a.status === 'FAILED'
      ? errorCopy[a.failCode ?? 'E_FILE_BROKEN']
      : isUntitled(a)
        ? copy.teacher.warnUntitled
        : copy.teacher.warnBlurry;
  const caption = captionOf(a);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      className={[s.cell, flashing ? s.flash : '', a.featured ? s.featuredCell : '']
        .filter(Boolean)
        .join(' ')}
      data-cell-id={a.id}
      data-testid={`cell-${a.id}`}
      data-status={a.status}
      data-index={index}
      role="button"
      tabIndex={0}
      aria-pressed={selecting ? selected : undefined}
      aria-current={inspected ? 'true' : undefined}
      aria-label={fill(copy.teacher.board.cellLabel, { n: index + 1, title })}
      onMouseDown={sensor('onMouseDown')}
      onTouchStart={sensor('onTouchStart')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <Frame
        src={thumbOf(exhibitionId, a)}
        alt={title}
        size={size}
        shape={FORM_SHAPE[a.form]}
        ratio={ratioOf(a)}
        featured={a.featured}
        blurred={a.status !== 'PUBLISHED' || inGroup}
        flag={flag}
        flagLabel={flag ? flagLabel : undefined}
        selected={inspected || (selecting && selected)}
        lifted={isDragging}
      >
        {a.form === 'SOUND' ? <Icon name="music" /> : null}
      </Frame>
      {selecting ? (
        <span className={selected ? `${s.check} ${s.checkOn}` : s.check} aria-hidden="true">
          {selected ? <Icon name="check" /> : null}
        </span>
      ) : null}
      <span className={s.caption}>
        <span className={s.order}>{two(index + 1)}</span>
        {caption ? <span className={a.featured ? s.capFeatured : s.capStatus}>{caption}</span> : null}
      </span>
    </div>
  );
});

export interface RoomBoardsProps {
  readonly exhibitionId: string;
  readonly rooms: readonly RoomTeacher[];
  readonly artworks: ReadonlyMap<string, ArtworkTeacher>;
  readonly size: FrameSize;
  /** 살펴보는 작품 */
  readonly inspectedId: string | null;
  readonly selected: readonly string[];
  readonly selecting: boolean;
  readonly flashId: string | null;
  readonly onOpen: (id: string) => void;
  readonly onToggleSelect: (id: string) => void;
  readonly onNudge: (id: string, delta: -1 | 1) => void;
  readonly onEditRoom: (roomId: string) => void;
  readonly onAddRoom: () => void;
  /** 판에 파일을 떨어뜨리기 시작함 → 올릴 전시실 */
  readonly onDropTarget: (roomId: string) => void;
  readonly keys: CellKeys;
  /** 휴대폰: 판을 접고 펼친다(접힌 판은 표지 그림 셋). 끄는 액자가 접힌 판에 머물면 펼친다 */
  readonly collapsible?: boolean;
}

interface BoardProps extends Omit<RoomBoardsProps, 'rooms' | 'onAddRoom' | 'collapsible'> {
  readonly room: RoomTeacher;
  readonly index: number;
  readonly ids: readonly string[];
  /** 접혔으면 true, 접을 수 없으면 null */
  readonly collapsed: boolean | null;
  readonly onToggle: (roomId: string, open?: boolean) => void;
}

const Board = ({
  exhibitionId,
  room,
  index,
  ids,
  artworks,
  size,
  inspectedId,
  selected,
  selecting,
  flashId,
  onOpen,
  onToggleSelect,
  onNudge,
  onEditRoom,
  onDropTarget,
  collapsed,
  onToggle,
  keys,
}: BoardProps) => {
  const drag = useDragState();
  const header = useSortable({
    id: boardKey(room.id),
    attributes: { roleDescription: copy.teacher.dnd.roleRoom },
  });
  const body = useDroppable({ id: roomKey(room.id), data: { roomId: room.id } });
  const [fileOver, setFileOver] = useState(false);
  const incoming = drag.overRoom === room.id && drag.fromRoom !== null && drag.fromRoom !== room.id;
  const activeCard = drag.active?.startsWith('card:') ? drag.active.slice('card:'.length) : null;
  const slot = incoming && activeCard ? ids.indexOf(activeCard) + 1 : 0;
  const m = copy.teacher.board;

  const onDragOverFiles = (e: DragEvent<HTMLElement>) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    if (!fileOver) {
      setFileOver(true);
      onDropTarget(room.id);
    }
  };
  const visible = ids.flatMap(id => {
    const a = artworks.get(id);
    return a ? [a] : [];
  });
  // 끄는 액자가 접힌 판에 머물면 잠시 뒤 펼친다(FIELD_PLAN §5.5)
  const hovering = collapsed === true && drag.overRoom === room.id && drag.fromRoom !== room.id;
  useEffect(() => {
    if (!hovering) return;
    const t = setTimeout(() => onToggle(room.id, true), config().MANAGE_DROP_EXPAND_MS);
    return () => clearTimeout(t);
  }, [hovering, onToggle, room.id]);
  const cover = (() => {
    const featured = visible.filter(a => a.featured);
    return [...featured, ...visible.filter(a => !a.featured)].slice(0, config().MANAGE_THUMB_STACK);
  })();

  return (
    <section
      ref={header.setNodeRef}
      className={[
        s.board,
        incoming ? s.incoming : '',
        fileOver ? s.fileOver : '',
        header.isDragging ? s.boardLifted : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ transform: CSS.Translate.toString(header.transform), transition: header.transition }}
      data-testid={`room-board-${room.id}`}
      data-room-id={room.id}
      data-collapsed={collapsed === null ? undefined : String(collapsed)}
      aria-label={fill(m.boardLabel, { n: two(index + 1), name: room.title })}
      onDragEnter={onDragOverFiles}
      onDragOver={onDragOverFiles}
      onDragLeave={() => setFileOver(false)}
      onDrop={() => {
        onDropTarget(room.id);
        setFileOver(false);
      }}
    >
      <header className={s.head}>
        <span className={s.no}>{two(index + 1)}</span>
        <h2 className={s.name}>{room.title}</h2>
        <span className={s.count}>{fill(copy.teacher.manage.roomCount, { n: ids.length })}</span>
        {room.bgm ? (
          <span className={s.bgm}>
            <Icon name="music" />
            {m.bgm}
          </span>
        ) : null}
        {incoming && slot > 0 ? (
          <span className={s.dropHint} data-testid="drop-hint">
            {fill(copy.teacher.dnd.dropHint, { n: slot })}
          </span>
        ) : (
          <span className={s.rail} aria-hidden="true" />
        )}
        <button
          type="button"
          ref={header.setActivatorNodeRef}
          className={s.handle}
          {...header.attributes}
          {...header.listeners}
          aria-label={fill(m.handle, { name: room.title })}
          data-testid={`board-handle-${room.id}`}
        >
          <Icon name="grip" />
        </button>
        <button
          type="button"
          className={s.edit}
          onClick={() => onEditRoom(room.id)}
          data-testid={`room-edit-${room.id}`}
        >
          <Icon name="pencil" />
          {m.edit}
        </button>
        {collapsed !== null ? (
          <button
            type="button"
            className={s.fold}
            aria-expanded={!collapsed}
            aria-label={fill(collapsed ? m.expand : m.collapse, { name: room.title })}
            onClick={() => onToggle(room.id)}
            data-testid={`room-fold-${room.id}`}
          >
            {collapsed ? (
              <span className={s.cover} aria-hidden="true">
                {cover.map(a => (
                  <Frame key={a.id} src={thumbOf(exhibitionId, a)} alt="" size="small" />
                ))}
              </span>
            ) : null}
            <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} />
          </button>
        ) : null}
      </header>
      {collapsed === true ? null : (
        <SortableContext items={ids.map(cardKey)} strategy={noMove}>
          <div ref={body.setNodeRef} className={s.wall} data-testid={`room-wall-${room.id}`}>
            {visible.length === 0 ? <p className={s.empty}>{copy.teacher.manage.emptyRoom}</p> : null}
            {visible.map((a, i) => (
              <Cell
                key={a.id}
                exhibitionId={exhibitionId}
                artwork={a}
                roomId={room.id}
                index={i}
                size={size}
                inspected={inspectedId === a.id}
                selected={selected.includes(a.id)}
                selecting={selecting}
                flashing={flashId === a.id}
                inGroup={drag.group.includes(a.id)}
                onOpen={onOpen}
                onToggleSelect={onToggleSelect}
                onNudge={onNudge}
                keys={keys}
              />
            ))}
          </div>
        </SortableContext>
      )}
    </section>
  );
};

/** 모든 전시실 판(보드). 판 순서는 끌기 상태의 임시 배열을 따른다 */
export const RoomBoards = ({ rooms, onAddRoom, collapsible = false, ...rest }: RoomBoardsProps) => {
  const drag = useDragState();
  // 휴대폰: 펼친 판(처음에는 살펴보는 작품의 판, 없으면 첫 판)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const inspectedRoom = rest.inspectedId
    ? drag.columns.find(c => c.ids.includes(rest.inspectedId ?? ''))?.roomId
    : undefined;
  const firstRoom = drag.columns[0]?.roomId;
  const isOpen = (roomId: string): boolean =>
    open.has(roomId) || (open.size === 0 && roomId === (inspectedRoom ?? firstRoom));
  const toggle = useCallback(
    (roomId: string, force?: boolean) =>
      setOpen(prev => {
        const next = new Set(
          prev.size === 0 && (inspectedRoom ?? firstRoom) ? [inspectedRoom ?? firstRoom ?? ''] : prev,
        );
        const want = force ?? !next.has(roomId);
        if (want) next.add(roomId);
        else next.delete(roomId);
        return next;
      }),
    [inspectedRoom, firstRoom],
  );
  const byId = new Map(rooms.map(r => [r.id, r] as const));
  const order = drag.columns.flatMap(c => {
    const room = byId.get(c.roomId);
    return room ? [{ room, ids: c.ids }] : [];
  });
  useEffect(() => {
    if (rest.flashId === null) return;
    document.querySelector(`[data-cell-id="${rest.flashId}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [rest.flashId]);
  return (
    <div className={s.boards} data-testid="room-boards">
      <SortableContext items={order.map(o => boardKey(o.room.id))} strategy={verticalListSortingStrategy}>
        {order.map((o, i) => (
          <Board
            key={o.room.id}
            {...rest}
            room={o.room}
            index={i}
            ids={o.ids}
            collapsed={collapsible ? !isOpen(o.room.id) : null}
            onToggle={toggle}
          />
        ))}
      </SortableContext>
      <button type="button" className={s.addRoom} onClick={onAddRoom} data-testid="add-room">
        <Icon name="plus" />
        {copy.teacher.manage.addRoom}
      </button>
    </div>
  );
};
