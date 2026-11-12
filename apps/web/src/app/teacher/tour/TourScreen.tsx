import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { planTour, type TourMusic } from '@gallery/core/tour';
import { type ExhibitionView, mediaPath, type TourSettings } from '@gallery/core/types';
import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import '../../../ui/tokens.css';
import '../../../ui/themes/modern-history.css';
import { TourSoundtrack } from '../../../audio/tourSoundtrack.ts';
import { Icon } from '../../../ui/Icon.tsx';
import { deviceKindOf, osOf, startTier } from '../../../viewer/quality/tier.ts';
import { templateAssets } from '../../../viewer/scene/templateAssets.ts';
import type { Tier } from '../../../viewer/textures/residency.ts';
import { tourInputOf } from '../../../viewer/tour/tourCamera.ts';
import { type TourClock, TourDriver } from '../../../viewer/tour/TourDriver.tsx';
import { VisitorScene } from '../../../viewer/VisitorScene.tsx';
import { useServices } from '../../services.ts';
import { dprCap } from '../../visit/walkUi.tsx';
import { visitModelOf } from '../../visit/visitModel.ts';
import { previewViewOf } from './previewView.ts';
import s from './TourScreen.module.css';

/**
 * 자동 투어(P5-9, G-16, PLAN §6.13): 교사가 교실 화면에 띄우는 전시 한 바퀴. 시간표(`planTour`) → 카메라(`TourDriver`)
 * · 전시실 배경음악 이음(`TourSoundtrack`). `투어 시작하기` 누름 안에서 소리를 풀고 전체 화면을 청한다.
 * 조작: 재생/멈춤(스페이스) · 진행 막대(끌기·좌우 키 10초) · 끝내기(Esc).
 */
const SEEK_STEP_SEC = 10;

const mmss = (sec: number): string => {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export const TourScreen = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const services = useServices();
  const [view, setView] = useState<{ view: ExhibitionView; tour: TourSettings } | null | 'empty'>(null);
  useEffect(() => {
    const ac = new AbortController();
    services.api.teacher
      .exhibition(id, { signal: ac.signal })
      .then(t => {
        const v = previewViewOf(t);
        setView(v ? { view: v, tour: t.exhibition.settings.tour } : 'empty');
      })
      .catch(() => {
        if (!ac.signal.aborted) setView('empty');
      });
    return () => ac.abort();
  }, [id, services]);
  const back = useCallback(() => navigate(`/t/e/${encodeURIComponent(id)}`), [id, navigate]);
  if (view === null)
    return (
      <section className={s.notice} data-testid="tour-loading">
        {copy.tour.loading}
      </section>
    );
  if (view === 'empty')
    return (
      <section className={s.notice} data-testid="tour-empty">
        <p>{copy.tour.empty}</p>
        <button type="button" className={s.secondary} onClick={back}>
          {copy.tour.back}
        </button>
      </section>
    );
  return <TourPlayer view={view.view} tour={view.tour} onExit={back} />;
};

