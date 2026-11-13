import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import {
  bodyOf,
  normalizeCharacterId,
  STUDENT_CHARACTER_IDS,
  STUDENT_FEMALE_IDS,
  STUDENT_MALE_IDS,
  type StudentCharacterId,
  studentNumber,
} from '@gallery/core/types';
import { type JSX, useId, useRef } from 'react';
import { Icon } from '../../Icon.tsx';
import { radioKeyStep } from '../radioKeys.ts';
import s from './EntryPoster.module.css';

/** 학생이 고르는 캐릭터 10명(목록은 `domain/characters.ts`) */
export type { StudentCharacterId };

/** 포스터 위 절반에 거는 작품 한 점(썸네일 주소와 화소 크기 — 그림이 오기 전에도 액자 비율을 잡는다) */
export interface EntryPosterArtwork {
  readonly url: string;
  readonly w: number;
  readonly h: number;
}

export interface EntryPosterProps {
  title: string;
  subtitle?: string | null | undefined;
  schoolSummary?: string | null | undefined;
  posterImageUrl?: string | null | undefined;
  /** 첫 전시실 작품 썸네일(최대 3장을 건다). 포스터 그림이 있으면 그것만 크게 건다 */
  artworks?: readonly EntryPosterArtwork[] | undefined;
  openUntil?: string | null | undefined;
  artworkCount?: number | undefined;
  togetherCount?: number | undefined;
  nickname: string;
  onNicknameChange: (nickname: string) => void;
  /** `처음 쓰는 친구예요`(U-20): 공용 기기에서 앞 친구의 별명·기록 없이 새로 시작. 없으면 단추 숨김 */
  onFreshStart?: (() => void) | undefined;
  /** 눌렀으면 "새 관람객으로 시작해요" 한 줄 */
  freshStarted?: boolean | undefined;
  character: StudentCharacterId;
  onCharacterChange: (character: StudentCharacterId) => void;
  /** 캐릭터별 얼굴 그림 주소(`face.png`가 오면). 없으면 몸 틀 실루엣 + 번호 */
  characterImage?: Partial<Record<StudentCharacterId, string>> | undefined;
  /** 준비 진행(0~1). 값이 있으면 입장 단추 바로 위에 같은 폭의 진행 막대. 준비가 끝나면 넘기지 않는다 */
  prepare?: number | null | undefined;
  onEnter: () => void;
  enterDisabled?: boolean | undefined;
  /** 입장 단추 바로 위 한 줄(진행 막대 대신 — 3D 준비가 늦어 가벼운 화면으로 들어갈 때, G-24) */
  enterNote?: string | null | undefined;
  showInAppBrowserHint?: boolean | undefined;
  className?: string | undefined;
}

/** 위 절반에 거는 최대 작품 수(가운데 큰 액자 1 + 양옆 2). 화면 모양에 묶인 값 */
const HUNG_MAX = 3;

/** 고르기 두 줄(남 1~5 · 여 6~10, `STUDENT_CHARACTER_IDS` 순서) */
const PICK_ROWS: readonly (readonly StudentCharacterId[])[] = [STUDENT_MALE_IDS, STUDENT_FEMALE_IDS];

/** 몸 틀 실루엣(학생 남·여) */
const StudentSilhouette = ({ variant }: { variant: 'student-m' | 'student-f' }): JSX.Element =>
  variant === 'student-m' ? (
    <svg
      className={s.figure}
      viewBox="0 0 76 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-testid="silhouette-student-m"
    >
      <circle cx="38" cy="26" r="15" fill="currentColor" />
      <rect x="25" y="43" width="26" height="27" rx="8" fill="currentColor" />
      <rect x="28" y="68" width="8" height="18" rx="3" fill="currentColor" />
      <rect x="40" y="68" width="8" height="18" rx="3" fill="currentColor" />
    </svg>
  ) : (
    <svg
      className={s.figure}
      viewBox="0 0 76 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-testid="silhouette-student-f"
    >
      <path
        d="M21 28C21 16 28 10 38 10C48 10 55 16 55 28C55 33 53 37 50 38H26C23 37 21 33 21 28Z"
        fill="currentColor"
      />
      <path d="M26 43H50L54 69H22L26 43Z" fill="currentColor" />
      <rect x="29" y="69" width="7" height="17" rx="3" fill="currentColor" />
      <rect x="40" y="69" width="7" height="17" rx="3" fill="currentColor" />
    </svg>
  );

