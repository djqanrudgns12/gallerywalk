import { config } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import { type JSX, useId } from 'react';
import { Icon } from '../../Icon.tsx';
import s from './TeacherCharacterDialog.module.css';

export type TeacherCharacterId = 'teacher-m' | 'teacher-f';

export interface TeacherCharacterDialogProps {
  open?: boolean | undefined;
  character: TeacherCharacterId;
  onCharacterChange: (character: TeacherCharacterId) => void;
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  /** 이름표 칸을 보일지(기본 보임). 교사 화면은 서버가 늘 "선생님"으로 정하므로 끈다(V-04) */
  showName?: boolean | undefined;
  characterImage?: Partial<Record<TeacherCharacterId, string>> | undefined;
  onSave: () => void;
  onClose: () => void;
  title?: string | undefined;
  subtitle?: string | undefined;
  maleLabel?: string | undefined;
  femaleLabel?: string | undefined;
  nameplateLabel?: string | undefined;
  nameplateHint?: string | undefined;
  saveLabel?: string | undefined;
  cancelLabel?: string | undefined;
  className?: string | undefined;
}

const TeacherSilhouette = ({ variant }: { variant: TeacherCharacterId }): JSX.Element =>
  variant === 'teacher-m' ? (
    <svg
      width="78"
      height="102"
      viewBox="0 0 82 108"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-testid="silhouette-teacher-m"
    >
      <ellipse cx="41" cy="100" rx="20" ry="4.5" fill="var(--plate-edge)" />
      <circle cx="41" cy="27" r="15" fill="var(--plate-ink-sub)" />
      <rect x="31" y="24" width="8" height="5" rx="1" stroke="var(--plate-ink)" strokeWidth="1.4" />
      <rect x="43" y="24" width="8" height="5" rx="1" stroke="var(--plate-ink)" strokeWidth="1.4" />
      <rect x="26" y="44" width="30" height="32" rx="7" fill="var(--plate-ink-sub)" />
      <polygon points="41,45 38,58 41,62 44,58" fill="var(--plate-ink)" />
      <rect x="19" y="46" width="8" height="23" rx="4" fill="var(--plate-edge)" />
      <rect x="55" y="46" width="8" height="23" rx="4" fill="var(--plate-edge)" />
      <rect x="30" y="75" width="9" height="22" rx="3" fill="var(--plate-ink)" />
      <rect x="43" y="75" width="9" height="22" rx="3" fill="var(--plate-ink)" />
    </svg>
  ) : (
    <svg
      width="78"
      height="102"
      viewBox="0 0 82 108"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-testid="silhouette-teacher-f"
    >
      <ellipse cx="41" cy="100" rx="20" ry="4.5" fill="var(--plate-edge)" />
      <path
        d="M23 30C23 16 30 10 41 10C52 10 59 16 59 30C59 36 56 40 52 41H30C26 40 23 36 23 30Z"
        fill="var(--plate-ink)"
      />
      <circle cx="41" cy="27" r="14.5" fill="var(--plate-ink-sub)" />
      <path d="M27 44H55L58 75H24L27 44Z" fill="var(--plate-ink-sub)" />
      <rect x="44" y="51" width="7" height="10" rx="1" fill="var(--brass-soft)" />
      <rect x="20" y="46" width="8" height="22" rx="4" fill="var(--plate-edge)" />
      <rect x="54" y="46" width="8" height="22" rx="4" fill="var(--plate-edge)" />
      <rect x="31" y="75" width="8" height="22" rx="3" fill="var(--plate-ink)" />
      <rect x="43" y="75" width="8" height="22" rx="3" fill="var(--plate-ink)" />
    </svg>
  );

export const TeacherCharacterDialog = ({
  open = true,
  character,
  onCharacterChange,
  displayName,
  onDisplayNameChange,
  showName = true,
  characterImage,
  onSave,
  onClose,
  title = copy.poster.characterLabel,
  subtitle = copy.poster.characterHint,
  maleLabel = `${copy.live.teacher} A`,
  femaleLabel = `${copy.live.teacher} B`,
  nameplateLabel = copy.poster.nicknameLabel,
  nameplateHint = copy.poster.nicknameHint,
  saveLabel = copy.reaction.update,
  cancelLabel = copy.viewer.close,
  className,
}: TeacherCharacterDialogProps): JSX.Element | null => {
  const titleId = useId();
  const inputId = useId();

  if (!open) return null;

  const options: readonly { id: TeacherCharacterId; label: string }[] = [
    { id: 'teacher-m', label: maleLabel },
    { id: 'teacher-f', label: femaleLabel },
  ];

  const badgeText = displayName.trim() || copy.live.teacher;

  return (
    <div className={className ? `${s.backdrop} ${className}` : s.backdrop}>
      <section
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="teacher-character-dialog"
      >
        <header className={s.head}>
          <div className={s.titleWrap}>
            <span className={s.eyebrow}>{copy.live.teacher}</span>
            <h2 id={titleId} className={s.title}>
              {title}
            </h2>
            <p className={s.subtitle}>{subtitle}</p>
          </div>
          <button
            type="button"
            className={s.closeBtn}
            onClick={onClose}
            aria-label={copy.viewer.close}
            data-testid="teacher-dialog-close"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className={s.charGrid} role="radiogroup" aria-label={title}>
          {options.map(opt => {
            const selected = character === opt.id;
            const imgSrc = characterImage?.[opt.id];
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
                    <Icon name="check" size={13} />
                  </span>
                ) : (
                  <span className={s.uncheckCircle} aria-hidden="true" />
                )}

                <div className={s.silhouetteBox}>
                  <span className={s.headBadge}>
                    <span className={s.headBadgeRole}>{copy.live.teacher}</span>
                    <span>{badgeText}</span>
                  </span>
                  {imgSrc ? (
                    <img className={s.charImg} src={imgSrc} alt={opt.label} />
                  ) : (
                    <TeacherSilhouette variant={opt.id} />
                  )}
                </div>

                <span className={s.charName}>{opt.label}</span>
              </button>
            );
          })}
        </div>

        {showName ? (
          <div className={s.labelBox}>
            <div className={s.labelLeft}>
              <label className={s.labelTitle} htmlFor={inputId}>
                {nameplateLabel}
              </label>
              <span className={s.labelHint}>{nameplateHint}</span>
            </div>
            <input
              id={inputId}
              className={s.labelInput}
              type="text"
              value={displayName}
              maxLength={config().NICKNAME_MAX_CHARS}
              placeholder={copy.poster.nicknamePlaceholder}
              aria-label={nameplateLabel}
              onChange={e => onDisplayNameChange(e.target.value)}
            />
          </div>
        ) : null}

        <footer className={s.footer}>
          <button type="button" className={s.cancelBtn} onClick={onClose}>
            {cancelLabel}
          </button>
          <button type="button" className={s.saveBtn} onClick={onSave} data-testid="teacher-character-save">
            {saveLabel}
          </button>
        </footer>
      </section>
    </div>
  );
};
