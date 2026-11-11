import { create } from 'zustand';

/**
 * `/dev/viewer` 상태(P1-4). 실제 관람 상태 저장소(`state/visitorStore.ts`)는 P4-1에서 만든다.
 * Canvas 안의 컨트롤러가 `api`를 채우고, 바깥 DOM(버튼·키보드·줌 층)이 그것을 부른다.
 */

export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewerApi {
  next: () => void;
  prev: () => void;
  zoom: (id: string) => void;
  zoomCurrent: () => void;
  close: () => void;
  look: (yawDeg: number, pitchDeg: number) => void;
  releaseLook: () => void;
}

export interface PerfStats {
  fps: number;
  calls: number;
  triangles: number;
  textures: number;
  geometries: number;
  framesRendered: number;
}

interface DevViewerState {
  stopIndex: number;
  stopCount: number;
  label: string;
  rigState: string;
  zoomId: string | null;
  /** 줌 HTML 층을 겹칠 그림 면의 화면 사각형(CSS px). 줌이 끝났을 때만 */
  overlayRect: ScreenRect | null;
  captionVisible: boolean;
  /** 정지 상태가 된 순간의 그린 프레임 수(이후 늘면 "정지 중 다시 그림") */
  idleFrameMark: number;
  perf: PerfStats;
  api: ViewerApi | null;
  set: (patch: Partial<Omit<DevViewerState, 'set'>>) => void;
}

const noop = (): void => {};

export const useDevViewer = create<DevViewerState>(set => ({
  stopIndex: 0,
  stopCount: 0,
  label: '',
  rigState: 'idle',
  zoomId: null,
  overlayRect: null,
  captionVisible: false,
  idleFrameMark: 0,
  perf: { fps: 0, calls: 0, triangles: 0, textures: 0, geometries: 0, framesRendered: 0 },
  api: {
    next: noop,
    prev: noop,
    zoom: noop,
    zoomCurrent: noop,
    close: noop,
    look: noop,
    releaseLook: noop,
  },
  set: patch => set(patch),
}));
