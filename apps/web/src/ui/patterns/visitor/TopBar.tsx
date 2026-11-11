import { copy, fill } from '@gallery/core/copy';
import type { JSX } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './TopBar.module.css';

export interface TopBarProps {
  title: string;
  place?: string | undefined;
  /** 함께 관람 인원 수 (0이면 copy.live.alone "혼자 둘러보는 중", 1 이상이면 copy.viewer.liveCount) */
  liveCount?: number | undefined;
  onCollection?: (() => void) | undefined;
  className?: string | undefined;
}

export const TopBar = ({
  title,
  place,
  liveCount = 0,
  onCollection,
  className,
}: TopBarProps): JSX.Element => {
  const hasPeers = liveCount > 0;
  const liveLabel = hasPeers ? fill(copy.viewer.liveCount, { n: liveCount }) : copy.live.alone;

  return (
    <header className={className ? `${s.topBar} ${className}` : s.topBar} aria-label={title}>
      <div className={s.roomPlate}>
        <span className={s.accentBar} aria-hidden="true" />
        <span className={s.title}>{title}</span>
        {place ? (
          <>
            <span className={s.sep} aria-hidden="true" />
            <span className={s.place} data-testid="place">
              {place}
            </span>
          </>
        ) : null}
      </div>

      <div className={s.rightGroup}>
        <div className={s.liveCounter} data-testid="live-count" role="status" aria-label={liveLabel}>
          <span className={hasPeers ? s.dotOnline : s.dotAlone} aria-hidden="true" />
          <span className={s.liveText}>{liveLabel}</span>
        </div>

        {onCollection ? (
          <button
            type="button"
            className={s.collectionBtn}
            onClick={onCollection}
            aria-label={copy.viewer.collection}
          >
            <Icon name="grid" size={18} />
            <span className={s.collectionLabel}>{copy.viewer.collection}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
};
