import { copy } from '@gallery/core/copy';
import type { ExhibitionView } from '@gallery/core/types';
import {
  type AnimationEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import { useStore } from 'zustand';
import { EntryPoster } from '../../ui/patterns/visitor/EntryPoster.tsx';
import { LoadingMuseum } from '../../ui/patterns/visitor/LoadingMuseum.tsx';
import { PATHS } from '../routes.ts';
import { useExhibitionUpdates } from '../visit/useExhibitionUpdates.ts';
import { useWalk } from '../../viewer/walk/walkStore.ts';
import { useServices } from '../services.ts';
import { ConsentSheet } from './ConsentSheet.tsx';
import { isInAppBrowser } from './inAppBrowser.ts';
import { prefersReducedMotion } from './motion.ts';
import { NoticeScreen } from './NoticeScreen.tsx';
import { formatDay, posterImageUrl, schoolSummary } from './posterView.ts';
import { STUDENT_THEME } from './theme.ts';
import { createVisitorStore, isEntered, isVisiting, type VisitorStore } from './visitorStore.ts';
import { useWakeLock } from './wakeLock.ts';
import s from './StudentExhibition.module.css';

/**
 * 관람 화면(three·R3F)은 따로 묶어 늦게 받는다 — 첫 화면 `/`와 포스터 글자가 3D 묶음을 기다리지 않게.
 * 전시를 불러오기 시작할 때 함께 받기 시작한다(포스터가 뜰 즈음 이미 받아 둠).
 */
const loadVisitScreen = () => import('../visit/VisitScreen.tsx');
const VisitScreen = lazy(() => loadVisitScreen().then(m => ({ default: m.VisitScreen })));
/** 2D 대체 화면(P4-10)도 따로 묶어, 전시를 불러올 때 함께 받아 둔다(3D가 안 되는 순간 바로 띄우게) */
const loadVisit2DScreen = () => import('../visit2d/Visit2DScreen.tsx');
const Visit2DScreen = lazy(() => loadVisit2DScreen().then(m => ({ default: m.Visit2DScreen })));

/**
 * 학생 전시 `/{코드}`(PLAN §7.1·§7.3): 불러오기(박물관 그리기) → 포스터 → 관람 / 막 내림 / 준비 중 / 다시 해 보기.
 * 관람 화면은 포스터 **뒤에 미리** 띄워 첫 자리를 준비하고(`entered={false}`), 준비가 끝나기 전에는 입장 단추를 잠근다.
 * 입장하면 같은 관람 화면을 그대로 두고 `entered`만 바꾼다(다시 만들지 않음) — 포스터는 `--t-enter` 동안 사라진다
 * (동작 줄이기면 연출 없이 바로).
 * 관람 화면이 `onFallback2d`를 부르면 3D 화면을 내리고 그 자리에 2D 대체 화면을 띄운다(그 전시 동안, ADR-019).
 * 관람 중(3D·2D)에는 화면 꺼짐을 막는다(Wake Lock).
 */
export const StudentExhibition = ({ code }: { readonly code: string }) => {
  const services = useServices();
  const navigate = useNavigate();
  const [store] = useState(() =>
    createVisitorStore({
      code,
      student: services.api.student,
      device: services.device,
      tokens: services.tokens,
      prefs: services.prefs,
      reducedMotion: () => prefersReducedMotion(typeof window === 'undefined' ? null : window),
    }),
  );
  const phase = useStore(store, st => st.phase);
  const view = useStore(store, st => st.view);
  const failure = useStore(store, st => st.failure);
  const overlay = useStore(store, st => st.overlay);
  const character = useStore(store, st => st.character);
  const liveToken = useStore(store, st => st.liveToken);
  const mode = useStore(store, st => st.mode);
  const { setProgress, load } = store.getState();
  // 소리 켬/끔(PRD G-06 "기기에 기억")
  const [soundOn, setSoundOn] = useState(() => services.device.soundOn());
  const sound = useMemo(
    () => ({
      on: soundOn,
      set: (on: boolean) => {
        services.device.setSoundOn(on);
        setSoundOn(on);
      },
    }),
    [soundOn, services.device],
  );
  // 2D 화면이 보는 정지 지점(바뀜 확인이 이어 볼 곳)과, 3D에서 넘어올 때 보던 곳
  const stop2d = useRef<string | null>(null);
  const [start2d, setStart2d] = useState<string | null>(null);
  const stop3d = useCallback(
    (): string | null => store.getState().view?.layout.stops[useWalk.getState().stopIndex]?.id ?? null,
    [store],
  );
  const fallBack2d = useCallback(() => {
    // 이유(webgl·context·fps)는 기록하지 않는다
    const st = store.getState();
    if (st.mode === '2d') return;
    if (isEntered(st.phase)) setStart2d(stop3d());
    st.fallBack2d();
  }, [store, stop3d]);
  // 바뀜 확인(P4-9): 관람 중 60초마다·화면 복귀 때. 보던 관이 바뀌면 띠로 미룬다
  const [pending, setPending] = useState<ExhibitionView | null>(null);
  useExhibitionUpdates({
    code,
    view: pending ?? view,
    enabled: view !== null && isVisiting(phase),
    student: services.api.student,
    currentStopId: () => (mode === '2d' ? stop2d.current : stop3d()),
    onPlan: plan => {
      if (plan.kind === 'APPLY') {
        setPending(null);
        store.getState().applyView(plan.view);
      } else setPending(plan.view);
    },
    onClosed: () => store.getState().endVisit('closed'),
    onNotReady: () => store.getState().endVisit('notReady'),
  });
  const applyPending = useCallback(() => {
    if (!pending) return;
    store.getState().applyView(pending);
    setPending(null);
  }, [pending, store]);
  const inApp = useMemo(() => isInAppBrowser(services.userAgent), [services.userAgent]);

  useEffect(() => {
    const ac = new AbortController();
    void loadVisitScreen();
    void loadVisit2DScreen();
    void store.getState().load(ac.signal);
    return () => ac.abort();
  }, [store]);

  const goHome = useCallback(() => navigate(PATHS.home), [navigate]);
  const retry = useCallback(() => void load(), [load]);

  const entered = isEntered(phase);
  // 화면 꺼짐 막기(P4-11): 관람 중(3D·2D)
  useWakeLock(view !== null && isVisiting(phase));

  return (
    <div className={s.stage} data-theme={STUDENT_THEME} data-phase={phase}>
      {view && mode === '3d' && (phase === 'poster' || entered) ? (
        <div className={s.visitLayer} inert={!entered}>
          <Suspense fallback={null}>
            <VisitScreen
              view={view}
              code={code}
              character={character}
              liveToken={liveToken}
              entered={entered}
              onProgress={setProgress}
              onHome={goHome}
              sound={sound}
              pendingUpdate={pending !== null}
              onApplyUpdate={applyPending}
              onFallback2d={fallBack2d}
            />
          </Suspense>
        </div>
      ) : null}

      {view && mode === '2d' && (phase === 'entering' || phase === 'fallback2d') ? (
        <div className={s.visitLayer}>
          <Suspense fallback={null}>
            <Visit2DScreen
              view={view}
              code={code}
              onHome={goHome}
              sound={sound}
              pendingUpdate={pending !== null}
              onApplyUpdate={applyPending}
              startStopId={start2d}
              onStop={id => {
                stop2d.current = id;
              }}
            />
          </Suspense>
        </div>
      ) : null}

      {phase === 'loading' ? (
        <div className={s.loadingLayer}>
          <LoadingMuseum
            title={copy.entry.appName}
            progress={0}
            statusText={copy.entry.loading}
            subhintText={copy.viewer.waitAMoment}
          />
        </div>
      ) : null}

      {view && (phase === 'poster' || phase === 'entering') ? (
        <PosterLayer
          store={store}
          view={view}
          leaving={phase === 'entering'}
          covered={overlay !== null}
          inApp={inApp}
        />
      ) : null}

      {overlay === 'consent' && view ? <ConsentSheet store={store} view={view} /> : null}

      {phase === 'closed' || phase === 'notReady' || phase === 'failed' ? (
        <NoticeScreen kind={phase} failure={failure} onHome={goHome} onRetry={retry} />
      ) : null}
    </div>
  );
};

interface PosterLayerProps {
  readonly store: VisitorStore;
  readonly view: ExhibitionView;
  /** 입장 연출 중(사라지는 중) */
  readonly leaving: boolean;
  /** 동의 시트가 덮고 있음 */
  readonly covered: boolean;
  readonly inApp: boolean;
}

const PosterLayer = ({ store, view, leaving, covered, inApp }: PosterLayerProps) => {
  const nickname = useStore(store, st => st.nickname);
  const character = useStore(store, st => st.character);
  const progress = useStore(store, st => st.progress);
  const { setNickname, setCharacter, requestEnter, finishEntering } = store.getState();
  const ex = view.exhibition;

  const onAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) finishEntering();
  };

  return (
    <div
      className={leaving ? `${s.posterLayer} ${s.leaving}` : s.posterLayer}
      inert={leaving || covered}
      onAnimationEnd={onAnimationEnd}
    >
      <div className={s.posterInner}>
        <EntryPoster
          title={ex.title}
          subtitle={ex.subtitle}
          schoolSummary={schoolSummary(view)}
          posterImageUrl={posterImageUrl(view)}
          openUntil={formatDay(ex.expiresAt)}
          artworkCount={view.artworks.length}
          nickname={nickname}
          onNicknameChange={setNickname}
          character={character}
          onCharacterChange={setCharacter}
          onEnter={requestEnter}
          enterDisabled={!progress.ready || leaving}
          showInAppBrowserHint={inApp}
        />
        {progress.ready ? null : <PrepareProgress value={progress.progress} />}
      </div>
    </div>
  );
};

/** "준비하고 있어요" + 가는 진행 막대(PLAN §7.3). `EntryPoster`에 자리가 없어 카드 바로 아래에 둔다 */
const PrepareProgress = ({ value }: { readonly value: number }) => {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={s.prepare} data-testid="prepare-progress">
      <div className={s.prepareRow}>
        <span>{copy.poster.preparing}</span>
        <span className={s.preparePct}>{`${pct}%`}</span>
      </div>
      <div
        className={s.prepareTrack}
        role="progressbar"
        aria-label={copy.poster.preparing}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={s.prepareFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};
