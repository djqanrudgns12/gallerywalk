import { copy, errorCopy } from '@gallery/core/copy';
import type { ReactionSettings } from '@gallery/core/types';
import { useState } from 'react';
import { useServices } from '../../services.ts';
import { errorCodeOf, errorText } from '../shared/errorText.ts';
import { shortStudentUrl, studentUrl } from '../shared/links.ts';
import { nothingCollected, reactionSummary } from '../shared/reactionSummary.ts';
import { ReactionSettingsEditor } from '../shared/ReactionSettingsEditor.tsx';
import { Sheet } from '../shared/Sheet.tsx';
import c from '../shared/controls.module.css';
import type { OpenSheetProps } from './contract.ts';
import { QrCode } from './QrCode.tsx';
import s from './OpenSheet.module.css';

/** 브라우저 전체 화면(되면 좋고, 안 되면 화면을 덮는 시트만으로 충분) */
const enterFullscreen = (): void => {
  const el = document.documentElement;
  if (typeof el.requestFullscreen === 'function') el.requestFullscreen().catch(() => undefined);
};
const exitFullscreen = (): void => {
  if (document.fullscreenElement && typeof document.exitFullscreen === 'function')
    document.exitFullscreen().catch(() => undefined);
};

/**
 * 전시 열기 시트(P5-7, PRD G-14·PLAN §7.4). 열기 전: 반응 설정 한 줄 요약 + `바꾸기`(수업 전에 평가 켜기를 잊지 않게)
 * → 주요 버튼 `열기`(게시 0이면 잠김). 연 뒤: QR · 짧은 주소 · 입장 코드 · `QR 크게 띄우기`(전체 화면에 주소·코드도 크게).
 * 닫힌 전시는 `열기`가 `다시 열기`(`reopen`)로 간다.
 */
export const OpenSheet = ({ exhibition, publishedCount, onChanged, onClose }: OpenSheetProps) => {
  const { api } = useServices();
  const t = copy.teacher.open;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReactionSettings>(exhibition.settings.reactions);
  const [big, setBig] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opened = exhibition.status === 'OPEN';
  const locked = publishedCount === 0;

  /** rev가 어긋났으면 새로 받아 관리 화면에 넘긴다(E_CONFLICT → 새로 불러옴, PLAN §9.2) */
  const refresh = async (): Promise<void> => {
    const view = await api.teacher.exhibition(exhibition.id);
    onChanged(view.exhibition);
    setDraft(view.exhibition.settings.reactions);
  };

  const fail = async (err: unknown): Promise<void> => {
    setError(errorText(err));
    if (errorCodeOf(err) === 'E_CONFLICT') await refresh().catch(() => undefined);
  };

  const saveSettings = async (): Promise<void> => {
    if (nothingCollected(draft)) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.teacher.patchExhibition(exhibition.id, exhibition.rev, {
        settings: { ...exhibition.settings, reactions: draft },
      });
      onChanged(next);
      setEditing(false);
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(false);
    }
  };

  const open = async (): Promise<void> => {
    if (locked) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await api.teacher.changeStatus(exhibition.id, exhibition.status === 'CLOSED' ? 'reopen' : 'open'),
      );
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(false);
    }
  };

  const url = studentUrl(exhibition.entryCode);
  const shortUrl = shortStudentUrl(exhibition.entryCode);

  if (opened && big)
    return (
      <Sheet
        title={exhibition.title}
        size="full"
        testId="open-sheet-big"
        onClose={() => {
          exitFullscreen();
          setBig(false);
        }}
      >
        <div className={s.big}>
          <QrCode value={url} large />
          <div className={s.bigText}>
            <p className={s.bigUrl} data-testid="big-short-url">
              {shortUrl}
            </p>
            <p className={s.bigCodeLabel}>{t.entryCode}</p>
            <p className={s.bigCode} data-testid="big-entry-code">
              {exhibition.entryCode}
            </p>
            <p className={c.hint}>{t.studentHint}</p>
          </div>
        </div>
      </Sheet>
    );

  return (
    <Sheet
      title={opened ? t.openedTitle : t.title}
      onClose={onClose}
      testId="open-sheet"
      footer={
        opened ? (
          <button
            type="button"
            className={c.primary}
            onClick={() => {
              enterFullscreen();
              setBig(true);
            }}
            data-testid="open-big"
          >
            {t.bigQr}
          </button>
        ) : (
          <button
            type="button"
            className={c.primary}
            disabled={locked || busy || editing}
            onClick={() => void open()}
            data-testid="open-submit"
          >
            {busy ? t.opening : exhibition.status === 'CLOSED' ? copy.teacher.menu.reopen : t.open}
          </button>
        )
      }
    >
      {opened ? (
        <div className={s.opened}>
          <QrCode value={url} />
          <dl className={s.facts}>
            <div className={s.fact}>
              <dt>{t.shortUrl}</dt>
              <dd className={s.url} data-testid="short-url">
                {shortUrl}
              </dd>
            </div>
            <div className={s.fact}>
              <dt>{t.entryCode}</dt>
              <dd className={s.code} data-testid="entry-code">
                {exhibition.entryCode}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <>
          <div className={s.summary}>
            <span data-testid="reaction-summary">{reactionSummary(exhibition.settings.reactions)}</span>
            {editing ? null : (
              <button
                type="button"
                className={c.ghost}
                onClick={() => {
                  setDraft(exhibition.settings.reactions);
                  setEditing(true);
                }}
                data-testid="summary-change"
              >
                {copy.teacher.reactionSettings.change}
              </button>
            )}
          </div>
          {editing ? (
            <div className={s.editor}>
              <ReactionSettingsEditor value={draft} onChange={setDraft} disabled={busy} />
              <div className={s.editorActions}>
                <button
                  type="button"
                  className={c.secondary}
                  onClick={() => setEditing(false)}
                  disabled={busy}
                >
                  {copy.teacher.cancel}
                </button>
                <button
                  type="button"
                  className={c.primary}
                  onClick={() => void saveSettings()}
                  disabled={busy || nothingCollected(draft)}
                  data-testid="settings-save"
                >
                  {copy.teacher.reactionSettings.save}
                </button>
              </div>
            </div>
          ) : null}
          {locked ? (
            <p className={s.locked} data-testid="open-locked">
              {errorCopy.E_NOTHING_PUBLISHED}
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p className={c.error} role="alert" data-testid="open-error">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
};
