import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import type { Layout } from '@gallery/core/types';
import type { PeerView } from '../../viewer/live/peerBuffer.ts';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  DocentBubble,
  Joystick,
  MoveButtons,
  NearArtworkCard,
  TopBar,
  WalkHint,
  WalkNav,
  ZoomCaption,
} from '../../ui/patterns/visitor/index.ts';
import type { Track } from '../../audio/AudioEngine.ts';
import { Icon } from '../../ui/Icon.tsx';
import type { CardText } from '../../viewer/textures/textCard.ts';
import type { ZoomPage } from '../../viewer/zoom/zoomPages.ts';
import { PageZoom } from './PageZoom.tsx';
import { AudioZoom, TextZoom } from './TextZoom.tsx';
import { mapView } from '../../viewer/map/mapView.ts';
import { combinedInput, useWalk, type WalkNotice } from '../../viewer/walk/walkStore.ts';
import s from './walkUi.module.css';

/**
 * 자유 관람 화면의 DOM 층(ADR-057, R-7b 부품 자리). 학생 관람(`VisitScreen`)과 개발 화면(`/dev/walk`)이 같은 것을 쓴다.
 * 3D 장면은 `VisitorScene`, 입력·상태는 `useWalk`. 화면이 한 번에 여는 덮개는 지도 하나(PRD 9.6).
 */

export { s as walkStyles };

/** 걷는 화면 둘레 글(작품 카드·크게 보기 캡션) */
export interface WalkArtworkText {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly caption: string;
  readonly description?: string | null | undefined;
  readonly featured?: boolean | undefined;
}

/** 기기 픽셀 비율 상한(데스크톱·태블릿·휴대폰) */
export const dprCap = (): number => {
  const c = config();
  const short = Math.min(window.screen.width, window.screen.height);
  const t = navigator.maxTouchPoints > 0;
  const cap = !t ? c.DPR_CAP_DESKTOP : short < 600 ? c.DPR_CAP_PHONE : c.DPR_CAP_TABLET;
  return Math.min(window.devicePixelRatio || 1, cap);
};

/** 캔버스 위 손짓: 끌기 = 둘러보기, 두 손가락 = 거리, 바퀴 = 거리. 끌었는지는 `dragged`로 알려 바닥 누르기와 가른다 */
const dragged = { current: false };

/** Canvas `onPointerMissed`: 끌기가 아니었으면 바닥 누르기 */
export const tapFloor = (e: MouseEvent): void => {
  if (dragged.current) return;
  // 크게 보는 중에는 빈 곳을 누르면 닫는다(PRD G-03)
  if (useWalk.getState().mode === 'zoom') {
    useWalk.getState().api?.close();
    return;
  }
  const r = (e.target as HTMLElement).getBoundingClientRect();
  useWalk.getState().api?.tapAt(e.clientX - r.left, e.clientY - r.top);
};

export const Gestures = ({ children }: { children: ReactNode }) => {
  const pointers = useRef(new Map<number, { x: number; y: number; sx: number; sy: number }>());
  const pinch = useRef<number | null>(null);
  const c = config();
  return (
    <div
      className={s.canvasWrap}
      onPointerDown={e => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
        dragged.current = false;
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        }
      }}
      onPointerMove={e => {
        const p = pointers.current.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (!dragged.current && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > c.TAP_MAX_PX) {
          dragged.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (!dragged.current) return;
        const api = useWalk.getState().api;
        if (pointers.current.size >= 2 && pinch.current) {
          const [a, b] = [...pointers.current.values()];
          const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          api?.dolly(pinch.current / Math.max(1, d));
          pinch.current = d;
        } else api?.orbit(-dx * c.ORBIT_RAD_PER_PX, dy * c.ORBIT_RAD_PER_PX);
      }}
      onPointerUp={e => {
        const p = pointers.current.get(e.pointerId);
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        // 크게 보는 중 한 손가락으로 아래로 쓸면 닫는다(PRD G-03)
        if (p && pointers.current.size === 0 && useWalk.getState().mode === 'zoom') {
          const dy = e.clientY - p.sy;
          if (dy > c.ZOOM_SWIPE_CLOSE_PX && Math.abs(e.clientX - p.sx) < dy) useWalk.getState().api?.close();
        }
      }}
      onPointerCancel={e => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
      }}
      onWheel={e => useWalk.getState().api?.dolly(Math.exp(e.deltaY * c.ZOOM_WHEEL_PER_PX))}
    >
      {children}
    </div>
  );
};

