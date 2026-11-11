import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { type CameraPose, frameAnchorOf, frameCamera, stopFraming, zoomFraming } from '@gallery/core/layout';
import type { Stop as LayoutStop } from '@gallery/core/types';
import { useFrame, useThree } from '@react-three/fiber';
import gsap from 'gsap';
import { useEffect, useMemo, useRef } from 'react';
import { type PerspectiveCamera, Vector3 } from 'three';
import { CameraRig } from '../src/viewer/camera/CameraRig.ts';
import { type DimHolder, sceneDim } from '../src/viewer/scene/materials.ts';
import { anchorOf, artPlaneOffsetOf, type ViewerArtwork } from '../src/viewer/scene/types.ts';
import type { TestExhibition } from './testExhibition.ts';
import { type ScreenRect, useDevViewer } from './viewerDevStore.ts';

/** 줌에서 캡션 카드가 가리는 화면 아래 비율(P1 뼈대는 고정값, P4-4에서 카드 높이를 재서 넣음) */
const CAPTION_INSET = 0.22;

interface Stop {
  readonly stop: LayoutStop;
  /** 작품 정지 지점이면 그 작품 */
  readonly artwork: ViewerArtwork | null;
}

/** 한 칸보다 먼 곳(모아 보기·지도로 가기)은 어둡게 바꿔 옮긴다(PLAN §4.8·§6.7) */
const FADE_SEC = 0.3;

/**
 * Canvas 안의 컨트롤러(P1-4): 정지 지점 이동, 줌·줌 풀기, 장면 어둡게, 줌 HTML 층 사각형 계산.
 * 규칙(PLAN §6.7): 움직이는 동안 들어온 `‹ ›`는 버린다(연타해도 한 칸). 줌 중 닫기는 지금 자리에서 되돌린다.
 */
