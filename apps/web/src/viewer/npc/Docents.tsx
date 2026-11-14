import { config } from '@gallery/core/config';
import { DOCENT_IDS, type DocentId, docentAtSpot, type Layout } from '@gallery/core/types';
import { type RootState, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AnimationMixer,
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  type Skeleton,
  type SkinnedMesh,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type LoadedCharacter, loadCharacterGlb } from '../scene/Character.tsx';
import { characterGlbUrl } from '../scene/characterFiles.ts';
import { blobShadowMaterial, withDim } from '../scene/materials.ts';
import { combinedInput, useWalk } from '../walk/walkStore.ts';
import { type DocentOutput, docentLineText, drawnDocentIds } from './docentBrain.ts';
import { type DirectorFrame, DocentDirector, type DocentSpotFull, docentSpotsOf } from './docentDirector.ts';
import { useDocentSpeech } from './docentStore.ts';
import { docentTuning } from './tuning.ts';

/**
 * 3D 도슨트(PRD_V2 W-10, M4-7·M4-9): 배치의 `npcSpots`마다 서로 다른 인물(같은 동작 세트)을 세운다. 스키마 2 배치면 아무것도 없다.
 * - 인물: 자리 → 도슨트 ID(`docentAtSpot` — 광장 1·홀 2·전시실 3, 기본 자리가 아니면 자리 순서로 돌려 씀) → 주소(`characterGlbUrl`).
 *   그 도슨트의 판 2 파일이 오기 전에는 어른 몸 틀의 판 1 파일(선생님 여·남을 섞음 — 실내에서 함께 보이는 홀·전시실은 서로 다름).
 *   glb를 못 읽으면 한 덩어리 임시 모형(그리기 1회). `CharacterFigure`는 조각마다 그리기라(15회 남짓) 쓰지 않는다.
 * - 그리기: 보이는 구역의 도슨트만(`drawnDocentIds`, 바깥은 광장, 실내는 홀 + 그리는 관 — 많아야 둘). 몸 1회씩 + 발밑 그늘은
 *   모두 인스턴스 하나(1회) → 늘어나는 그리기 ≤ 3. glb는 그 도슨트를 처음 그릴 때 그의 것만 받는다.
 * - 움직임: 숨쉬기(glb `idle`), 바라보기(몸 + 목·머리 뼈), 끄덕임(머리 뼈), 손짓(오른팔 뼈 겨누기 — `Character.tsx`의 손 흔들기와 같은 방식).
 * - 다시 그리기(PLAN §6.11, `frameloop="demand"`): 숨쉬기는 장면이 어차피 그려질 때만 따라 움직이고 스스로 깨우지 않는다.
 *   스스로 `invalidate()`하는 때는 몸·고개가 도는 동안, 손짓·끄덕임 동안, 말걸기 대사가 떠 있는 동안(≤ `NPC_TALK_SHOW_SEC`)뿐이다.
 *   한마디 시작·대사 끝 시각에는 타이머로 한 번 깨운다. 동작 줄이기면 손짓·끄덕임이 없고 대사 중에도 깨우지 않는다.
 * - 걷기 저장소 `npcs`(행동 키·부딪힘)를 채우고, 말걸기 요청(`talkRequest`)을 받아 대사 상태(`useDocentSpeech`)를 쓴다.
 *   머리 위 말풍선은 화면 좌표(CSS px)로 넘기고, 그리기는 바깥 DOM(`DocentBubble`)이 한다(3D 말풍선 렌더러 M4-3 전까지).
 * - 장면 순서: `WalkView` 뒤에 둔다 — 같은 프레임에서 카메라가 옮겨진 뒤 말풍선 자리를 잰다.
 */

/**
 * 자리의 도슨트(기본 자리면 정한 인물, 아니면 자리 순서로 돌려 씀). 모습 파일은 `characterGlbUrl`로 — 뼈 이름은 같은 mixamo 규칙이어야
 * 고개·손짓이 된다
 */
const docentOf = (spotId: string, index: number): DocentId =>
  docentAtSpot(spotId) ?? DOCENT_IDS[index % DOCENT_IDS.length] ?? 'docent-1';

