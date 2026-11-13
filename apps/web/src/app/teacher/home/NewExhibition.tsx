import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import {
  ExhibitionSettingsSchema,
  TemplateIdSchema,
  type ExhibitionSettings,
  type ReactionSettings,
} from '@gallery/core/types';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CreateExhibitionInput } from '../../../ports/index.ts';
import { useServices } from '../../services.ts';
import { digitsOnly } from '../../routes.ts';
import { DigitsInput } from '../shared/DigitsInput.tsx';
import { errorCodeOf, errorText } from '../shared/errorText.ts';
import { TEACHER_PATHS, type TeacherNavState } from '../shared/nav.ts';
import { nothingCollected } from '../shared/reactionSummary.ts';
import { ReactionSettingsEditor } from '../shared/ReactionSettingsEditor.tsx';
import { Segmented } from '../shared/Segmented.tsx';
import { checkPosterFile, POSTER_ACCEPT } from '../upload/posterFile.ts';
import c from '../shared/controls.module.css';
import s from './NewExhibition.module.css';

/** 시작 코드 칸 길이(core `CreateExhibitionSchema.startCode`의 `max(32)`와 같게) */
const START_CODE_MAX = 32;

type TemplateId = (typeof TemplateIdSchema.options)[number];
/** 고른 채로 여는 템플릿(v1은 하나뿐, PLAN §4.6) */
const DEFAULT_TEMPLATE: TemplateId = 'modern-history';
type TourMode = ExhibitionSettings['tour']['timeMode'];

/** 칸 아래 오류(칸 이름 → 문구). `form`은 `전시 만들기` 아래 */
type FieldErrors = Partial<
  Record<'title' | 'subtitle' | 'pin' | 'startCode' | 'reactions' | 'tour' | 'school' | 'form', string>
>;

/** 서버 `E_VALIDATION`의 `fields` 키(zod 경로 첫 마디) → 화면 칸 */
const fieldOfIssue = (key: string): keyof FieldErrors => {
  const head = key.split('.')[0] ?? '';
  if (head === 'title' || head === 'subtitle' || head === 'pin' || head === 'startCode') return head;
  if (head === 'settings') return key.includes('tour') ? 'tour' : 'reactions';
  return 'form';
};

/** 서버 거절을 칸 아래 문구로(PLAN §7.4: PIN 중복·쉬운 PIN·시작 코드·입력 확인은 칸 아래) */
const errorsOf = (err: unknown): FieldErrors => {
  const code = errorCodeOf(err);
  const text = errorText(err);
  if (code === 'E_PIN_TAKEN' || code === 'E_PIN_WEAK') return { pin: text };
  if (code === 'E_START_CODE') return { startCode: text };
  if (code === 'E_VALIDATION' && err instanceof AppError && err.fields) {
    const out: FieldErrors = {};
    for (const key of Object.keys(err.fields)) out[fieldOfIssue(key)] ??= text;
    return Object.keys(out).length > 0 ? out : { form: text };
  }
  return { form: text };
};

/**
 * 새 전시 만들기 `/t/new`(P5-2, PRD G-09 `[고정]`): 보이는 것은 전시 이름 · 템플릿 카드 · 한 줄 소개 · PIN 넷.
 * 접힌 `더 설정하기`에 학교·학급 표시 · 반응 설정(G-07) · 자동 투어 시간(ADR-046). 이 기기가 아직 시작 코드를
 * 통과하지 않았으면 PIN 아래 한 칸을 더 보인다(ADR-048). 만들면 관리 화면 + "30일" 토스트.
 *
 * - 전시 ID는 이 화면에서 한 번 만들어 다시 보내도 같게 둔다(멱등, PLAN §9.2).
 * - 포스터 이미지(V-02)는 `더 설정하기`에서 하나 고르고(기기 사전 검사), 전시를 만든 직후 올린다. 실패해도 전시는
 *   만들어진 채로 관리 화면에 가고 토스트 한 줄(관리 `···`에서 다시 고를 수 있다).
 * - 학교·학급은 만들기 본문에 칸이 없어(`CreateExhibitionSchema`) 만든 직후 `patchExhibition`으로 보낸다.
 */