/** 다른 관람객 이름표: 선생님은 "선생님 · 별명" */
export const peerLabel = (p: PeerView): { text: string; teacher: boolean } =>
  p.role === 'teacher'
    ? {
        // 서버가 이름표를 "선생님"으로 정하면 "선생님 · 선생님"이 되지 않게 한 번만
        text:
          p.nickname === copy.viewer.badgeTeacher
            ? p.nickname
            : `${copy.viewer.badgeTeacher} · ${p.nickname}`,
        teacher: true,
      }
    : { text: p.nickname, teacher: false };

/** 쪽 상자 크기·화소 비율 → 쪽들 */
export type PagesFor = (vp: { readonly w: number; readonly h: number }, dpr: number) => readonly ZoomPage[];

/** 크게 보기 캡션의 반응 자리(학생 경로만 — 개발 화면에는 없음) */
export interface ReactionHooks {
  readonly onReact?: ((artworkId: string) => void) | undefined;
  readonly below?: ((artworkId: string) => ReactNode) | undefined;
  /** 반응 시트가 열린 작품 — 그동안 크게 보기 캡션(닫기·반응 단추)을 숨긴다(창 하나, PRD 9.6) */
  readonly openFor?: string | null | undefined;
  /** 보내지 못한 반응이 기기에 남았다(끊김) — 반응 단추에 작은 점(PRD G-07, V-21) */
  readonly pending?: boolean | undefined;
}

export const useMapOpen = create<{ open: boolean }>(() => ({ open: false }));

export interface WalkOverlayProps {
  /** 위 줄 이름(정면 이름판과 같은 글) */
  readonly title: string;
  readonly layout: Layout;
  readonly artworks: readonly WalkArtworkText[];
  /** 함께 보는 사람 수(나 포함, 혼자면 0) */
  readonly liveCount: number;
  readonly touch: boolean;
  /** 성능 숫자 판(개발 화면 `?hud=1`) */
  readonly hud?: boolean | undefined;
  /** 출구의 `처음으로`(없으면 단추를 숨김) */
  readonly onHome?: (() => void) | undefined;
  /** 띠 "전시가 새로 바뀌었어요 `새로 보기`"(P4-9) */
  readonly pendingUpdate?: boolean | undefined;
  readonly onApplyUpdate?: (() => void) | undefined;
  /** `소리` 켬/끔 단추(P4-7). 없으면 숨김 */
  readonly sound?: { readonly on: boolean; readonly toggle: () => void } | undefined;
  /** 동작 줄이기: 카메라를 바로 바꾸는 순간 화면을 짧게 덮었다 걷는다(PLAN §6.14) */
  readonly reducedMotion?: boolean | undefined;
  /** 위 줄 `모아 보기`(G-04). 없으면 단추 숨김 */
  readonly onCollection?: (() => void) | undefined;
  /** 반응(P4-6): `반응 남기기`(없으면 단추 숨김)·캡션 아래 공개 집계 */
  readonly reactions?: ReactionHooks | undefined;
  /** 크게 보기에서 HTML 쪽으로 보일 그림(PDF·긴 세로·파노라마·글 많음): 작품 ID → 쪽 계산(P4-4) */
  readonly pages?: ReadonlyMap<string, PagesFor> | undefined;
  /** 크게 보기에서 HTML로 보일 글·소리 작품(P4-4) */
  readonly cards?: ReadonlyMap<string, CardText> | undefined;
  readonly tracks?: ReadonlyMap<string, Track> | undefined;
  /** 지도 단추 목록에 쓸 관 이름(관 ID → "봄 전시실" 등). 없으면 목록 없이 그림만 */
  readonly partName?: ((partId: string) => string) | undefined;
  /** 소리 단추 옆 닫기(교사 3D 미리 보기, P5-6). 없으면 숨김 */
  readonly onClose?: { readonly label: string; readonly run: () => void } | undefined;
}