export const DevController = ({
  exhibition,
  holders,
}: {
  exhibition: TestExhibition;
  holders: Readonly<Record<string, DimHolder>>;
}) => {
  const { camera, invalidate, size } = useThree();
  const rig = useMemo(() => new CameraRig(camera as PerspectiveCamera, invalidate), [camera, invalidate]);
  const stops = useMemo<Stop[]>(() => {
    const byId = new Map(exhibition.artworks.map(a => [a.id, a]));
    // 정해진 정지 지점 화면(`/dev/viewer`)은 홀부터 — 광장·계단은 자유 관람(`/dev/walk`)에서 본다(ADR-057)
    return exhibition.layout.stops
      .filter(stop => stop.kind !== 'exterior')
      .map(stop => ({
        stop,
        artwork: stop.artworkId ? (byId.get(stop.artworkId) ?? null) : null,
      }));
  }, [exhibition]);
  const legs = useMemo(
    () => new Map(exhibition.layout.legs.map(l => [`${l.from}>${l.to}`, l.waypoints])),
    [exhibition],
  );
  const index = useRef(0);
  const focus = useRef<string | null>(null);
  const captionCall = useRef<gsap.core.Tween | null>(null);
  const aspect = size.width / Math.max(1, size.height);
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const set = useDevViewer(s => s.set);

  const stopPose = (i: number): CameraPose => {
    const s = stops[i] ?? stops[0]!;
    const anchor = s.artwork ? anchorOf(s.artwork) : frameAnchorOf(s.stop.anchor);
    return frameCamera(anchor, { aspect: aspectRef.current }, stopFraming());
  };
  const zoomPose = (a: ViewerArtwork): CameraPose =>
    frameCamera(anchorOf(a), { aspect: aspectRef.current, insetBottom: CAPTION_INSET }, zoomFraming());

  const partTitle = (partId: string | null): string => {
    const part = exhibition.layout.parts.find(p => p.partId === partId);
    if (!part) return exhibition.title;
    const room = exhibition.roomTitles.get(part.roomId) ?? '';
    return part.partCount > 1 ? fill(copy.viewer.partName, { room, part: part.partIndex + 1 }) : room;
  };
  /** 위치 표시(PLAN §4.7): 작품 = `{관} · {번호}/{수}`, 소개 = `{관} · 소개`, 홀·출구 = 전시 이름 */
  const labelOf = (i: number): string => {
    const st = stops[i]?.stop;
    if (!st || st.kind === 'hall' || st.kind === 'exit') return exhibition.title;
    const room = partTitle(st.partId);
    if (st.kind === 'roomIntro') return fill(copy.viewer.stopIntro, { room });
    return fill(copy.viewer.stopArtwork, { room, index: st.index ?? 0, count: st.count ?? 0 });
  };

  /** 줌 대상만 1, 나머지는 장면 값을 따른다 */
  const syncDim = (): void => {
    for (const [id, h] of Object.entries(holders)) h.value = id === focus.current ? 1 : sceneDim.value;
  };
  const tweenDim = (to: number, seconds: number): void => {
    gsap.to(sceneDim, {
      value: to,
      duration: seconds,
      ease: 'power2.out',
      overwrite: true,
      onUpdate: () => {
        syncDim();
        invalidate();
      },
    });
  };

  /** 그림 면 네 모서리를 화면에 투영한 사각형(CSS px, Canvas 기준) */
  const artRect = (a: ViewerArtwork): ScreenRect => {
    const n = new Vector3(a.normal.x, a.normal.y, a.normal.z).normalize();
    const up = new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(n.clone().negate(), up).normalize();
    const c = new Vector3(a.center.x, a.center.y, a.center.z).addScaledVector(n, artPlaneOffsetOf(a));
    const xs: number[] = [];
    const ys: number[] = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const p = c
          .clone()
          .addScaledVector(right, (sx * a.art.w) / 2)
          .addScaledVector(up, (sy * a.art.h) / 2)
          .project(camera);
        xs.push(((p.x + 1) / 2) * sizeRef.current.width);
        ys.push(((1 - p.y) / 2) * sizeRef.current.height);
      }
    }
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  };

  const announce = (): void => {
    set({
      stopIndex: index.current,
      stopCount: stops.length,
      label: labelOf(index.current),
      rigState: rig.state,
    });
  };
  const markIdle = (): void => {
    // 끝 자세를 그리는 마지막 한 프레임까지는 "정지 전"으로 친다.
    set({ idleFrameMark: frameCounter.value + 1, rigState: rig.state });
  };

  /** 한 칸보다 먼 곳: 어둡게 → 옮김 → 밝게 */
  const fadeTo = (i: number): void => {
    const to = stopPose(i);
    index.current = i;
    rig.state = 'moving';
    announce();
    gsap.to(sceneDim, {
      value: 0,
      duration: FADE_SEC,
      ease: 'power1.in',
      overwrite: true,
      onUpdate: () => {
        syncDim();
        invalidate();
      },
      onComplete: () => {
        rig.jumpTo(to, 'moving');
        gsap.to(sceneDim, {
          value: 1,
          duration: FADE_SEC,
          ease: 'power1.out',
          onUpdate: () => {
            syncDim();
            invalidate();
          },
          onComplete: () => {
            rig.state = 'idle';
            announce();
            markIdle();
          },
        });
      },
    });
  };

  const goTo = (i: number): void => {
    if (rig.busy || i < 0 || i >= stops.length) return;
    const from = stops[index.current]?.stop.id;
    const target = stops[i]?.stop.id;
    if (Math.abs(i - index.current) > 1) {
      fadeTo(i);
      return;
    }
    // 관 사이(경로점이 있는 구간)는 경로를 따라 걷는다. 거꾸로 가면 경로점을 뒤집는다.
    const forward = legs.get(`${from}>${target}`);
    const waypoints = forward ?? [...(legs.get(`${target}>${from}`) ?? [])].reverse();
    if (waypoints.length > 0) {
      index.current = i;
      const walking = rig.animateAlong(waypoints, stopPose(i), 'moving', 'idle');
      announce();
      void walking.then(done => done && markIdle());
      return;
    }
    index.current = i;
    const to = stopPose(i);
    // 이동을 시작한 뒤에 알린다 — 그래야 바깥에서 "움직이는 중"을 본다(시작 전 값이 남지 않게).
    const moving = rig.animateTo(to, rig.stopMoveSeconds(to), 'moving', 'idle');
    announce();
    void moving.then(done => done && markIdle());
  };

  const zoom = (id: string): void => {
    if (rig.busy) return;
    const i = stops.findIndex(s => s.artwork?.id === id);
    const stop = stops[i];
    if (!stop?.artwork) return;
    const artwork = stop.artwork;
    const c = config();
    const wasZoomed = rig.state === 'zoomed';
    index.current = i;
    focus.current = id;
    set({ zoomId: id, overlayRect: null, captionVisible: false });
    tweenDim(c.ZOOM_DIM, c.T_ZOOM);
    captionCall.current?.kill();
    captionCall.current = gsap.delayedCall(c.T_ZOOM_CAPTION_START, () => set({ captionVisible: true }));
    const seconds = wasZoomed ? c.T_ZOOM_NEXT : c.T_ZOOM;
    const zooming = rig.animateTo(zoomPose(artwork), seconds, 'zooming', 'zoomed');
    announce();
    void zooming.then(done => {
      if (!done) return;
      set({ overlayRect: artRect(artwork) });
      markIdle();
    });
  };

  const close = (): void => {
    if (rig.state !== 'zoomed' && rig.state !== 'zooming') return;
    const c = config();
    focus.current = null;
    captionCall.current?.kill();
    set({ overlayRect: null, captionVisible: false, zoomId: null });
    tweenDim(1, c.T_UNZOOM);
    const closing = rig.animateTo(stopPose(index.current), c.T_UNZOOM, 'unzooming', 'idle');
    set({ rigState: rig.state });
    void closing.then(done => done && markIdle());
  };

  const step = (delta: 1 | -1): void => {
    if (rig.state === 'zoomed') {
      // 줌 상태에서 ‹ ›: 같은 관의 이웃 작품으로 줌 상태 그대로(PLAN §6.8). 처음·끝을 넘으면 줌을 푼다.
      const next = stops[index.current + delta];
      if (next?.artwork) zoom(next.artwork.id);
      else close();
      return;
    }
    goTo(index.current + delta);
  };

  // 컨트롤러 api 등록과 첫 자세
  useEffect(() => {
    rig.jumpTo(stopPose(0), 'idle');
    announce();
    markIdle();
    set({
      api: {
        next: () => step(1),
        prev: () => step(-1),
        zoom,
        zoomCurrent: () => {
          const artwork = stops[index.current]?.artwork;
          if (artwork) zoom(artwork.id);
        },
        close,
        look: (yaw, pitch) => {
          if (rig.state === 'idle') rig.setLook(yaw, pitch);
        },
        releaseLook: () => rig.releaseLook(),
      },
    });
    return () => rig.dispose();
    // 컨트롤러는 한 번만 붙는다(함수들은 ref로 최신 값을 읽는다). 화면 크기 변경은 아래 효과가 맡는다.
  }, [rig]);

  // 화면 크기·방향이 바뀌면 지금 자세를 애니메이션 없이 다시 맞춘다(PRD 9.5, PLAN §6.7).
  useEffect(() => {
    if (rig.state === 'idle') rig.jumpTo(stopPose(index.current), 'idle');
    if (rig.state === 'zoomed') {
      const artwork = stops[index.current]?.artwork;
      if (artwork) {
        rig.jumpTo(zoomPose(artwork), 'zoomed');
        set({ overlayRect: artRect(artwork) });
      }
    }
  }, [size.width, size.height]);

  return <PerfProbe />;
};

