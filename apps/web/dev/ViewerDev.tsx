import { copy } from '@gallery/core/copy';
import { config } from '@gallery/core/config';
import { templateLooks } from '@gallery/core/templates';
import { Canvas } from '@react-three/fiber';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { mapView } from '../src/viewer/map/mapView.ts';
import { ArtworkFrame } from '../src/viewer/scene/ArtworkFrame.tsx';
import { Stage } from '../src/viewer/scene/Stage.tsx';
import { TemplateModules, useTemplateModules } from '../src/viewer/scene/TemplateModules.tsx';
import coreUrl from '../src/tpl/modern-history/core.glb?url';
import type { DimHolder } from '../src/viewer/scene/materials.ts';
import { DevController } from './DevController.tsx';
import { buildTestExhibition, placementsOf, type TestExhibition } from './testExhibition.ts';
import s from './ViewerDev.module.css';
import { useDevViewer } from './viewerDevStore.ts';

/**
 * `/dev/viewer` — 관람 엔진 뼈대(P1-4)가 배치 엔진의 실제 출력(P2-7)을 조립하는 확인 화면, 관문 G1 실기기 화면.
 * 확인할 것: 정지 지점 이동(‹ ›·스와이프·← →), 연타해도 한 칸, 작품 누르면 0.8초 줌 + 캡션, 줌 HTML 층이 3D 그림과
 * 겹치는가(`?blink=1`로 깜빡여 비교), 정지 상태에서 다시 그리기 0(아래 숫자), 프레임·그리기 호출·삼각형.
 * `?rooms=n`(1~17): 6점짜리 전시실 n개(최대 100점대). 액자는 지금 관과 이웃 관만 그린다(PLAN §6.6의 간단한 형태).
 */

const dprCap = (): number => {
  const c = config();
  const short = Math.min(window.screen.width, window.screen.height);
  const touch = navigator.maxTouchPoints > 0;
  const cap = !touch ? c.DPR_CAP_DESKTOP : short < 600 ? c.DPR_CAP_PHONE : c.DPR_CAP_TABLET;
  return Math.min(window.devicePixelRatio || 1, cap);
};

const LOOK = templateLooks['modern-history'];

export const ViewerDev = () => {
  const exhibition = useMemo(buildTestExhibition, []);
  const artworks = exhibition.artworks;
  const holders = useMemo<Record<string, DimHolder>>(
    () => Object.fromEntries(artworks.map(a => [a.id, { value: 1 }])),
    [artworks],
  );
  const dpr = useMemo(dprCap, []);
  const api = useDevViewer(st => st.api);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') api?.next();
      else if (e.key === 'ArrowLeft') api?.prev();
      else if (e.key === 'Enter') api?.zoomCurrent();
      else if (e.key === 'Escape') api?.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api]);

  return (
    <div className={s.stage}>
      <Gestures>
        <Canvas
          frameloop="demand"
          dpr={dpr}
          gl={{
            antialias: dpr < config().MSAA_MAX_DPR,
            alpha: false,
            stencil: false,
            powerPreference: 'high-performance',
          }}
          camera={{
            fov: config().VFOV_DEG,
            near: 0.05,
            far: 60,
            position: [0, config().CAMERA_HEIGHT_M, -1.2],
          }}
        >
          <Stage look={LOOK} />
          <Room exhibition={exhibition} />
          <Frames exhibition={exhibition} holders={holders} onTap={id => api?.zoom(id)} />
          <DevController exhibition={exhibition} holders={holders} />
        </Canvas>
      </Gestures>
      <Nav />
      {new URLSearchParams(window.location.search).has('map') && <DevMap exhibition={exhibition} />}
      <ZoomOverlay artworks={artworks} />
      <Hud />
    </div>
  );
};

/** 방: 배치의 조각 목록을 Blender로 만든 근대 역사관 조각(P1-3)으로 조립한다. 불러오는 동안은 비어 있다. */
const Room = ({ exhibition }: { exhibition: TestExhibition }) => {
  const modules = useTemplateModules(coreUrl, LOOK);
  const placements = useMemo(() => placementsOf(exhibition.layout), [exhibition]);
  if (!modules) return null;
  return <TemplateModules modules={modules} placements={placements} />;
};

