import { copy, fill } from '@gallery/core/copy';
import { type JSX, useState } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './ZoomCaption.module.css';

export interface ZoomCaptionProps {
  title: string;
  author?: string | null | undefined;
  caption?: string | null | undefined;
  description?: string | null | undefined;
  featured?: boolean | undefined;
  pageInfo?: { page: number; total: number } | null | undefined;
  defaultExpanded?: boolean | undefined;
  onClose: () => void;
  onReact?: (() => void) | undefined;
  className?: string | undefined;
}

export const ZoomCaption = ({
  title,
  author,
  caption,
  description,
  featured = false,
  pageInfo,
  defaultExpanded = false,
  onClose,
  onReact,
  className,
}: ZoomCaptionProps): JSX.Element => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasDescription = Boolean(description && description.trim().length > 0);

  return (
    <section
      className={className ? `${s.container} ${className}` : s.container}
      role="dialog"
      aria-label={title}
      data-testid="zoom-caption"
    >
      <div className={s.topRow}>
        <button
          type="button"
          className={s.closeBtn}
          onClick={onClose}
          aria-label={copy.viewer.close}
          data-testid="zoom-close"
        >
          <Icon name="close" size={16} />
          <span>{copy.viewer.close}</span>
        </button>
      </div>

      <div className={s.card}>
        <div className={s.head}>
          <div className={s.titleGroup}>
            {featured || pageInfo ? (
              <div className={s.eyebrow}>
                {featured ? <span className={s.featuredBadge}>{copy.viewer.featuredBadge}</span> : null}
                {pageInfo ? (
                  <span className={s.pageInfo}>
                    {fill(copy.viewer.pageOf, { page: pageInfo.page, total: pageInfo.total })}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className={s.titleRow}>
              <h2 className={s.title}>{title}</h2>
              {author ? <span className={s.author}>{author}</span> : null}
            </div>

            {caption ? <p className={s.caption}>{caption}</p> : null}
          </div>

          {hasDescription || onReact ? (
            <div className={s.actions}>
              {hasDescription ? (
                <button
                  type="button"
                  className={s.toggleBtn}
                  aria-expanded={expanded}
                  onClick={() => setExpanded(prev => !prev)}
                  data-testid="zoom-toggle-desc"
                >
                  <span>{expanded ? copy.viewer.collapseMore : copy.viewer.more}</span>
                </button>
              ) : null}

              {onReact ? (
                <button type="button" className={s.reactBtn} onClick={onReact} data-testid="zoom-react">
                  <span>{copy.viewer.react}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {hasDescription && expanded ? (
          <div className={s.expandedDesc} data-testid="zoom-expanded-desc">
            <p className={s.descriptionText}>{description}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
};
