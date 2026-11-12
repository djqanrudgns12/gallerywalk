import { copy, fill } from '@gallery/core/copy';
import { StickerSchema, type ReactionSettings, type TeacherReaction } from '@gallery/core/types';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { DownloadedFile, ReactionPatchInput } from '../../../ports/index.ts';
import { Icon } from '../../../ui/Icon.tsx';
import { STICKER_ICONS } from '../../../ui/patterns/visitor/ReactionSheet.tsx';
import { useServices } from '../../services.ts';
import { errorText, isAbort } from '../shared/errorText.ts';
import c from '../shared/controls.module.css';
import type { ReactionsTabProps } from './contract.ts';
import { avg1, reactionRows } from './ReactionsTabStats.ts';
import s from './ReactionsTab.module.css';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly reactions: readonly TeacherReaction[];
      readonly settings: ReactionSettings;
      readonly title: string;
    };

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 서버가 파일 이름을 주지 않았을 때: `반응_{전시 이름}_{YYYYMMDD}.csv`(PLAN §9.5와 같은 모양) */
const fallbackName = (title: string, now: Date): string =>
  `${copy.teacher.csv.filePrefix}_${title}_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.csv`;

/** 받은 파일을 기기에 저장(`a[download]`) */
const saveFile = (file: DownloadedFile, name: string): void => {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename ?? name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * 반응 탭(P5-8, PRD G-15·PLAN §7.4). 작품별 한 줄(스티커별 수 · 메모 수 · 평가 평균) → 누르면 그 줄 아래 메모 목록
 * (별명 또는 `익명`·시각, 메모마다 `숨기기`, 메모 공개가 '고른 것만'이면 `모두에게 보이기`). 주요 버튼 `내려받기`(CSV).
 * 메모 공개 설정과 파일 이름의 전시 이름은 약속 속성에 없어 교사 보기를 함께 받는다(보고: 약속에 `exhibition`을 더하면 뺄 수 있음).
 */
export const ReactionsTab = ({ exhibitionId, artworks }: ReactionsTabProps) => {
  const { api } = useServices();
  const t = copy.teacher.reactionsTab;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const listId = useId();

  useEffect(() => {
    const ctrl = new AbortController();
    setLoad({ kind: 'loading' });
    Promise.all([
      api.teacher.reactions(exhibitionId, { signal: ctrl.signal }),
      api.teacher.exhibition(exhibitionId, { signal: ctrl.signal }),
    ]).then(
      ([reactions, view]) =>
        setLoad({
          kind: 'ready',
          reactions,
          settings: view.exhibition.settings.reactions,
          title: view.exhibition.title,
        }),
      (err: unknown) => {
        if (!isAbort(err)) setLoad({ kind: 'failed', message: errorText(err) });
      },
    );
    return () => ctrl.abort();
  }, [api, exhibitionId, attempt]);

  const rows = useMemo(
    () => (load.kind === 'ready' ? reactionRows(artworks, load.reactions) : []),
    [artworks, load],
  );

  const patch = useCallback(
    async (reaction: TeacherReaction, body: ReactionPatchInput): Promise<void> => {
      setBusyId(reaction.id);
      setRowError(null);
      try {
        const next = await api.teacher.patchReaction(exhibitionId, reaction.id, body);
        setLoad(prev =>
          prev.kind === 'ready'
            ? { ...prev, reactions: prev.reactions.map(r => (r.id === next.id ? next : r)) }
            : prev,
        );
      } catch (err) {
        setRowError(errorText(err));
      } finally {
        setBusyId(null);
      }
    },
    [api, exhibitionId],
  );

  const download = async (): Promise<void> => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const file = await api.teacher.reactionsCsv(exhibitionId);
      saveFile(file, fallbackName(load.kind === 'ready' ? load.title : '', new Date()));
    } catch (err) {
      setDownloadError(errorText(err));
    } finally {
      setDownloading(false);
    }
  };

  const selectable =
    load.kind === 'ready' && load.settings.collect.memo && load.settings.memoVisibility === 'SELECTED';
  const anyReaction = rows.some(r => r.total > 0);

  return (
    <section className={s.tab} data-testid="reactions-tab">
      <header className={s.head}>
        <h2 className={s.title}>{t.title}</h2>
        <button
          type="button"
          className={c.primary}
          disabled={downloading || load.kind !== 'ready'}
          onClick={() => void download()}
          data-testid="reactions-download"
        >
          {downloading ? t.downloading : t.download}
        </button>
      </header>
      {downloadError ? (
        <p className={c.error} role="alert" data-testid="reactions-download-error">
          {downloadError}
        </p>
      ) : null}

      {load.kind === 'loading' ? (
        <p className={c.hint} role="status">
          {t.loading}
        </p>
      ) : null}
      {load.kind === 'failed' ? (
        <div className={s.failed}>
          <p className={c.error} role="alert">
            {load.message}
          </p>
          <button type="button" className={c.secondary} onClick={() => setAttempt(n => n + 1)}>
            {copy.entry.retry}
          </button>
        </div>
      ) : null}

      {load.kind === 'ready' ? (
        <>
          {anyReaction ? null : (
            <p className={s.empty} data-testid="reactions-empty">
              {t.empty}
            </p>
          )}
          <ul className={s.rows} id={listId}>
            {rows.map(row => {
              const open = openId === row.artwork.id;
              const title = row.artwork.title.trim() === '' ? t.untitled : row.artwork.title;
              return (
                <li
                  key={row.artwork.id}
                  className={s.row}
                  data-testid="reaction-row"
                  data-id={row.artwork.id}
                >
                  <button
                    type="button"
                    className={s.rowHead}
                    aria-expanded={open}
                    onClick={() => {
                      setOpenId(open ? null : row.artwork.id);
                      setRowError(null);
                    }}
                  >
                    <span className={s.rowTitle}>{title}</span>
                    <span className={s.stats}>
                      {StickerSchema.options.map(k => {
                        const icon = STICKER_ICONS[k];
                        return (
                          <span
                            key={k}
                            className={s.stat}
                            data-sticker={k}
                            data-count={row.stickers[k]}
                            title={copy.reaction.stickers[k]}
                          >
                            {icon ? <Icon name={icon} size={16} label={copy.reaction.stickers[k]} /> : null}
                            <span>{row.stickers[k]}</span>
                          </span>
                        );
                      })}
                      <span className={s.stat} data-stat="memo">
                        {fill(t.memoCount, { n: row.memoCount })}
                      </span>
                      {row.score ? (
                        <span className={s.stat} data-stat="score">
                          {fill(t.scoreAvg, {
                            fact: avg1(row.score.fact),
                            delivery: avg1(row.score.delivery),
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span className={s.chevron} data-open={open ? '1' : '0'} aria-hidden="true" />
                  </button>
                  {open ? (
                    <div className={s.memos} data-testid="memo-list">
                      {row.memos.length === 0 ? <p className={c.hint}>{t.noMemos}</p> : null}
                      {rowError ? (
                        <p className={c.error} role="alert">
                          {rowError}
                        </p>
                      ) : null}
                      <ul className={s.memoList}>
                        {row.memos.map(m => (
                          <li
                            key={m.id}
                            className={s.memo}
                            data-hidden={m.hidden ? '1' : '0'}
                            data-testid="memo"
                          >
                            <div className={s.memoMeta}>
                              <span className={s.memoName}>{m.nickname ?? copy.teacher.csv.anonymous}</span>
                              <span className={s.memoTime}>{timeFormat.format(m.updatedAt)}</span>
                              {m.hidden ? <span className={c.badge}>{t.hiddenBadge}</span> : null}
                              {selectable && m.publicSelected && !m.hidden ? (
                                <span className={`${c.badge} ${s.badgePublic}`}>{t.selectedBadge}</span>
                              ) : null}
                            </div>
                            <p className={s.memoText}>{m.memo}</p>
                            <div className={s.memoActions}>
                              <button
                                type="button"
                                className={c.ghost}
                                disabled={busyId === m.id}
                                onClick={() => void patch(m, { hidden: !m.hidden })}
                                data-testid="memo-hide"
                              >
                                {m.hidden ? t.unhide : t.hide}
                              </button>
                              {selectable && !m.hidden ? (
                                <button
                                  type="button"
                                  className={c.ghost}
                                  disabled={busyId === m.id}
                                  onClick={() => void patch(m, { publicSelected: !m.publicSelected })}
                                  data-testid="memo-select"
                                >
                                  {m.publicSelected ? t.unselect : t.select}
                                </button>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
};
