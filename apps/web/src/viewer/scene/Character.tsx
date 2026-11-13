import { config } from '@gallery/core/config';
import { bodyOf, buildOf, type CharacterId } from '@gallery/core/types';
import { useFrame, useThree } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  type Group,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  PlaneGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { z } from 'zod';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  bumpSquash,
  CharacterFigure,
  type CharacterHandle,
  type FigurePose,
  restPose,
} from './CharacterFigure.tsx';
import { characterGlbUrl } from './characterFiles.ts';
import { blobShadowMaterial, withDim } from './materials.ts';
import { gltfLoaderFor } from './gltf.ts';
import { JumpDust } from '../walk/JumpDust.tsx';
import type { CharacterFx } from '../walk/jumpPose.ts';

/**
 * 캐릭터(ADR-057, 규격 `tools/assets/spec/characters.md`): 그 ID의 glb(`characterGlbUrl` — 판 2에 자기 파일이 없으면 같은 몸 틀의
 * 판 1 파일, 뼈대 + `idle`·`walk`·`run`·`wave`)가 있으면 그것, 없거나 못 읽으면 임시 모형(`CharacterFigure`).
 * 바깥에서 보는 손잡이(`CharacterHandle.pose`)는 같다. 같은 glb는 한 번만 받아 두고 사람마다 뼈대째 복제한다.
 * 키·팔 벌림·손 흔들기 수치는 몸 틀(`bodyOf`·`buildOf`)로 찾는다 — 같은 틀의 사람은 같은 값.
 */

/** 판 1 캐릭터 폴더(주소 규칙은 `characterFiles.ts`) */
export { CHARACTER_BASE } from './characterFiles.ts';
const FADE_SEC = 0.2;

/** 변환 도구가 장면 extras에 적은 클립의 땅 빠르기(m/s) — 없거나 이상하면 설정의 걷기·뛰기 빠르기로 */
const GroundMps = z.object({ walk: z.number().positive().optional(), run: z.number().positive().optional() });

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const FORWARD = new Vector3(0, 0, 1);
const qa = new Quaternion();
const qr = new Quaternion();
const qWave = new Quaternion();
const vWave = new Vector3();

/**
 * 위팔을 캐릭터 앞쪽 축(+Z)으로 `angle`만큼 더 돌린다(동작을 적용한 뒤). 캐릭터 뿌리 기준 부모 회전 A로
 * 국소 회전 q ← A⁻¹·R·A·q. A는 장면 뿌리에서 부모까지 국소 회전을 곱해 얻는다(이번 프레임 동작 값 그대로).
 */
const va = new Vector3();
const vb = new Vector3();
const vt = new Vector3();
const qw = new Quaternion();
const qp = new Quaternion();
const qi = new Quaternion();

/**
 * 뼈를 겨눈다: 뼈 → 자식 방향이 세계 방향 `toWorld`를 향하도록 `weight`(0..1)만큼 돌린다(동작을 적용한 뒤, 세계 행렬이 새것일 때).
 * 국소 회전 q ← P⁻¹·Q·P·q (P = 부모 세계 회전, Q = 지금 방향 → 목표 방향). 돌린 뒤 자식까지 세계 행렬을 다시 맞춘다.
 */
const aimBone = (bone: Object3D, child: Object3D, toWorld: Vector3, weight: number): void => {
  bone.getWorldPosition(va);
  child.getWorldPosition(vb);
  vb.sub(va).normalize();
  qw.setFromUnitVectors(vb, vt.copy(toWorld).normalize());
  qw.slerp(qi.identity(), 1 - weight);
  bone.parent?.getWorldQuaternion(qp);
  const inv = qp.clone().invert();
  bone.quaternion.premultiply(inv.multiply(qw).multiply(qp));
  bone.updateMatrixWorld(true);
};

const spreadArm = (bone: Object3D, top: Object3D, angle: number): void => {
  qa.identity();
  const chain: Object3D[] = [];
  for (let o = bone.parent; o && o !== top.parent; o = o.parent) chain.push(o);
  for (let i = chain.length - 1; i >= 0; i--) qa.multiply(chain[i]!.quaternion);
  qr.setFromAxisAngle(FORWARD, angle);
  // A⁻¹·R·A
  const a = qa.clone();
  qr.premultiply(a.clone().invert()).multiply(a);
  bone.quaternion.premultiply(qr);
};

export interface LoadedCharacter {
  readonly scene: Object3D;
  readonly clips: ReadonlyMap<string, AnimationClip>;
}
type Loaded = LoadedCharacter;

const cache = new Map<string, Promise<Loaded | null>>();

