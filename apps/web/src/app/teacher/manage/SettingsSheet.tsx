import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import type { ExhibitionTeacher, ReactionSettings, TourSettings } from '@gallery/core/types';
import { useId, useState } from 'react';
import { useServices } from '../../services.ts';
import { digitsOnly } from '../../routes.ts';
import { errorCodeOf, errorText } from '../shared/errorText.ts';
import { nothingCollected } from '../shared/reactionSummary.ts';
import { ReactionSettingsEditor } from '../shared/ReactionSettingsEditor.tsx';
import { Segmented } from '../shared/Segmented.tsx';
import { Sheet } from '../shared/Sheet.tsx';
import c from '../shared/controls.module.css';
import s from './SettingsSheet.module.css';

export interface SettingsSheetProps {
  readonly exhibition: ExhibitionTeacher;
  /** 저장했거나(rev 어긋남으로) 새로 받은 전시 행 */
  readonly onChanged: (next: ExhibitionTeacher) => void;
  /** 저장한 뒤 알림 한 줄(메뉴가 알림으로 띄운다) */
  readonly onSaved: (message: string) => void;
  readonly onClose: () => void;
}

type TourMode = TourSettings['timeMode'];

/**
 * 반응·투어 설정 시트(V-17, PRD G-07 "언제든 바꿀 수 있음"·G-16 "설정에서 바꿈"). `···` 메뉴에서 연다.
 * 반응은 만들기 화면과 같은 부품(`ReactionSettingsEditor`), 투어 시간은 노래 길이에 맞춤 / 전시실마다 ○초.
 * 저장은 `patchExhibition`(settings 전체). 열린 전시면 학생 화면은 다음 바뀜 확인(`CHANGE_POLL_SEC`) 때 받는다.
 */
export const SettingsSheet = ({ exhibition, onChanged, onSaved, onClose }: SettingsSheetProps) => {
  const { api } = useServices();
  const cfg = config();
  const t = copy.teacher.create;
  const secondsId = useId();
  const current = exhibition.settings;
  const [reactions, setReactions] = useState<ReactionSettings>(current.reactions);
  const [tourMode, setTourMode] = useState<TourMode>(current.tour.timeMode);
  const [seconds, setSeconds] = useState(String(current.tour.secondsPerRoom));
  const [tourError, setTourError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tourMin = cfg.TOUR_MIN_SECONDS_PER_PART;
  const tourMax = cfg.TOUR_MUSIC_MAX_SEC;

  const save = async (): Promise<void> => {
    if (nothingCollected(reactions)) return;
    const sec = Number(seconds);
    if (tourMode === 'FIXED' && (seconds === '' || sec < tourMin || sec > tourMax)) {
      setTourError(fill(t.tourRange, { min: tourMin, max: tourMax }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await api.teacher.patchExhibition(exhibition.id, exhibition.rev, {
        settings: {
          ...current,
          reactions,
          tour: {
            timeMode: tourMode,
            // 노래 길이에 맞춤이면 음악 없는 전시실의 초는 그대로 둔다
            secondsPerRoom: tourMode === 'FIXED' ? sec : current.tour.secondsPerRoom,
          },
        },
      });
      onChanged(next);
      onSaved(
        exhibition.status === 'OPEN'
          ? fill(copy.teacher.menu.settingsSavedOpen, { sec: cfg.CHANGE_POLL_SEC })
          : copy.teacher.menu.settingsSaved,
      );
    } catch (err) {
      setError(errorText(err));
      // rev가 어긋났으면 새로 받아 넘긴다(PLAN §9.2). 시트의 고친 값은 그대로 두어 다시 누를 수 있게
      if (errorCodeOf(err) === 'E_CONFLICT')
        await api.teacher.exhibition(exhibition.id).then(
          v => onChanged(v.exhibition),
          () => undefined,
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={copy.teacher.menu.settings}
      onClose={onClose}
      testId="settings-sheet"
      footer={
        <>
          <button type="button" className={c.secondary} onClick={onClose} disabled={busy}>
            {copy.teacher.cancel}
          </button>
          <button
            type="button"
            className={c.primary}
            onClick={() => void save()}
            disabled={busy || nothingCollected(reactions)}
            data-testid="settings-save"
          >
            {copy.teacher.reactionSettings.save}
          </button>
        </>
      }
    >
      <section className={s.group}>
        <h3 className={s.groupTitle}>{copy.teacher.reactionSettings.title}</h3>
        <ReactionSettingsEditor value={reactions} onChange={setReactions} disabled={busy} />
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
            setTourError(null);
          }}
          disabled={busy}
          testId="settings-tour-mode"
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
              aria-invalid={tourError ? true : undefined}
              disabled={busy}
              data-testid="settings-tour-seconds"
              onChange={e => {
                setSeconds(digitsOnly(e.target.value, String(tourMax).length));
                setTourError(null);
              }}
            />
            <span className={c.hint}>{t.secondsUnit}</span>
          </div>
        ) : (
          <p className={c.hint}>{fill(t.tourMusicHint, { n: current.tour.secondsPerRoom })}</p>
        )}
        {tourError ? (
          <p className={c.error} role="alert">
            {tourError}
          </p>
        ) : null}
      </section>

      {error ? (
        <p className={c.error} role="alert" data-testid="settings-error">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
};
