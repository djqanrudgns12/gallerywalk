import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import { mediaPath, type ArtworkTeacher, type AssetRef } from '@gallery/core/types';
import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type SyntheticEvent,
} from 'react';
import { ArtworkCard } from '../../../ui/index.ts';
import { AutosaveField } from './AutosaveField.tsx';
import { cardKey } from './dnd.ts';
import { useDragState } from './ManageDnd.tsx';
import s from './manage.module.css';

/** 마우스로 길게 누르기 = 고르기(ms). 터치는 길게 누르면 끌기가 시작되고, 움직이지 않고 떼면 고르기(`dnd.ts`) */
export const LONG_PRESS_MS = config().LONG_PRESS_MS;
const DRAG_START_PX = config().DRAG_START_PX;
const MS_PER_SEC = 1000;
const SEC_PER_MIN = 60;

export const isUntitled = (a: Pick<ArtworkTeacher, 'title'>): boolean => a.title.trim() === '';
export const isBlurry = (a: Pick<ArtworkTeacher, 'warnings'>): boolean => a.warnings.includes('LOW_RES');

/** 썸네일(`thumb` 파생, 없으면 첫 파생) */
export const thumbOf = (exhibitionId: string, a: ArtworkTeacher): string | null => {
  const ref: AssetRef | null = a.image?.asset ?? a.pages?.[0]?.asset ?? a.audio?.cover ?? null;
  if (!ref) return null;
  const v = ref.variants.find(x => x.name === 'thumb') ?? ref.variants[0];
  return v ? mediaPath(exhibitionId, ref.assetId, v) : null;
};

const durationLabel = (ms: number): string => {
  const sec = Math.round(ms / MS_PER_SEC);
  return `${Math.floor(sec / SEC_PER_MIN)}:${String(sec % SEC_PER_MIN).padStart(2, '0')}`;
};

const warningOf = (a: ArtworkTeacher): string => {
  if (a.status === 'FAILED') return errorCopy[a.failCode ?? 'E_FILE_BROKEN'];
  if (isUntitled(a)) return copy.teacher.warnUntitled;
  if (isBlurry(a)) return copy.teacher.warnBlurry;
  return '';
};

/** 칸 안의 입력·버튼에서 시작한 누르기는 끌기·고르기로 보지 않는다 */
const fromControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('input,textarea,button') !== null;

export interface CardFaceProps {
  readonly exhibitionId: string;
  readonly artwork: ArtworkTeacher;
  readonly selected: boolean;
  readonly dragging: boolean;
}

/** 카드 한 장의 모양(격자 칸·끄는 동안 손끝을 따라다니는 모양이 같이 쓴다) */
export const CardFace = ({ exhibitionId, artwork: a, selected, dragging }: CardFaceProps) => {
  const pages = a.pages?.length ?? 1;
  return (
    <ArtworkCard
      id={a.id}
      title={isUntitled(a) ? copy.teacher.manage.untitled : a.title}
      author={a.author}
      form={a.form}
      pageCount={pages}
      status={a.status}
      featured={a.featured}
      warnings={a.warnings}
      failCode={a.failCode}
      thumbnailUrl={thumbOf(exhibitionId, a)}
      durationLabel={a.audio ? durationLabel(a.audio.durationMs) : null}
      darkMat={(a.image?.analysis.edgeLuma ?? 0) >= config().MAT_DARK_EDGE_LUMA}
      selected={selected}
      dragging={dragging}
      formLabel={copy.teacher.forms[a.form]}
      pageLabel={fill(copy.teacher.pageCount, { n: pages })}
      statusLabel={copy.teacher.status[a.status]}
      warningLabel={warningOf(a)}
      draggingLabel={copy.teacher.draggingBadge}
    />
  );
};

export interface ArtworkBoardProps {
  readonly exhibitionId: string;
  readonly artworks: readonly ArtworkTeacher[];
  readonly selected: readonly string[];
  readonly flashId: string | null;
  readonly onOpen: (id: string) => void;
  readonly onToggleSelect: (id: string) => void;
  readonly onRename: (id: string, title: string) => Promise<void>;
  readonly onNudge: (id: string, delta: number) => void;
}

interface CellProps {
  readonly exhibitionId: string;
  readonly artwork: ArtworkTeacher;
  readonly index: number;
  readonly selected: boolean;
  readonly selecting: boolean;
  readonly flashing: boolean;
  readonly editing: boolean;
  readonly onEdit: (id: string | null) => void;
  readonly onOpen: (id: string) => void;
  readonly onToggleSelect: (id: string) => void;
  readonly onRename: (id: string, title: string) => Promise<void>;
  readonly onNudge: (id: string, delta: number) => void;
}