/** 캐릭터 glb 하나를 한 번만 받아 둔다(주소별). 없거나 못 읽으면 null — 받은 장면은 고치지 말고 복제해서 쓴다 */
export const loadCharacterGlb = (url: string, gl: WebGLRenderer): Promise<Loaded | null> => {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async () => {
    // 없거나 못 읽으면 조용히 임시 모형으로(개발 중·변환 전). 미리 HEAD로 묻지 않는다 — 요청이 하나 늘고,
    // 운영 빌드 e2e에서 HEAD가 끊기는(ERR_ABORTED) 일이 있었다. 없으면 받기 자체가 실패해 아래에서 null이 된다.
    try {
      const gltf = await gltfLoaderFor(gl).loadAsync(url);
      return { scene: gltf.scene, clips: new Map(gltf.animations.map(a => [a.name, a])) };
    } catch {
      return null;
    }
  })();
  cache.set(url, p);
  return p;
};

const load = (id: CharacterId, gl: WebGLRenderer, src?: string): Promise<Loaded | null> =>
  loadCharacterGlb(src ?? characterGlbUrl(id), gl);

interface ModelProps {
  readonly loaded: Loaded;
  readonly character: CharacterId;
  readonly fx?: CharacterFx | undefined;
}

const Model = forwardRef<CharacterHandle, ModelProps>(({ loaded, character, fx }, ref) => {
  const pose = useRef<FigurePose>(restPose()).current;
  useImperativeHandle(ref, () => ({ pose }), [pose]);
  const root = useRef<Group>(null);
  const shadeRef = useRef<Mesh>(null);
  const [parts] = useState(() => {
    const scene = cloneSkinned(loaded.scene);
    const materials: Material[] = [];
    scene.traverse(o => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as MeshStandardMaterial).clone();
      mat.transparent = true;
      withDim(mat);
      m.material = mat;
      m.frustumCulled = false;
      materials.push(mat);
    });
    const mixer = new AnimationMixer(scene);
    const actions = new Map<string, AnimationAction>();
    for (const [name, clip] of loaded.clips) actions.set(name, mixer.clipAction(clip));
    // 발밑 그늘: 바닥에 눕힌 부드러운 원판(지름 = 키 × 비율 × 2, 옆으로 조금 넓게)
    const shade = blobShadowMaterial(config().CHAR_SHADOW_OPACITY);
    const shadeGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const tall = config().CHAR_HEIGHT_M[buildOf(character)];
    const shadeR = tall * config().CHAR_SHADOW_RADIUS_RATIO;
    // 위팔(왼쪽 +X는 +각, 오른쪽은 −각이 몸 바깥)
    const arms: { bone: Object3D; sign: number }[] = [];
    scene.traverse(o => {
      if (/LeftArm$/.test(o.name)) arms.push({ bone: o, sign: 1 });
      else if (/RightArm$/.test(o.name)) arms.push({ bone: o, sign: -1 });
    });
    const ground = GroundMps.safeParse(loaded.scene.userData['groundMps']);
    const groundMps = ground.success ? ground.data : {};
    // 손 흔들기는 엔진이 오른팔을 돌려 만든다(Tripo `wave_goodbye_01`은 엉덩이까지 움직이며 웅크려 쓰지 않음)
    const right = {
      arm: null as Object3D | null,
      fore: null as Object3D | null,
      hand: null as Object3D | null,
    };
    scene.traverse(o => {
      if (/RightArm$/.test(o.name)) right.arm = o;
      else if (/RightForeArm$/.test(o.name)) right.fore = o;
      else if (/RightHand$/.test(o.name)) right.hand = o;
    });
    // 손을 펴려고: 오른손과 손가락 뼈의 바인드 자세(A자세 — 손목 곧고 손가락 펴짐) 회전을 기억해 둔다
    const openHand: { bone: Object3D; rest: Quaternion }[] = [];
    right.hand?.traverse(o => openHand.push({ bone: o, rest: o.quaternion.clone() }));
    // 공중 자세로 겨눌 뼈 → 자식과 캐릭터 기준 목표 방향(부모 먼저: 넓적다리 → 정강이)
    const bones: Object3D[] = [];
    scene.traverse(o => bones.push(o));
    const bone = (suffix: string): Object3D | null => bones.find(o => o.name.endsWith(suffix)) ?? null;
    const p = config().CHAR_JUMP_POSE;
    const tuckAims: { bone: Object3D; child: Object3D; dir: Vector3 }[] = [];
    const aim = (from: string, to: string, dir: Vector3): void => {
      const b = bone(from);
      const ch = bone(to);
      if (b && ch) tuckAims.push({ bone: b, child: ch, dir });
    };
    for (const side of ['Left', 'Right'] as const) {
      const out = side === 'Left' ? 1 : -1;
      aim(`${side}UpLeg`, `${side}Leg`, new Vector3(0, -Math.cos(p.thighRad), Math.sin(p.thighRad)));
      aim(`${side}Leg`, `${side}Foot`, new Vector3(0, -Math.cos(p.shinRad), -Math.sin(p.shinRad)));
      aim(
        `${side}Arm`,
        `${side}ForeArm`,
        new Vector3(out * Math.sin(p.armOutRad), -Math.cos(p.armOutRad), 0),
      );
    }
    return {
      tuckAims,
      scene,
      materials,
      mixer,
      actions,
      current: 'idle',
      shade,
      shadeGeo,
      shadeR,
      arms,
      groundMps,
      right,
      openHand,
      /** 마지막으로 본 손 흔들기 번호 · 남은 흔들기 시간(s) */
      lastWave: 0,
      waveLeft: 0,
    };
  });
  // 재생은 붙을 때 시작한다(StrictMode가 효과를 뗐다 다시 붙이면 정리의 `stopAllAction` 뒤에 다시 켜지도록 — 쓸 때 만들면 멈춘 채 남음)
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    parts.actions.get(parts.current)?.reset().play();
    invalidate();
    return () => {
      parts.mixer.stopAllAction();
      for (const m of parts.materials) m.dispose();
      parts.shade.dispose();
      parts.shadeGeo.dispose();
    };
  }, [parts, invalidate]);
  useFrame((_, dtIn) => {
    const g = root.current;
    if (!g) return;
    g.position.set(pose.x, pose.y, pose.z);
    g.rotation.y = pose.yaw;
    const c = config();
    // 몸 배율 = 부딪힘 움찔(벽 1, 사람은 약하게) × 점프(웅크림·늘림·착지 눌림·되튐). 겨누기 전에 맞춘다
    const sq = bumpSquash(pose.bump);
    const gain = fx?.bumpGain ?? 1;
    const sy = (1 - (1 - sq.sy) * gain) * (fx?.sy ?? 1);
    const sxz = (1 + (sq.sxz - 1) * gain) * (fx?.sxz ?? 1);
    g.scale.set(sxz, sy, sxz);
    g.rotation.order = 'YXZ';
    g.rotation.x = sq.tilt * gain;
    const ground =
      pose.speed < 0.05 ? 'idle' : pose.speed > (c.CHAR_WALK_MPS + c.CHAR_RUN_MPS) / 2 ? 'run' : 'walk';
    const want = pose.air > 0.02 && parts.actions.has('jump') ? 'jump' : ground;
    // 새 동작 첫 프레임의 쉰 시간만 빼고, 진행 중인 동작은 실제 시간대로 끝낸다.
    const dt = pose.wave !== parts.lastWave || want !== parts.current ? 0 : dtIn;
    // 손 흔들기: 번호가 바뀌면 가만히 서 있는 동안 앞 `CHAR_WAVE_SEC`만 — 걸으면 바로 멈춤
    if (pose.wave !== parts.lastWave) {
      parts.lastWave = pose.wave;
      if (parts.right.arm && parts.right.fore && parts.right.hand && ground === 'idle')
        parts.waveLeft = c.CHAR_WAVE_SEC;
    }
    if (parts.waveLeft > 0) parts.waveLeft = ground === 'idle' ? Math.max(0, parts.waveLeft - dt) : 0;
    // 떠 있으면 `jump` 동작(있으면)
    if (want !== parts.current && parts.actions.has(want)) {
      const from = parts.actions.get(parts.current);
      const to = parts.actions.get(want)!;
      to.reset().play();
      if (from) to.crossFadeFrom(from, FADE_SEC, false);
      parts.current = want;
    }
    // 공중 자세 가중: `jump` 동작이 있으면 그것을 쓰므로 0. 걷던 다리는 가중만큼 시간을 멈춘다
    const tuck = fx && parts.current !== 'jump' ? fx.tuck : 0;
    const r = c.CHAR_CLIP_RATE;
    const walk = parts.actions.get('walk');
    if (walk)
      walk.timeScale =
        clamp(pose.speed / (parts.groundMps.walk ?? c.CHAR_WALK_MPS), r.walkMin, r.walkMax) * (1 - tuck);
    const run = parts.actions.get('run');
    if (run)
      run.timeScale =
        clamp(pose.speed / (parts.groundMps.run ?? c.CHAR_RUN_MPS), r.runMin, r.runMax) * (1 - tuck);
    parts.mixer.update(dt);
    // 동작이 매 프레임 팔 회전을 새로 쓰므로 더하기가 쌓이지 않는다(재생 중인 동작이 있을 때만)
    const spread = c.CHAR_ARM_SPREAD_RAD[bodyOf(character)];
    if (spread && parts.actions.get(parts.current)?.isRunning())
      for (const a of parts.arms) spreadArm(a.bone, parts.scene, a.sign * spread);
    // 공중 자세: 무릎을 조금 접고 팔을 옆으로(동작 위에 겨누기 — 동작이 매 프레임 새로 쓰므로 쌓이지 않음)
    if (tuck > 0) {
      g.updateMatrixWorld(true);
      g.getWorldQuaternion(qWave);
      for (const a of parts.tuckAims)
        aimBone(a.bone, a.child, vWave.copy(a.dir).applyQuaternion(qWave), tuck);
    }
    // 손 흔들기: 위팔은 옆 바깥·조금 위로, 아래팔은 위로 세워 좌우로 흔든다 — 손이 큰 머리 옆 바깥에 와서 뒤에서도 보이게
    const { arm, fore, hand } = parts.right;
    if (parts.waveLeft > 0 && arm && fore && hand) {
      const w = c.CHAR_WAVE[buildOf(character)];
      const t = c.CHAR_WAVE_SEC - parts.waveLeft;
      const ease = (x: number): number => x * x * (3 - 2 * x);
      const e = ease(Math.min(1, t / w.easeSec, parts.waveLeft / w.easeSec));
      g.updateMatrixWorld(true);
      g.getWorldQuaternion(qWave);
      // 캐릭터 기준(앞 +Z, 오른쪽 −X) 방향 → 세계
      aimBone(arm, fore, vWave.set(-w.upper[0], w.upper[1], w.upper[2]).applyQuaternion(qWave), e);
      const phi = w.swingCenterRad + w.swingRad * Math.sin(2 * Math.PI * w.hz * t);
      aimBone(fore, hand, vWave.set(-Math.sin(phi), Math.cos(phi), w.upper[2]).applyQuaternion(qWave), e);
      // 손목을 펴고 손가락을 편다(주먹 쥔 채 귀를 긁는 것처럼 보이지 않게 — Antigravity 비평)
      for (const f of parts.openHand) f.bone.quaternion.slerp(f.rest, e);
      // 흔드는 동안은 스스로 다음 장면을 부른다(멈추면 다시 그리지 않는 장면이라 걷기 화면이 모르는 사이 끊기지 않게)
      invalidate();
    }
    const sh = shadeRef.current;
    if (sh) {
      // 떠오르면 바닥에 남아 작고 옅어진다(찌그러짐 배율은 되돌려 바닥 크기 그대로)
      sh.position.y = 0.012 - pose.air / sy;
      const k = 1 - Math.min(0.45, pose.air * 0.9);
      const d = parts.shadeR * 2 * k;
      sh.scale.set(d / sxz, 1, (d * 0.85) / sxz);
      parts.shade.opacity = c.CHAR_SHADOW_OPACITY * (1 - Math.min(0.6, pose.air * 1.4)) * pose.opacity;
    }
    for (const m of parts.materials) {
      m.opacity = pose.opacity;
      m.depthWrite = pose.opacity > 0.99;
    }
  });
  return (
    <group ref={root}>
      <mesh
        ref={shadeRef}
        geometry={parts.shadeGeo}
        material={parts.shade}
        position={[0, 0.012, 0]}
        renderOrder={2}
      />
      <primitive object={parts.scene} />
    </group>
  );
});
Model.displayName = 'CharacterModel';

