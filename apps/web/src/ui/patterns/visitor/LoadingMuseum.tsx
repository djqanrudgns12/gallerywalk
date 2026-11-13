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

/**
 * 준비 화면(F8 V-55): 어두운 바탕 위 미술관 외관 선그림 + 큰 세리프 이름 + 가는 놋쇠 진행선.
 * 판 안의 판·움직이는 펜 점은 두지 않는다 — 선을 천천히 그리는 움직임 하나(동작 줄이기면 멈춘 완성 그림).
 */
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

            <path
              className={s.lineGuide}
              d="M72 212 L72 86 L152 86 L260 28 L368 86 L448 86 L448 212 M136 212 L384 212 M152 198 L368 198 M168 186 L352 186"
            />

            <path
              className={s.lineDrawPrimary}
              pathLength={100}
              d="M44 212 L476 212 M96 212 L96 86 L156 86 L260 28 L364 86 L424 86 L424 212 M182 96 L182 186 M218 96 L218 186 M302 96 L302 186 M338 96 L338 186 M140 198 L380 198 M158 186 L362 186"
            />

            <path
              className={s.lineDrawBrass}
              pathLength={100}
              d="M174 72 L260 36 L346 72 Z M176 74 L344 74 L344 96 L176 96 Z M238 186 L238 122 A22 22 0 0 1 282 122 L282 186 M260 100 L260 186"
            />

            <circle className={s.medallion} cx="260" cy="56" r="6" />

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

          {subhintText ? <p className={s.subhint}>{subhintText}</p> : null}
        </div>
      </div>
    </section>
  );
};
