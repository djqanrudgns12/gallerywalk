import { config } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import type { CharacterId } from '@gallery/core/types';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Component,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { WebGLRenderer } from 'three';
import '../../ui/tokens.css';
import '../../ui/themes/modern-history.css';
import '../../ui/themes/gallery-dark.css';
import { visibleMaxFor } from '../../viewer/live/peerBuffer.ts';
import {
  deviceKindOf,
  type DeviceKind,
  osOf,
  type RendererCaps,
  startTier,
  TierMonitor,
} from '../../viewer/quality/tier.ts';
import { modulesFor, templateAssets } from '../../viewer/scene/templateAssets.ts';
import type { Tier } from '../../viewer/textures/residency.ts';
import { VisitorScene } from '../../viewer/VisitorScene.tsx';
import { useWalkKeyboard } from '../../viewer/walk/input.ts';
import type { WalkStart } from '../../viewer/walk/WalkView.tsx';
import { useWalk } from '../../viewer/walk/walkStore.ts';
import { LoadingMuseum } from '../../ui/patterns/visitor/index.ts';
import type { Fallback2dReason, VisitScreenProps } from './contract.ts';
import { type LiveVisit, useLiveVisit } from './useLiveVisit.ts';
import { activeProbe } from '../perf/visitProbe.ts';
import { resumeStop } from '../../viewer/updates/applyRules.ts';
import {
  PublicReactionsFor,
  ReactionLayer,
  reactionKey,
  reactionRuntime,
  reactionsEnabled,
  useReactionPending,
} from '../reactions/index.ts';
import { ServicesContext } from '../services.ts';
import { prefersReducedMotion, REDUCED_MOTION_QUERY } from '../student/motion.ts';
import { STUDENT_THEME } from '../student/theme.ts';
import { zoomPagesFor } from '../../viewer/zoom/zoomPages.ts';
import { collectionOf } from './collection.ts';
import { CollectionSheet } from './CollectionSheet.tsx';
import { ExitSheet } from './ExitSheet.tsx';
import { LiveLostBanner } from '../../ui/patterns/visitor/LiveLostBanner.tsx';
import { useRoomMusic } from './roomMusic.ts';
import { type VisitModel, visitModelOf } from './visitModel.ts';
import {
  dprCap,
  Gestures,
  peerLabel,
  type PagesFor,
  type ReactionHooks,
  tapFloor,
  useMapOpen,
  WalkOverlay,
  walkStyles as s,
} from './walkUi.tsx';

/**
 * 학생 관람 화면(P4-2, ADR-057): 실제 전시(`ExhibitionView`)로 자유 관람 3D 장면 + DOM 층.
 * - 포스터가 떠 있는 동안(`entered` false) 뒤에서 첫 자리(외관 조각)를 미리 받는다. 그동안 입력·함께 관람·첫 인사는 하지 않는다.
 * - 작품 그림은 상주 관리(§6.5)가 보이는 관·가까운 작품만 올리고 예산을 넘으면 내린다.
 * - 품질 단계는 기기 능력으로 시작해, 움직이는 구간 fps가 두 번 연속 낮으면 한 단계 내린다(§6.10, 수업 중 올리지 않음).
 * - 함께 관람은 들어온 뒤에만 잇는다(토큰이 없으면 혼자).
 */

/** 준비 막대: 첫 조각을 받는 동안 이 값까지 천천히 오른다(끝은 준비 끝에서만) */
const PROGRESS_CAP = 0.9;
const PROGRESS_TICK_MS = 300;
/** 한 번에 오를 몫(남은 거리의 비율) */
const PROGRESS_EASE = 0.12;

const capsOf = (gl: WebGLRenderer): RendererCaps => {
  const ctx = gl.getContext();
  const info = ctx.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? String(ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '') : '';
  const touch = navigator.maxTouchPoints;
  return {
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext,
    maxTextureSize: gl.capabilities.maxTextureSize,
    gpu,
    kind: deviceKindOf(touch, Math.min(window.screen.width, window.screen.height)),
    os: osOf(navigator.userAgent, touch),
  };
};

