import { create } from 'zustand';

/**
 * 자유 관람 화면 상태(ADR-057). Canvas 안의 `WalkView`가 `api`를 채우고, 바깥 DOM(조이스틱·버튼·키보드·카드)이 부른다.
 * 손 입력(앞뒤·옆·뛰기)은 여기 두고 `WalkView`가 매 프레임 읽는다 — 입력이 바뀌면 다시 그리기를 깨운다.
 */

export type WalkMode =
  /** 직접 걷기(따라가는 카메라) */
  | 'free'
  /** 다음 작품으로 걸어가는 중 */
  | 'guiding'
  /** 작품(정지 지점) 앞에 도착해 크게 보는 중 */
  | 'view'
  /** 작품 하나를 화면 가득 */
  | 'zoom';

export interface WalkApi {
  next: () => void;
  prev: () => void;
  goTo: (stopIndex: number) => void;
  /** 화면 좌표(CSS px, Canvas 기준)를 눌렀을 때: 바닥이면 그곳까지 걷기 */
  tapAt: (x: number, y: number) => void;
  /** 끌어서 둘러보기(rad)·거리 바꾸기(배율) */
  orbit: (dYaw: number, dPitch: number) => void;
  dolly: (scale: number) => void;
  zoom: (artworkId: string) => void;
  close: () => void;
  /** 뛰어오르기(놀이) */
  jump: () => void;
}

/** 관람 예절 말풍선(도슨트). `at`이 바뀌면 다시 띄운다 */
export interface WalkNotice {
  readonly kind: 'run' | 'jump';
  readonly at: number;
}

export interface WalkPerf {
  fps: number;
  calls: number;
  triangles: number;
  textures: number;
  geometries: number;
  framesRendered: number;
}

interface WalkState {
  /** 손 입력: 키보드와 조이스틱을 합친 값 */
  readonly keys: { forward: number; strafe: number; run: boolean };
  readonly stick: { forward: number; strafe: number; run: boolean };
  /** 뛰기 단추(휴대폰·태블릿): 켜 두면 걷는 입력이 뛰기가 된다 */
  runToggle: boolean;
  /** 지금 뛰기가 잠겨 있는가(예절 알림 뒤) — 뛰기 단추를 흐리게 */
  runLocked: boolean;
  notice: WalkNotice | null;
  mode: WalkMode;
  /** 마지막으로 도착한(또는 가는 중인) 정지 지점 */
  stopIndex: number;
  stopCount: number;
  /** 가까이 있는 작품(작은 작품 카드) */
  nearArtworkId: string | null;
  zoomId: string | null;
  /** 위 줄에 보일 지금 자리(외관·홀·전시실 이름) */
  place: string;
  idleFrameMark: number;
  /** 카메라·빛·먼지 정지가 렌더에 반영된 프레임. 다른 관람객의 이동은 제외한다. */
  viewFrameMark: number;
  microMotionActive: boolean;
  perf: WalkPerf;
  /** 내 캐릭터 자리(성능 숫자와 함께 0.5초마다·멈출 때) — 지도·함께 관람 보내기·시험이 읽는다 */
  me: { x: number; y: number; z: number; yaw: number };
  api: WalkApi | null;
  set: (patch: Partial<Omit<WalkState, 'set' | 'setKeys' | 'setStick'>>) => void;
  setKeys: (k: WalkState['keys']) => void;
  setStick: (s: WalkState['stick']) => void;
}

export const useWalk = create<WalkState>(set => ({
  keys: { forward: 0, strafe: 0, run: false },
  stick: { forward: 0, strafe: 0, run: false },
  runToggle: false,
  runLocked: false,
  notice: null,
  mode: 'free',
  stopIndex: 0,
  stopCount: 0,
  nearArtworkId: null,
  zoomId: null,
  place: '',
  idleFrameMark: 0,
  viewFrameMark: 0,
  microMotionActive: false,
  perf: { fps: 0, calls: 0, triangles: 0, textures: 0, geometries: 0, framesRendered: 0 },
  me: { x: 0, y: 0, z: 0, yaw: 0 },
  api: null,
  set: patch => set(patch),
  setKeys: keys => set({ keys }),
  setStick: stick => set({ stick }),
}));

/** 키보드와 조이스틱 중 큰 쪽. 뛰기 단추가 켜져 있으면 뛰기 */
export const combinedInput = (s: Pick<WalkState, 'keys' | 'stick' | 'runToggle'>) => {
  const k = s.keys;
  const j = s.stick;
  const useStick = Math.hypot(j.forward, j.strafe) > Math.hypot(k.forward, k.strafe);
  const base = useStick ? j : k;
  return s.runToggle && !base.run ? { ...base, run: true } : base;
};
