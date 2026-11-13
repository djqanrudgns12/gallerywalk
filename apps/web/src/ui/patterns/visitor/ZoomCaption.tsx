import { copy, fill } from '@gallery/core/copy';
import { type JSX, useId, useState } from 'react';
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
  /** 보내지 못한 반응이 남았으면 반응 단추에 작은 점 */
  reactPending?: boolean | undefined;
  /** 캡션 위 `닫기`를 숨김(걷기 화면은 화면 오른쪽 위에 따로 둔다, PRD 9.2) */
  hideClose?: boolean | undefined;
  /**
   * 휴대폰 세로에서 한 줄로 접었다 펴기(PRD 9.5 "접힘 1줄 → 펼침", V-15). 기본 켬 — 처음엔 접힌 한 줄(제목·작가·반응 단추)만.
   * 접힘 줄과 카드 숨김은 CSS가 휴대폰 세로에서만 적용하므로 넓은 화면은 늘 펼친 카드다. 2D 화면처럼 자기 접기가 있으면 끈다
   */
  foldable?: boolean | undefined;
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
  hideClose = false,
  reactPending = false,
  foldable = true,
  className,
}: ZoomCaptionProps): JSX.Element => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [folded, setFolded] = useState(true);
  const cardId = useId();
  const hasDescription = Boolean(description && description.trim().length > 0);
  const pendingDot = reactPending ? (
    <span className={s.pendingDot} role="img" aria-label={copy.viewer.reactPending} />
  ) : null;

  return (
    <section
      className={className ? `${s.container} ${className}` : s.container}
      role="dialog"
      aria-label={title}
      data-testid="zoom-caption"
      data-folded={foldable ? (folded ? '1' : '0') : undefined}
    >
      {hideClose ? null : (
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
      )}

      {foldable ? (
        <div className={s.foldRow}>
          <button
            type="button"
            className={s.foldBtn}
            aria-expanded={!folded}
            aria-controls={cardId}
            onClick={() => setFolded(prev => !prev)}
            data-testid="zoom-fold"
          >
            {folded ? (
              <span className={s.foldText}>
                <span className={s.foldTitle}>{title}</span>
                {author ? <span className={s.foldAuthor}>{author}</span> : null}
              </span>
            ) : null}
            <span className={folded ? s.foldHint : `${s.foldHint} ${s.foldHintOpen}`}>
              {folded ? copy.viewer.captionUnfold : copy.viewer.captionFold}
              <Icon name="chevron-right" size={16} className={s.foldIcon} />
            </span>
          </button>
          {folded && onReact ? (
            <button
              type="button"
              className={s.reactBtn}
              onClick={onReact}
              data-testid="zoom-fold-react"
              data-pending={reactPending ? '1' : undefined}
            >
              <span>{copy.viewer.react}</span>
              {pendingDot}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={s.card} id={cardId} data-testid="zoom-card">
        <div className={s.text}>
          {featured || pageInfo ? (
            <p className={s.eyebrow}>
              {featured ? <span className={s.featuredBadge}>{copy.viewer.featuredBadge}</span> : null}
              {pageInfo ? (
                <span className={s.pageInfo}>
                  {fill(copy.viewer.pageOf, { page: pageInfo.page, total: pageInfo.total })}
                </span>
              ) : null}
            </p>
          ) : null}

          <h2 className={s.title}>{title}</h2>
          {author ? <p className={s.author}>{author}</p> : null}
          {caption ? <p className={s.caption}>{caption}</p> : null}
        </div>

        {/* 펼친 설명은 단추 줄 위에 — 캡션이 아래에 붙어 위로 자라므로 단추 자리가 흔들리지 않는다 */}
        {hasDescription && expanded ? (
          <div className={s.expandedDesc} data-testid="zoom-expanded-desc">
            <p className={s.descriptionText}>{description}</p>
          </div>
        ) : null}

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
              <button
                type="button"
                className={s.reactBtn}
                onClick={onReact}
                data-testid="zoom-react"
                data-pending={reactPending ? '1' : undefined}
              >
                <span>{copy.viewer.react}</span>
                {pendingDot}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
};