const TourPlayer = ({
  view,
  tour,
  onExit,
}: {
  view: ExhibitionView;
  tour: TourSettings;
  onExit: () => void;
}) => {
  const model = useMemo(() => visitModelOf(view), [view]);
  const layout = model.layout;
  const bgmOf = useMemo(() => new Map(view.rooms.map(r => [r.id, r.bgm])), [view.rooms]);
  const plan = useMemo(() => {
    const musicOf = (roomId: string): TourMusic | null => {
      const b = bgmOf.get(roomId);
      return b
        ? {
            durationMs: b.durationMs,
            audibleStartMs: b.analysis.audibleStartMs,
            audibleEndMs: b.analysis.audibleEndMs,
            loudnessDb: b.analysis.loudnessDb,
          }
        : null;
    };
    return planTour(tourInputOf(layout, musicOf, tour));
  }, [layout, bgmOf, tour]);
  const clock = useRef<TourClock>({ t: 0, playing: false }).current;
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [tier, setTier] = useState<Tier | null>(null);
  const sound = useRef<TourSoundtrack | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const dpr = useMemo(dprCap, []);

  const setPlay = useCallback(
    (on: boolean) => {
      if (on && clock.t >= plan.totalSec) clock.t = 0;
      clock.playing = on;
      setPlaying(on);
      setNow(clock.t);
    },
    [clock, plan.totalSec],
  );
  const seek = useCallback(
    (t: number) => {
      clock.t = Math.max(0, Math.min(plan.totalSec, t));
      setNow(clock.t);
    },
    [clock, plan.totalSec],
  );

  const start = async (): Promise<void> => {
    try {
      const ctx = new AudioContext();
      await ctx.resume();
      audio.current = ctx;
      sound.current = new TourSoundtrack(ctx, plan, {
        urlOf: roomId => {
          const b = bgmOf.get(roomId);
          const v = b?.asset.variants.find(x => x.name === 'audio') ?? b?.asset.variants[0];
          return b && v ? mediaPath(view.exhibition.id, b.asset.assetId, v) : null;
        },
      });
    } catch {
      // 소리 없이도 투어는 된다
    }
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    setStarted(true);
    setPlay(true);
  };

  useEffect(
    () => () => {
      sound.current?.dispose();
      void audio.current?.close().catch(() => undefined);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (!started) return;
    const key = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        e.preventDefault();
        setPlay(!clock.playing);
      } else if (e.code === 'ArrowRight') seek(clock.t + SEEK_STEP_SEC);
      else if (e.code === 'ArrowLeft') seek(clock.t - SEEK_STEP_SEC);
      else if (e.code === 'Escape') onExit();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [started, clock, seek, setPlay, onExit]);

  // 진행 막대는 1초에 한 번만 다시 그린다(3D 프레임마다 React를 돌리지 않게)
  const lastShown = useRef(-1);
  const onTick = useCallback(
    (t: number, isPlaying: boolean) => {
      sound.current?.sync(t, isPlaying);
      const whole = Math.floor(t);
      if (whole !== lastShown.current) {
        lastShown.current = whole;
        setNow(t);
      }
      if (!isPlaying && playing) setPlaying(false);
    },
    [playing],
  );

  const assets = templateAssets[layout.templateId];
  const c = config();
  return (
    <div
      className={s.stage}
      data-theme={layout.templateId}
      data-testid="tour-screen"
      data-playing={playing ? '1' : '0'}
    >
      <Canvas
        frameloop="demand"
        dpr={dpr}
        gl={{
          antialias: dpr < c.MSAA_MAX_DPR,
          alpha: false,
          stencil: false,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: c.VFOV_DEG, near: 0.05, far: 120 }}
        onCreated={({ gl }) => {
          const ctx = gl.getContext();
          const info = ctx.getExtension('WEBGL_debug_renderer_info');
          const touch = navigator.maxTouchPoints;
          setTier(
            startTier(
              {
                webgl2:
                  typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext,
                maxTextureSize: gl.capabilities.maxTextureSize,
                gpu: info ? String(ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '') : '',
                kind: deviceKindOf(touch, Math.min(window.screen.width, window.screen.height)),
                os: osOf(navigator.userAgent, touch),
              },
              null,
            ),
          );
        }}
      >
        {tier && (
          <VisitorScene
            layout={layout}
            look={model.look}
            modulesUrl={assets.modules}
            fixturesUrl={assets.fixtures}
            title={model.title}
            artworks={model.artworks}
            holders={model.holders}
            character="teacher-m"
            tier={tier}
            placeOf={model.placeOf}
            textures={model.textures}
            cards={model.cards}
            controller={onRegion => (
              <TourDriver layout={layout} plan={plan} clock={clock} onRegion={onRegion} onTick={onTick} />
            )}
          />
        )}
      </Canvas>
      {!started ? (
        <div className={s.cover}>
          <h1 className={s.title}>{model.facade}</h1>
          <p className={s.hint}>{copy.tour.startHint}</p>
          <p className={s.hint} data-testid="tour-preload-hint">
            {copy.teacher.preload.tourHint}
          </p>
          <button type="button" className={s.primary} onClick={() => void start()} data-testid="tour-start">
            <Icon name="play" />
            <span>{copy.tour.start}</span>
          </button>
          <button type="button" className={s.secondary} onClick={onExit}>
            {copy.tour.back}
          </button>
        </div>
      ) : (
        <div className={s.bar} data-testid="tour-bar">
          <button
            type="button"
            className={s.round}
            onClick={() => setPlay(!playing)}
            aria-label={playing ? copy.tour.pause : copy.tour.play}
            data-testid="tour-toggle"
          >
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <input
            id="tour-progress"
            className={s.range}
            type="range"
            min={0}
            max={Math.round(plan.totalSec)}
            step={1}
            value={Math.round(now)}
            aria-label={copy.tour.progress}
            onChange={e => seek(Number(e.target.value))}
          />
          <span className={s.time}>
            {fill(copy.tour.time, { now: mmss(now), total: mmss(plan.totalSec) })}
          </span>
          <button type="button" className={s.secondary} onClick={onExit} data-testid="tour-exit">
            {copy.tour.exit}
          </button>
        </div>
      )}
    </div>
  );
};