export const VisitScreen = ({
  view,
  code,
  character,
  liveToken,
  entered,
  onProgress,
  onHome,
  pendingUpdate,
  onApplyUpdate,
  sound,
  onFallback2d,
  onPickArtwork,
  liveAs,
}: VisitScreenProps) => {
  const fresh = useMemo(() => visitModelOf(view), [view]);
  // 내용만 바뀌면(배치 그대로) 그림 받기 입력·작품별 밝기 손잡이를 그대로 둔다 — 글자 하나 고쳐도 텍스처를 다시 받지 않게
  const model = useStableModel(fresh);
  const dpr = useMemo(dprCap, []);
  const touch = useMemo(() => navigator.maxTouchPoints > 0, []);
  // 반응(P4-6): 학생 경로(서비스가 있음)에서만. 덮개가 열린 동안은 걷기 키를 끈다(메모를 쓰는 동안 움직이지 않게)
  // 교사 미리 보기(`onPickArtwork`)는 서비스가 있어도 학생 일을 하지 않는다
  const ctxServices = useContext(ServicesContext);
  const services = onPickArtwork ? null : ctxServices;
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [reactionsOff, setReactionsOff] = useState(false);
  const [reactPending, setReactPending] = useState(false);
  const canReact = services !== null && !reactionsOff && reactionsEnabled(view);
  const zoomId = useWalk(st => st.zoomId);
  useEffect(() => {
    if (reactingId && zoomId !== reactingId) setReactingId(null);
  }, [zoomId, reactingId]);
  const reactions = useMemo<ReactionHooks | undefined>(
    () =>
      services
        ? {
            onReact: canReact ? setReactingId : undefined,
            below: id => <PublicReactionsFor view={view} artworkId={id} />,
            openFor: reactingId,
            pending: reactPending,
          }
        : undefined,
    [services, canReact, view, reactingId, reactPending],
  );
  // 크게 볼 그림(P4-4·V-10)
  const zoomPages = useMemo(() => {
    const out = new Map<string, PagesFor>();
    for (const a of view.artworks) {
      // 모든 그림·PDF: 크게 볼 때는 벽용 텍스처 대신 `zoom`/`zoom-hi` 단계를 HTML 층에(PRD 6.6, ADR-016, V-10).
      // 여러 쪽(PDF·긴 세로·파노라마·글 많음)은 쪽 넘김, 보통 그림은 한 쪽
      if (a.kind === 'PDF' || a.kind === 'IMAGE')
        out.set(a.id, (vp, dpr) => zoomPagesFor(view.exhibition.id, a, vp, dpr));
    }
    return out;
  }, [view]);
  // 모아 보기(G-04): 덮개는 한 번에 하나(지도·반응을 닫고 연다). 고른 작품 앞에 도착하면 바로 크게 본다
  const [collectionOpen, setCollectionOpen] = useState(false);
  const pendingZoom = useRef<string | null>(null);
  const openCollection = useCallback(() => {
    setReactingId(null);
    useMapOpen.setState({ open: false });
    setCollectionOpen(true);
  }, []);
  const collection = useMemo(
    () =>
      collectionOf(
        model.layout,
        [...view.rooms].sort((a, b) => a.order - b.order).map(r => r.id),
      ),
    [model.layout, view.rooms],
  );
  useEffect(
    () =>
      useWalk.subscribe((n, p) => {
        const want = pendingZoom.current;
        if (!want) return;
        if (n.mode === 'free' && p.mode === 'guiding') pendingZoom.current = null;
        else if (
          n.mode === 'view' &&
          p.mode !== 'view' &&
          model.layout.stops[n.stopIndex]?.artworkId === want
        ) {
          pendingZoom.current = null;
          n.api?.zoom(want);
        }
      }),
    [model.layout],
  );
  // 나가기 창(W-08): 대문 앞 행동 키로 열린다. 창은 한 번에 하나 — 열리면 다른 덮개를 닫고 걷기 키를 끈다.
  // 본 작품 = 가까이 서거나 크게 보거나 정지 지점으로 멈춘 작품, 남긴 반응 = 내 반응(보낸 것 + 보낼 것)
  const exitOpen = useWalk(st => st.exitOpen);
  const seen = useRef(new Set<string>());
  useEffect(
    () =>
      useWalk.subscribe(n => {
        if (n.nearArtworkId) seen.current.add(n.nearArtworkId);
        if (n.zoomId) seen.current.add(n.zoomId);
        const stopArt = n.mode === 'view' ? model.layout.stops[n.stopIndex]?.artworkId : null;
        if (stopArt) seen.current.add(stopArt);
      }),
    [model.layout],
  );
  const [reacted, setReacted] = useState(0);
  useEffect(() => {
    if (!exitOpen) return;
    setReactingId(null);
    useMapOpen.setState({ open: false });
    setCollectionOpen(false);
    if (!services) return;
    const rt = reactionRuntime(services);
    const ex = view.exhibition.id;
    const count = (): number =>
      view.artworks.filter(a => rt.mine(ex, a.id) !== null || rt.outbox.get(reactionKey(ex, a.id)) !== null)
        .length;
    setReacted(count());
    let alive = true;
    void rt
      .loadMine({ code, exhibitionId: ex })
      .then(() => {
        if (alive) setReacted(count());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [exitOpen, services, view, code]);
  useWalkKeyboard(entered && reactingId === null && !collectionOpen && !exitOpen);
  // 동작 줄이기(PRD 8.4): 기기 설정을 따르고 바뀌면 따라간다
  const [reducedMotion, setReducedMotion] = useState(() => prefersReducedMotion(window));
  useEffect(() => {
    const mq = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!mq) return;
    const on = (): void => setReducedMotion(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // 배경음악(P4-7): 구역 → 전시실 곡, 켬/끔은 기기에 기억(없으면 이 화면 안에서만)
  const [region, setRegion] = useState('exterior');
  const [localSound, setLocalSound] = useState(true);
  const soundOn = sound?.on ?? localSound;
  const setSound = sound?.set ?? setLocalSound;
  useRoomMusic({ view, region, entered, on: soundOn });
  const live = useLiveVisit({
    code,
    token: liveToken,
    character,
    layout: model.layout,
    enabled: entered,
    as: liveAs,
  });
  // 끊김 띠(W-08): 이어져 있던 함께 관람이 `LIVE_LOST_BANNER_SEC` 넘게 다시 잇는 중이면 위 줄 아래 작은 띠 + `재접속하기`
  const [liveLost, setLiveLost] = useState(false);
  const wasLive = useRef(false);
  useEffect(() => {
    if (live.status === 'live') wasLive.current = true;
    if (live.status !== 'retrying' || !wasLive.current) {
      setLiveLost(false);
      return;
    }
    const t = window.setTimeout(() => setLiveLost(true), config().LIVE_LOST_BANNER_SEC * 1000);
    return () => window.clearTimeout(t);
  }, [live.status]);
  // 품질 단계는 캔버스를 다시 붙여도 이어 간다(내린 단계를 되돌리지 않음)
  const [device, setDevice] = useState<{ tier: Tier; kind: DeviceKind } | null>(null);
  const onLower = useCallback((tier: Tier) => setDevice(d => (d ? { ...d, tier } : d)), []);
  // 실기기 반응성 재기(ADR-070): 시작·내린 품질 단계
  const tierNow = device?.tier ?? null;
  useEffect(() => {
    if (tierNow) activeProbe()?.tier(tierNow);
  }, [tierNow]);
  const [ready, setReady] = useState(false);
  const onReady = useCallback((ready: boolean) => setReady(ready), []);
  // 컨텍스트 손실(§6.12): 기본 동작을 막고 "잠시만 기다려 주세요" → 복구되면 캔버스를 새로 붙여 같은 자리에서
  const [epoch, setEpoch] = useState(0);
  const epochRef = useRef(0);
  // 2D로 바꾸기(ADR-019): 한 번만 알린다
  const fellBack = useRef(false);
  const fallback = useRef(onFallback2d);
  fallback.current = onFallback2d;
  const fallBack = useCallback((reason: Fallback2dReason) => {
    if (fellBack.current) return;
    fellBack.current = true;
    fallback.current?.(reason);
  }, []);
  const lossTimes = useRef<number[]>([]);
  const webgl2 = useMemo(hasWebgl2, []);
  useEffect(() => {
    if (!webgl2) fallBack('webgl');
  }, [webgl2, fallBack]);
  const [lost, setLost] = useState(false);
  const resume = useRef<WalkStart | undefined>(undefined);
  // 배치가 바뀌면(P4-9): 캐릭터는 그 자리에서 새 벽으로 이어 가고(`WalkView`), 정지 지점은 새 배치에서 이어 볼 곳으로
  const shownLayout = useRef(model.layout);
  if (shownLayout.current !== model.layout) {
    const w = useWalk.getState();
    const cur = shownLayout.current.stops[w.stopIndex];
    const id = cur ? resumeStop(model.layout, cur) : null;
    resume.current = {
      x: w.me.x,
      z: w.me.z,
      yaw: w.me.yaw,
      stopIndex: Math.max(
        0,
        model.layout.stops.findIndex(st => st.id === id),
      ),
    };
    shownLayout.current = model.layout;
  }

  // 준비 막대: 받는 동안 천천히, 준비가 끝나면 1
  const progressRef = useRef(0.05);
  useEffect(() => {
    if (ready) {
      progressRef.current = 1;
      onProgress?.({ ready: true, progress: 1 });
      return;
    }
    onProgress?.({ ready: false, progress: progressRef.current });
    const t = window.setInterval(() => {
      progressRef.current += (PROGRESS_CAP - progressRef.current) * PROGRESS_EASE;
      onProgress?.({ ready: false, progress: progressRef.current });
    }, PROGRESS_TICK_MS);
    return () => window.clearInterval(t);
  }, [ready, onProgress]);

  return (
    <div
      className={s.stage}
      data-theme={STUDENT_THEME}
      data-testid="visit-screen"
      data-entered={entered ? '1' : '0'}
      data-ready={ready ? '1' : '0'}
      aria-hidden={entered ? undefined : true}
    >
      <Gestures>
        {webgl2 && (
          <CanvasGuard onError={() => fallBack('webgl')}>
            <Canvas
              key={epoch}
              frameloop="demand"
              dpr={dpr}
              gl={{
                antialias: dpr < config().MSAA_MAX_DPR,
                alpha: false,
                stencil: false,
                powerPreference: 'high-performance',
              }}
              camera={{ fov: config().VFOV_DEG, near: 0.05, far: 120, position: [0, 1, -30] }}
              onCreated={({ gl }) => {
                const caps = capsOf(gl);
                activeProbe()?.gpu(caps.gpu);
                setDevice(d => d ?? { tier: startTier(caps, null), kind: caps.kind });
                // 이 캔버스가 지금 것일 때만 듣는다 — 새로 붙일 때 R3F가 옛 캔버스에 일부러 손실을 일으킨다(forceContextLoss)
                const mine = epochRef.current;
                const el = gl.domElement;
                el.addEventListener('webglcontextlost', e => {
                  if (epochRef.current !== mine) return;
                  e.preventDefault();
                  const lim = config().FALLBACK_2D_CONTEXT_LOSSES;
                  const now = performance.now();
                  lossTimes.current = [...lossTimes.current, now].filter(
                    t => now - t <= lim.windowSec * 1000,
                  );
                  if (lossTimes.current.length >= lim.count) fallBack('context');
                  const w = useWalk.getState();
                  resume.current = { x: w.me.x, z: w.me.z, yaw: w.me.yaw, stopIndex: w.stopIndex };
                  setLost(true);
                });
                el.addEventListener('webglcontextrestored', () => {
                  if (epochRef.current !== mine) return;
                  epochRef.current = mine + 1;
                  setLost(false);
                  setEpoch(mine + 1);
                });
              }}
              onPointerMissed={e => {
                if (entered) tapFloor(e);
              }}
            >
              {device && (
                <VisitContent
                  model={model}
                  character={character}
                  device={device}
                  onLower={onLower}
                  start={resume.current}
                  entered={entered}
                  live={liveToken ? live : null}
                  onReady={onReady}
                  onLoadFail={() => fallBack('load')}
                  onRegion={setRegion}
                  onFallback={() => {
                    // 자동 시험(헤드리스 소프트웨어 그리기)은 늘 느려 3D 흐름을 볼 수 없게 된다 — 그때만 fps 전환을 끈다
                    // (전환 판정은 `TierMonitor` 단위 시험, 2D 화면은 WebGL을 끈 확인으로 따로 본다)
                    if (!navigator.webdriver) fallBack('fps');
                  }}
                  reducedMotion={reducedMotion}
                  onArtworkTap={onPickArtwork}
                />
              )}
            </Canvas>
          </CanvasGuard>
        )}
      </Gestures>
      {lost && (
        <div className={s.cover}>
          <LoadingMuseum
            className={s.coverFill}
            title={model.title}
            progress={PROGRESS_CAP * 100}
            statusText={copy.viewer.waitAMoment}
            subhintText=""
          />
        </div>
      )}
      {entered && !lost && (
        <WalkOverlay
          title={model.facade}
          layout={model.layout}
          artworks={model.artworks}
          liveCount={live.count > 0 ? live.count + 1 : 0}
          touch={touch}
          onHome={onHome}
          pendingUpdate={pendingUpdate}
          onApplyUpdate={onApplyUpdate}
          sound={{ on: soundOn, toggle: () => setSound(!soundOn) }}
          cards={model.cards}
          tracks={model.tracks}
          reactions={reactions}
          pages={zoomPages}
          partName={model.placeOf}
          onClose={onPickArtwork ? { label: copy.teacher.manage.previewClose, run: onHome } : undefined}
          onCollection={collection.length > 0 ? openCollection : undefined}
          reducedMotion={reducedMotion}
        />
      )}
      {entered && collectionOpen && (
        <CollectionSheet
          rooms={collection}
          roomTitle={id => view.rooms.find(r => r.id === id)?.title ?? ''}
          titleOf={id => model.artworks.find(a => a.id === id)?.title ?? ''}
          thumbOf={id => model.textures.urlOf(id, 'thumb')}
          cards={model.cards}
          initialRoomId={model.layout.parts.find(p => p.partId === region)?.roomId ?? null}
          onClose={() => setCollectionOpen(false)}
          onPick={(id, stopIndex) => {
            setCollectionOpen(false);
            pendingZoom.current = id;
            useWalk.getState().api?.goTo(stopIndex);
          }}
        />
      )}
      {entered && !exitOpen && (
        <LiveLostBanner visible={liveLost} onRejoin={() => window.location.reload()} />
      )}
      {entered && (
        <ExitSheet
          open={exitOpen}
          seen={seen.current.size}
          reacted={reacted}
          onClose={() => useWalk.getState().closeExit()}
          onLeave={onHome}
        />
      )}
      {services && entered && (
        <ReactionOutbox exhibitionId={view.exhibition.id} onPending={setReactPending} />
      )}
      {services && entered && reactingId && (
        <ReactionLayer
          key={reactingId}
          view={view}
          code={code}
          artworkId={reactingId}
          onClose={() => setReactingId(null)}
          onUnavailable={c => {
            if (c === 'E_REACTIONS_OFF') setReactionsOff(true);
          }}
        />
      )}
    </div>
  );
};

/** Canvas 안: 장면 + 품질 단계 재기 + 함께 관람 다시 그리기 */
const VisitContent = ({
  model,
  character,
  device,
  onLower,
  start,
  entered,
  live,
  onReady,
  onLoadFail,
  onRegion,
  onFallback,
  reducedMotion,
  onArtworkTap,
}: {
  model: VisitModel;
  character: CharacterId;
  device: { tier: Tier; kind: DeviceKind };
  onLower: (tier: Tier) => void;
  start: WalkStart | undefined;
  entered: boolean;
  live: LiveVisit | null;
  onReady: (ready: boolean) => void;
  onLoadFail: () => void;
  onRegion: (region: string) => void;
  onFallback: () => void;
  reducedMotion: boolean;
  onArtworkTap: ((artworkId: string) => void) | undefined;
}) => {
  const invalidate = useThree(st => st.invalidate);
  const size = useThree(st => st.size);
  const tier = device.tier;
  const fb = useRef(onFallback);
  fb.current = onFallback;
  const monitor = useMemo(
    () => new TierMonitor(tier, device.kind, onLower, () => fb.current()),
    [tier, device.kind, onLower],
  );
  const last = useRef<number | null>(null);
  useFrame(() => {
    const now = performance.now();
    const prev = last.current;
    last.current = now;
    if (prev === null || !entered) return;
    activeProbe()?.frame(now - prev);
    const dt = (now - prev) / 1000;
    // 이어 그린 프레임 = 움직이는 구간(멈춘 화면은 그리지 않으므로 긴 틈 뒤 첫 프레임이 구간 끝)
    monitor.frame(dt, dt < 0.1);
  });

  useEffect(() => {
    if (!live) return;
    live.wake.current = invalidate;
    return () => {
      live.wake.current = () => {};
    };
  }, [live, invalidate]);

  const peers = useMemo(
    () =>
      live
        ? {
            sample: () => live.buffer.sample(Date.now()),
            busy: () => live.buffer.busy(Date.now()),
            labelOf: peerLabel,
            maxFull: visibleMaxFor(Math.min(size.width, size.height), navigator.maxTouchPoints > 0),
            invalidate,
          }
        : null,
    [live, invalidate, size.width, size.height],
  );
  const assets = templateAssets[model.layout.templateId];
  return (
    <VisitorScene
      layout={model.layout}
      look={model.look}
      modulesUrl={modulesFor(assets, model.layout.schemaVersion)}
      fixturesUrl={assets.fixtures}
      title={model.title}
      artworks={model.artworks}
      holders={model.holders}
      character={character}
      tier={tier}
      placeOf={model.placeOf}
      peers={peers}
      textures={model.textures}
      cards={model.cards}
      paused={!entered}
      onPose={live?.sendPose}
      onJump={live?.sendJump}
      onReady={onReady}
      onLoadFail={onLoadFail}
      onRegion={onRegion}
      start={start}
      reducedMotion={reducedMotion}
      onArtworkTap={onArtworkTap}
      signRooms={model.signRooms}
      signAreas={assets.signAreas}
    />
  );
};

/** 그림 받기 입력의 서명: 전시·배치 해시·작품마다 그림 자산과 변형 크기 */
const textureSig = (m: VisitModel): string =>
  `${m.layout.hash}|${m.textures.arts.map(a => `${a.id}:${a.partId}:${a.order}:${JSON.stringify(a.sizes)}:${m.textures.urlOf(a.id, 'thumb') ?? ''}`).join(',')}`;

/**
 * 같은 서명이면 앞 모델의 `textures`·`holders`를 그대로 쓴다(새 객체면 상주 관리가 처음부터 다시 받는다).
 * 작품 글(제목·캡션)·카드 글은 새 것.
 */
const useStableModel = (next: VisitModel): VisitModel => {
  const prev = useRef<VisitModel | null>(null);
  const p = prev.current;
  let out = next;
  if (p && p !== next) {
    const sameTex = textureSig(p) === textureSig(next);
    const sameIds =
      p.artworks.length === next.artworks.length && p.artworks.every((a, i) => a.id === next.artworks[i]?.id);
    if (sameTex || sameIds)
      out = {
        ...next,
        ...(sameTex ? { textures: p.textures } : {}),
        ...(sameIds ? { holders: p.holders } : {}),
      };
  }
  prev.current = out;
  return out;
};

/** 이 기기에서 WebGL2를 만들 수 있는가(만들어 본 것은 바로 놓는다) */
const hasWebgl2 = (): boolean => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
};

/** 캔버스를 만들다 실패하면(그리기 장치를 못 얻음) 2D로 — 빈 화면을 남기지 않는다 */
class CanvasGuard extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(): void {
    this.props.onError();
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * 반응 보내기 줄(ADR-049)을 관람 중 늘 살려 둔다: 처음 불릴 때 줄을 만들고, 지난 탭이 남긴 것을 보내며,
 * `online`·화면 복귀·60초 확인이 돈다. 남은 것이 있는지는 반응 단추의 작은 점에 쓸 자리(부품 속성이 생기면)
 */
const ReactionOutbox = ({
  exhibitionId,
  onPending,
}: {
  exhibitionId: string;
  onPending: (pending: boolean) => void;
}) => {
  const pending = useReactionPending(exhibitionId);
  useEffect(() => onPending(pending), [pending, onPending]);
  return null;
};