export interface DocentsProps {
  readonly layout: Layout;
  /** 캐릭터가 있는 구역(`WalkView`의 `onRegion`): `exterior` · 관 ID · 홀(`spine`) */
  readonly region: string;
  /** 그리는 관(`visibleParts`) */
  readonly visibleParts: ReadonlySet<string>;
  /** 나를 보고 말하는가(걷기 화면). 투어·미리 보기는 false — 쉬는 자세로 서 있기만 */
  readonly interactive?: boolean | undefined;
  /** 동작 줄이기(PRD 8.4) */
  readonly reducedMotion?: boolean | undefined;
  /** 지금 그릴 도슨트의 모습을 다 받음(못 읽은 것은 임시 모형) — 포스터 뒤 첫 화면 준비 관문 */
  readonly onReady?: ((ready: boolean) => void) | undefined;
}

interface Rig {
  readonly root: Group;
  readonly mixer: AnimationMixer | null;
  readonly idle: (() => void) | null;
  readonly neck: Object3D | null;
  readonly head: Object3D | null;
  readonly headTop: Object3D | null;
  readonly arm: Object3D | null;
  readonly fore: Object3D | null;
  readonly hand: Object3D | null;
  /** 동작을 적용하기 전에 바인드 자세로 되돌릴 뼈 — 동작이 그 뼈를 쓰지 않아도 더한 회전이 쌓이지 않게 */
  readonly rest: readonly { readonly bone: Object3D; readonly q: Quaternion }[];
  /** 손을 펼 때 쓰는 오른손·손가락 바인드 회전 */
  readonly openHand: readonly { readonly bone: Object3D; readonly q: Quaternion }[];
  /** 임시 모형 몸(숨쉬기로 세로 늘림) */
  readonly breathe: Object3D | null;
  clock: number;
  readonly dispose: () => void;
}

const nowSec = (): number => performance.now() / 1000;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (x: number): number => x * x * (3 - 2 * x);

const UP = new Vector3(0, 1, 0);
const vA = new Vector3();
const vB = new Vector3();
const vT = new Vector3();
const vDir = new Vector3();
const vAxis = new Vector3();
const vAnchor = new Vector3();
const qW = new Quaternion();
const qP = new Quaternion();
const qT = new Quaternion();
const qI = new Quaternion();
const qBody = new Quaternion();
const m4 = new Matrix4();
const vPos = new Vector3();
const vScale = new Vector3();

/** 뼈를 세계 축 둘레로 더 돌린다: 국소 회전 q ← P⁻¹·R·P·q (P = 부모 세계 회전) */
const turnBone = (bone: Object3D, axisWorld: Vector3, angle: number): void => {
  if (bone.parent) bone.parent.getWorldQuaternion(qP);
  else qP.identity();
  qW.setFromAxisAngle(axisWorld, angle);
  qT.copy(qP).invert().multiply(qW).multiply(qP);
  bone.quaternion.premultiply(qT);
  bone.updateMatrixWorld(true);
};

/** 뼈 → 자식 방향이 세계 방향 `toWorld`를 향하도록 `weight`(0..1)만큼 돌린다(`Character.tsx`의 `aimBone`과 같은 셈) */
const aimBone = (bone: Object3D, child: Object3D, toWorld: Vector3, weight: number): void => {
  bone.getWorldPosition(vA);
  child.getWorldPosition(vB);
  vB.sub(vA).normalize();
  qW.setFromUnitVectors(vB, vT.copy(toWorld).normalize());
  qW.slerp(qI.identity(), 1 - weight);
  if (bone.parent) bone.parent.getWorldQuaternion(qP);
  else qP.identity();
  qT.copy(qP).invert().multiply(qW).multiply(qP);
  bone.quaternion.premultiply(qT);
  bone.updateMatrixWorld(true);
};

