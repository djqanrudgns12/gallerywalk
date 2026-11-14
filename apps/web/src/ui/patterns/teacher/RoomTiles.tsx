import type { JSX } from 'react';
import { useMemo } from 'react';
import s from './RoomTiles.module.css';
import { rovingIndex, useRovingRadio } from './useRovingRadio.ts';

export interface RoomTile {
  id: string;
  /** 큰 번호(예: 01) */
  no: string;
  /** 번호 아래 작은 글(예: 8점) */
  caption?: string | undefined;
  /** 화면 낭독기 이름(예: 02 3·1 운동, 12점). 없으면 번호와 작은 글을 읽는다. */
  label?: string | undefined;
}

export interface RoomTilesProps {
  rooms: readonly RoomTile[];
  /** 고른 전시실 id(없으면 null) */
  value: string | null;
  onChange: (roomId: string) => void;
  /** 묶음 이름(예: 전시실) */
  label: string;
  className?: string | undefined;
}

/**
 * 전시실 번호 타일(01~05). 고른 것은 남색 면(G-32 ④, 살펴보기 칸의 보조 조작).
 * 라디오 묶음이라 Tab에는 고른 타일 하나만 들어가고 화살표로 옮긴다. 타일 높이 48px.
 */
export const RoomTiles = ({ rooms, value, onChange, label, className }: RoomTilesProps): JSX.Element => {
  const ids = useMemo(() => rooms.map(r => r.id), [rooms]);
  const { refs, onKeyDown } = useRovingRadio(ids, onChange);
  const tabAt = rovingIndex(ids, value);

  return (
    <div className={[s.tiles, className].filter(Boolean).join(' ')} role="radiogroup" aria-label={label}>
      {rooms.map((room, i) => {
        const on = room.id === value;
        return (
          <button
            key={room.id}
            ref={el => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={room.label}
            tabIndex={i === tabAt ? 0 : -1}
            className={[s.tile, on && s.on].filter(Boolean).join(' ')}
            data-room-id={room.id}
            onClick={() => onChange(room.id)}
            onKeyDown={e => onKeyDown(e, i)}
          >
            <b className={s.no}>{room.no}</b>
            {room.caption ? <small className={s.caption}>{room.caption}</small> : null}
          </button>
        );
      })}
    </div>
  );
};
