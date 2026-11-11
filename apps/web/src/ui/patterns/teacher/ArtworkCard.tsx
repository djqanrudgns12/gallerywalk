import { copy, errorCopy, fill } from '@gallery/core/copy';
import type { ErrorCode } from '@gallery/core/errors';
import type { ArtworkForm, ArtworkStatus, ArtworkWarning } from '@gallery/core/types';
import type { JSX } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './ArtworkCard.module.css';

export interface ArtworkCardProps {
  id: string;
  title: string;
  author?: string | null | undefined;
  form: ArtworkForm;
  pageCount?: number | undefined;
  status: ArtworkStatus;
  featured?: boolean | undefined;
  warnings?: readonly ArtworkWarning[] | undefined;
  failCode?: ErrorCode | null | undefined;
  thumbnailUrl?: string | null | undefined;
  durationLabel?: string | null | undefined;
  darkMat?: boolean | undefined;
  selected?: boolean | undefined;
  dragging?: boolean | undefined;
  formLabel?: string | undefined;
  pageLabel?: string | undefined;
  statusLabel?: string | undefined;
  warningLabel?: string | undefined;
  draggingLabel?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  className?: string | undefined;
}

const defaultStatusLabel = (status: ArtworkStatus, failCode?: ErrorCode | null): string => {
  switch (status) {
    case 'PUBLISHED':
      return copy.viewer.more;
    case 'PROCESSING':
      return copy.poster.preparing;
    case 'HIDDEN':
      return copy.closed.draft;
    case 'FAILED':
      return failCode ? errorCopy[failCode] : errorCopy.E_FILE_BROKEN;
  }
};

const defaultWarningLabel = (
  warnings: readonly ArtworkWarning[] | undefined,
  failCode?: ErrorCode | null,
): string | null => {
  if (warnings && warnings.length > 0) {
    const first = warnings[0];
    if (first === 'LOW_RES') return errorCopy.E_FILE_TOO_SMALL;
    if (first === 'MOSTLY_SILENT') return errorCopy.E_AUDIO_LENGTH;
  }
  if (failCode) return errorCopy[failCode];
  return null;
};

