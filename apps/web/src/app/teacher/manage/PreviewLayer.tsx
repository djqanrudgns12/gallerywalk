import { config } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import type { ExhibitionView } from '@gallery/core/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '../../services.ts';
import { VisitScreen } from '../../visit/VisitScreen.tsx';
import { previewViewOf } from '../tour/previewView.ts';
import s from './PreviewLayer.module.css';

export interface PreviewLayerProps {
  readonly exhibitionId: string;
  /** 바뀌면(교사 묶음이 바뀜 — 고치기·게시·순서) 잠시 뒤 다시 받는다 */
  readonly revision: unknown;
  readonly onPick: (artworkId: string) => void;
  readonly onClose: () => void;
  /** 이 작품 앞에서 시작(HT-06 — 관리 화면에서 고른 작품). 없으면 광장부터 */
  readonly startArtworkId?: string | null | undefined;
}

type State =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly view: ExhibitionView;
      /** 열린 전시면 함께 관람에 선생님으로(입장 코드). 아니면 혼자 */
      readonly liveCode: string | null;
    }
  | { readonly kind: 'empty' }
  | { readonly kind: 'no3d' };

/**
 * 교사 3D 미리 보기(P5-6, PRD G-13·15.4-4, ADR-057): 관리 화면 위 전체 화면 층.
 * 학생 화면과 "같은 배치"를 보이려고 기기에서 다시 계산하지 않고 서버가 읽을 때 계산한 배치를 받는다(PLAN §4.10 —
 * 학생 입장과 같은 경로). 장면은 학생 관람 화면 그대로(`VisitScreen`), 작품을 누르면 크게 보기 대신 그 작품 패널.
 * 교사 묶음이 바뀌면 `AUTOSAVE_DELAY_MS` 뒤 다시 받아 고친 것이 보이게 한다(배치가 같으면 그림을 다시 받지 않는다).
 */
export const PreviewLayer = ({
  exhibitionId,
  revision,
  onPick,
  onClose,
  startArtworkId,
}: PreviewLayerProps) => {
  const { api, device } = useServices();
  // 함께 관람(PRD 15.8): 이 기기의 교사 세션 토큰과 고른 선생님 캐릭터
  const teacherToken = useMemo(
    () => device.teacherSession(exhibitionId)?.token ?? null,
    [device, exhibitionId],
  );
  const character = useMemo(() => device.teacherCharacter(), [device]);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const first = useRef(true);
  // 안내 한 줄은 처음 누를 때까지만
  const [hint, setHint] = useState(true);
  useEffect(() => {
    if (!hint) return;
    const off = (): void => setHint(false);
    window.addEventListener('pointerdown', off, { once: true });
    return () => window.removeEventListener('pointerdown', off);
  }, [hint]);
  useEffect(() => {
    const ac = new AbortController();
    const delay = first.current ? 0 : config().AUTOSAVE_DELAY_MS;
    first.current = false;
    const t = window.setTimeout(() => {
      api.teacher.exhibition(exhibitionId, { signal: ac.signal }).then(
        tv => {
          const v = previewViewOf(tv);
          const liveCode = tv.exhibition.status === 'OPEN' ? tv.exhibition.entryCode : null;
          // 받는 사이 3D를 못 쓰게 됐으면 그대로 둔다
          setState(prev =>
            prev.kind === 'no3d' ? prev : v ? { kind: 'ready', view: v, liveCode } : { kind: 'empty' },
          );
        },
        () => {
          // 다시 받기 실패는 보던 장면을 그대로 둔다(처음이면 빈 안내)
          if (!ac.signal.aborted) setState(prev => (prev.kind === 'loading' ? { kind: 'empty' } : prev));
        },
      );
    }, delay);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [api, exhibitionId, revision]);

  if (state.kind !== 'ready')
    return (
      <div
        className={s.layer}
        role="dialog"
        aria-label={copy.teacher.manage.preview}
        data-testid="preview-layer"
      >
        <div className={s.notice} data-state={state.kind}>
          <p>
            {state.kind === 'loading'
              ? copy.teacher.manage.previewLoading
              : state.kind === 'no3d'
                ? copy.teacher.manage.previewNo3d
                : copy.teacher.manage.previewEmpty}
          </p>
          <button type="button" className={s.close} onClick={onClose} data-testid="preview-close">
            {copy.teacher.manage.previewClose}
          </button>
        </div>
      </div>
    );
  return (
    <div
      className={s.layer}
      role="dialog"
      aria-label={copy.teacher.manage.preview}
      data-testid="preview-layer"
    >
      <VisitScreen
        view={state.view}
        code={state.liveCode ?? ''}
        character={character}
        liveToken={state.liveCode ? teacherToken : null}
        liveAs="teacher"
        entered
        onHome={onClose}
        onPickArtwork={onPick}
        startArtworkId={startArtworkId ?? undefined}
        onFallback2d={() => setState({ kind: 'no3d' })}
      />
      {hint ? (
        <p className={s.hint} data-testid="preview-hint">
          {copy.teacher.manage.previewHint}
        </p>
      ) : null}
    </div>
  );
};
