import { copy, fill } from '@gallery/core/copy';
import type { ArtworkBatch, RoomTeacher } from '@gallery/core/types';
import { useState } from 'react';
import { Icon } from '../../../ui/index.ts';
import s from './manage.module.css';

export interface BatchBarProps {
  readonly selected: readonly string[];
  readonly rooms: readonly RoomTeacher[];
  readonly currentRoomId: string | null;
  readonly onBatch: (batch: ArtworkBatch) => void;
  readonly onClear: () => void;
}

/** 여러 장을 골랐을 때 아래 띠(G-10): `숨기기` `게시` `전시실 옮기기`만 */
export const BatchBar = ({ selected, rooms, currentRoomId, onBatch, onClear }: BatchBarProps) => {
  const [choosing, setChoosing] = useState(false);
  if (selected.length === 0) return null;
  const ids = [...selected];
  const others = rooms.filter(r => r.id !== currentRoomId);
  const m = copy.teacher.manage;
  return (
    <div className={s.batch} role="toolbar" aria-label={m.batchLabel} data-testid="batch-bar">
      <span className={s.batchCount}>{fill(copy.teacher.selectedCount, { n: selected.length })}</span>
      <button type="button" className={s.batchBtn} onClick={() => onBatch({ action: 'HIDE', ids })}>
        {m.batchHide}
      </button>
      <button type="button" className={s.batchBtn} onClick={() => onBatch({ action: 'PUBLISH', ids })}>
        {m.batchPublish}
      </button>
      <span className={s.batchMove}>
        <button
          type="button"
          className={s.batchBtn}
          aria-expanded={choosing}
          disabled={others.length === 0}
          onClick={() => setChoosing(v => !v)}
        >
          {m.batchMove}
        </button>
        {choosing ? (
          <ul className={s.batchRooms} role="listbox" aria-label={m.batchMove} data-testid="batch-rooms">
            {others.map(r => (
              <li key={r.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={s.batchRoom}
                  onClick={() => {
                    setChoosing(false);
                    onBatch({ action: 'MOVE', ids, roomId: r.id });
                  }}
                >
                  {r.title}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </span>
      <button type="button" className={s.batchClose} aria-label={m.clearSelection} onClick={onClear}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
};
