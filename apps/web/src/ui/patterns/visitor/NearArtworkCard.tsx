import { copy } from '@gallery/core/copy';
import type { JSX } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './NearArtworkCard.module.css';

export interface NearArtworkCardProps {
  title: string;
  author?: string | null | undefined;
  caption?: string | null | undefined;
  featured?: boolean | undefined;
  stopLabel?: string | undefined;
  onZoom: () => void;
  className?: string | undefined;
}

export const NearArtworkCard = ({
  title,
  author,
  caption,
  featured = false,
  stopLabel,
  onZoom,
  className,
}: NearArtworkCardProps): JSX.Element => (
  <section
    className={className ? `${s.card} ${className}` : s.card}
    aria-label={title}
    data-testid="near-card"
  >
    <div className={s.info}>
      {featured || stopLabel ? (
        <div className={s.eyebrow}>
          {featured ? <span className={s.featuredBadge}>{copy.viewer.featuredBadge}</span> : null}
          {stopLabel ? <span className={s.stopLabel}>{stopLabel}</span> : null}
        </div>
      ) : null}

      <div className={s.titleRow}>
        <h2 className={s.title}>{title}</h2>
        {author ? <span className={s.author}>{author}</span> : null}
      </div>

      {caption ? <p className={s.caption}>{caption}</p> : null}
    </div>

    <button type="button" className={s.zoomBtn} onClick={onZoom}>
      <Icon name="zoom-in" size={16} />
      <span>{copy.viewer.zoomIn}</span>
    </button>
  </section>
);