/** 조명 아래 걸린 액자 하나: 짙은 테 + 밝은 매트(빛은 그라데이션이 아니라 매트·테와 바탕의 대비로) */
const HungFrame = ({ art, main }: { art: EntryPosterArtwork; main: boolean }): JSX.Element => (
  <div className={main ? `${s.hung} ${s.hungMain}` : s.hung}>
    <span className={s.lamp} aria-hidden="true" />
    <div className={s.frame}>
      <img className={s.art} src={art.url} width={art.w} height={art.h} alt="" decoding="async" />
    </div>
  </div>
);

/** 대표작(첫 장)을 가운데 크게, 나머지를 양옆에 */
const hangOrder = (arts: readonly EntryPosterArtwork[]): { art: EntryPosterArtwork; main: boolean }[] => {
  const [first, ...rest] = arts.slice(0, HUNG_MAX);
  if (!first) return [];
  const center = { art: first, main: true };
  const [left, right] = rest.map(art => ({ art, main: false }));
  return [left, center, right].filter(
    (x): x is { art: EntryPosterArtwork; main: boolean } => x !== undefined,
  );
};

export const EntryPoster = ({
  title,
  subtitle,
  schoolSummary,
  posterImageUrl,
  artworks,
  openUntil,
  artworkCount,
  togetherCount,
  nickname,
  onNicknameChange,
  onFreshStart,
  freshStarted = false,
  character,
  onCharacterChange,
  characterImage,
  prepare,
  onEnter,
  enterDisabled = false,
  enterNote = null,
  showInAppBrowserHint = false,
  className,
}: EntryPosterProps): JSX.Element => {
  const inputId = useId();
  const charLabelId = useId();
  const charRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const maxChars = config().NICKNAME_MAX_CHARS;
  // 포스터 제목은 전시 이름 그대로. "{전시명} 전시관"은 3D 정면 이름판 규칙(ADR-057)이라 여기서 덧붙이면
  // "○○ 전시 전시관"처럼 겹친다(V-57)
  const displayTitle = title.trim();

  // 옛 ID가 와도(기기에 남은 값) 01번 칸을 고른 것으로 보인다
  const chosen = normalizeCharacterId(character);

  // 작게 한 줄: 학교 · 작품 수 · 기간
  const meta = [
    schoolSummary ?? null,
    artworkCount !== undefined ? fill(copy.viewer.exitCount, { n: artworkCount }) : null,
    openUntil ? fill(copy.poster.openUntil, { date: openUntil }) : null,
  ].filter((x): x is string => x !== null && x !== '');

  // 함께 관람 안내는 한 줄(보조 회색 글은 이것 하나)
  const togetherLine =
    togetherCount === undefined
      ? copy.poster.togetherNotice
      : togetherCount > 0
        ? fill(copy.viewer.liveCount, { n: togetherCount })
        : null;

  // 포스터 그림이 있으면 그것만 크게, 없으면 작품들, 둘 다 없으면(받기 전·작품 없음) 단색 판
  const hung = posterImageUrl ? [] : hangOrder(artworks ?? []);
  const emptyWall = !posterImageUrl && hung.length === 0;
  const prepPct =
    prepare === null || prepare === undefined ? null : Math.round(Math.max(0, Math.min(1, prepare)) * 100);

  return (
    <section
      className={className ? `${s.wrapper} ${className}` : s.wrapper}
      aria-label={displayTitle}
      data-testid="entry-poster"
    >
      <div className={s.card}>
        <div
          className={posterImageUrl ? `${s.wall} ${s.wallPoster}` : s.wall}
          data-testid="poster-artworks"
          data-empty={emptyWall ? '1' : '0'}
          aria-hidden="true"
        >
          {posterImageUrl ? (
            <div className={`${s.hung} ${s.hungPoster}`}>
              <span className={s.lamp} aria-hidden="true" />
              <div className={s.frame}>
                <img className={s.art} src={posterImageUrl} alt="" decoding="async" />
              </div>
            </div>
          ) : (
            hung.map(({ art, main }) => <HungFrame key={art.url} art={art} main={main} />)
          )}
        </div>

        <div className={s.body}>
          {meta.length > 0 ? <p className={s.meta}>{meta.join(' · ')}</p> : null}
          <h1 className={s.title}>{displayTitle}</h1>
          {subtitle ? <p className={s.subtitle}>{subtitle}</p> : null}

          <div className={s.form}>
            <div className={s.field}>
              <div className={s.nickRow}>
                <label className={s.label} htmlFor={inputId}>
                  {copy.poster.nicknameLabel}
                </label>
                <input
                  id={inputId}
                  className={s.nicknameInput}
                  type="text"
                  value={nickname}
                  maxLength={maxChars}
                  placeholder={copy.poster.nicknamePlaceholder}
                  aria-label={copy.poster.nicknameLabel}
                  autoComplete="off"
                  onChange={e => onNicknameChange(e.target.value)}
                />
                <span className={s.nicknameCount} aria-hidden="true">{`${nickname.length}/${maxChars}`}</span>
              </div>
              {togetherLine ? <p className={s.together}>{togetherLine}</p> : null}
              {onFreshStart ? (
                <div className={s.freshRow}>
                  <button
                    type="button"
                    className={s.freshBtn}
                    onClick={onFreshStart}
                    data-testid="fresh-start"
                  >
                    {copy.poster.freshStart}
                  </button>
                  {freshStarted ? (
                    <span className={s.freshDone} role="status">
                      {copy.poster.freshStarted}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className={s.field}>
              <span className={s.label} id={charLabelId}>
                {copy.poster.characterLabel}
              </span>
              <div className={s.charGrid} role="radiogroup" aria-labelledby={charLabelId}>
                {PICK_ROWS.map((row, r) => (
                  <div key={r} className={s.charRow}>
                    {row.map(id => {
                      const i = STUDENT_CHARACTER_IDS.indexOf(id);
                      const n = studentNumber(id);
                      const selected = chosen === id;
                      const imgSrc = characterImage?.[id];
                      const body = bodyOf(id) === 'student-f' ? 'student-f' : 'student-m';
                      return (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={fill(copy.poster.characterNumber, {
                            group: r === 0 ? copy.poster.studentMale : copy.poster.studentFemale,
                            n,
                          })}
                          tabIndex={selected ? 0 : -1}
                          ref={el => {
                            charRefs.current[i] = el;
                          }}
                          className={selected ? `${s.charBtn} ${s.charBtnSelected}` : s.charBtn}
                          onClick={() => onCharacterChange(id)}
                          onKeyDown={e => {
                            const to = radioKeyStep(e.key, i, STUDENT_CHARACTER_IDS.length);
                            const target = to === null ? undefined : STUDENT_CHARACTER_IDS[to];
                            if (to === null || !target) return;
                            e.preventDefault();
                            onCharacterChange(target);
                            charRefs.current[to]?.focus();
                          }}
                          data-testid={`char-${id}`}
                        >
                          {imgSrc ? (
                            <img className={s.charImg} src={imgSrc} alt="" />
                          ) : (
                            <StudentSilhouette variant={body} />
                          )}
                          <span className={s.charNum} aria-hidden="true">
                            {n}
                          </span>
                          {selected ? <Icon name="check" size={14} className={s.charCheck} /> : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={s.enterBlock}>
            {prepPct !== null ? (
              <div className={s.prepare} data-testid="prepare-progress">
                <div className={s.prepareRow}>
                  <span>{copy.poster.preparing}</span>
                  <span className={s.preparePct}>{`${prepPct}%`}</span>
                </div>
                <div
                  className={s.prepareTrack}
                  role="progressbar"
                  aria-label={copy.poster.preparing}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={prepPct}
                >
                  <div className={s.prepareFill} style={{ width: `${prepPct}%` }} />
                </div>
              </div>
            ) : enterNote ? (
              <div className={s.prepare} data-testid="enter-note" role="status">
                {enterNote}
              </div>
            ) : null}
            <button
              type="button"
              className={s.enterBtn}
              onClick={onEnter}
              disabled={enterDisabled}
              data-testid="enter-plaza-btn"
            >
              {copy.poster.enter}
            </button>
          </div>
        </div>
      </div>

      {showInAppBrowserHint ? <p className={s.browserHint}>{copy.poster.inAppBrowserHint}</p> : null}
    </section>
  );
};