export const NewExhibition = () => {
  const { api, device } = useServices();
  const navigate = useNavigate();
  const cfg = config();
  const t = copy.teacher.create;
  const exhibitionId = useRef<string>(crypto.randomUUID());
  const titleId = useId();
  const subtitleId = useId();
  const moreId = useId();
  const schoolNameId = useId();
  const classNameId = useId();
  const secondsId = useId();

  const defaults = ExhibitionSettingsSchema.parse({});
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState<TemplateId>(DEFAULT_TEMPLATE);
  const [subtitle, setSubtitle] = useState('');
  const [pin, setPin] = useState('');
  const [startCode, setStartCode] = useState('');
  const [askStartCode, setAskStartCode] = useState(() => !device.startCodePassed());
  const [moreOpen, setMoreOpen] = useState(false);
  const [showSchool, setShowSchool] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const [className, setClassName] = useState('');
  const [reactions, setReactions] = useState<ReactionSettings>(defaults.reactions);
  const [tourMode, setTourMode] = useState<TourMode>(defaults.tour.timeMode);
  const [seconds, setSeconds] = useState(String(defaults.tour.secondsPerRoom));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [poster, setPoster] = useState<File | null>(null);
  const [posterError, setPosterError] = useState<string | null>(null);
  const posterInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const tourMin = cfg.TOUR_MIN_SECONDS_PER_PART;
  const tourMax = cfg.TOUR_MUSIC_MAX_SEC;

  const validate = (): FieldErrors => {
    const out: FieldErrors = {};
    if (title.trim() === '') out.title = t.nameRequired;
    if (pin.length < cfg.PIN_MIN_LENGTH || pin.length > cfg.PIN_MAX_LENGTH)
      out.pin = fill(copy.teacher.pin.format, { min: cfg.PIN_MIN_LENGTH, max: cfg.PIN_MAX_LENGTH });
    if (nothingCollected(reactions)) out.reactions = copy.teacher.reactionSettings.nothingCollected;
    const sec = Number(seconds);
    if (tourMode === 'FIXED' && (seconds === '' || sec < tourMin || sec > tourMax))
      out.tour = fill(t.tourRange, { min: tourMin, max: tourMax });
    return out;
  };

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault();
    if (busy) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // 접힌 칸의 오류면 펼쳐서 보이게
      if (found.reactions || found.tour) setMoreOpen(true);
      return;
    }
    setBusy(true);
    const id = exhibitionId.current;
    const trimmedSubtitle = subtitle.trim();
    const input: CreateExhibitionInput = {
      exhibitionId: id,
      title: title.trim(),
      templateId,
      pin,
      settings: {
        reactions,
        tour: {
          timeMode: tourMode,
          secondsPerRoom: tourMode === 'FIXED' ? Number(seconds) : defaults.tour.secondsPerRoom,
        },
      },
      ...(trimmedSubtitle === '' ? {} : { subtitle: trimmedSubtitle }),
      ...(askStartCode && startCode !== '' ? { startCode } : {}),
    };
    try {
      const result = await api.teacher.createExhibition(input);
      device.rememberExhibition({ exhibitionId: id, title: input.title, expiresAt: result.expiresAt });
      let schoolFailed = false;
      let posterFailed = false;
      const school = { schoolName: schoolName.trim(), className: className.trim() };
      if (showSchool && (school.schoolName !== '' || school.className !== '')) {
        try {
          const view = await api.teacher.exhibition(id);
          await api.teacher.patchExhibition(id, view.exhibition.rev, {
            showSchool: true,
            schoolName: school.schoolName === '' ? null : school.schoolName,
            className: school.className === '' ? null : school.className,
          });
        } catch {
          schoolFailed = true;
        }
      }
      if (poster) {
        try {
          await api.teacher.uploadPoster(id, { blob: poster, name: poster.name });
        } catch {
          posterFailed = true;
        }
      }
      const toast =
        schoolFailed && posterFailed
          ? t.extrasSaveFailed
          : schoolFailed
            ? t.schoolSaveFailed
            : posterFailed
              ? t.posterSaveFailed
              : fill(t.createdToast, { days: cfg.EXHIBITION_TTL_DAYS });
      const state: TeacherNavState = { toast };
      navigate(TEACHER_PATHS.manage(id), { state });
    } catch (err) {
      const next = errorsOf(err);
      if (next.startCode) setAskStartCode(true);
      if (next.reactions || next.tour) setMoreOpen(true);
      setErrors(next);
      setBusy(false);
    }
  };

  const clear = (key: keyof FieldErrors): void => {
    if (!errors[key] && !errors.form) return;
    setErrors(prev => {
      const next = { ...prev };
      delete next[key];
      delete next.form;
      return next;
    });
  };

  const pickPoster = async (el: HTMLInputElement): Promise<void> => {
    const file = el.files?.[0] ?? null;
    el.value = '';
    if (!file) return;
    const problem = await checkPosterFile(file, file.name);
    setPosterError(problem === null ? null : errorCopy[problem]);
    setPoster(problem === null ? file : null);
  };

  const upcoming = t.upcomingTemplates;

  return (
    <section className={c.page} data-testid="teacher-new">
      <form className={s.form} onSubmit={e => void submit(e)} noValidate>
        <header className={s.head}>
          <button type="button" className={c.ghost} onClick={() => navigate(TEACHER_PATHS.home)}>
            {t.back}
          </button>
          <h1 className={s.title}>{t.title}</h1>
        </header>

        {/* 1. 전시 이름 */}
        <div className={c.field}>
          <div className={c.labelRow}>
            <label className={c.label} htmlFor={titleId}>
              {t.name}
            </label>
            <span className={c.counter}>
              {fill(t.charCount, { n: [...title].length, max: cfg.EXHIBITION_TITLE_MAX_CHARS })}
            </span>
          </div>
          <input
            id={titleId}
            className={c.input}
            value={title}
            maxLength={cfg.EXHIBITION_TITLE_MAX_CHARS}
            placeholder={t.namePlaceholder}
            aria-invalid={errors.title ? true : undefined}
            data-testid="new-title"
            onChange={e => {
              setTitle(e.target.value);
              clear('title');
            }}
          />
          {errors.title ? (
            <p className={c.error} role="alert" data-testid="new-title-error">
              {errors.title}
            </p>
          ) : null}
        </div>

        {/* 2. 템플릿 카드 */}
        <fieldset className={s.templates}>
          <legend className={c.label}>{t.template}</legend>
          <div className={s.templateGrid} role="radiogroup" aria-label={t.template}>
            {TemplateIdSchema.options.map(id => {
              const on = id === templateId;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={on ? `${s.templateCard} ${s.templateOn}` : s.templateCard}
                  data-template={id}
                  onClick={() => setTemplateId(id)}
                  data-testid={`template-${id}`}
                >
                  <span className={s.templateArt} data-template={id} aria-hidden="true" />
                  <span className={s.templateName}>{t.templates[id].name}</span>
                  <span className={s.templateDesc}>{t.templates[id].desc}</span>
                </button>
              );
            })}
            {upcoming.map(u => (
              <div key={u.name} className={`${s.templateCard} ${s.templateSoon}`} aria-disabled="true">
                <span className={s.templateArt} data-template="soon" aria-hidden="true" />
                <span className={s.templateName}>
                  {u.name}
                  <span className={c.badge}>{t.soon}</span>
                </span>
                <span className={s.templateDesc}>{u.desc}</span>
              </div>
            ))}
          </div>
        </fieldset>

        {/* 3. 한 줄 소개 */}
        <div className={c.field}>
          <div className={c.labelRow}>
            <label className={c.label} htmlFor={subtitleId}>
              {t.subtitle}
              <span className={c.optional}>{t.optional}</span>
            </label>
            <span className={c.counter}>
              {fill(t.charCount, { n: [...subtitle].length, max: cfg.SUBTITLE_MAX_CHARS })}
            </span>
          </div>
          <input
            id={subtitleId}
            className={c.input}
            value={subtitle}
            maxLength={cfg.SUBTITLE_MAX_CHARS}
            aria-invalid={errors.subtitle ? true : undefined}
            data-testid="new-subtitle"
            onChange={e => {
              setSubtitle(e.target.value);
              clear('subtitle');
            }}
          />
          <p className={c.hint}>{t.subtitleHint}</p>
          {errors.subtitle ? (
            <p className={c.error} role="alert">
              {errors.subtitle}
            </p>
          ) : null}
        </div>

        {/* 4. 선생님 PIN (+ 처음 쓰는 기기면 시작 코드) */}
        <DigitsInput
          label={copy.teacher.pin.label}
          value={pin}
          onChange={v => {
            setPin(v);
            clear('pin');
          }}
          maxLength={cfg.PIN_MAX_LENGTH}
          hint={fill(copy.teacher.pin.createHint, { min: cfg.PIN_MIN_LENGTH, max: cfg.PIN_MAX_LENGTH })}
          error={errors.pin}
          testId="new-pin"
        />
        {askStartCode ? (
          <DigitsInput
            label={t.startCode}
            value={startCode}
            onChange={v => {
              setStartCode(v);
              clear('startCode');
            }}
            maxLength={START_CODE_MAX}
            hint={t.startCodeHint}
            error={errors.startCode}
            testId="new-start-code"
          />
        ) : null}

        {/* 더 설정하기 */}
        <div className={s.more}>
          <button
            type="button"
            className={s.moreToggle}
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={() => setMoreOpen(o => !o)}
            data-testid="new-more"
          >
            <span>{t.more}</span>
            <span className={s.chevron} data-open={moreOpen ? '1' : '0'} aria-hidden="true" />
          </button>
          {moreOpen ? (
            <div id={moreId} className={s.moreBody}>
              <section className={s.group}>
                <h2 className={s.groupTitle}>{t.poster}</h2>
                <input
                  ref={posterInput}
                  type="file"
                  accept={POSTER_ACCEPT}
                  hidden
                  data-testid="new-poster-input"
                  onChange={e => void pickPoster(e.currentTarget)}
                />
                <div className={s.posterRow}>
                  <button
                    type="button"
                    className={c.secondary}
                    onClick={() => posterInput.current?.click()}
                    data-testid="new-poster-pick"
                  >
                    {poster ? t.posterChange : t.posterPick}
                  </button>
                  {poster ? (
                    <>
                      <span className={s.posterName} data-testid="new-poster-name">
                        {fill(t.posterChosen, { name: poster.name })}
                      </span>
                      <button
                        type="button"
                        className={c.ghost}
                        onClick={() => setPoster(null)}
                        data-testid="new-poster-remove"
                      >
                        {t.posterRemove}
                      </button>
                    </>
                  ) : null}
                </div>
                {posterError ? (
                  <p className={c.error} role="alert" data-testid="new-poster-error">
                    {posterError}
                  </p>
                ) : (
                  <p className={c.hint}>{t.posterHint}</p>
                )}
              </section>

              <section className={s.group}>
                <Segmented
                  label={t.school}
                  value={showSchool ? 'on' : 'off'}
                  options={[
                    { value: 'on', label: copy.teacher.reactionSettings.on },
                    { value: 'off', label: copy.teacher.reactionSettings.off },
                  ]}
                  onChange={v => setShowSchool(v === 'on')}
                  testId="new-school-toggle"
                />
                <p className={c.hint}>{t.schoolHint}</p>
                {showSchool ? (
                  <div className={s.schoolRow}>
                    <div className={c.field}>
                      <label className={c.label} htmlFor={schoolNameId}>
                        {t.schoolName}
                      </label>
                      <input
                        id={schoolNameId}
                        className={c.input}
                        value={schoolName}
                        maxLength={cfg.SCHOOL_NAME_MAX_CHARS}
                        data-testid="new-school-name"
                        onChange={e => setSchoolName(e.target.value)}
                      />
                    </div>
                    <div className={c.field}>
                      <label className={c.label} htmlFor={classNameId}>
                        {t.className}
                      </label>
                      <input
                        id={classNameId}
                        className={c.input}
                        value={className}
                        maxLength={cfg.CLASS_NAME_MAX_CHARS}
                        data-testid="new-class-name"
                        onChange={e => setClassName(e.target.value)}
                      />
                    </div>
                  </div>
                ) : null}
              </section>

              <section className={s.group}>
                <h2 className={s.groupTitle}>{copy.teacher.reactionSettings.title}</h2>
                <ReactionSettingsEditor
                  value={reactions}
                  onChange={next => {
                    setReactions(next);
                    clear('reactions');
                  }}
                />
                {errors.reactions && !nothingCollected(reactions) ? (
                  <p className={c.error} role="alert">
                    {errors.reactions}
                  </p>
                ) : null}
              </section>

              <section className={s.group}>
                <Segmented
                  label={t.tour}
                  value={tourMode}
                  options={[
                    { value: 'MUSIC', label: t.tourMusic },
                    { value: 'FIXED', label: t.tourFixed },
                  ]}
                  onChange={v => {
                    setTourMode(v);
                    clear('tour');
                  }}
                  testId="new-tour-mode"
                />
                {tourMode === 'FIXED' ? (
                  <div className={s.secondsRow}>
                    <label className={c.label} htmlFor={secondsId}>
                      {t.tourSecondsLabel}
                    </label>
                    <input
                      id={secondsId}
                      className={`${c.input} ${s.seconds}`}
                      inputMode="numeric"
                      value={seconds}
                      maxLength={String(tourMax).length}
                      aria-invalid={errors.tour ? true : undefined}
                      onChange={e => {
                        setSeconds(digitsOnly(e.target.value, String(tourMax).length));
                        clear('tour');
                      }}
                    />
                    <span className={c.hint}>{t.secondsUnit}</span>
                  </div>
                ) : (
                  <p className={c.hint}>{fill(t.tourMusicHint, { n: cfg.TOUR_SECONDS_PER_ROOM })}</p>
                )}
                {errors.tour ? (
                  <p className={c.error} role="alert">
                    {errors.tour}
                  </p>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>

        <div className={s.submitRow}>
          {errors.form ? (
            <p className={c.error} role="alert" data-testid="new-form-error">
              {errors.form}
            </p>
          ) : null}
          <button type="submit" className={c.primary} disabled={busy} data-testid="new-submit">
            {busy ? t.submitting : t.submit}
          </button>
        </div>
      </form>
    </section>
  );
};