const Cell = ({
  exhibitionId,
  artwork: a,
  index,
  selected,
  selecting,
  flashing,
  editing,
  onEdit,
  onOpen,
  onToggleSelect,
  onRename,
  onNudge,
}: CellProps) => {
  const drag = useDragState();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({
      id: cardKey(a.id),
      disabled: editing,
      attributes: { roleDescription: copy.teacher.dnd.roleCard },
    });
  const press = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);

  useEffect(() => () => clearTimeout(pressTimer.current), []);

  const ref = (el: HTMLDivElement | null) => {
    setNodeRef(el);
    setActivatorNodeRef(el);
  };

  // 끌기 센서(마우스·터치·키보드)의 시작 처리. 칸 안의 입력·버튼에서 시작한 것은 넘기지 않는다
  const sensor = (name: string) => (e: SyntheticEvent) => {
    if (fromControl(e.target)) return;
    (listeners?.[name] as ((ev: SyntheticEvent) => void) | undefined)?.(e);
  };

  // 마우스 길게 누르기 → 고르기(터치는 끌기 센서가 맡는다)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || editing || fromControl(e.target)) return;
    press.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      if (press.current === null) return;
      press.current = null;
      suppressClick.current = true;
      onToggleSelect(a.id);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointer !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START_PX) return;
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
    if (e.shiftKey || selecting) {
      onToggleSelect(a.id);
      return;
    }
    if ((e.target as Element).closest('h3')) {
      onEdit(a.id);
      return;
    }
    onOpen(a.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    // 키보드로 끄는 중이면 Space·Enter·화살표는 끌기 센서의 것
    if (drag.active === null) {
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        onNudge(a.id, e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onOpen(a.id);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        onToggleSelect(a.id);
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        onEdit(a.id);
        return;
      }
    }
    sensor('onKeyDown')(e);
  };

  const cls = [
    s.cell,
    editing ? s.cellEditing : '',
    flashing ? s.cellFlash : '',
    isDragging ? s.cellDragging : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      ref={ref}
      {...attributes}
      // 편집 중에는 끌기만 끈다 — `aria-disabled`가 붙으면 안의 제목 칸까지 잠긴 것으로 알려진다
      aria-disabled={editing ? undefined : attributes['aria-disabled']}
      className={cls}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-cell-id={a.id}
      data-testid={`cell-${index}`}
      role="button"
      tabIndex={0}
      aria-pressed={selecting ? selected : undefined}
      aria-label={isUntitled(a) ? copy.teacher.manage.untitled : a.title}
      onMouseDown={sensor('onMouseDown')}
      onTouchStart={sensor('onTouchStart')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <CardFace exhibitionId={exhibitionId} artwork={a} selected={selected} dragging={isDragging} />
      {editing ? (
        <div className={s.titleEdit}>
          <AutosaveField
            label={copy.teacher.panel.title}
            hideLabel
            autoFocus
            value={a.title}
            maxChars={config().ARTWORK_TITLE_MAX_CHARS}
            onSave={next => onRename(a.id, next)}
            onDone={() => onEdit(null)}
            testId="inline-title"
          />
        </div>
      ) : null}
    </div>
  );
};

/**
 * 작품 격자(G-10, P5-4). R-7 `ArtworkCard`를 칸마다 감싸 아래를 더한다(`ArtworkGrid`는 카드마다 감쌀 자리가 없어 쓰지 않음).
 * - 카드 제목을 누르면 그 자리에서 고친다(0.6초 뒤 저장, Enter·Esc로 끝).
 * - 카드를 누르면 작품 패널. Shift+누르기·길게 누르기(또는 Space)로 여러 장 고르기, 고른 것이 있으면 누를 때마다 고르기.
 * - 순서: 끌어서 다른 카드 자리에 놓기(마우스·길게 누른 손가락·키보드 `M`, `ManageDnd`), 또는 Alt+←/→·패널의 `앞으로`·`뒤로`.
 *   끌어서 전시실 칩 위에 놓으면 그 전시실로 옮긴다.
 */
export const ArtworkBoard = ({
  exhibitionId,
  artworks,
  selected,
  flashId,
  onOpen,
  onToggleSelect,
  onRename,
  onNudge,
}: ArtworkBoardProps) => {
  const [editing, setEditing] = useState<string | null>(null);
  const selecting = selected.length > 0;

  useEffect(() => {
    if (flashId === null) return;
    document.querySelector(`[data-cell-id="${flashId}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [flashId]);

  if (artworks.length === 0)
    return (
      <p className={s.emptyRoom} data-testid="room-empty">
        {copy.teacher.manage.emptyRoom}
      </p>
    );

  return (
    <SortableContext items={artworks.map(a => cardKey(a.id))} strategy={rectSortingStrategy}>
      <div className={s.board} data-testid="artwork-board">
        {artworks.map((a, i) => (
          <Cell
            key={a.id}
            exhibitionId={exhibitionId}
            artwork={a}
            index={i}
            selected={selected.includes(a.id)}
            selecting={selecting}
            flashing={flashId === a.id}
            editing={editing === a.id}
            onEdit={setEditing}
            onOpen={onOpen}
            onToggleSelect={onToggleSelect}
            onRename={onRename}
            onNudge={onNudge}
          />
        ))}
      </div>
    </SortableContext>
  );
};
