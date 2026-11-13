import { copy, fill } from '@gallery/core/copy';
import type { JSX, ReactNode } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './TopBar.module.css';

export interface TopBarProps {
  title: string;
  place?: string | undefined;
  /** 작품 앞에서 현재 전시실 아래 보일 순번 */
  progress?: string | undefined;
  /** 함께 관람 인원 수. 0이면 인원 표시를 두지 않는다(V-54), 1 이상이면 copy.viewer.liveCount */
  liveCount?: number | undefined;
  onCollection?: (() => void) | undefined;
  /** 오른쪽 위 아이콘 묶음 끝에 더 둘 단추들(지도·소리·미리 보기 닫기 — 안내판 세 자리 규칙, V-54) */
  actions?: ReactNode;
  className?: string | undefined;
}

export const TopBar = ({
  title,
  place,
  progress,
  liveCount = 0,
  onCollection,
  actions,
  className,
}: TopBarProps): JSX.Element => {
  // 혼자일 때는 인원 표시를 두지 않는다(안내판을 줄임, V-54). 함께 보는 사람이 있을 때만
  const hasPeers = liveCount > 0;
  const liveLabel = fill(copy.viewer.liveCount, { n: liveCount });

  return (
    <header className={className ? `${s.topBar} ${className}` : s.topBar} aria-label={title}>
      <div className={s.leftGroup}>
        <div className={s.roomPlate}>
          {place ? (
            <span className={s.place} data-testid="place">
              {place}
            </span>
          ) : (
            <span className={s.title}>{title}</span>
          )}
          {progress ? <span className={s.progress}>{progress}</span> : null}
        </div>
        {hasPeers ? (
          <div className={s.liveCounter} data-testid="live-count" role="status" aria-label={liveLabel}>
            <span className={s.dotOnline} aria-hidden="true" />
            <span className={s.liveText}>{liveLabel}</span>
          </div>
        ) : null}
      </div>

      <div className={s.rightGroup}>
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
        {actions}
      </div>
    </header>
  );
};
