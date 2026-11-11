import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { type JSX, useId } from 'react';
import { Icon } from '../../Icon.tsx';
import { formatFacadeTitle } from './LoadingMuseum.tsx';
import s from './EntryPoster.module.css';

export type StudentCharacterId = 'student-m' | 'student-f';

export interface EntryPosterProps {
  title: string;
  subtitle?: string | null | undefined;
  schoolSummary?: string | null | undefined;
  posterImageUrl?: string | null | undefined;
  openUntil?: string | null | undefined;
  artworkCount?: number | undefined;
  togetherCount?: number | undefined;
  nickname: string;
  onNicknameChange: (nickname: string) => void;
  character: StudentCharacterId;
  onCharacterChange: (character: StudentCharacterId) => void;
  /** 캐릭터별 그림 주소. 없으면 3등신 실루엣 표시 */
  characterImage?: Partial<Record<StudentCharacterId, string>> | undefined;
  onEnter: () => void;
  enterDisabled?: boolean | undefined;
  showInAppBrowserHint?: boolean | undefined;
  className?: string | undefined;
}

const StudentSilhouette = ({ variant }: { variant: StudentCharacterId }): JSX.Element =>
  variant === 'student-m' ? (
    <svg
      width="72"
      height="90"
      viewBox="0 0 76 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-testid="silhouette-student-m"
    >
      <ellipse cx="38" cy="88" rx="18" ry="4" fill="var(--plate-edge)" />
      <circle cx="38" cy="26" r="15" fill="var(--plate-ink-sub)" />
      <rect x="25" y="43" width="26" height="27" rx="8" fill="var(--plate-ink-sub)" />
      <rect x="19" y="45" width="7" height="20" rx="3.5" fill="var(--plate-edge)" />
      <rect x="50" y="45" width="7" height="20" rx="3.5" fill="var(--plate-edge)" />
      <rect x="28" y="68" width="8" height="18" rx="3" fill="var(--plate-ink)" />
      <rect x="40" y="68" width="8" height="18" rx="3" fill="var(--plate-ink)" />
    </svg>
  ) : (
    <svg
      width="72"
      height="90"
      viewBox="0 0 76 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-testid="silhouette-student-f"
    >
      <ellipse cx="38" cy="88" rx="18" ry="4" fill="var(--plate-edge)" />
      <path
        d="M21 28C21 16 28 10 38 10C48 10 55 16 55 28C55 33 53 37 50 38H26C23 37 21 33 21 28Z"
        fill="var(--plate-ink)"
      />
      <circle cx="38" cy="26" r="14" fill="var(--plate-ink-sub)" />
      <path d="M26 43H50L54 69H22L26 43Z" fill="var(--plate-ink-sub)" />
      <rect x="19" y="45" width="7" height="19" rx="3.5" fill="var(--plate-edge)" />
      <rect x="50" y="45" width="7" height="19" rx="3.5" fill="var(--plate-edge)" />
      <rect x="29" y="69" width="7" height="17" rx="3" fill="var(--plate-ink)" />
      <rect x="40" y="69" width="7" height="17" rx="3" fill="var(--plate-ink)" />
    </svg>
  );