/** 캔버스 위 DOM 층 전부 */
export const WalkOverlay = ({
  title,
  layout,
  artworks,
  liveCount,
  touch,
  hud,
  onHome,
  pendingUpdate,
  onApplyUpdate,
  sound,
  cards,
  tracks,
  reactions,
  onCollection,
  reducedMotion,
  pages,
  onClose,
  partName,
}: WalkOverlayProps) => {
  // 크게 보는 동안은 오른쪽 위 `닫기`만(PRD 9.2) — 위 줄·소리·지도는 숨긴다
  const zoomed = useWalk(st => st.mode === 'zoom');
  return (
    <>
      {reducedMotion && <FadeCut />}
      {!zoomed && (
        <Top
          title={title}
          layout={layout}
          liveCount={liveCount}
          onCollection={onCollection}
          actions={
            <>
              <MapToggle />
              {sound && (
                <button
                  type="button"
                  className={s.topIcon}
                  aria-pressed={sound.on}
                  aria-label={copy.viewer.sound}
                  data-testid="sound-toggle"
                  onClick={sound.toggle}
                >
                  <Icon name={sound.on ? 'sound-on' : 'sound-off'} />
                </button>
              )}
              {onClose && (
                <button
                  type="button"
                  className={s.topIcon}
                  aria-label={onClose.label}
                  data-testid="overlay-close"
                  onClick={onClose.run}
                >
                  <Icon name="close" />
                </button>
              )}
            </>
          }
        />
      )}
      {pendingUpdate && onApplyUpdate && (
        <div className={`${s.plate} ${s.updateBanner}`} role="status" data-testid="update-banner">
          <span>{copy.viewer.updated}</span>
          <button type="button" className={s.exitPrimary} onClick={onApplyUpdate}>
            {copy.viewer.updatedAction}
          </button>
        </div>
      )}
      <Exit layout={layout} artworkCount={artworks.length} onHome={onHome} onCollection={onCollection} />
      {touch && <Stick />}
      <Hint touch={touch} />
      <NearCard artworks={artworks} />
      {touch && <Moves />}
      <Docent />
      <Nav layout={layout} />
      <Zoom
        layout={layout}
        artworks={artworks}
        cards={cards}
        tracks={tracks}
        reactions={reactions}
        pages={pages}
      />
      {!zoomed && <WalkMap layout={layout} partName={partName} />}
      {hud && <Hud />}
      <PerfMarks />
    </>
  );
};

/** 시험 손잡이(보이지 않음): 그린 프레임 수·멈춘 순간의 수·그리기 호출·걷기 상태 — e2e가 "멈추면 다시 그리지 않음"을 DOM으로 읽는다 */
const PerfMarks = () => {
  const perf = useWalk(st => st.perf);
  const mark = useWalk(st => st.idleFrameMark);
  const mode = useWalk(st => st.mode);
  const stop = useWalk(st => st.stopIndex);
  return (
    <output
      hidden
      data-testid="walk-perf"
      data-frames={perf.framesRendered}
      data-idle-mark={mark}
      data-calls={perf.calls}
      data-triangles={perf.triangles}
      data-mode={mode}
      data-stop={stop}
    />
  );
};

/** 동작 줄이기에서 작품 앞 도착·크게 보기·닫기 때 카메라가 바로 바뀌는 것을 짧은 덮개 페이드로 잇는다 */
const FadeCut = () => {
  const mode = useWalk(st => st.mode);
  const prev = useRef(mode);
  const [n, setN] = useState(0);
  useEffect(() => {
    const was = prev.current;
    prev.current = mode;
    if (was !== mode && (mode === 'view' || mode === 'zoom' || was === 'view' || was === 'zoom'))
      setN(x => x + 1);
  }, [mode]);
  return n > 0 ? <div key={n} className={s.fadeCut} aria-hidden /> : null;
};

