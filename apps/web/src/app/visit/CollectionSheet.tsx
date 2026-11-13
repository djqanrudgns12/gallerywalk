import { copy } from '@gallery/core/copy';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon.tsx';
import type { CardText } from '../../viewer/textures/textCard.ts';
import type { CollectionRoom } from './collection.ts';
import s from './CollectionSheet.module.css';

/**
 * 모아 보기(G-04, PLAN §7.3): 전체 화면 시트. 위 전시실 탭(밑줄형, 가로로 밀기) + 썸네일 격자(휴대폰 3·태블릿 4·데스크톱 6열).
 * 썸네일은 얇은 액자 테 안에 둔다(F8 V-55). 글·소리 작품은 작은 종이 카드. 누르면 시트를 닫고 그 작품 앞으로 걸어가 바로 크게 본다(부르는 쪽).
 */
export interface CollectionSheetProps {
  readonly rooms: readonly CollectionRoom[];
  readonly roomTitle: (roomId: string) => string;
  readonly titleOf: (artworkId: string) => string;
  readonly thumbOf: (artworkId: string) => string | null;
  readonly cards: ReadonlyMap<string, CardText>;
  /** 처음 열 전시실(지금 있는 곳) */
  readonly initialRoomId: string | null;
  readonly onPick: (artworkId: string, stopIndex: number) => void;
  readonly onClose: () => void;
}

export const CollectionSheet = ({
  rooms,
  roomTitle,
  titleOf,
  thumbOf,
  cards,
  initialRoomId,
  onPick,
  onClose,
}: CollectionSheetProps) => {
  const [roomId, setRoomId] = useState(
    () => rooms.find(r => r.roomId === initialRoomId)?.roomId ?? rooms[0]?.roomId ?? null,
  );
  const room = rooms.find(r => r.roomId === roomId) ?? rooms[0];
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', key, { capture: true });
    return () => window.removeEventListener('keydown', key, { capture: true });
  }, [onClose]);
  return (
    <section
      className={s.sheet}
      role="dialog"
      aria-modal="true"
      aria-label={copy.viewer.collection}
      data-testid="collection-sheet"
    >
      <header className={s.head}>
        <h2 className={s.title}>{copy.viewer.collection}</h2>
        <button
          ref={closeRef}
          type="button"
          className={s.close}
          onClick={onClose}
          aria-label={copy.viewer.close}
        >
          <Icon name="close" />
          <span>{copy.viewer.close}</span>
        </button>
      </header>
      {rooms.length > 1 && (
        <div className={s.tabs} role="tablist" aria-label={copy.viewer.collection}>
          {rooms.map(r => (
            <button
              key={r.roomId}
              type="button"
              role="tab"
              aria-selected={r.roomId === room?.roomId}
              className={s.tab}
              onClick={() => setRoomId(r.roomId)}
            >
              {roomTitle(r.roomId)}
            </button>
          ))}
        </div>
      )}
      <ul className={s.grid} role="list">
        {room?.items.map(it => {
          const card = cards.get(it.artworkId);
          const thumb = thumbOf(it.artworkId);
          const title = titleOf(it.artworkId);
          return (
            <li key={it.artworkId}>
              <button
                type="button"
                className={s.item}
                onClick={() => onPick(it.artworkId, it.stopIndex)}
                data-testid="collection-item"
              >
                <span className={s.frame}>
                  {thumb ? (
                    <img className={s.thumb} src={thumb} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className={s.paper} aria-hidden>
                      {card?.kind === 'AUDIO' ? (
                        <Icon name="sound-on" />
                      ) : (
                        <span className={s.paperTitle}>{title}</span>
                      )}
                    </span>
                  )}
                </span>
                <span className={s.caption}>{title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