const FrameArtPreview = ({
  form,
  title,
  thumbnailUrl,
  durationLabel,
}: {
  form: ArtworkForm;
  title: string;
  thumbnailUrl?: string | null | undefined;
  durationLabel?: string | null | undefined;
}): JSX.Element => {
  if (thumbnailUrl) {
    return <img className={s.thumbImg} src={thumbnailUrl} alt={title} />;
  }

  switch (form) {
    case 'SOUND':
      return (
        <svg className={s.miniArt} viewBox="0 0 152 76" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect
            x="2"
            y="6"
            width="54"
            height="64"
            rx="2"
            fill="var(--accent)"
            stroke="var(--brass-border)"
            strokeWidth="1"
          />
          <circle cx="29" cy="38" r="14" fill="var(--brass-soft)" />
          <polygon points="26,32 36,38 26,44" fill="var(--accent)" />
          <rect x="66" y="34" width="4" height="16" rx="1" fill="var(--brass-border)" />
          <rect x="74" y="28" width="4" height="28" rx="1" fill="var(--brass-border)" />
          <rect x="82" y="32" width="4" height="20" rx="1" fill="var(--brass-border)" />
          <rect x="90" y="22" width="4" height="36" rx="1" fill="var(--brass-soft)" />
          <rect x="98" y="30" width="4" height="24" rx="1" fill="var(--brass-border)" />
          <rect x="106" y="36" width="4" height="14" rx="1" fill="var(--surface-oak)" />
          <rect x="114" y="33" width="4" height="18" rx="1" fill="var(--surface-oak)" />
          {durationLabel ? (
            <text x="146" y="66" textAnchor="end" fill="var(--surface-oak)" fontSize="9" fontWeight="600">
              {durationLabel}
            </text>
          ) : null}
        </svg>
      );

    case 'TEXTCARD':
    case 'MULTIPAGE':
      return (
        <svg className={s.miniArt} viewBox="0 0 76 98" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect width="76" height="98" fill="var(--plate-bg)" />
          <line x1="14" y1="20" x2="62" y2="20" stroke="var(--brass-border)" strokeWidth="1.2" />
          <line x1="10" y1="32" x2="64" y2="32" stroke="var(--plate-ink-sub)" strokeWidth="1.5" />
          <line x1="10" y1="40" x2="58" y2="40" stroke="var(--plate-ink-sub)" strokeWidth="1.5" />
          <line x1="10" y1="48" x2="62" y2="48" stroke="var(--plate-ink-sub)" strokeWidth="1.5" />
          <line x1="10" y1="62" x2="64" y2="62" stroke="var(--plate-ink-sub)" strokeWidth="1.5" />
          <line x1="10" y1="70" x2="52" y2="70" stroke="var(--plate-ink-sub)" strokeWidth="1.5" />
        </svg>
      );

    case 'TALL':
      return (
        <>
          <svg
            className={s.miniArt}
            viewBox="0 0 60 112"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect width="60" height="112" fill="var(--plate-bg)" />
            <rect
              x="4"
              y="4"
              width="52"
              height="28"
              fill="var(--accent-soft)"
              stroke="var(--accent)"
              strokeWidth="1"
            />
            <rect
              x="4"
              y="36"
              width="52"
              height="30"
              fill="var(--brass-soft)"
              stroke="var(--brass)"
              strokeWidth="1"
            />
            <rect
              x="4"
              y="70"
              width="52"
              height="28"
              fill="var(--accent-plum-soft)"
              stroke="var(--accent-plum)"
              strokeWidth="1"
            />
          </svg>
          <span className={s.tallContinueStrip}>{copy.viewer.continueReading}</span>
        </>
      );

    case 'PANORAMA':
      return (
        <svg className={s.miniArt} viewBox="0 0 190 66" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect width="190" height="66" fill="var(--accent-soft)" />
          <polygon points="0,48 38,20 76,48" fill="var(--plate-edge)" />
          <polygon points="54,48 102,14 148,48" fill="var(--plate-ink-sub)" />
          <polygon points="122,48 158,24 190,48" fill="var(--plate-edge)" />
          <rect x="0" y="46" width="190" height="20" fill="var(--surface-wall)" />
        </svg>
      );

    case 'SQUARE':
      return (
        <svg className={s.miniArt} viewBox="0 0 90 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect width="90" height="90" fill="var(--surface-marble)" />
          <path d="M22 76 V34 H68 V76 H54 V50 A9 9 0 0 0 36 50 V76 Z" fill="var(--frame-outer)" />
          <circle cx="45" cy="22" r="8" fill="var(--danger)" />
        </svg>
      );

    case 'PORTRAIT':
      return (
        <svg className={s.miniArt} viewBox="0 0 76 104" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect width="76" height="104" fill="var(--surface-wall)" />
          <line x1="18" y1="18" x2="18" y2="62" stroke="var(--plate-ink)" strokeWidth="2" />
          <line x1="28" y1="18" x2="28" y2="56" stroke="var(--plate-ink-sub)" strokeWidth="1.5" />
          <line x1="38" y1="18" x2="38" y2="60" stroke="var(--plate-ink-sub)" strokeWidth="1.5" />
          <rect x="50" y="48" width="10" height="10" fill="var(--danger)" />
        </svg>
      );

    case 'LANDSCAPE':
      return (
        <svg className={s.miniArt} viewBox="0 0 140 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect width="140" height="80" fill="var(--surface-wall)" />
          <line x1="8" y1="20" x2="132" y2="20" stroke="var(--brass)" strokeWidth="1.2" />
          <rect x="86" y="26" width="44" height="44" fill="var(--surface-oak)" />
          <line x1="8" y1="30" x2="78" y2="30" stroke="var(--plate-ink)" strokeWidth="2" />
          <line x1="8" y1="40" x2="78" y2="40" stroke="var(--plate-ink-sub)" strokeWidth="1.5" />
          <line x1="8" y1="50" x2="78" y2="50" stroke="var(--plate-ink-sub)" strokeWidth="1.5" />
          <line x1="8" y1="60" x2="60" y2="60" stroke="var(--plate-ink-sub)" strokeWidth="1.5" />
        </svg>
      );
  }
};

