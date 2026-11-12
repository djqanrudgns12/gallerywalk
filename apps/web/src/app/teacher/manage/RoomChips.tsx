import { copy, fill } from '@gallery/core/copy';
import type { RoomTeacher } from '@gallery/core/types';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { Icon } from '../../../ui/index.ts';
import { chipKey } from './dnd.ts';
import { useDragState } from './ManageDnd.tsx';
import { moveItem } from './teacherStore.ts';
import s from './manage.module.css';

export interface RoomChipsProps {
  readonly rooms: readonly RoomTeacher[];
  readonly currentId: string | null;
  /** 전시실마다 작품 수 */
  readonly counts: ReadonlyMap<string, number>;
  readonly onPick: (roomId: string) => void;
  /** 지금 전시실 칩을 다시 누르면 전시실 시트 */
  readonly onEdit: (roomId: string) => void;
  /** Alt+←/→ 한 칸(끌어 놓기는 `ManageDnd`가 순서를 정한다) */
  readonly onReorder: (ids: readonly string[]) => void;
  readonly onAdd: () => void;
}

interface ChipProps {
  readonly room: RoomTeacher;
  readonly index: number;
  readonly current: boolean;
  readonly count: number;
  readonly onPick: (roomId: string) => void;
  readonly onEdit: (roomId: string) => void;
  readonly onNudge: (roomId: string, delta: number) => void;
}

/** 칩 겉모양(끄는 동안 손끝을 따라다니는 모양과 같이 쓴다) */
export const ChipFace = ({ title, count, current }: { title: string; count: number; current: boolean }) => (
  <>
    <span className={s.chipTitle}>{title}</span>
    <span className={s.chipCount}>{fill(copy.teacher.manage.roomCount, { n: count })}</span>
    {current ? <Icon name="menu" size={14} className={s.chipEdit} /> : null}
  </>
);

const Chip = ({ room: r, index, current, count, onPick, onEdit, onNudge }: ChipProps) => {
  const drag = useDragState();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: chipKey(r.id),
    attributes: { roleDescription: copy.teacher.dnd.roleRoom },
  });
  const sensor = (name: string) => (e: SyntheticEvent) =>
    (listeners?.[name] as ((ev: SyntheticEvent) => void) | undefined)?.(e);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (drag.active === null && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      onNudge(r.id, e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    // 키보드로 끄는 중에는 Space·Enter가 놓기다(눌러 고르기가 되지 않게)
    if (drag.active !== null && (e.key === ' ' || e.key === 'Enter')) e.preventDefault();
    sensor('onKeyDown')(e);
  };

  const cls = [
    s.chip,
    current ? s.chipCurrent : '',
    isDragging ? s.chipDragging : '',
    drag.overRoom === r.id ? s.chipDrop : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      type="button"
      role="tab"
      aria-selected={current}
      aria-pressed={undefined}
      aria-haspopup={current ? 'dialog' : undefined}
      className={cls}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-room-chip={r.id}
      data-testid={`room-chip-${index}`}
      title={current ? copy.teacher.manage.roomEditHint : undefined}
      onMouseDown={sensor('onMouseDown')}
      onTouchStart={sensor('onTouchStart')}
      onClick={() => {
        if (drag.active !== null) return;
        if (current) onEdit(r.id);
        else onPick(r.id);
      }}
      onKeyDown={onKeyDown}
    >
      <ChipFace title={r.title} count={count} current={current} />
    </button>
  );
};

/**
 * 전시실 칩 줄(G-10·G-12). 누르면 그 전시실, 지금 전시실을 다시 누르면 시트. 끝의 `+`로 새 전시실.
 * 순서: 끌기(마우스·길게 누른 손가락·키보드 `M`, `ManageDnd`) 또는 칩에 초점을 두고 Alt+←/→.
 * 작품 카드를 끌어 칩 위에 놓으면 그 전시실로 옮긴다(칩은 끌어 놓을 곳이기도 하다).
 */
export const RoomChips = ({ rooms, currentId, counts, onPick, onEdit, onReorder, onAdd }: RoomChipsProps) => {
  const ids = rooms.map(r => r.id);
  const nudge = (id: string, delta: number) => {
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    onReorder(moveItem(ids, from, to));
  };

  return (
    <div
      className={s.chips}
      role="tablist"
      aria-label={copy.teacher.manage.roomsLabel}
      data-testid="room-chips"
    >
      <SortableContext items={rooms.map(r => chipKey(r.id))} strategy={horizontalListSortingStrategy}>
        {rooms.map((r, i) => (
          <Chip
            key={r.id}
            room={r}
            index={i}
            current={r.id === currentId}
            count={counts.get(r.id) ?? 0}
            onPick={onPick}
            onEdit={onEdit}
            onNudge={nudge}
          />
        ))}
      </SortableContext>
      <button
        type="button"
        className={`${s.chip} ${s.chipAdd}`}
        aria-label={copy.teacher.manage.addRoom}
        data-testid="room-add"
        onClick={onAdd}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
};