/** glb 모습: 뼈대째 복제(받은 장면은 고치지 않음). 기하·텍스처는 받은 것을 같이 쓰므로 재질·뼈 텍스처만 놓는다 */
const glbRig = (loaded: LoadedCharacter): Rig => {
  const scene = cloneSkinned(loaded.scene);
  const materials: Material[] = [];
  const skeletons = new Set<Skeleton>();
  const bones: Object3D[] = [];
  scene.traverse(o => {
    bones.push(o);
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mat = withDim((m.material as MeshStandardMaterial).clone());
    m.material = mat;
    // 뼈로 움직이는 몸의 경계 구가 바인드 자세 기준이라 손짓 때 잘릴 수 있다 — 내 캐릭터와 같이 끄고, 그리기 수는 구역으로 줄인다
    m.frustumCulled = false;
    materials.push(mat);
    const sk = (o as SkinnedMesh).isSkinnedMesh ? (o as SkinnedMesh).skeleton : null;
    if (sk) skeletons.add(sk);
  });
  const bone = (re: RegExp): Object3D | null => bones.find(o => re.test(o.name)) ?? null;
  const neck = bone(/Neck$/);
  const head = bone(/Head$/);
  const arm = bone(/RightArm$/);
  const fore = bone(/RightForeArm$/);
  const hand = bone(/RightHand$/);
  const openHand: { bone: Object3D; q: Quaternion }[] = [];
  hand?.traverse(o => openHand.push({ bone: o, q: o.quaternion.clone() }));
  const rest = [neck, head, arm, fore]
    .filter((b): b is Object3D => b !== null)
    .map(b => ({ bone: b, q: b.quaternion.clone() }))
    .concat(openHand);
  const mixer = new AnimationMixer(scene);
  const clip = loaded.clips.get('idle');
  const root = new Group();
  root.add(scene);
  return {
    root,
    mixer,
    // 재생은 붙을 때 시작한다(StrictMode가 효과를 뗐다 붙여도 다시 켜지게)
    idle: clip ? () => void mixer.clipAction(clip).reset().play() : null,
    neck,
    head,
    headTop: bone(/HeadTop_End$/),
    arm,
    fore,
    hand,
    rest,
    openHand,
    breathe: null,
    clock: 0,
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      for (const m of materials) m.dispose();
      for (const s of skeletons) s.dispose();
    },
  };
};

/** 임시 모형 모습(glb를 못 읽었을 때): 한 덩어리라 그리기 1회. 뼈가 없어 고개·손짓은 없고 몸 돌리기·숨쉬기만 */
const figureRig = (geometry: BufferGeometry, material: Material): Rig => {
  const root = new Group();
  const body = new Mesh(geometry, material);
  root.add(body);
  return {
    root,
    mixer: null,
    idle: null,
    neck: null,
    head: null,
    headTop: null,
    arm: null,
    fore: null,
    hand: null,
    rest: [],
    openHand: [],
    breathe: body,
    clock: 0,
    dispose: () => {},
  };
};

const tinted = (g: BufferGeometry, hex: string): BufferGeometry => {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  const c = new Color(hex);
  const n = flat.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  flat.setAttribute('color', new Float32BufferAttribute(a, 3));
  return flat;
};

