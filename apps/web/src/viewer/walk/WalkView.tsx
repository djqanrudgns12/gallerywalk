import { config } from '@gallery/core/config';
import { type CameraPose, floorAt, frameCamera, type P2, standable, zoomFraming } from '@gallery/core/layout';
import type { CharacterId, Layout, Pose } from '@gallery/core/types';
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { type PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { Character } from '../scene/Character.tsx';
import type { CharacterHandle } from '../scene/CharacterFigure.tsx';
import { anchorOf, type ViewerArtwork } from '../scene/types.ts';
import {
  cameraSpace,
  clampOrbit,
  damp,
  dampAngle,
  defaultOrbit,
  followPose,
  type Orbit,
} from './followCamera.ts';
import { buildGuideMap, pathBetween, standSpot, stepTarget } from './guide.ts';
import { applyAmbience } from '../scene/ambience.ts';
import { MannerWatch } from './manners.ts';
import { combinedInput, useWalk } from './walkStore.ts';
import { Walker } from './walker.ts';

/**
 * 자유 관람 장면 조종(ADR-057): 캐릭터 걷기(`Walker`) + 따라가는 카메라 + 안내 이동 + 작품 앞 보기·크게 보기.
 * `frameloop="demand"`: 움직이는 동안만 다시 그린다. 손 입력이 바뀌면 깨우고, 캐릭터·카메라가 멈추면 그리기를 멈춘다(PRD 10.1).
 */

export interface WalkViewProps {
  readonly layout: Layout;
  readonly artworks: readonly ViewerArtwork[];
  readonly character: CharacterId;
  /** 구역(외관·회랑·관 ID) → 위 줄 이름 */
  readonly placeOf: (region: string) => string;
  /** 캐릭터가 지금 있는 관 ID(없으면 null) — 그릴 액자 범위를 정하는 쪽에 알림 */
  readonly onRegion?: (region: string) => void;
  /** 둘레 다른 사람들의 지금 자리(x, z) — 겹치지 않게 비켜 간다(없으면 혼자) */
  readonly crowd?: (() => readonly P2[]) | undefined;
  /** 포스터 뒤에서 미리 준비하는 중: 첫 인사(손 흔들기)를 들어온 뒤로 미룬다 */
  readonly paused?: boolean | undefined;
  readonly onCharacterReady?: ((id: CharacterId) => void) | undefined;
  /** 그린 프레임마다 내 자리·걸음 상태(함께 관람 보내기 — 받는 쪽이 `LIVE_POSE_HZ`로 줄임) */
  readonly onPose?: ((pose: Pose) => void) | undefined;
  /**
   * 시작 자리: 자리는 캐릭터를 처음 만들 때만 읽는다(캔버스를 다시 붙일 때 — 컨텍스트 손실 복구). 서 있을 수 없는 곳이면
   * 광장 첫 자리. 정지 지점 번호는 처음 붙을 때와 배치가 바뀔 때마다 읽는다(새 배치에서 이어 볼 지점).
   */
  readonly start?: WalkStart | undefined;
  /** 동작 줄이기(PRD 8.4, §6.14): 작품 앞·크게 보기로 옮길 때 카메라를 날리지 않고 바로 바꾸고, 부딪힘 흔들림을 끈다 */
  readonly reducedMotion?: boolean | undefined;
}

export interface WalkStart {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** 마지막으로 간 정지 지점(`다음 작품으로`가 이어지게) */
  readonly stopIndex: number;
}

const ZOOM_REACH_M = 6;
const STILL = { forward: 0, strafe: 0, run: false } as const;
const NEAR_CARD_M = 3.2;
const ORBIT_IDLE_ALIGN_SEC = 1.2;
/** 벽 부딪힘 카메라 흔들림: 처음 세기(m)·줄어드는 빠르기(1/s)·떨림(Hz) */
const SHAKE_M = 0.045;
const SHAKE_DECAY = 7;
const SHAKE_HZ = 22;

export const WalkView = ({
  layout,
  artworks,
  character,
  placeOf,
  onRegion,
  crowd,
  paused,
  onCharacterReady,
  onPose,
  start,
  reducedMotion,
}: WalkViewProps) => {
  const camera = useThree(s => s.camera) as PerspectiveCamera;
  const gl = useThree(s => s.gl);
  const size = useThree(s => s.size);
  const get = useThree(s => s.get);
  const invalidate = useThree(s => s.invalidate);
  const figure = useRef<CharacterHandle>(null);

  const walk = layout.walk;
  const map = useMemo(() => buildGuideMap(layout), [layout]);
  const space = useMemo(() => cameraSpace(walk), [walk]);
  const startRef = useRef(start);
  startRef.current = start;
  // 캐릭터는 한 번만 만든다. 배치가 바뀌면(전시 바뀜, P4-9) 같은 자리에서 새 벽으로 이어 간다(`rebase`)
  const walkerRef = useRef<Walker | null>(null);
  const walker = useMemo(() => {
    const prev = walkerRef.current;
    if (prev) {
      prev.rebase(walk);
      return prev;
    }
    const s0 = startRef.current;
    const w =
      s0 && standable(walk, [s0.x, s0.z])
        ? new Walker(walk, { x: s0.x, z: s0.z, yaw: s0.yaw })
        : new Walker(walk, { x: walk.spawn.pos[0], z: walk.spawn.pos[2], yaw: walk.spawn.yaw });
    walkerRef.current = w;
    return w;
  }, [walk]);
  const byId = useMemo(() => new Map(artworks.map(a => [a.id, a])), [artworks]);
  const manners = useMemo(() => new MannerWatch(), []);

  const st = useRef({
    orbit: defaultOrbit(walker.pose.yaw) as Orbit,
    lastOrbitAt: -Infinity,
    view: null as CameraPose | null,
    cur: { pos: new Vector3(), target: new Vector3(), fov: config().VFOV_DEG, ready: false },
    // 프레임마다 새로 만들지 않는 카메라 목표(휴대폰에서 메모리 정리로 끊기지 않게)
    want: { pos: new Vector3(), target: new Vector3(), fov: config().VFOV_DEG },
    clock: 0,
    region: '',
    /** 손 흔들기: 번호(바뀌면 한 번) · 끝나는 시각 · 처음 인사 했는가 · 마지막 인사 시각 · 둘레에 있던 사람 수 */
    wave: { count: 0, until: -Infinity, welcomed: false, lastGreetAt: -Infinity, near: 0 },
    /** 첫 인사를 할 수 있는 시각(들어온 뒤 `CHAR_WAVE_DELAY_SEC`) */
    welcomeFrom: config().CHAR_WAVE_DELAY_SEC,
    fpsFrames: 0,
    fpsSince: 0,
    totalFrames: 0,
    wasActive: false,
    wokeAt: null as number | null,
    /** 느린 프레임 사이에 누르고 뗀 입력도 그 유지 시간만큼 걷는다. */
    inputEnds: [] as { until: number; input: ReturnType<typeof combinedInput> }[],
    /** 벽 부딪힘 흔들림 세기 1 → 0 */
    shake: 0,
    /** 지난 프레임의 걸음 상태(동작 줄이기에서 바뀌는 순간을 알려고) */
    lastMode: 'free' as string,
    /** 실내 분위기 0(광장)..1(실내) — 정문을 지나면 천천히 */
    indoor: 0,
  }).current;

  const aspect = size.width / Math.max(1, size.height);
  const wake = useCallback(() => {
    if (!st.wasActive && st.wokeAt === null) st.wokeAt = performance.now();
    const store = useWalk.getState();
    if (store.idleFrameMark !== 0 || store.viewFrameMark !== 0)
      store.set({ idleFrameMark: 0, viewFrameMark: 0 });
    invalidate();
  }, [st, invalidate]);

  useEffect(() => {
    // 처음 붙을 때·배치가 바뀔 때 부르는 쪽이 정한 정지 지점(없으면 첫 지점). StrictMode가 두 번 돌려도 같은 값
    const i = Math.min(layout.stops.length - 1, Math.max(0, startRef.current?.stopIndex ?? 0));
    st.view = null;
    useWalk.getState().set({ stopCount: layout.stops.length, stopIndex: i, mode: 'free', zoomId: null });
  }, [layout]);
  // 들어오면 다시 그리기를 깨워 첫 인사 시계를 돌린다
  useEffect(() => {
    if (!paused) wake();
  }, [paused, wake]);

  useEffect(() => {
    // 숨긴 탭에서 지난 시간과 demand 정지 시간은 새 동작에 더하지 않는다.
    const reset = () => {
      st.wasActive = false;
      st.wokeAt = null;
      st.inputEnds.length = 0;
    };
    document.addEventListener('visibilitychange', reset);
    return () => document.removeEventListener('visibilitychange', reset);
  }, [st]);

  useEffect(() => {
    let observed = -1;
    return addAfterEffect(() => {
      if (observed === st.totalFrames) return;
      observed = st.totalFrames;
      const store = useWalk.getState();
      // 사람은 계속 걸어도 카메라와 연출이 끝난 같은 상태에서 그리기 예산을 잴 수 있다.
      const viewActive = st.wasActive || store.microMotionActive;
      if (viewActive && store.viewFrameMark !== 0) store.set({ viewFrameMark: 0 });
      else if (!viewActive && store.viewFrameMark === 0)
        store.set({
          viewFrameMark: st.totalFrames,
          perf: {
            ...store.perf,
            calls: gl.info.render.calls,
            triangles: gl.info.render.triangles,
            framesRendered: st.totalFrames,
          },
        });
      // useFrame은 WalkView 뒤에도 실행된다. 실제 렌더 뒤에 모든 연출의 예약을 함께 본다.
      if (get().internal.frames > 0) {
        if (store.idleFrameMark !== 0) store.set({ idleFrameMark: 0 });
        return;
      }
      const pose = walker.pose;
      const me = store.me;
      const moved = me.x !== pose.x || me.y !== pose.y || me.z !== pose.z || me.yaw !== pose.yaw;
      store.set({
        perf: {
          ...store.perf,
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          framesRendered: st.totalFrames,
        },
        idleFrameMark: st.totalFrames,
        ...(moved ? { me: { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw } } : {}),
      });
    });
  }, [get, gl, st, walker]);

  useEffect(() => {
    const s = useWalk.getState();
    const aspectNow = (): number => get().size.width / Math.max(1, get().size.height);
    const goTo = (index: number): void => {
      const i = Math.max(0, Math.min(layout.stops.length - 1, index));
      const stop = layout.stops[i]!;
      const spot = standSpot(layout, stop, aspectNow());
      const from: P2 = [walker.pose.x, walker.pose.z];
      st.view = null;
      // 먼저 길을 건다(앞 안내의 'cancelled'가 상태를 free로 바꾼 뒤) → 그다음 guiding
      walker.follow(pathBetween(map, from, spot.at), spot.yaw, e => {
        if (e === 'arrived') {
          st.view = spot.camera;
          useWalk.getState().set({ mode: 'view' });
        } else onCancelled();
        wake();
      });
      if (walker.guiding) useWalk.getState().set({ stopIndex: i, mode: 'guiding', zoomId: null });
      else useWalk.getState().set({ stopIndex: i, zoomId: null });
      wake();
    };
    /** 안내가 손 입력·새 안내로 끊기면: 새 안내가 없으면 직접 걷기로 */
    const onCancelled = (): void => {
      if (!walker.guiding && useWalk.getState().mode === 'guiding') useWalk.getState().set({ mode: 'free' });
    };
    const step = (delta: 1 | -1): void => {
      const w = useWalk.getState();
      const to = stepTarget(w.mode, w.stopIndex, delta, layout.stops.length);
      if (to !== null) goTo(to);
    };
    const raycaster = new Raycaster();
    s.set({
      api: {
        next: () => step(1),
        prev: () => step(-1),
        goTo,
        tapAt: (x, y) => {
          if (useWalk.getState().mode === 'zoom') return; // 크게 보는 중에는 바닥 누르기 없음
          const { size: sz, camera: cam } = get();
          const ndc = new Vector2((x / sz.width) * 2 - 1, -(y / sz.height) * 2 + 1);
          raycaster.setFromCamera(ndc, cam);
          const hit = new Vector3();
          if (!raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -walker.pose.y), hit)) return;
          const to: P2 = [hit.x, hit.z];
          if (!standable(walk, to)) return;
          st.view = null;
          walker.follow(pathBetween(map, [walker.pose.x, walker.pose.z], to), null, e => {
            if (e === 'arrived') useWalk.getState().set({ mode: 'free' });
            else onCancelled();
          });
          if (walker.guiding) useWalk.getState().set({ mode: 'guiding', zoomId: null });
          wake();
        },
        orbit: (dYaw, dPitch) => {
          leaveView();
          st.orbit = clampOrbit({ ...st.orbit, yaw: st.orbit.yaw + dYaw, pitch: st.orbit.pitch + dPitch });
          st.lastOrbitAt = st.clock;
          wake();
        },
        dolly: scale => {
          leaveView();
          st.orbit = clampOrbit({ ...st.orbit, distance: st.orbit.distance * scale });
          wake();
        },
        zoom: id => {
          const a = byId.get(id);
          if (!a) return;
          const d = Math.hypot(a.center.x - walker.pose.x, a.center.z - walker.pose.z);
          // 그 작품 정지 지점에 서 있으면 거리와 상관없이 — 세로 휴대폰은 작품 폭을 맞추느라 더 멀리 선다
          const store = useWalk.getState();
          const atStop = store.mode === 'view' && layout.stops[store.stopIndex]?.artworkId === id;
          if (!atStop && d > ZOOM_REACH_M) {
            const i = layout.stops.findIndex(x => x.artworkId === id);
            if (i >= 0) goTo(i);
            return;
          }
          walker.cancel();
          useWalk.getState().set({ mode: 'zoom', zoomId: id });
          wake();
        },
        close: () => {
          const m = useWalk.getState().mode;
          if (m === 'zoom') useWalk.getState().set({ mode: st.view ? 'view' : 'free', zoomId: null });
          wake();
        },
        jump: () => {
          if (useWalk.getState().mode === 'zoom') return;
          leaveView();
          if (walker.jump()) wake();
        },
      },
    });
    /** 작품 앞 보기에서 손을 대면 그 카메라 방향 그대로 직접 걷기로 */
    const leaveView = (): void => {
      if (useWalk.getState().mode !== 'view') return;
      const dx = st.cur.target.x - st.cur.pos.x;
      const dz = st.cur.target.z - st.cur.pos.z;
      st.orbit = { ...st.orbit, yaw: Math.atan2(dx, dz) };
      st.view = null;
      useWalk.getState().set({ mode: 'free' });
    };
    // 손 입력이 바뀌면 깨운다
    const unsub = useWalk.subscribe((next, prev) => {
      if (next.keys !== prev.keys || next.stick !== prev.stick || next.runToggle !== prev.runToggle) {
        st.inputEnds.push({ until: performance.now(), input: combinedInput(prev) });
        if (Math.hypot(combinedInput(next).forward, combinedInput(next).strafe) > 0) leaveView();
        wake();
      }
    });
    wake();
    return () => {
      unsub();
      useWalk.getState().set({ api: null });
    };
  }, [layout, walk, map, walker, byId, get, wake, st]);

  useFrame((state, dtIn) => {
    const c = config();
    const dt = st.wasActive
      ? dtIn
      : st.wokeAt === null
        ? 0
        : Math.max(0, (performance.now() - st.wokeAt) / 1000);
    st.wokeAt = null;
    st.clock += dt;
    if (paused) st.welcomeFrom = st.clock + c.CHAR_WAVE_DELAY_SEC;
    const store = useWalk.getState();
    const mode = store.mode;
    // 크게 보는 동안은 걷지 않는다(보이지 않는 캐릭터가 움직여 닫으면 다른 곳에 있지 않게, Codex 검토 P2)
    const input = mode === 'zoom' ? STILL : combinedInput(store);

    // ── 캐릭터 ────────────────────────────────────────────────
    walker.setCrowd(crowd?.() ?? []);
    const now = performance.now();
    let from = now - dt * 1000;
    let moving = false;
    for (const ended of st.inputEnds) {
      const until = Math.min(now, Math.max(from, ended.until));
      moving =
        walker.step((until - from) / 1000, {
          ...(mode === 'zoom' ? STILL : ended.input),
          cameraYaw: st.orbit.yaw,
        }) || moving;
      from = until;
    }
    st.inputEnds.length = 0;
    moving = walker.step((now - from) / 1000, { ...input, cameraYaw: st.orbit.yaw }) || moving;
    const pose = walker.pose;
    let jumped = false;
    for (const fx of walker.drainEvents()) {
      if (fx === 'bump' && !reducedMotion) st.shake = 1;
      else if (fx === 'jump') jumped = true;
    }
    // 관람 예절(놀이): 실내에서 오래 뛰거나 자꾸 뛰어오르면 도슨트 말풍선 + 잠깐 뛰기 잠금
    const notice = manners.step(dt, {
      indoor: st.region !== '' && st.region !== 'exterior',
      running: pose.move === 2,
      jumped,
    });
    if (notice) {
      walker.lockRun(c.MANNER_SLOW_SEC);
      store.set({ notice: { kind: notice, at: Date.now() } });
    }
    if (walker.runLocked !== store.runLocked) store.set({ runLocked: walker.runLocked });

    // 직접 걷거나 안내 중이면 카메라가 천천히 캐릭터 뒤로 돈다(아이가 방향을 잃지 않게)
    const forwardish = input.forward > 0.3 && Math.abs(input.strafe) < 0.6;
    if (
      (mode === 'guiding' && pose.speed > 0.2) ||
      (forwardish && st.clock - st.lastOrbitAt > ORBIT_IDLE_ALIGN_SEC)
    )
      st.orbit = { ...st.orbit, yaw: dampAngle(st.orbit.yaw, pose.yaw, mode === 'guiding' ? 2.2 : 1.1, dt) };

    // ── 카메라 목표 ─────────────────────────────────────────────
    const tall = character.startsWith('teacher') ? c.CHAR_HEIGHT_M.teacher : c.CHAR_HEIGHT_M.student;
    // 카메라는 부드러운 바닥(계단은 경사)을 따른다 — 발은 디딤판마다 올라가도 화면이 단마다 덜컹이지 않게
    const camFloor = floorAt(walk, [pose.x, pose.z]) ?? pose.y - pose.air;
    const head = { x: pose.x, y: camFloor + pose.air + tall * c.CAM_LOOK_HEIGHT_RATIO, z: pose.z };
    const want = st.want;
    let followDistance = Number.POSITIVE_INFINITY;
    const zoomArt = store.zoomId ? byId.get(store.zoomId) : undefined;
    const aim = (
      p: { x: number; y: number; z: number },
      t: { x: number; y: number; z: number },
      fov: number,
    ) => {
      want.pos.set(p.x, p.y, p.z);
      want.target.set(t.x, t.y, t.z);
      want.fov = fov;
    };
    if (mode === 'zoom' && zoomArt) {
      // 세로 화면은 아래 캡션 카드 자리를 비우고 맞춘다(PRD 9.5 "액자를 위쪽에")
      const z = frameCamera(
        anchorOf(zoomArt),
        aspect < 1 ? { aspect, insetBottom: c.ZOOM_CAPTION_INSET } : { aspect },
        zoomFraming(),
      );
      aim(z.position, z.target, z.fov);
    } else if (mode === 'view' && st.view) aim(st.view.position, st.view.target, st.view.fov);
    else {
      const f = followPose(space, head, st.orbit);
      followDistance = f.distance;
      aim(f.position, f.target, c.VFOV_DEG);
    }

    // ── 부드럽게 따라가기 ─────────────────────────────────────────
    const cur = st.cur;
    // 동작 줄이기: 걸음 상태가 바뀌는 순간(작품 앞 도착·크게 보기·닫기) 카메라를 바로 옮긴다(화면 층이 짧게 페이드)
    if (
      reducedMotion &&
      mode !== st.lastMode &&
      (mode === 'view' || mode === 'zoom' || st.lastMode !== 'guiding')
    )
      cur.ready = false;
    st.lastMode = mode;
    if (!cur.ready) {
      cur.pos.copy(want.pos);
      cur.target.copy(want.target);
      cur.fov = want.fov;
      cur.ready = true;
    }
    const k = mode === 'free' || mode === 'guiding' ? c.CAM_FOLLOW_DAMP : c.CAM_FOLLOW_DAMP * 0.6;
    cur.pos.set(
      damp(cur.pos.x, want.pos.x, k, dt),
      damp(cur.pos.y, want.pos.y, k, dt),
      damp(cur.pos.z, want.pos.z, k, dt),
    );
    cur.target.set(
      damp(cur.target.x, want.target.x, k, dt),
      damp(cur.target.y, want.target.y, k, dt),
      damp(cur.target.z, want.target.z, k, dt),
    );
    cur.fov = damp(cur.fov, want.fov, k, dt);
    camera.position.copy(cur.pos);
    if (st.shake > 1e-3) {
      // 벽에 부딪힌 순간 짧게 떨림(옆·위) — 줄어들며 끝난다
      const a = SHAKE_M * st.shake * Math.sin(st.clock * SHAKE_HZ * 2 * Math.PI);
      camera.position.x += a * Math.cos(st.orbit.yaw);
      camera.position.y += a * 0.5;
      camera.position.z -= a * Math.sin(st.orbit.yaw);
      st.shake *= Math.exp(-SHAKE_DECAY * dt);
    } else st.shake = 0;
    camera.lookAt(cur.target);
    if (Math.abs(camera.fov - cur.fov) > 1e-4) {
      camera.fov = cur.fov;
      camera.updateProjectionMatrix();
    }
    const settling =
      cur.pos.distanceTo(want.pos) > 1e-3 ||
      cur.target.distanceTo(want.target) > 1e-3 ||
      Math.abs(cur.fov - want.fov) > 1e-3;

    // ── 손 흔들기(인사) ─────────────────────────────────────────
    const w = st.wave;
    const still = pose.speed < 0.05 && pose.air === 0 && mode !== 'zoom';
    const others = crowd?.() ?? [];
    const nearPeople = others.filter(q => Math.hypot(q[0] - pose.x, q[1] - pose.z) < c.CHAR_GREET_M).length;
    let waveNow = false;
    if (!w.welcomed && still && !paused && st.clock > st.welcomeFrom) {
      w.welcomed = true;
      waveNow = true;
    } else if (still && nearPeople > w.near && st.clock - w.lastGreetAt > c.CHAR_GREET_COOLDOWN_SEC) {
      w.lastGreetAt = st.clock;
      waveNow = true;
    }
    w.near = nearPeople;
    if (waveNow) {
      w.count++;
      w.until = st.clock + c.CHAR_WAVE_SEC + 0.3;
    }
    const waving = st.clock < w.until;
    onPose?.({
      x: pose.x,
      y: pose.y,
      z: pose.z,
      yaw: Math.atan2(Math.sin(pose.yaw), Math.cos(pose.yaw)),
      move: waving ? 3 : pose.move,
    });

    // ── 캐릭터 그리기 자리 ───────────────────────────────────────
    const fig = figure.current?.pose;
    if (fig) {
      fig.x = pose.x;
      fig.y = pose.y;
      fig.z = pose.z;
      fig.yaw = pose.yaw;
      fig.speed = pose.speed;
      fig.air = pose.air;
      fig.bump = pose.bump;
      fig.wave = w.count;
      fig.opacity = mode === 'zoom' ? 0 : Math.max(0, Math.min(1, (followDistance - 0.5) / 0.6));
    }

    // ── 자리·가까운 작품(바뀔 때만 상태에 씀) ───────────────────────────
    const region = map.regionOf([pose.x, pose.z]);
    if (region !== st.region) {
      st.region = region;
      store.set({ place: placeOf(region) });
      onRegion?.(region);
    }
    let near: string | null = null;
    let best = NEAR_CARD_M;
    for (const a of artworks) {
      const dx = a.center.x - pose.x;
      const dz = a.center.z - pose.z;
      const d = Math.hypot(dx, dz);
      if (d >= best) continue;
      // 작품 앞쪽에 있고(법선 쪽) 작품을 대체로 바라볼 때
      const front = -(dx * a.normal.x + dz * a.normal.z) > 0.2;
      const facing = (Math.sin(pose.yaw) * dx + Math.cos(pose.yaw) * dz) / (d || 1) > 0.2 || mode === 'view';
      if (front && facing) {
        best = d;
        near = a.id;
      }
    }
    // 작품 앞 보기 중에는 그 정지 지점의 작품(휴대폰 세로처럼 카메라가 멀리 서도 카드가 뜨게)
    if (mode === 'view') near = layout.stops[store.stopIndex]?.artworkId ?? near;
    if (near !== store.nearArtworkId) store.set({ nearArtworkId: near });

    // ── 성능 숫자 ───────────────────────────────────────────────
    st.fpsFrames++;
    st.totalFrames++;
    if (state.clock.elapsedTime - st.fpsSince > 0.5) {
      const info = gl.info;
      const m = store.me;
      // 자리는 실제로 움직였을 때만 새로 쓴다(장면·지도가 그것을 읽어 다시 그리므로)
      const moved =
        Math.abs(m.x - pose.x) > 1e-3 ||
        Math.abs(m.y - pose.y) > 1e-3 ||
        Math.abs(m.z - pose.z) > 1e-3 ||
        Math.abs(m.yaw - pose.yaw) > 1e-3;
      store.set({
        perf: {
          fps: Math.round(st.fpsFrames / Math.max(1e-3, state.clock.elapsedTime - st.fpsSince)),
          calls: info.render.calls,
          triangles: info.render.triangles,
          textures: info.memory.textures,
          geometries: info.memory.geometries,
          framesRendered: st.totalFrames,
        },
        ...(moved ? { me: { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw } } : {}),
      });
      st.fpsFrames = 0;
      st.fpsSince = state.clock.elapsedTime;
    }

    // ── 실내·바깥 빛(눈 적응) ─────────────────────────────────────
    const indoorWant = st.region === 'exterior' || st.region === '' ? 0 : 1;
    let adapting = false;
    if (st.indoor !== indoorWant) {
      const stepK = dt / c.AMBIENCE_ADAPT_SEC;
      st.indoor =
        indoorWant > st.indoor
          ? Math.min(indoorWant, st.indoor + stepK)
          : Math.max(indoorWant, st.indoor - stepK);
      applyAmbience(0.5 - 0.5 * Math.cos(Math.PI * st.indoor));
      adapting = true;
    }

    const active =
      input.forward !== 0 ||
      input.strafe !== 0 ||
      moving ||
      settling ||
      pose.speed > 0 ||
      walker.guiding ||
      st.shake > 0 ||
      adapting ||
      waving ||
      // 첫 인사(손 흔들기) 전까지는 시각이 흘러야 한다(포스터 뒤에서 준비하는 동안은 멈춤)
      (!st.wave.welcomed && !paused);
    if (active) invalidate();
    else if (st.wasActive) {
      // 자리는 멈춘 순간 한 번만 갱신한다. 정지 표시는 장면 전체 렌더 뒤에 기록한다.
      store.set({
        me: { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw },
      });
    }
    st.wasActive = active;
  });

  return <Character ref={figure} character={character} onReady={onCharacterReady} />;
};