/** 움직이는 중(안내 걷기·손 입력) */
const isMoving = (st: ReturnType<typeof useWalk.getState>): boolean => {
  const i = combinedInput(st);
  return st.mode === 'guiding' || Math.hypot(i.forward, i.strafe) > 0;
};

/**
 * 위 줄: 전시관 이름·지금 자리·함께 보는 사람 수(R-7b `TopBar`).
 * 움직이는 동안 흐리게, 입력 없이 `IDLE_DIM_SEC`이 지나면 더 흐리게(PLAN §7.3) — 누르거나 키를 치면 또렷하게 돌아온다.
 */
const Top = ({
  title,
  layout,
  liveCount,
  onCollection,
  actions,
}: {
  title: string;
  layout: Layout;
  liveCount: number;
  onCollection?: (() => void) | undefined;
  actions?: ReactNode;
}) => {
  const place = useWalk(st => st.place);
  const stopIndex = useWalk(st => st.stopIndex);
  const mode = useWalk(st => st.mode);
  const moving = useWalk(isMoving);
  const [idle, setIdle] = useState(false);
  const [touchedAt, setTouchedAt] = useState(0);
  useEffect(() => {
    const wake = () => setTouchedAt(Date.now());
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);
  useEffect(() => {
    setIdle(false);
    if (moving) return;
    const t = window.setTimeout(() => setIdle(true), config().IDLE_DIM_SEC * 1000);
    return () => window.clearTimeout(t);
  }, [moving, touchedAt]);
  const o = config().TOP_BAR_OPACITY;
  const dim = moving ? 'moving' : idle ? 'idle' : 'none';
  const stop = layout.stops[stopIndex];
  const progress =
    (mode === 'view' || mode === 'guiding') && stop?.index && stop.count
      ? fill(copy.viewer.pageOf, { page: stop.index, total: stop.count })
      : undefined;
  return (
    <div
      className={s.top}
      data-testid="top-bar"
      data-dim={dim}
      style={dim === 'none' ? undefined : { opacity: o[dim] }}
    >
      <TopBar
        title={title}
        place={place}
        progress={progress}
        liveCount={liveCount}
        onCollection={onCollection}
        actions={actions}
      />
    </div>
  );
};

/** 출구 정지 지점에 도착하면: 고마움 인사·작품 수 + `처음부터 다시 보기`·`처음으로`(PLAN §7.3) */
const Exit = ({
  layout,
  artworkCount,
  onHome,
  onCollection,
}: {
  layout: Layout;
  artworkCount: number;
  onHome?: (() => void) | undefined;
  /** 출구 벽의 `모아 보기`(PRD 9.3·5.5) */
  onCollection?: (() => void) | undefined;
}) => {
  const api = useWalk(st => st.api);
  const atExit = useWalk(st => st.mode === 'view' && layout.stops[st.stopIndex]?.kind === 'exit');
  if (!atExit) return null;
  const first = Math.max(
    0,
    layout.stops.findIndex(x => x.kind === 'artwork'),
  );
  return (
    <section className={`${s.plate} ${s.exit}`} data-testid="exit-panel" aria-label={copy.viewer.exitThanks}>
      <p className={s.exitTitle}>{copy.viewer.exitThanks}</p>
      <p className={s.exitSub}>{fill(copy.viewer.exitCount, { n: artworkCount })}</p>
      <div className={s.exitActions}>
        <button type="button" className={s.exitPrimary} onClick={() => api?.goTo(first)}>
          {copy.viewer.restart}
        </button>
        {onCollection && (
          <button
            type="button"
            className={s.exitSecondary}
            onClick={onCollection}
            data-testid="exit-collection"
          >
            {copy.viewer.collection}
          </button>
        )}
        {onHome && (
          <button type="button" className={s.exitSecondary} onClick={onHome}>
            {copy.closed.home}
          </button>
        )}
      </div>
    </section>
  );
};

/** 조이스틱(휴대폰·태블릿) — 값은 걷기 상태로. 크게 보는 중에는 숨김(걷지 않으므로) */
/** 지도 열기·닫기(오른쪽 위 아이콘 묶음) */
const MapToggle = () => {
  const open = useMapOpen(st => st.open);
  return (
    <button
      type="button"
      className={s.topIcon}
      aria-pressed={open}
      aria-label={copy.viewer.map}
      data-testid="map-toggle"
      onClick={() => useMapOpen.setState(st => ({ open: !st.open }))}
    >
      <Icon name="map" />
    </button>
  );
};

/** 걷기 안내판: 크게 보는 동안은 캡션과 겹치지 않게 숨긴다(조이스틱과 같이) */
const Hint = ({ touch }: { touch: boolean }) => {
  const zoomed = useWalk(st => st.mode === 'zoom');
  const moving = useWalk(isMoving);
  // 처음 `WALK_HINT_SEC` 동안만, 그 사이 움직이면 바로 숨긴다(안내판 줄이기, V-54)
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setShown(false), config().WALK_HINT_SEC * 1000);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (moving) setShown(false);
  }, [moving]);
  if (zoomed || !shown) return null;
  return (
    <div className={touch ? s.hintWithStick : s.hint}>
      <WalkHint touch={touch} />
    </div>
  );
};

