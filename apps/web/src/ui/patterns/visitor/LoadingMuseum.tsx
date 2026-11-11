import { copy, facadeTitle } from '@gallery/core/copy';
import type { JSX } from 'react';
import s from './LoadingMuseum.module.css';

/** 이름판 규칙은 core 한 곳(`facadeTitle`) — 예전 이름도 남겨 둠 */
export const formatFacadeTitle = facadeTitle;

export interface LoadingMuseumProps {
  title: string;
  progress?: number | undefined;
  statusText?: string | undefined;
  subhintText?: string | undefined;
  className?: string | undefined;
}

export const LoadingMuseum = ({
  title,
  progress = 72,
  statusText = copy.viewer.loadingDrawing,
  subhintText = copy.viewer.loadingSubhint,
  className,
}: LoadingMuseumProps): JSX.Element => {
  const displayTitle = formatFacadeTitle(title);
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <section
      className={className ? `${s.stage} ${className}` : s.stage}
      aria-busy="true"
      aria-label={copy.poster.preparing}
      data-testid="loading-museum"
    >
      <div className={s.center}>
        <div className={s.silhouetteFrame} role="img" aria-label={statusText}>
          <svg className={s.silhouetteSvg} viewBox="0 0 520 250" xmlns="http://www.w3.org/2000/svg">
            <line className={s.lineGuide} x1="20" y1="212" x2="500" y2="212" />
            <line className={s.lineGuide} x1="260" y1="14" x2="260" y2="232" />
            <line className={s.lineGuide} x1="90" y1="74" x2="430" y2="74" />

            <path
              className={s.lineGuide}
              d="M72 212 L72 86 L152 86 L260 28 L368 86 L448 86 L448 212 M136 212 L384 212 M152 198 L368 198 M168 186 L352 186"
            />

            <path
              className={s.lineDrawPrimary}
              d="M44 212 L476 212 M96 212 L96 86 L156 86 L260 28 L364 86 L424 86 L424 212 M182 96 L182 186 M218 96 L218 186 M302 96 L302 186 M338 96 L338 186 M140 198 L380 198 M158 186 L362 186"
            />

            <path
              className={s.lineDrawBrass}
              d="M174 72 L260 36 L346 72 Z M176 74 L344 74 L344 96 L176 96 Z M238 186 L238 122 A22 22 0 0 1 282 122 L282 186 M260 100 L260 186"
            />

            <circle cx="260" cy="56" r="7" fill="var(--brass-soft)" stroke="var(--brass)" strokeWidth="1.8" />

            <text
              x="260"
              y="89"
              textAnchor="middle"
              fill="var(--accent)"
              fontFamily="var(--font-display)"
              fontSize="11.5"
              fontWeight="700"
            >
              {displayTitle}
            </text>

            <g className={s.penPoint}>
              <circle cx="364" cy="86" r="6" fill="var(--brass-soft)" />
              <circle cx="364" cy="86" r="3.2" fill="var(--brass)" />
            </g>
            <g className={s.penPoint}>
              <circle cx="338" cy="142" r="6" fill="var(--accent-soft)" />
              <circle cx="338" cy="142" r="3.2" fill="var(--accent)" />
            </g>
          </svg>
        </div>

        <div className={s.info}>
          <h1 className={s.title}>{displayTitle}</h1>

          <div className={s.statusRow}>
            <span>{statusText}</span>
            <span className={s.pct}>{`${clamped}%`}</span>
          </div>

          <div
            className={s.progressTrack}
            role="progressbar"
            aria-label={copy.poster.preparing}
            aria-valuenow={clamped}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className={s.progressFill} style={{ width: `${clamped}%` }} />
          </div>

          <p className={s.subhint}>{subhintText}</p>
        </div>
      </div>
    </section>
  );
};