export const EntryPoster = ({
  title,
  subtitle,
  schoolSummary,
  posterImageUrl,
  openUntil,
  artworkCount,
  togetherCount,
  nickname,
  onNicknameChange,
  character,
  onCharacterChange,
  characterImage,
  onEnter,
  enterDisabled = false,
  showInAppBrowserHint = false,
  className,
}: EntryPosterProps): JSX.Element => {
  const inputId = useId();
  const maxChars = config().NICKNAME_MAX_CHARS;
  const displayTitle = formatFacadeTitle(title);

  const studentOptions: readonly { id: StudentCharacterId; label: string }[] = [
    { id: 'student-m', label: copy.poster.studentMale },
    { id: 'student-f', label: copy.poster.studentFemale },
  ];

  const togetherBadgeText =
    togetherCount !== undefined
      ? togetherCount > 0
        ? fill(copy.poster.togetherCount, { n: togetherCount })
        : copy.live.alone
      : null;

  return (
    <section
      className={className ? `${s.wrapper} ${className}` : s.wrapper}
      aria-label={displayTitle}
      data-testid="entry-poster"
    >
      <div className={s.card}>
        <div className={s.posterCol}>
          {togetherBadgeText || schoolSummary ? (
            <div className={s.posterHeader}>
              {togetherBadgeText ? <span className={s.togetherBadge}>{togetherBadgeText}</span> : null}
              {schoolSummary ? <span className={s.schoolText}>{schoolSummary}</span> : null}
            </div>
          ) : null}

          <div className={s.facadeBox}>
            {posterImageUrl ? (
              <img className={s.posterImg} src={posterImageUrl} alt={displayTitle} />
            ) : (
              <svg
                className={s.facadeSvg}
                viewBox="0 0 520 250"
                xmlns="http://www.w3.org/2000/svg"
                role="img"
                aria-label={displayTitle}
              >
                <rect x="0" y="0" width="520" height="190" fill="var(--accent-soft)" />
                <rect x="0" y="190" width="520" height="60" fill="var(--surface-marble)" />
                <rect
                  x="96"
                  y="68"
                  width="328"
                  height="122"
                  fill="var(--plate-bg)"
                  stroke="var(--brass-border)"
                  strokeWidth="1.5"
                />
                <polygon
                  points="154,68 260,22 366,68"
                  fill="var(--plate-bg)"
                  stroke="var(--accent)"
                  strokeWidth="2"
                />
                <circle
                  cx="260"
                  cy="49"
                  r="9"
                  fill="var(--brass-soft)"
                  stroke="var(--brass)"
                  strokeWidth="1.5"
                />
                <rect
                  x="172"
                  y="68"
                  width="176"
                  height="24"
                  rx="2"
                  fill="var(--accent)"
                  stroke="var(--brass-border)"
                  strokeWidth="1.2"
                />
                <text
                  x="260"
                  y="84"
                  textAnchor="middle"
                  fill="var(--accent-ink)"
                  fontFamily="var(--font-display)"
                  fontSize="11"
                  fontWeight="700"
                >
                  {displayTitle}
                </text>
                <rect
                  x="180"
                  y="92"
                  width="14"
                  height="92"
                  fill="var(--plate-bg-elevated)"
                  stroke="var(--plate-edge)"
                  strokeWidth="1.2"
                />
                <rect
                  x="218"
                  y="92"
                  width="14"
                  height="92"
                  fill="var(--plate-bg-elevated)"
                  stroke="var(--plate-edge)"
                  strokeWidth="1.2"
                />
                <rect
                  x="288"
                  y="92"
                  width="14"
                  height="92"
                  fill="var(--plate-bg-elevated)"
                  stroke="var(--plate-edge)"
                  strokeWidth="1.2"
                />
                <rect
                  x="326"
                  y="92"
                  width="14"
                  height="92"
                  fill="var(--plate-bg-elevated)"
                  stroke="var(--plate-edge)"
                  strokeWidth="1.2"
                />
                <rect
                  x="240"
                  y="106"
                  width="40"
                  height="78"
                  fill="var(--frame-outer)"
                  stroke="var(--brass-border)"
                  strokeWidth="1.5"
                />
                <rect
                  x="164"
                  y="184"
                  width="192"
                  height="8"
                  fill="var(--plate-bg)"
                  stroke="var(--plate-edge)"
                  strokeWidth="1"
                />
                <rect
                  x="148"
                  y="192"
                  width="224"
                  height="9"
                  fill="var(--surface-wall)"
                  stroke="var(--plate-edge)"
                  strokeWidth="1"
                />
                <rect
                  x="132"
                  y="201"
                  width="256"
                  height="10"
                  fill="var(--surface-marble)"
                  stroke="var(--brass-border)"
                  strokeWidth="1"
                />
              </svg>
            )}
          </div>

          <div className={s.posterBody}>
            <h1 className={s.posterTitle}>{displayTitle}</h1>
            {subtitle ? <p className={s.posterSubtitle}>{subtitle}</p> : null}
          </div>

          {artworkCount !== undefined || openUntil ? (
            <div className={s.posterMetaRow}>
              {artworkCount !== undefined ? (
                <span>{fill(copy.viewer.exitCount, { n: artworkCount })}</span>
              ) : null}
              {openUntil ? <span>{fill(copy.poster.openUntil, { date: openUntil })}</span> : null}
            </div>
          ) : null}
        </div>

        <div className={s.setupCol}>
          <div className={s.section}>
            <div className={s.sectionHead}>
              <label className={s.sectionTitle} htmlFor={inputId}>
                {copy.poster.nicknameLabel}
              </label>
              <span className={s.sectionHint}>{copy.poster.nicknameHint}</span>
            </div>
            <div className={s.nicknameField}>
              <input
                id={inputId}
                className={s.nicknameInput}
                type="text"
                value={nickname}
                maxLength={maxChars}
                placeholder={copy.poster.nicknamePlaceholder}
                aria-label={copy.poster.nicknameLabel}
                onChange={e => onNicknameChange(e.target.value)}
              />
              <span className={s.nicknameCount}>{`${nickname.length}/${maxChars}`}</span>
            </div>
          </div>

          <div className={s.section}>
            <div className={s.sectionHead}>
              <span className={s.sectionTitle}>{copy.poster.characterLabel}</span>
              <span className={s.sectionHint}>{copy.poster.characterHint}</span>
            </div>

            <div className={s.charGrid} role="radiogroup" aria-label={copy.poster.characterLabel}>
              {studentOptions.map(opt => {
                const selected = character === opt.id;
                const imgSrc = characterImage?.[opt.id];
                const previewText = nickname.trim() || opt.label;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={opt.label}
                    className={selected ? `${s.charCard} ${s.charCardSelected}` : s.charCard}
                    onClick={() => onCharacterChange(opt.id)}
                    data-testid={`char-${opt.id}`}
                  >
                    {selected ? (
                      <span className={s.checkCircle} aria-hidden="true">
                        <Icon name="check" size={14} />
                      </span>
                    ) : (
                      <span className={s.uncheckCircle} aria-hidden="true" />
                    )}

                    <div className={s.charFigureBox}>
                      <span className={selected ? s.previewTagMe : s.previewTagVisitor}>
                        {selected ? `${copy.viewer.badgeMe} · ${previewText}` : previewText}
                      </span>
                      {imgSrc ? (
                        <img className={s.charImg} src={imgSrc} alt={opt.label} />
                      ) : (
                        <StudentSilhouette variant={opt.id} />
                      )}
                    </div>

                    <span className={s.charName}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={s.togetherNotice} role="note">
            <Icon name="user" size={18} className={s.noticeIcon} />
            <span>{copy.poster.togetherNotice}</span>
          </div>

          <div className={s.enterActions}>
            <button
              type="button"
              className={s.enterBtn}
              onClick={onEnter}
              disabled={enterDisabled}
              data-testid="enter-plaza-btn"
            >
              <span>{copy.poster.enterPlaza}</span>
              <Icon name="chevron-right" size={18} />
            </button>
          </div>
        </div>
      </div>

      {showInAppBrowserHint ? <p className={s.browserHint}>{copy.poster.inAppBrowserHint}</p> : null}
    </section>
  );
};
