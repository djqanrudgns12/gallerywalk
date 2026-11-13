import { copy, fill } from '@gallery/core/copy';
import type { JSX } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './WalkNav.module.css';

export interface WalkNavProps {
  /** 현재 정지 지점/작품 순번 (1부터 시작, `{i}/{n}`의 i) */
  current: number;
  /** 전체 정지 지점/작품 수 (`{i}/{n}`의 n). 0이면 숫자를 숨긴다(작품 앞이 아님 — 광장·소개·출구) */
  total: number;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean | undefined;
  nextDisabled?: boolean | undefined;
  /** 다음이 없는 자리(출구)에서는 `다음 작품으로`를 그리지 않는다(V-57) */
  nextHidden?: boolean | undefined;
  onMap?: (() => void) | undefined;
  onSoundToggle?: (() => void) | undefined;
  soundOn?: boolean | undefined;
  onMenu?: (() => void) | undefined;
  className?: string | undefined;
}

export const WalkNav = ({
  current,
  total,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  nextHidden = false,
  onMap,
  onSoundToggle,
  soundOn = false,
  onMenu,
  className,
}: WalkNavProps): JSX.Element => {
  const safeTotal = Math.max(1, total);
  const safeCurrent = Math.min(safeTotal, Math.max(1, current));
  const pageText = fill(copy.viewer.pageOf, { page: safeCurrent, total: safeTotal });
  const hasQuickTools = Boolean(onMap || onSoundToggle || onMenu);

  return (
    <nav
      className={className ? `${s.navCluster} ${className}` : s.navCluster}
      aria-label={copy.viewer.walkNav}
    >
      {hasQuickTools ? (
        <div className={s.quickTools}>
          {onMap ? (
            <button type="button" className={s.toolBtn} onClick={onMap} aria-label={copy.viewer.map}>
              <Icon name="map" size={18} />
              <span className={s.toolLabel}>{copy.viewer.map}</span>
            </button>
          ) : null}

          {onSoundToggle ? (
            <button
              type="button"
              className={s.toolBtn}
              onClick={onSoundToggle}
              aria-label={copy.viewer.sound}
              aria-pressed={soundOn}
            >
              <Icon name={soundOn ? 'sound-on' : 'sound-off'} size={18} />
              <span className={s.toolLabel}>{copy.viewer.sound}</span>
            </button>
          ) : null}

          {onMenu ? (
            <button type="button" className={s.toolBtn} onClick={onMenu} aria-label={copy.viewer.menu}>
              <Icon name="menu" size={18} />
              <span className={s.toolLabel}>{copy.viewer.menu}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={s.stopGroup}>
        <button
          type="button"
          className={s.prevBtn}
          aria-label={copy.viewer.prevArtwork}
          onClick={onPrev}
          disabled={prevDisabled}
          data-testid="prev"
        >
          <Icon name="chevron-left" size={20} />
        </button>

        {nextHidden ? null : (
          <button
            type="button"
            className={s.nextBtn}
            onClick={onNext}
            disabled={nextDisabled}
            data-testid="next"
          >
            <span>{copy.viewer.nextArtwork}</span>
            {total > 0 ? <span className={s.count}>{pageText}</span> : null}
            <Icon name="chevron-right" size={18} />
          </button>
        )}
      </div>
    </nav>
  );
};
