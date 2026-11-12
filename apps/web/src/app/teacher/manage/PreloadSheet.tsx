import { copy, fill } from '@gallery/core/copy';
import { useEffect, useState } from 'react';
import type { PreloadProgress } from '../../../ports/mediaCache.ts';
import { useServices } from '../../services.ts';
import { errorText, isAbort } from '../shared/errorText.ts';
import { Sheet } from '../shared/Sheet.tsx';
import c from '../shared/controls.module.css';
import { previewViewOf } from '../tour/previewView.ts';
import s from './PreloadSheet.module.css';

/** 바이트 → MB(단위 바꾸기, 1MB = 1,000,000B), 소수 한 자리 */
const BYTES_PER_MB = 1_000_000;
export const formatMb = (bytes: number): string => (Math.max(0, bytes) / BYTES_PER_MB).toFixed(1);

type SheetState =
  | { readonly phase: 'fetching' }
  | { readonly phase: 'empty' }
  | { readonly phase: 'error'; readonly message: string }
  | { readonly phase: 'progress'; readonly progress: PreloadProgress };

export interface PreloadSheetProps {
  readonly exhibitionId: string;
  readonly onClose: () => void;
}

/**
 * 수업 전 미리 불러오기(P5-10, PLAN §7.4·§6.13, ADR-049). 열면 바로 교사 보기를 새로 받아 게시 작품만(`previewViewOf`)
 * 전시 전체를 기기 캐시에 받는다(`MediaCache.preload(…, {scope:'WHOLE'})`). 진행률·저장한 MB를 보이고,
 * 공간이 모자라면 그 문구, 끝나면 "다 받았어요 · {n}MB". 받는 일은 포트가 맡아 시트를 닫아도 이어지고, 다시 열면 같은 진행에 붙는다.
 */
export const PreloadSheet = ({ exhibitionId, onClose }: PreloadSheetProps) => {
  const { api, media } = useServices();
  const t = copy.teacher.preload;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SheetState>({ phase: 'fetching' });

  useEffect(() => {
    let live = true;
    const ac = new AbortController();
    setState({ phase: 'fetching' });
    const show = (progress: PreloadProgress): void => {
      if (live) setState({ phase: 'progress', progress });
    };
    void (async () => {
      if (!media) {
        show({ kind: 'UNAVAILABLE', completed: 0, total: 0, bytes: 0 });
        return;
      }
      let view;
      try {
        view = previewViewOf(await api.teacher.exhibition(exhibitionId, { signal: ac.signal }));
      } catch (err) {
        if (live && !isAbort(err)) setState({ phase: 'error', message: errorText(err) });
        return;
      }
      if (!live) return;
      if (!view) {
        setState({ phase: 'empty' });
        return;
      }
      const result = await media.preload(view, show, { scope: 'WHOLE' });
      // 진행 알림 없이 끝난 경우(입력 검사 실패 등)에도 끝 상태를 보인다
      if (live)
        setState(prev =>
          prev.phase === 'progress' && prev.progress.kind === result.kind
            ? prev
            : {
                phase: 'progress',
                progress: {
                  kind: result.kind,
                  completed: prev.phase === 'progress' ? prev.progress.completed : 0,
                  total: prev.phase === 'progress' ? prev.progress.total : 0,
                  bytes: prev.phase === 'progress' ? prev.progress.bytes : 0,
                },
              },
        );
    })();
    return () => {
      live = false;
      ac.abort();
    };
  }, [api, media, exhibitionId, attempt]);

  const progress = state.phase === 'progress' ? state.progress : null;
  const kind = progress?.kind ?? null;
  const canRetry = state.phase === 'error' || kind === 'FAILED' || kind === 'NO_SPACE';
  const running = state.phase === 'fetching' || kind === 'LOADING';
  const pct =
    kind === 'READY'
      ? 100
      : progress && progress.total > 0
        ? Math.round((progress.completed / progress.total) * 100)
        : 0;

  return (
    <Sheet
      title={t.title}
      onClose={onClose}
      testId="preload-sheet"
      footer={
        <>
          <button type="button" className={c.secondary} onClick={onClose} data-autofocus>
            {t.close}
          </button>
          {canRetry ? (
            <button
              type="button"
              className={c.primary}
              onClick={() => setAttempt(n => n + 1)}
              data-testid="preload-retry"
            >
              {t.retry}
            </button>
          ) : null}
        </>
      }
    >
      <p className={c.hint}>{t.intro}</p>

      {state.phase === 'empty' ? (
        <p className={s.notice} role="status" data-testid="preload-empty">
          {t.empty}
        </p>
      ) : null}
      {state.phase === 'error' ? (
        <p className={c.error} role="alert" data-testid="preload-error">
          {state.message}
        </p>
      ) : null}

      {running || kind === 'READY' || kind === 'NO_SPACE' || kind === 'FAILED' ? (
        <div className={s.progress} data-testid="preload-progress" data-kind={kind ?? 'FETCHING'}>
          <div className={s.row}>
            {kind === 'READY' ? (
              <span className={s.done} role="status" data-testid="preload-ready">
                {fill(t.ready, { mb: formatMb(progress?.bytes ?? 0) })}
              </span>
            ) : (
              <span>{t.loading}</span>
            )}
            <span className={s.pct}>{`${pct}%`}</span>
          </div>
          <div
            className={s.track}
            role="progressbar"
            aria-label={t.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className={s.fill} data-done={kind === 'READY' ? '1' : '0'} style={{ width: `${pct}%` }} />
          </div>
          <div className={s.meta}>
            <span data-testid="preload-saved">{fill(t.saved, { mb: formatMb(progress?.bytes ?? 0) })}</span>
            {progress && progress.total > 0 ? (
              <span data-testid="preload-count">
                {fill(t.count, { done: progress.completed, total: progress.total })}
              </span>
            ) : null}
          </div>
          {running ? <p className={c.hint}>{t.keepGoing}</p> : null}
        </div>
      ) : null}

      {kind === 'NO_SPACE' ? (
        <p className={c.error} role="alert" data-testid="preload-no-space">
          {t.noSpace}
        </p>
      ) : null}
      {kind === 'FAILED' ? (
        <p className={c.error} role="alert" data-testid="preload-failed">
          {t.failed}
        </p>
      ) : null}
      {kind === 'UNAVAILABLE' ? (
        <p className={s.notice} role="status" data-testid="preload-unavailable">
          {t.unavailable}
        </p>
      ) : null}
    </Sheet>
  );
};