/** 그린 프레임 수. 정지 상태에서는 useFrame이 불리지 않으므로 늘지 않아야 한다(PRD 15.5). */
export const frameCounter = { value: 0 };

/** 그린 프레임만 센다. 표시는 초당 4번까지만, 마지막 값은 0.3초 뒤 한 번 더 보내 정지 시에도 맞게 남긴다. */
const PerfProbe = () => {
  const { gl } = useThree();
  const dts = useRef<number[]>([]);
  const lastPush = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const push = (): void => {
    const sorted = [...dts.current].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    useDevViewer.getState().set({
      perf: {
        fps: median > 0 ? Math.round(1 / median) : 0,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        textures: gl.info.memory.textures,
        geometries: gl.info.memory.geometries,
        framesRendered: frameCounter.value,
      },
    });
  };
  useEffect(
    () => () => {
      if (trailing.current) clearTimeout(trailing.current);
    },
    [],
  );
  useFrame((_, delta) => {
    frameCounter.value += 1;
    if (delta < 0.2) {
      dts.current.push(delta);
      if (dts.current.length > 30) dts.current.shift();
    }
    const now = performance.now();
    if (now - lastPush.current > 250) {
      lastPush.current = now;
      push();
    }
    if (trailing.current) clearTimeout(trailing.current);
    trailing.current = setTimeout(push, 300);
  });
  return null;
};