export const Character = forwardRef<
  CharacterHandle,
  {
    character: CharacterId;
    /** 내 캐릭터 몸 연출·착지 먼지(걷기 화면, W-05·W-07). 없으면 연출 없음. 임시 모형은 배율·공중 자세를 받지 않는다 */
    fx?: CharacterFx | undefined;
    /** 검수 화면(`/dev/characters?try=…&src=…`)만: 저장소에 넣기 전 시험 glb 주소. 없으면 `characterGlbUrl(character)` */
    src?: string | undefined;
  }
>(({ character, fx, src }, ref) => {
  const gl = useThree(s => s.gl);
  const invalidate = useThree(s => s.invalidate);
  // 받은 캐릭터와 그 종류를 함께 둔다: 포스터에서 고르기를 바꾸면 새 것을 받을 때까지 옛 모습을 두고, 오면 새로 붙인다
  // (`Model`은 처음 받은 장면으로 한 번만 복제하므로 종류가 바뀌면 `key`로 새로 만든다)
  const [got, setGot] = useState<{ id: CharacterId; loaded: Loaded | null } | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void load(character, gl, src).then(l => {
      if (!alive) return;
      setGot({ id: character, loaded: l });
      invalidate();
    });
    return () => {
      alive = false;
    };
  }, [character, gl, invalidate, src]);
  const body = got?.loaded ? (
    <Model key={got.id} ref={ref} loaded={got.loaded} character={got.id} fx={fx} />
  ) : (
    <CharacterFigure ref={ref} character={got?.id ?? character} />
  );
  if (!fx) return body;
  return (
    <>
      {body}
      <JumpDust cue={fx.dust} />
    </>
  );
});
Character.displayName = 'Character';