/** 임시 모형: 짙은 재킷 + 놋쇠 스카프·이름표(PRD_V2 W-10 도슨트 복장), 선생님 비율 */
const figureGeometry = (h: number): BufferGeometry => {
  const headR = h * 0.15;
  const legLen = h * 0.4;
  const torso = h - legLen - headR * 2;
  const jacket = '#262b38';
  const brass = '#b8894a';
  const parts: BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    parts.push(
      tinted(
        new CapsuleGeometry(h * 0.055, Math.max(0.01, legLen - h * 0.11), 3, 8).translate(
          sx * h * 0.07,
          legLen / 2,
          0,
        ),
        '#2c2c31',
      ),
    );
    parts.push(
      tinted(
        new BoxGeometry(h * 0.1, h * 0.05, h * 0.16).translate(sx * h * 0.07, h * 0.025, h * 0.03),
        '#3b2a1e',
      ),
    );
    parts.push(
      tinted(
        new CapsuleGeometry(h * 0.045, torso * 0.62, 3, 8)
          .rotateZ(sx * 0.2)
          .translate(sx * h * 0.17, legLen + torso * 0.6, 0),
        jacket,
      ),
    );
  }
  parts.push(
    tinted(
      new CapsuleGeometry(h * 0.13, Math.max(0.01, torso - h * 0.2), 4, 12).translate(
        0,
        legLen + torso / 2,
        0,
      ),
      jacket,
    ),
  );
  parts.push(
    tinted(
      new TorusGeometry(h * 0.075, h * 0.022, 6, 16)
        .rotateX(Math.PI / 2)
        .translate(0, legLen + torso * 0.95, 0),
      brass,
    ),
  );
  parts.push(
    tinted(
      new BoxGeometry(h * 0.06, h * 0.025, h * 0.01).translate(h * 0.05, legLen + torso * 0.72, h * 0.125),
      brass,
    ),
  );
  const headY = legLen + torso + headR * 0.92;
  parts.push(tinted(new SphereGeometry(headR, 20, 14).translate(0, headY, 0), '#f1c9a5'));
  parts.push(
    tinted(
      new SphereGeometry(headR * 1.06, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58)
        .rotateX(-0.35)
        .translate(0, headY + headR * 0.06, -headR * 0.06),
      '#3d2a20',
    ),
  );
  const merged = mergeGeometries(parts) ?? new SphereGeometry(headR);
  for (const p of parts) p.dispose();
  return merged;
};

/** 행동 결과를 뼈에 옮긴다: 숨쉬기(동작) → 고개 → 끄덕임 → 손짓 */
const applyRig = (rig: Rig, spot: DocentSpotFull, out: DocentOutput, dt: number): void => {
  const c = config();
  const t = docentTuning();
  rig.root.position.set(spot.pos[0], spot.y, spot.pos[1]);
  rig.root.rotation.y = out.bodyYaw;
  rig.clock += dt;
  if (rig.breathe)
    rig.breathe.scale.y = 1 + t.breath.amp * Math.sin((2 * Math.PI * rig.clock) / t.breath.sec);
  for (const r of rig.rest) r.bone.quaternion.copy(r.q);
  rig.mixer?.update(dt);
  rig.root.updateMatrixWorld(true);
  rig.root.getWorldQuaternion(qBody);
  if (out.headYaw !== 0) {
    if (rig.neck) turnBone(rig.neck, UP, out.headYaw * t.neckShare);
    if (rig.head) turnBone(rig.head, UP, out.headYaw * (1 - t.neckShare));
  }
  if (out.nod !== null && rig.head) {
    // 고개 돌린 쪽의 오른쪽 축(+X) 둘레로 앞으로 숙였다 든다(0 → 숙임 → 0을 횟수만큼)
    const n = t.nod;
    const a = n.rad * 0.5 * (1 - Math.cos(2 * Math.PI * n.hz * out.nod));
    turnBone(rig.head, vAxis.set(1, 0, 0).applyAxisAngle(UP, out.headYaw).applyQuaternion(qBody), a);
  }
  const g = out.gesture;
  const { arm, fore, hand } = rig;
  if (g && arm && fore && hand) {
    const w = c.CHAR_WAVE.teacher;
    const e = smooth(clamp01(Math.min(g.t / w.easeSec, (c.CHAR_WAVE_SEC - g.t) / w.easeSec)));
    // 캐릭터 기준(앞 +Z, 오른쪽 −X) 방향 → 세계
    if (g.kind === 'wave') {
      aimBone(arm, fore, vDir.set(-w.upper[0], w.upper[1], w.upper[2]).applyQuaternion(qBody), e);
      const phi = w.swingCenterRad + w.swingRad * Math.sin(2 * Math.PI * w.hz * g.t);
      aimBone(fore, hand, vDir.set(-Math.sin(phi), Math.cos(phi), w.upper[2]).applyQuaternion(qBody), e);
    } else {
      const p = t.guide;
      aimBone(arm, fore, vDir.set(-p.upper[0], p.upper[1], p.upper[2]).applyQuaternion(qBody), e);
      aimBone(fore, hand, vDir.set(-p.fore[0], p.fore[1], p.fore[2]).applyQuaternion(qBody), e);
    }
    // 손목·손가락을 편다(주먹 쥔 채 흔들지 않게)
    for (const f of rig.openHand) f.bone.quaternion.slerp(f.q, e);
  }
};

