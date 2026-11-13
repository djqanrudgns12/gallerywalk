import { create } from 'zustand';
import { type ActionMe, type ActionNpc, resolveAction, type WalkAction } from './action.ts';

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

/**
 * 도슨트 말풍선 알림. `at`이 바뀌면 다시 띄운다.
 * `run`·`jump` = 관람 예절, `boundary` = 광장 경계에 닿음(W-06), `bump` = 사람끼리 부딪힘(W-07)
 */
export interface WalkNotice {
  readonly kind: 'run' | 'jump' | 'boundary' | 'bump';
  readonly at: number;
}

/** 말걸기 요청(행동 키, W-01) — 대사 카드가 읽는다(M4). `at`이 바뀌면 새 요청 */
export interface TalkRequest {
  readonly npcId: string;
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
  /** 행동 키가 지금 할 일(W-01). 걷기 화면이 매 프레임 `syncAction`으로 정하고, 바뀔 때만 쓴다 */
  action: WalkAction;
  /** `action`이 말걸기일 때 그 도슨트 */
  actionNpcId: string | null;
  /** 도슨트(움직이지 않는 사람). 비어 있으면 말걸기 없음(M4에서 채움) */
  npcs: readonly ActionNpc[];
  /** 대문 자리(x, z). 없으면 나가기 없음 */
  gate: readonly [number, number] | null;
  /** 나가기 창이 열려 있는가(W-08). 열려 있으면 Space를 건드리지 않는다 */
  exitOpen: boolean;
  talkRequest: TalkRequest | null;
  api: WalkApi | null;
  set: (patch: Partial<Omit<WalkState, StoreFns>>) => void;
  setKeys: (k: WalkState['keys']) => void;
  setStick: (s: WalkState['stick']) => void;
  /** 내 자리로 행동을 다시 정한다(값이 같으면 쓰지 않음 — 다시 그리기를 부르지 않게) */
  syncAction: (me: ActionMe) => void;
  /** 행동 키를 눌렀다: 말걸기 요청 · 나가기 창 열기 · 점프 */
  act: () => void;
  openExit: () => void;
  closeExit: () => void;
}

type StoreFns = 'set' | 'setKeys' | 'setStick' | 'syncAction' | 'act' | 'openExit' | 'closeExit';

export const useWalk = create<WalkState>((set, get) => ({
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
  action: 'jump',
  actionNpcId: null,
  npcs: [],
  gate: null,
  exitOpen: false,
  talkRequest: null,
  api: null,
  set: patch => set(patch),
  setKeys: keys => set({ keys }),
  setStick: stick => set({ stick }),
  syncAction: me => {
    const s = get();
    const r = resolveAction(me, s.npcs, s.gate);
    if (r.action !== s.action || r.npcId !== s.actionNpcId) set({ action: r.action, actionNpcId: r.npcId });
  },
  act: () => {
    const s = get();
    // 크게 보는 중·나가기 창이 열린 동안은 아무것도 하지 않는다(창 하나, PRD 9.6)
    if (s.mode === 'zoom' || s.exitOpen) return;
    if (s.action === 'talk' && s.actionNpcId) set({ talkRequest: { npcId: s.actionNpcId, at: Date.now() } });
    else if (s.action === 'exit') set({ exitOpen: true });
    else s.api?.jump();
  },
  openExit: () => set({ exitOpen: true }),
  closeExit: () => set({ exitOpen: false }),
}));

/** 키보드와 조이스틱 중 큰 쪽. 뛰기 단추가 켜져 있으면 뛰기 */
export const combinedInput = (s: Pick<WalkState, 'keys' | 'stick' | 'runToggle'>) => {
  const k = s.keys;
  const j = s.stick;
  const useStick = Math.hypot(j.forward, j.strafe) > Math.hypot(k.forward, k.strafe);
  const base = useStick ? j : k;
  return s.runToggle && !base.run ? { ...base, run: true } : base;
};
