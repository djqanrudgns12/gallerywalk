import { config } from '@gallery/core/config';
import type { CharacterId } from '@gallery/core/types';
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
import { blobShadowMaterial, withDim } from './materials.ts';
import { gltfLoaderFor } from './gltf.ts';

/**
 * 캐릭터(ADR-057, 규격 `tools/assets/spec/characters.md`): `{CHARACTER_BASE}/{id}.glb`가 있으면 그것(뼈대 + `idle`·`walk`·`run`·`wave`),
 * 없거나 못 읽으면 임시 모형(`CharacterFigure`). 바깥에서 보는 손잡이(`CharacterHandle.pose`)는 같다.
 * 같은 glb는 한 번만 받아 두고 사람마다 뼈대째 복제한다.
 */

/**
 * 캐릭터 glb 자리: 운영 서버는 `/assets/g/*`만 오래 캐시하는 정적 파일로 낸다(PLAN §9.6) — 파일 이름에 해시가 없으므로
 * 폴더에 판 번호를 붙이고, 캐릭터 파일을 바꾸면 번호를 올린다(`basis-r187`과 같은 방식, 변환 도구 기본 출력도 여기).
 */
export const CHARACTER_BASE = '/assets/g/chr-1';
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
    // 없으면 조용히 임시 모형으로(개발 중·변환 전)
    const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (!head || !head.ok) return null;
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

const load = (id: CharacterId, gl: WebGLRenderer): Promise<Loaded | null> =>
  loadCharacterGlb(`${CHARACTER_BASE}/${id}.glb`, gl);

const Model = forwardRef<CharacterHandle, { loaded: Loaded; character: CharacterId }>(
  ({ loaded, character }, ref) => {
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
      const tall = config().CHAR_HEIGHT_M[character.startsWith('teacher') ? 'teacher' : 'student'];
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
      return {
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
      // 멈춤 뒤 첫 프레임의 간격은 쉰 시간 전체라 자른다(흔들기·섞기가 한 프레임에 끝나지 않게)
      const dt = Math.min(dtIn, 0.1);
      const g = root.current;
      if (!g) return;
      g.position.set(pose.x, pose.y, pose.z);
      g.rotation.y = pose.yaw;
      const c = config();
      const ground =
        pose.speed < 0.05 ? 'idle' : pose.speed > (c.CHAR_WALK_MPS + c.CHAR_RUN_MPS) / 2 ? 'run' : 'walk';
      // 손 흔들기: 번호가 바뀌면 가만히 서 있는 동안 앞 `CHAR_WAVE_SEC`만 — 걸으면 바로 멈춤
      if (pose.wave !== parts.lastWave) {
        parts.lastWave = pose.wave;
        if (parts.right.arm && parts.right.fore && parts.right.hand && ground === 'idle')
          parts.waveLeft = c.CHAR_WAVE_SEC;
      }
      if (parts.waveLeft > 0) parts.waveLeft = ground === 'idle' ? Math.max(0, parts.waveLeft - dt) : 0;
      // 떠 있으면 `jump` 동작(있으면)
      const want = pose.air > 0.02 && parts.actions.has('jump') ? 'jump' : ground;
      if (want !== parts.current && parts.actions.has(want)) {
        const from = parts.actions.get(parts.current);
        const to = parts.actions.get(want)!;
        to.reset().play();
        if (from) to.crossFadeFrom(from, FADE_SEC, false);
        parts.current = want;
      }
      const r = c.CHAR_CLIP_RATE;
      const walk = parts.actions.get('walk');
      if (walk)
        walk.timeScale = clamp(pose.speed / (parts.groundMps.walk ?? c.CHAR_WALK_MPS), r.walkMin, r.walkMax);
      const run = parts.actions.get('run');
      if (run)
        run.timeScale = clamp(pose.speed / (parts.groundMps.run ?? c.CHAR_RUN_MPS), r.runMin, r.runMax);
      parts.mixer.update(dt);
      // 동작이 매 프레임 팔 회전을 새로 쓰므로 더하기가 쌓이지 않는다(재생 중인 동작이 있을 때만)
      const spread = c.CHAR_ARM_SPREAD_RAD[character];
      if (spread && parts.actions.get(parts.current)?.isRunning())
        for (const a of parts.arms) spreadArm(a.bone, parts.scene, a.sign * spread);
      // 손 흔들기: 위팔은 옆 바깥·조금 위로, 아래팔은 위로 세워 좌우로 흔든다 — 손이 큰 머리 옆 바깥에 와서 뒤에서도 보이게
      const { arm, fore, hand } = parts.right;
      if (parts.waveLeft > 0 && arm && fore && hand) {
        const w = c.CHAR_WAVE[character.startsWith('teacher') ? 'teacher' : 'student'];
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
      const sq = bumpSquash(pose.bump);
      g.scale.set(sq.sxz, sq.sy, sq.sxz);
      g.rotation.order = 'YXZ';
      g.rotation.x = sq.tilt;
      const sh = shadeRef.current;
      if (sh) {
        // 떠오르면 바닥에 남아 작고 옅어진다(찌그러짐 배율은 되돌려 바닥 크기 그대로)
        sh.position.y = 0.012 - pose.air / sq.sy;
        const k = 1 - Math.min(0.45, pose.air * 0.9);
        const d = parts.shadeR * 2 * k;
        sh.scale.set(d / sq.sxz, 1, (d * 0.85) / sq.sxz);
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
  },
);
Model.displayName = 'CharacterModel';

export const Character = forwardRef<CharacterHandle, { character: CharacterId }>(({ character }, ref) => {
  const gl = useThree(s => s.gl);
  const invalidate = useThree(s => s.invalidate);
  // 받은 캐릭터와 그 종류를 함께 둔다: 포스터에서 고르기를 바꾸면 새 것을 받을 때까지 옛 모습을 두고, 오면 새로 붙인다
  // (`Model`은 처음 받은 장면으로 한 번만 복제하므로 종류가 바뀌면 `key`로 새로 만든다)
  const [got, setGot] = useState<{ id: CharacterId; loaded: Loaded | null } | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void load(character, gl).then(l => {
      if (!alive) return;
      setGot({ id: character, loaded: l });
      invalidate();
    });
    return () => {
      alive = false;
    };
  }, [character, gl, invalidate]);
  if (got?.loaded) return <Model key={got.id} ref={ref} loaded={got.loaded} character={got.id} />;
  return <CharacterFigure ref={ref} character={got?.id ?? character} />;
});
Character.displayName = 'Character';