const Stick = () => {
  const setStick = useWalk(st => st.setStick);
  const zoomed = useWalk(st => st.mode === 'zoom');
  if (zoomed) return null;
  return (
    <div className={s.stick}>
      <Joystick onChange={setStick} />
    </div>
  );
};

/** 오른쪽, 이동 단추 위: 뛰기(켜고 끄기)·점프. 크게 보는 중에는 숨김 */
const Moves = () => {
  const api = useWalk(st => st.api);
  const running = useWalk(st => st.runToggle);
  const locked = useWalk(st => st.runLocked);
  const zoomed = useWalk(st => st.mode === 'zoom');
  if (zoomed) return null;
  return (
    <div className={s.moves} data-testid="move-buttons">
      <MoveButtons
        running={running}
        runLocked={locked}
        onRunToggle={() => useWalk.setState(st => ({ runToggle: !st.runToggle }))}
        onJump={() => api?.jump()}
      />
    </div>
  );
};

/** 관람 예절 말풍선: 알림이 오면 `MANNER_NOTICE_SEC` 동안 */
const Docent = () => {
  const notice = useWalk(st => st.notice);
  const [shown, setShown] = useState<WalkNotice | null>(null);
  useEffect(() => {
    if (!notice) return;
    setShown(notice);
    const t = window.setTimeout(() => setShown(null), config().MANNER_NOTICE_SEC * 1000);
    return () => window.clearTimeout(t);
  }, [notice]);
  if (!shown) return null;
  return (
    <div className={s.docent}>
      <DocentBubble text={shown.kind === 'run' ? copy.viewer.mannerRun : copy.viewer.mannerJump} />
    </div>
  );
};

/**
 * 아래 가운데(휴대폰은 오른쪽): 이전·"다음 작품으로 i/n"(R-7b `WalkNav`). 크게 보는 중에는 숨김.
 * 숫자는 PRD 9.1대로 그 관 안의 작품 순번(정지 지점의 `index/count`) — 광장·소개·출구에서는 숫자 없이
 */
const Nav = ({ layout }: { layout: Layout }) => {
  const api = useWalk(st => st.api);
  const index = useWalk(st => st.stopIndex);
  const count = useWalk(st => st.stopCount);
  const zoomed = useWalk(st => st.mode === 'zoom');
  if (zoomed) return null;
  const stop = layout.stops[index];
  return (
    <div
      className={s.bottomRight}
      data-testid="walk-nav"
      data-stop-index={stop?.index ?? ''}
      data-stop-count={stop?.count ?? ''}
    >
      <WalkNav
        current={stop?.index ?? 0}
        total={stop?.count ?? 0}
        onPrev={() => api?.prev()}
        onNext={() => api?.next()}
        prevDisabled={index <= 0}
        nextDisabled={index >= count - 1}
      />
    </div>
  );
};