interface BodyProps {
  readonly spot: DocentSpotFull;
  readonly model: LoadedCharacter | null;
  readonly figure: { readonly geometry: BufferGeometry; readonly material: Material } | null;
  readonly rigs: Map<string, Rig>;
}

/** 도슨트 한 명의 몸. 붙을 때 복제하고 뗄 때 놓는다 */
const DocentBody = ({ spot, model, figure, rigs }: BodyProps) => {
  const invalidate = useThree(s => s.invalidate);
  const [rig] = useState<Rig | null>(() => {
    const r = model ? glbRig(model) : figure ? figureRig(figure.geometry, figure.material) : null;
    r?.root.position.set(spot.pos[0], spot.y, spot.pos[1]);
    r?.root.rotation.set(0, spot.yaw, 0);
    return r;
  });
  useEffect(() => {
    if (!rig) return;
    rig.idle?.();
    rigs.set(spot.id, rig);
    invalidate();
    return () => {
      if (rigs.get(spot.id) === rig) rigs.delete(spot.id);
      rig.dispose();
    };
  }, [rig, rigs, spot.id, invalidate]);
  return rig ? <primitive object={rig.root} /> : null;
};

export const Docents = ({
  layout,
  region,
  visibleParts,
  interactive = true,
  reducedMotion = false,
  onReady,
}: DocentsProps) => {
  const gl = useThree(s => s.gl);
  const invalidate = useThree(s => s.invalidate);
  const spots = useMemo(() => docentSpotsOf(layout), [layout]);
  const spotById = useMemo(() => new Map(spots.map(s => [s.id, s])), [spots]);
  const director = useMemo(() => new DocentDirector(spots), [spots]);
  const drawn = useMemo(() => drawnDocentIds(spots, region, visibleParts), [spots, region, visibleParts]);
  // 그리는 관 집합은 1m 칸마다 새로 만들어지므로 효과는 글 열쇠로 묶는다
  const drawnKey = [...drawn].sort().join('|');
  const rigs = useRef(new Map<string, Rig>()).current;

  // ── 모습 받기: 그 도슨트를 처음 그릴 때 그의 것만(광장 다음 차례) ─────────
  /** 자리 → 모습 주소 */
  const urlOf = useMemo(
    () => new Map(spots.map((s, i) => [s.id, characterGlbUrl(docentOf(s.id, i))])),
    [spots],
  );
  /** 받은 모습(주소마다, 못 읽었으면 null) */
  const [models, setModels] = useState<ReadonlyMap<string, LoadedCharacter | null>>(() => new Map());
  const requested = useRef(new Set<string>()).current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const wantKey = [...new Set([...drawn].map(id => urlOf.get(id)))]
    .filter((u): u is string => u !== undefined)
    .sort()
    .join('|');
  useEffect(() => {
    for (const url of wantKey === '' ? [] : wantKey.split('|')) {
      if (requested.has(url)) continue;
      requested.add(url);
      void loadCharacterGlb(url, gl).then(l => {
        if (!mounted.current) return;
        setModels(prev => new Map(prev).set(url, l));
        invalidate();
      });
    }
  }, [wantKey, requested, gl, invalidate]);
  const modelsReady = wantKey === '' || wantKey.split('|').every(u => models.has(u));
  useEffect(() => {
    onReady?.(modelsReady);
  }, [modelsReady, onReady]);
  const needFigure = [...models.values()].some(m => m === null);
  const figure = useMemo(
    () =>
      needFigure
        ? {
            geometry: figureGeometry(config().CHAR_HEIGHT_M.teacher),
            material: withDim(new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 })),
          }
        : null,
    [needFigure],
  );
  useEffect(
    () => () => {
      figure?.geometry.dispose();
      figure?.material.dispose();
    },
    [figure],
  );

  // ── 발밑 그늘: 그리는 도슨트 모두를 인스턴스 하나로 ─────────────────────
  const shadow = useMemo(() => {
    const geo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = blobShadowMaterial(config().CHAR_SHADOW_OPACITY);
    const mesh = new InstancedMesh(geo, mat, Math.max(1, spots.length));
    mesh.count = 0;
    mesh.visible = false;
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    return mesh;
  }, [spots.length]);
  useEffect(
    () => () => {
      shadow.geometry.dispose();
      (shadow.material as Material).dispose();
      shadow.dispose();
    },
    [shadow],
  );
  // 모습을 받은(또는 못 읽어 임시 모형인) 그리는 도슨트
  const shownKey = spots
    .filter(s => drawn.has(s.id) && models.has(urlOf.get(s.id) ?? ''))
    .map(s => s.id)
    .join('|');
  useEffect(() => {
    const c = config();
    // 도슨트는 어른 몸 틀(`domain/characters.ts`)
    const d = c.CHAR_HEIGHT_M.teacher * c.CHAR_SHADOW_RADIUS_RATIO * 2;
    const shownIds = new Set(shownKey === '' ? [] : shownKey.split('|'));
    const list = spots.filter(s => shownIds.has(s.id));
    list.forEach((s, i) => {
      vPos.set(s.pos[0], s.y + docentTuning().shadowLiftM, s.pos[1]);
      shadow.setMatrixAt(i, m4.compose(vPos, qI.identity(), vScale.set(d, 1, d)));
    });
    shadow.count = list.length;
    shadow.instanceMatrix.needsUpdate = true;
    shadow.visible = list.length > 0;
    director.setDrawn(drawn);
    invalidate();
    // `drawn`은 `drawnKey`가 같으면 같은 내용이라 열쇠만 본다
  }, [drawnKey, shownKey, spots, shadow, director, invalidate]);

  // ── 걷기 저장소: 행동 키·부딪힘이 쓰는 도슨트 목록 ─────────────────────
  useEffect(() => {
    // 도슨트가 없는 배치(스키마 2)는 저장소를 건드리지 않는다(새 빈 배열이 걷기 화면을 깨우지 않게)
    if (spots.length === 0) return;
    const npcs = spots.map(s => ({ id: s.id, pos: s.pos, yaw: s.yaw }));
    useWalk.getState().set({ npcs });
    return () => {
      if (useWalk.getState().npcs === npcs) useWalk.getState().set({ npcs: [] });
    };
  }, [spots]);

  // ── 말걸기 요청 → 대사 / 카드 닫기 → 행동도 닫기 ───────────────────────
  const writing = useRef(false);
  useEffect(() => {
    if (!interactive) return;
    return useWalk.subscribe((n, p) => {
      const req = n.talkRequest;
      if (!req || req === p.talkRequest) return;
      const s = director.talk(req.npcId, nowSec());
      if (!s) return;
      writing.current = true;
      useDocentSpeech.setState({
        talk: { npcId: req.npcId, line: s.line, text: docentLineText(s.line), at: s.since },
      });
      writing.current = false;
      invalidate();
    });
  }, [director, interactive, invalidate]);
  useEffect(() => {
    const unsub = useDocentSpeech.subscribe((n, p) => {
      if (writing.current || !p.talk || n.talk) return;
      director.closeTalk(p.talk.npcId);
      invalidate();
    });
    return () => {
      unsub();
      useDocentSpeech.setState({ talk: null, bubble: null });
    };
  }, [director, invalidate]);

  // ── 한마디 시작·대사 끝에 한 번 깨우기 ────────────────────────────────
  const timer = useRef<{ id: number | null; at: number | null }>({ id: null, at: null });
  useEffect(
    () => () => {
      if (timer.current.id !== null) window.clearTimeout(timer.current.id);
      timer.current = { id: null, at: null };
    },
    [],
  );
  const schedule = (at: number | null, now: number): void => {
    const tm = timer.current;
    if (tm.at === at) return;
    if (tm.id !== null) window.clearTimeout(tm.id);
    tm.id = null;
    tm.at = at;
    if (at === null) return;
    tm.id = window.setTimeout(
      () => {
        tm.id = null;
        tm.at = null;
        invalidate();
      },
      // 정한 시각을 조금 넘겨 깨워야 그 프레임의 시각이 그 시각을 지난다
      Math.max(0, (at - now) * 1000) + 1000 / 60,
    );
  };

  // ── 대사 상태 쓰기(바뀔 때만) ────────────────────────────────────────
  const publish = (frame: DirectorFrame, state: RootState): void => {
    const st = useDocentSpeech.getState();
    const tk = frame.talk;
    writing.current = true;
    if (
      (st.talk?.npcId ?? null) !== (tk?.npcId ?? null) ||
      (st.talk?.at ?? null) !== (tk?.speech.since ?? null)
    )
      useDocentSpeech.setState({
        talk: tk
          ? {
              npcId: tk.npcId,
              line: tk.speech.line,
              text: docentLineText(tk.speech.line),
              at: tk.speech.since,
            }
          : null,
      });
    const b = frame.bubble;
    const spot = b ? spotById.get(b.npcId) : undefined;
    if (!b || !spot) {
      if (st.bubble) useDocentSpeech.setState({ bubble: null });
      writing.current = false;
      return;
    }
    const head = rigs.get(b.npcId)?.headTop;
    if (head) {
      head.getWorldPosition(vAnchor);
      vAnchor.y += docentTuning().bubbleAboveM;
    } else
      vAnchor.set(
        spot.pos[0],
        spot.y + config().CHAR_HEIGHT_M.teacher + docentTuning().bubbleAboveM,
        spot.pos[1],
      );
    state.camera.updateMatrixWorld();
    vAnchor.project(state.camera);
    const onScreen = vAnchor.z > -1 && vAnchor.z < 1 && Math.abs(vAnchor.x) <= 1 && Math.abs(vAnchor.y) <= 1;
    const x = ((vAnchor.x + 1) / 2) * state.size.width;
    const y = ((1 - vAnchor.y) / 2) * state.size.height;
    const prev = st.bubble;
    const px = docentTuning().bubbleMovePx;
    if (
      !prev ||
      prev.npcId !== b.npcId ||
      prev.at !== b.speech.since ||
      prev.kind !== b.speech.kind ||
      prev.onScreen !== onScreen ||
      Math.abs(prev.x - x) > px ||
      Math.abs(prev.y - y) > px
    )
      useDocentSpeech.setState({
        bubble: {
          npcId: b.npcId,
          kind: b.speech.kind,
          line: b.speech.line,
          text: docentLineText(b.speech.line),
          at: b.speech.since,
          x,
          y,
          onScreen,
        },
      });
    writing.current = false;
  };

  useFrame((state, delta) => {
    if (spots.length === 0) return;
    const now = nowSec();
    const w = useWalk.getState();
    const input = combinedInput(w);
    const walking = Math.hypot(input.forward, input.strafe) > 0 || w.mode === 'guiding';
    const frame = director.step({ now, me: interactive ? w.me : null, walking, calm: reducedMotion });
    const dt = Math.min(docentTuning().dtMaxSec, Math.max(0, delta));
    for (const [id, rig] of rigs) {
      const out = frame.outs.get(id);
      const spot = spotById.get(id);
      if (out && spot) applyRig(rig, spot, out, dt);
    }
    publish(frame, state);
    if (frame.busy) invalidate();
    schedule(frame.wakeAt, now);
  });

  if (spots.length === 0) return null;
  return (
    <>
      {spots
        .filter(s => drawn.has(s.id))
        .map(s => {
          const url = urlOf.get(s.id);
          const model = url === undefined ? undefined : models.get(url);
          if (url === undefined || model === undefined) return null;
          return (
            <DocentBody
              key={`${s.id}:${url}:${model ? 'glb' : 'figure'}`}
              spot={s}
              model={model}
              figure={figure}
              rigs={rigs}
            />
          );
        })}
      <primitive object={shadow} />
    </>
  );
};