/** 지금 정지 지점의 관과 그 이웃 관의 액자만(그리기 호출 예산, PRD 10.2) */
const Frames = ({
  exhibition,
  holders,
  onTap,
}: {
  exhibition: TestExhibition;
  holders: Readonly<Record<string, DimHolder>>;
  onTap: (id: string) => void;
}) => {
  const stopIndex = useDevViewer(st => st.stopIndex);
  const { layout, artworks } = exhibition;
  const visible = useMemo(() => {
    const order = layout.parts.map(p => p.partId);
    const stop = layout.stops.filter(x => x.kind !== 'exterior')[stopIndex];
    const at =
      stop?.partId != null ? order.indexOf(stop.partId) : stop?.kind === 'exit' ? order.length - 1 : 0;
    return new Set(order.filter((_, i) => Math.abs(i - at) <= 1));
  }, [layout, stopIndex]);
  const partOf = useMemo(() => new Map(layout.frames.map(f => [f.artworkId, f.partId])), [layout]);
  return (
    <>
      {artworks
        .filter(a => visible.has(partOf.get(a.id) ?? ''))
        .map(a => (
          <ArtworkFrame key={a.id} artwork={a} holder={holders[a.id]!} onTap={onTap} />
        ))}
    </>
  );
};

/** 한 손가락 끌기 = 둘러보기, 빠르게 쓸기 = 이전·다음(PLAN §6.9). 놓는 순간에 가른다. */
const Gestures = ({ children }: { children: ReactNode }) => {
  const api = useDevViewer(st => st.api);
  const start = useRef<{ x: number; y: number; t: number; id: number; dragging: boolean } | null>(null);
  const c = config();
  return (
    <div
      className={s.canvasWrap}
      onPointerDown={e => {
        // 누르기만 하면 포인터를 잡지 않는다 — 잡으면 캔버스(R3F)의 작품 누르기가 사라진다.
        start.current = {
          x: e.clientX,
          y: e.clientY,
          t: performance.now(),
          id: e.pointerId,
          dragging: false,
        };
      }}
      onPointerMove={e => {
        const st = start.current;
        if (!st || st.id !== e.pointerId) return;
        const dx = e.clientX - st.x;
        const dy = e.clientY - st.y;
        if (!st.dragging && Math.hypot(dx, dy) > c.TAP_MAX_PX) {
          st.dragging = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        if (st.dragging) api?.look(-dx * c.LOOK_DEG_PER_PX, -dy * c.LOOK_DEG_PER_PX);
      }}
      onPointerUp={e => {
        const st = start.current;
        start.current = null;
        api?.releaseLook();
        if (!st) return;
        const dx = e.clientX - st.x;
        const dy = e.clientY - st.y;
        const dt = performance.now() - st.t;
        const velocity = Math.abs(dx) / Math.max(1, dt);
        const swipe =
          Math.abs(dx) >= c.SWIPE_MIN_PX &&
          Math.abs(dx) >= c.SWIPE_AXIS_RATIO * Math.abs(dy) &&
          dt <= c.SWIPE_MAX_MS &&
          velocity >= c.SWIPE_MIN_VELOCITY;
        if (swipe) (dx < 0 ? api?.next : api?.prev)?.();
      }}
      onPointerCancel={() => {
        start.current = null;
        api?.releaseLook();
      }}
      onLostPointerCapture={() => {
        start.current = null;
        api?.releaseLook();
      }}
    >
      {children}
    </div>
  );
};

/** `?map=1`: 배치의 지도(P2-7 확인용 — 실제 지도 화면 RoomMap은 P4, 스타일은 토큰) */
const DevMap = ({ exhibition }: { exhibition: TestExhibition }) => {
  const stopIndex = useDevViewer(st => st.stopIndex);
  const stop = exhibition.layout.stops.filter(x => x.kind !== 'exterior')[stopIndex];
  const view = useMemo(
    () => mapView(exhibition.layout.map, stop ? [stop.anchor.target[0], stop.anchor.target[2]] : null),
    [exhibition, stop],
  );
  return (
    <svg className={s.devMap} viewBox={view.viewBox} data-testid="dev-map" aria-hidden="true">
      {view.outline.map(points => (
        <polygon key={points} points={points} fill="#e9dfcc" stroke="#3b2b1f" strokeWidth={0.12} />
      ))}
      {view.parts.map(p => (
        <g key={p.partId}>
          <polygon points={p.points} fill="#f4ecdd" stroke="#3b2b1f" strokeWidth={0.12} />
          <text x={p.label.x} y={p.label.y} fontSize={1.2} textAnchor="middle" fill="#3b2b1f">
            {exhibition.roomTitles.get(p.partId.split(':')[0] ?? '') ?? ''}
          </text>
        </g>
      ))}
      {view.doors.map(d => (
        <line key={`${d.x1},${d.y1}`} {...d} stroke="#b9873a" strokeWidth={0.3} />
      ))}
      {view.here && <circle cx={view.here.x} cy={view.here.y} r={0.6} fill="#b23b2e" />}
    </svg>
  );
};

const Nav = () => {
  const label = useDevViewer(st => st.label);
  const api = useDevViewer(st => st.api);
  const zoomed = useDevViewer(st => st.zoomId !== null);
  if (zoomed) return null;
  return (
    <nav className={s.nav}>
      <button type="button" className={s.navButton} aria-label={copy.viewer.prev} onClick={() => api?.prev()}>
        ‹
      </button>
      <span className={s.navLabel} aria-live="polite">
        {label}
      </span>
      <button type="button" className={s.navButton} aria-label={copy.viewer.next} onClick={() => api?.next()}>
        ›
      </button>
    </nav>
  );
};

const ZoomOverlay = ({ artworks }: { artworks: TestExhibition['artworks'] }) => {
  const zoomId = useDevViewer(st => st.zoomId);
  const rect = useDevViewer(st => st.overlayRect);
  const captionVisible = useDevViewer(st => st.captionVisible);
  const api = useDevViewer(st => st.api);
  const params = new URLSearchParams(window.location.search);
  // ?blink=1: HTML 그림을 깜빡여 3D 그림과 비교 / ?ghost=1: 반투명 + 빨간 테두리로 겹쳐 어긋남을 눈으로 확인
  const blink = params.has('blink');
  const ghost = params.has('ghost');
  const artwork = artworks.find(a => a.id === zoomId);
  if (!artwork) return null;
  return (
    <div className={s.zoomLayer} role="dialog" aria-label={artwork.title}>
      {rect && (
        <img
          className={blink ? `${s.zoomImage} ${s.blink}` : s.zoomImage}
          src={artwork.imageSrc ?? undefined}
          alt=""
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            ...(ghost ? { opacity: 0.5, outline: '1px solid #ff3b30', animation: 'none' } : {}),
          }}
          data-testid="zoom-image"
        />
      )}
      <button type="button" className={s.close} onClick={() => api?.close()}>
        {copy.viewer.close}
      </button>
      <div className={captionVisible ? `${s.caption} ${s.captionIn}` : s.caption}>
        <strong>
          {artwork.title} · {artwork.author}
        </strong>
        <span>{artwork.caption}</span>
      </div>
    </div>
  );
};

const Hud = () => {
  const perf = useDevViewer(st => st.perf);
  const mark = useDevViewer(st => st.idleFrameMark);
  const rigState = useDevViewer(st => st.rigState);
  const rect = useDevViewer(st => st.overlayRect);
  const idleRedraws =
    rigState === 'idle' || rigState === 'zoomed' ? Math.max(0, perf.framesRendered - mark) : 0;
  return (
    <pre className={s.hud} data-testid="perf-hud">
      {[
        `state ${rigState}`,
        `fps(move) ${perf.fps}`,
        `calls ${perf.calls}  tris ${perf.triangles}`,
        `tex ${perf.textures}  geo ${perf.geometries}`,
        `frames ${perf.framesRendered}  idle-redraw ${idleRedraws}`,
        `dpr ${window.devicePixelRatio} → ${Math.min(window.devicePixelRatio, dprCap())}`,
        rect
          ? `zoom rect ${rect.left.toFixed(1)},${rect.top.toFixed(1)} ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}`
          : '',
      ].join('\n')}
    </pre>
  );
};