/** 가까운 작품 카드(R-7b `NearArtworkCard`) */
const NearCard = ({ artworks }: { artworks: readonly WalkArtworkText[] }) => {
  const near = useWalk(st => st.nearArtworkId);
  const mode = useWalk(st => st.mode);
  const api = useWalk(st => st.api);
  const a = artworks.find(x => x.id === near);
  if (!a || mode === 'zoom') return null;
  return (
    <div className={s.card}>
      <NearArtworkCard title={a.title} author={a.author} caption={a.caption} onZoom={() => api?.zoom(a.id)} />
    </div>
  );
};

/** 크게 보기 캡션(R-7b `ZoomCaption`). 글 작품은 HTML 종이 카드(쪽 넘김), 소리 작품은 명판 재생 단추를 함께(P4-4) */
const Zoom = ({
  layout,
  artworks,
  cards,
  tracks,
  reactions,
  pages,
}: {
  layout: Layout;
  artworks: readonly WalkArtworkText[];
  cards?: ReadonlyMap<string, CardText> | undefined;
  tracks?: ReadonlyMap<string, Track> | undefined;
  reactions?: ReactionHooks | undefined;
  pages?: ReadonlyMap<string, PagesFor> | undefined;
}) => {
  const zoomId = useWalk(st => st.zoomId);
  const api = useWalk(st => st.api);
  const zoomLayout = useRef<HTMLDivElement>(null);
  const captionBox = useRef<HTMLDivElement>(null);
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number } | null>(null);
  const onPage = useCallback(
    (page: number, total: number) => setPageInfo(total > 1 ? { page, total } : null),
    [],
  );
  useEffect(() => setPageInfo(null), [zoomId]);
  // 마지막 쪽에서 `›` → 다음 작품 정지 지점으로 걸어간다(PRD G-03). 다음 작품이 없으면 잠김
  const nextArt = useWalk(st => layout.stops.findIndex((s, i) => i > st.stopIndex && s.kind === 'artwork'));
  const pastEnd = useMemo(
    () => (nextArt >= 0 ? () => useWalk.getState().api?.goTo(nextArt) : undefined),
    [nextArt],
  );
  const a = artworks.find(x => x.id === zoomId);
  const artworkId = a?.id;
  const captionHidden = artworkId !== undefined && reactions?.openFor === artworkId;
  // DOM 크기만 전달한다. 관람 상태·Canvas의 invalidate를 건드리지 않아 정지 중인 3D를 깨우지 않는다.
  useLayoutEffect(() => {
    const layoutBox = zoomLayout.current;
    const caption = captionBox.current;
    if (!layoutBox || !caption) return;
    let observedSummary: HTMLElement | null = null;
    const measure = (): void => {
      const summary = caption.querySelector<HTMLElement>('[data-caption-summary]');
      if (summary !== observedSummary) {
        if (observedSummary) observer.unobserve(observedSummary);
        if (summary) observer.observe(summary);
        observedSummary = summary;
      }
      const rect = caption.getBoundingClientRect();
      const width = caption.hidden ? 0 : rect.width;
      const height = caption.hidden ? 0 : rect.height;
      const summaryHeight = caption.hidden ? 0 : (summary?.getBoundingClientRect().height ?? 0);
      layoutBox.style.setProperty('--zoom-caption-width', `${width}px`);
      layoutBox.style.setProperty('--zoom-caption-height', `${height}px`);
      layoutBox.style.setProperty('--zoom-reactions-height', `${summaryHeight}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(caption);
    measure();
    return () => {
      observer.disconnect();
      layoutBox.style.removeProperty('--zoom-caption-width');
      layoutBox.style.removeProperty('--zoom-caption-height');
      layoutBox.style.removeProperty('--zoom-reactions-height');
    };
  }, [artworkId, captionHidden]);
  if (!a) return null;
  const card = cards?.get(a.id);
  const track = tracks?.get(a.id);
  const pagesOf = pages?.get(a.id);
  return (
    <div ref={zoomLayout} className={s.zoomLayout}>
      <button
        type="button"
        className={`${s.plate} ${s.zoomClose}`}
        onClick={() => api?.close()}
        aria-label={copy.viewer.close}
        data-testid="zoom-close"
      >
        <Icon name="close" />
        <span>{copy.viewer.close}</span>
      </button>
      {card?.kind === 'TEXT' && <TextZoom key={a.id} text={card} onPage={onPage} onPastEnd={pastEnd} />}
      {card?.kind === 'AUDIO' && track && <AudioZoom key={a.id} text={card} track={track} />}
      {!card && pagesOf && <PageZoom key={a.id} pagesFor={pagesOf} onPage={onPage} onPastEnd={pastEnd} />}
      <div ref={captionBox} className={s.zoomCaption} hidden={captionHidden}>
        <ZoomCaption
          title={a.title}
          author={a.author}
          caption={a.caption}
          description={a.description ?? null}
          featured={a.featured ?? false}
          pageInfo={pageInfo}
          hideClose
          onClose={() => api?.close()}
          onReact={reactions?.onReact ? () => reactions.onReact?.(a.id) : undefined}
          reactPending={reactions?.pending ?? false}
        />
        {reactions?.below?.(a.id)}
      </div>
    </div>
  );
};

/**
 * 전시실 지도(작게, 위 왼쪽): 내 자리 점. 광장에 있으면 지도 아래 끝(입구 쪽)에 붙인다.
 * 전시실(관)을 누르면 그 관의 첫 정지 지점(소개 → 첫 작품)으로 걸어간다(G-05 `goToPart`) — 지도는 닫는다.
 */
const WalkMap = ({
  layout,
  partName,
}: {
  layout: Layout;
  partName?: ((partId: string) => string) | undefined;
}) => {
  const map = layout.map;
  const open = useMapOpen(st => st.open);
  const me = useWalk(st => st.me);
  const api = useWalk(st => st.api);
  const hx = Math.max(map.bounds.min[0], Math.min(map.bounds.max[0], me.x));
  const hz = Math.max(map.bounds.min[1], Math.min(map.bounds.max[1], me.z));
  const view = useMemo(() => mapView(map, [hx, hz]), [map, hx, hz]);
  if (!open) return null;
  const goToPart = (partId: string): void => {
    const i = layout.stops.findIndex(st => st.partId === partId);
    if (i < 0) return;
    api?.goTo(i);
    useMapOpen.setState({ open: false });
  };
  // 지도 그림(마우스·손가락) + 전시실 단추 목록(키보드·화면 읽기, PRD 14, V-22)
  return (
    <section className={`${s.plate} ${s.map}`} data-testid="walk-map" aria-label={copy.viewer.map}>
      <svg className={s.mapSvg} viewBox={view.viewBox} aria-hidden="true">
        {view.outline.map(points => (
          <polygon key={points} points={points} className={s.mapOutline} />
        ))}
        {view.parts.map(p => (
          <polygon
            key={p.partId}
            points={p.points}
            className={s.mapPart}
            data-part={p.partId}
            onClick={() => goToPart(p.partId)}
          />
        ))}
        {view.doors.map(d => (
          <line key={`${d.x1},${d.y1}`} {...d} className={s.mapDoor} />
        ))}
        {view.here && <circle cx={view.here.x} cy={view.here.y} r={0.9} className={s.mapHere} />}
      </svg>
      {partName ? (
        <ul className={s.mapList}>
          {view.parts.map(p => (
            <li key={p.partId}>
              <button
                type="button"
                className={s.mapListBtn}
                data-testid={`map-part-${p.partId}`}
                onClick={() => goToPart(p.partId)}
              >
                {partName(p.partId)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};

const Hud = () => {
  const perf = useWalk(st => st.perf);
  const mark = useWalk(st => st.idleFrameMark);
  const mode = useWalk(st => st.mode);
  return (
    <pre className={s.hud} data-testid="perf-hud">
      {[
        `mode ${mode}`,
        `fps(move) ${perf.fps}`,
        `calls ${perf.calls}  tris ${perf.triangles}`,
        `tex ${perf.textures}  geo ${perf.geometries}`,
        `frames ${perf.framesRendered}  idle-mark ${mark}`,
      ].join('\n')}
    </pre>
  );
};