export const ArtworkCard = ({
  id,
  title,
  author,
  form,
  pageCount = 1,
  status,
  featured = false,
  warnings,
  failCode,
  thumbnailUrl,
  durationLabel,
  darkMat = false,
  selected = false,
  dragging = false,
  formLabel,
  pageLabel,
  statusLabel,
  warningLabel,
  draggingLabel,
  onSelect,
  className,
}: ArtworkCardProps): JSX.Element => {
  const resolvedFormLabel = formLabel ?? (form === 'SOUND' ? copy.viewer.sound : form);
  const resolvedPageLabel = pageLabel ?? fill(copy.viewer.pageOf, { page: 1, total: Math.max(1, pageCount) });
  const resolvedStatusLabel = statusLabel ?? defaultStatusLabel(status, failCode);
  const resolvedWarnLabel = warningLabel ?? defaultWarningLabel(warnings, failCode);

  const cardClasses = [
    s.card,
    selected ? s.cardSelected : '',
    dragging ? s.cardDragging : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const frameClass = `${s.miniFrame} ${s[`frame_${form}`] ?? s.frame_LANDSCAPE}`;
  const matClass = [s.miniMat, darkMat ? s.miniMatDark : '', form === 'TALL' ? s.miniMatTight : '']
    .filter(Boolean)
    .join(' ');
  const stateChipClass = `${s.stateChip} ${s[`state_${status}`] ?? s.state_PUBLISHED}`;

  return (
    <article
      className={cardClasses}
      aria-label={title}
      data-testid={`artwork-card-${id}`}
      data-form={form}
      data-status={status}
      data-selected={selected ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      onClick={() => onSelect?.(id)}
    >
      <div className={s.wallStage}>
        {selected || featured ? (
          <div className={s.stageTopLeft}>
            {selected ? (
              <span className={s.checkBadge} data-testid="selected-badge" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
            ) : null}
            {featured ? <span className={s.featuredTag}>{copy.viewer.featuredBadge}</span> : null}
          </div>
        ) : null}

        {dragging ? (
          <div className={s.stageTopRight}>
            <span className={s.dragTag} data-testid="dragging-badge">
              {draggingLabel ?? copy.reaction.changeNickname}
            </span>
          </div>
        ) : null}

        <div className={frameClass} data-testid={`mini-frame-${form}`}>
          {form === 'SOUND' ? (
            <FrameArtPreview
              form={form}
              title={title}
              thumbnailUrl={thumbnailUrl}
              durationLabel={durationLabel}
            />
          ) : (
            <div className={matClass}>
              <FrameArtPreview
                form={form}
                title={title}
                thumbnailUrl={thumbnailUrl}
                durationLabel={durationLabel}
              />
            </div>
          )}
        </div>
      </div>

      <div className={s.info}>
        <div className={s.titleRow}>
          <h3 className={s.title}>{title}</h3>
          {author ? <span className={s.author}>{author}</span> : null}
        </div>

        <div className={s.metaRow}>
          <span className={s.formSpec}>{`${resolvedFormLabel} · ${resolvedPageLabel}`}</span>

          <div className={s.badgeGroup}>
            {resolvedWarnLabel ? (
              <span
                className={status === 'FAILED' ? `${s.warnChip} ${s.warnChipDanger}` : s.warnChip}
                data-testid="warning-chip"
              >
                <Icon name="warning" size={12} />
                <span>{resolvedWarnLabel}</span>
              </span>
            ) : null}
            <span className={stateChipClass} data-testid="status-chip">
              {resolvedStatusLabel}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
};
