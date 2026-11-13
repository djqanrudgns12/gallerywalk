import { config } from '@gallery/core/config';
import type { CharacterId } from '@gallery/core/types';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { blobShadowMaterial, withDim } from '../scene/materials.ts';
import { loadPeerBody, type PeerBody, vatFrame } from './peerBody.ts';
import { type PeerView, splitVisible } from './peerBuffer.ts';

/**
 * 다른 관람객(ADR-057, R-6). 그리기 호출을 사람 수와 상관없이 일정하게:
 * - 몸: 캐릭터 종류마다 `InstancedMesh` 하나(4종 = 최대 4회). 걸으면 위아래로 살짝 흔들린다.
 * - 이름표: 모든 사람의 별명을 한 캔버스(아틀라스)에 그리고, 화면을 보는 네모 하나씩을 인스턴스로(1회).
 *   가까운 `maxFull`명은 몸과 이름표, 나머지는 이름표만(멀면 작게).
 *
 * 몸은 R-4 캐릭터의 먼 거리 LOD(`{id}-lod1.glb`)를 구운 정점 애니메이션(`peerBody.ts`) — 사람마다 빠르기에 맞춰 서기·걷기·뛰기
 *   장면을 고른다(재생 배속은 내 캐릭터와 같은 규칙, 서기 ↔ 걷기는 섞어 넘어감). 그 종류가 처음 보일 때 받는다.
 *   받기 전·없으면 임시 모형(아래 `figureGeometry`, 걸으면 위아래로만 흔들림).
 * - 발밑 그늘: 모든 사람을 인스턴스 하나로(1회).
 */

export interface PeersProps {
  /** 매 프레임 보일 자리(보간된 값) */
  readonly sample: () => readonly PeerView[];
  /** 보간이 아직 남았는가(`PeerBuffer.busy`) */
  readonly busy: () => boolean;
  /** 내 자리(가까운 순서) */
  readonly me: () => { x: number; z: number };
  readonly maxFull: number;
  /** 이름표 글(역할 배지 포함)과 색: 보통·선생님 */
  readonly labelOf: (p: PeerView) => { text: string; teacher: boolean };
  /** 움직였으면 다시 그리기를 깨운다 */
  readonly invalidate: () => void;
}

const KINDS: readonly CharacterId[] = ['student-m', 'student-f', 'teacher-m', 'teacher-f'];
const MAX_PER_KIND = 40;
const TAG_SLOTS = 128;
/** 겹친 이름표를 올리는 한 칸 높이(m)와 최대 칸 수 */
const TAG_STACK_STEP_M = 0.22;
const TAG_STACK_MAX = 3;
const ATLAS_W = 2048;
const SLOT_H = 64;
const SLOT_W = 512;
const COLS = ATLAS_W / SLOT_W;

const PALETTE: Readonly<Record<CharacterId, { top: string; bottom: string; hair: string }>> = {
  'student-m': { top: '#1f2f55', bottom: '#8f7f6d', hair: '#4a2f22' },
  'student-f': { top: '#6e1f2c', bottom: '#1f2a4d', hair: '#3d2a20' },
  'teacher-m': { top: '#4c5a2a', bottom: '#4a4a4a', hair: '#3a2a20' },
  'teacher-f': { top: '#c99a2e', bottom: '#1f2a4d', hair: '#3d2a20' },
};

const tinted = (g: BufferGeometry, hex: string): BufferGeometry => {
  const c = new Color(hex);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
};

/** 임시 모형 한 덩어리(CharacterFigure와 같은 비율) */
const figureGeometry = (kind: CharacterId): BufferGeometry => {
  const teacher = kind.startsWith('teacher');
  const h = teacher ? config().CHAR_HEIGHT_M.teacher : config().CHAR_HEIGHT_M.student;
  const headR = h * (teacher ? 0.15 : 0.18);
  const legLen = h * (teacher ? 0.4 : 0.3);
  const torso = h - legLen - headR * 2;
  const p = PALETTE[kind];
  const parts: BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    parts.push(
      tinted(
        new CapsuleGeometry(h * 0.055, Math.max(0.01, legLen - h * 0.11), 3, 8).translate(
          sx * h * 0.07,
          legLen / 2,
          0,
        ),
        p.bottom,
      ),
    );
    parts.push(
      tinted(
        new BoxGeometry(h * 0.1, h * 0.05, h * 0.16).translate(sx * h * 0.07, h * 0.025, h * 0.03),
        '#e8dfcf',
      ),
    );
    parts.push(
      tinted(
        new CapsuleGeometry(h * 0.045, torso * 0.62, 3, 8)
          .rotateZ(sx * 0.28)
          .translate(sx * h * 0.19, legLen + torso * 0.6, 0),
        p.top,
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
      p.top,
    ),
  );
  const headY = legLen + torso + headR * 0.92;
  parts.push(tinted(new SphereGeometry(headR, 20, 14).translate(0, headY, 0), '#f1c9a5'));
  parts.push(
    tinted(
      new SphereGeometry(headR * 1.06, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58)
        .rotateX(-0.35)
        .translate(0, headY + headR * 0.06, -headR * 0.06),
      p.hair,
    ),
  );
  const merged = mergeGeometries(parts) ?? parts[0]!;
  for (const g of parts) if (g !== merged) g.dispose();
  return merged;
};

/** 화면을 보는 이름표 네모(인스턴스: 자리·크기·아틀라스 칸) */
const tagMaterial = (atlas: CanvasTexture): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { uAtlas: { value: atlas }, uCols: { value: COLS }, uRows: { value: TAG_SLOTS / COLS } },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute vec2 aSize;
      attribute float aSlot;
      uniform float uCols;
      uniform float uRows;
      varying vec2 vUv;
      void main() {
        vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
        mv.xy += position.xy * aSize;
        gl_Position = projectionMatrix * mv;
        float col = mod(aSlot, uCols);
        float row = floor(aSlot / uCols);
        vUv = vec2((col + uv.x) / uCols, 1.0 - (row + 1.0 - uv.y) / uRows);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(uAtlas, vUv);
        if (c.a < 0.02) discard;
        gl_FragColor = c;
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });

export const Peers = ({ sample, busy, me, maxFull, labelOf, invalidate }: PeersProps) => {
  const parts = useMemo(() => {
    const material = withDim(new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 }));
    const bodies = new Map<CharacterId, InstancedMesh>();
    for (const k of KINDS) {
      const m = new InstancedMesh(figureGeometry(k), material, MAX_PER_KIND);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      bodies.set(k, m);
    }
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W;
    canvas.height = (TAG_SLOTS / COLS) * SLOT_H;
    const atlas = new CanvasTexture(canvas);
    atlas.colorSpace = SRGBColorSpace;
    const quad = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const center = new InstancedBufferAttribute(new Float32Array(TAG_SLOTS * 3), 3).setUsage(
      DynamicDrawUsage,
    );
    const size = new InstancedBufferAttribute(new Float32Array(TAG_SLOTS * 2), 2).setUsage(DynamicDrawUsage);
    const slot = new InstancedBufferAttribute(new Float32Array(TAG_SLOTS), 1).setUsage(DynamicDrawUsage);
    geo.setAttribute('aCenter', center);
    geo.setAttribute('aSize', size);
    geo.setAttribute('aSlot', slot);
    geo.instanceCount = 0;
    const tagMat = tagMaterial(atlas);
    const tags = new Mesh(geo, tagMat);
    tags.frustumCulled = false;
    tags.renderOrder = 10;
    // 발밑 그늘(모든 사람 공용 인스턴스)
    const shadowGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const shadowMat = blobShadowMaterial(config().CHAR_SHADOW_OPACITY);
    const shadows = new InstancedMesh(shadowGeo, shadowMat, MAX_PER_KIND * KINDS.length);
    shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    shadows.count = 0;
    shadows.frustumCulled = false;
    shadows.renderOrder = 2;
    return {
      material,
      shadowGeo,
      shadowMat,
      shadows,
      /** 받은 몸(종류마다) · 받기를 시작한 종류 */
      bodyOf: new Map<CharacterId, PeerBody>(),
      requested: new Set<CharacterId>(),
      /** 사람마다 동작 상태: 클립 시각 t(s)·움직임 섞음 w(0 서기 … 1 걷기/뛰기)·마지막 클립 */
      anim: new Map<string, { t: number; w: number; clip: 'walk' | 'run' }>(),
      /** 받아서 바꿔 끼운 몸의 재질(종류마다) — 떼어 낼 때 버림 */
      bodyMaterials: [] as Material[],
      bodies,
      canvas,
      atlas,
      quad,
      geo,
      center,
      size,
      slot,
      tagMat,
      tags,
      slots: new Map<string, { slot: number; text: string }>(),
      /** 사람마다 이름표를 올린 칸 수(부드럽게) */
      tagLift: new Map<string, number>(),
    };
  }, []);
  useEffect(
    () => () => {
      for (const m of parts.bodies.values()) {
        m.geometry.dispose();
        m.dispose();
      }
      parts.material.dispose();
      for (const m of parts.bodyMaterials) m.dispose();
      for (const b of parts.bodyOf.values()) b.dispose();
      parts.bodyOf.clear();
      parts.requested.clear();
      parts.shadowGeo.dispose();
      parts.shadowMat.dispose();
      parts.shadows.dispose();
      parts.atlas.dispose();
      parts.quad.dispose();
      parts.geo.dispose();
      parts.tagMat.dispose();
    },
    [parts],
  );

  // 진짜 몸(LOD 정점 애니메이션)은 그 종류가 처음 보일 때 받아 임시 모형과 바꿔 끼운다
  const gl = useThree(st => st.gl);
  const redraw = useThree(st => st.invalidate);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, [parts]);
  const request = (k: CharacterId): void => {
    if (parts.requested.has(k)) return;
    parts.requested.add(k);
    void loadPeerBody(k, gl).then(body => {
      if (!body) return;
      if (!alive.current) {
        body.geometry.dispose();
        body.material.dispose();
        body.dispose();
        return;
      }
      const mesh = parts.bodies.get(k)!;
      mesh.geometry.dispose();
      body.geometry.setAttribute(
        'aVat',
        new InstancedBufferAttribute(new Float32Array(MAX_PER_KIND * 3), 3).setUsage(DynamicDrawUsage),
      );
      mesh.geometry = body.geometry;
      mesh.material = body.material;
      parts.bodyMaterials.push(body.material);
      parts.bodyOf.set(k, body);
      redraw();
    });
  };

  /** 별명을 아틀라스 칸에 그린다(바뀐 사람만) */
  const drawTag = (index: number, text: string, teacher: boolean): void => {
    const ctx = parts.canvas.getContext('2d');
    if (!ctx) return;
    const x = (index % COLS) * SLOT_W;
    const y = Math.floor(index / COLS) * SLOT_H;
    ctx.clearRect(x, y, SLOT_W, SLOT_H);
    ctx.font = `600 34px "Pretendard", "Apple SD Gothic Neo", sans-serif`;
    const w = Math.min(SLOT_W - 8, ctx.measureText(text).width + 36);
    const left = x + (SLOT_W - w) / 2;
    ctx.fillStyle = teacher ? '#6b2135' : 'rgba(250,247,241,0.94)';
    ctx.beginPath();
    // 옛 iPad Safari(15 이하)에는 roundRect가 없다 → 알약 모양을 호 두 개로
    const top = y + 8;
    const hh = SLOT_H - 16;
    const rr = hh / 2;
    ctx.moveTo(left + rr, top);
    ctx.lineTo(left + w - rr, top);
    ctx.arc(left + w - rr, top + rr, rr, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(left + rr, top + hh);
    ctx.arc(left + rr, top + rr, rr, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = teacher ? '#6b2135' : '#cfc4b0';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = teacher ? '#faf7f1' : '#1e1b18';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + SLOT_W / 2, y + SLOT_H / 2 + 1, w - 24);
    parts.atlas.needsUpdate = true;
  };

  const m = useMemo(() => new Matrix4(), []);
  const q = useMemo(() => new Quaternion(), []);
  const up = useMemo(() => new Vector3(0, 1, 0), []);
  const one = useMemo(() => new Vector3(1, 1, 1), []);
  const pos = useMemo(() => new Vector3(), []);
  const sc = useMemo(() => new Vector3(), []);
  const view = useMemo(() => new Vector3(), []);

  useFrame((state, dtIn) => {
    const c = config();
    const dt = Math.min(dtIn, 0.1);
    const views = sample();
    const { full, tags } = splitVisible(views, me(), maxFull);
    const counts = new Map<CharacterId, number>(KINDS.map(k => [k, 0]));
    const t = state.clock.elapsedTime;
    let moving = false;
    let shadowCount = 0;
    const seenAnim = new Set<string>();
    for (const p of full) {
      const mesh = parts.bodies.get(p.character)!;
      const i = counts.get(p.character)!;
      if (i >= MAX_PER_KIND) continue;
      request(p.character);
      const body = parts.bodyOf.get(p.character);
      const walking = p.speed > 0.05;
      if (walking) moving = true;
      // 정점 애니메이션: 빠르기로 클립·배속을 고르고(내 캐릭터와 같은 규칙) 서기 ↔ 걷기는 섞는다
      let lift = 0;
      if (body) {
        const st = parts.anim.get(p.sid) ?? { t: 0, w: 0, clip: 'walk' as const };
        const clipName = p.speed > (c.CHAR_WALK_MPS + c.CHAR_RUN_MPS) / 2 && body.run ? 'run' : 'walk';
        const clip = (clipName === 'run' ? body.run : body.walk) ?? null;
        const r = c.CHAR_CLIP_RATE;
        if (walking && clip) {
          const ground = body.groundMps[clipName] ?? (clipName === 'run' ? c.CHAR_RUN_MPS : c.CHAR_WALK_MPS);
          const rate =
            clipName === 'run'
              ? Math.min(r.runMax, Math.max(r.runMin, p.speed / ground))
              : Math.min(r.walkMax, Math.max(r.walkMin, p.speed / ground));
          st.t += dt * rate;
          st.clip = clipName;
        }
        const k = c.PEER_VAT_BLEND_PER_S * dt;
        st.w = walking ? Math.min(1, st.w + k) : Math.max(0, st.w - k);
        if (st.w > 0 || walking) moving = true;
        const live = (st.clip === 'run' ? body.run : body.walk) ?? null;
        const attr = mesh.geometry.getAttribute('aVat') as InstancedBufferAttribute | undefined;
        if (attr) {
          if (!live || st.w <= 0) attr.setXYZ(i, body.idle.base, body.idle.base, 0);
          else {
            const f = vatFrame(live, st.t);
            // 다 걷는 중이면 앞뒤 장면을 섞고, 서기와 섞는 동안은 서기 → 가까운 장면
            if (st.w >= 1) attr.setXYZ(i, f.a, f.b, f.mix);
            else attr.setXYZ(i, body.idle.base, f.mix < 0.5 ? f.a : f.b, st.w);
          }
        }
        parts.anim.set(p.sid, st);
        seenAnim.add(p.sid);
      } else {
        lift = walking ? Math.abs(Math.sin(t * 9 + p.x)) * 0.03 : 0;
      }
      mesh.setMatrixAt(i, m.compose(pos.set(p.x, p.y + lift, p.z), q.setFromAxisAngle(up, p.yaw), one));
      counts.set(p.character, i + 1);
      // 발밑 그늘(키에 맞춘 원판, 옆으로 조금 넓게)
      const tall = p.character.startsWith('teacher') ? c.CHAR_HEIGHT_M.teacher : c.CHAR_HEIGHT_M.student;
      const d = tall * c.CHAR_SHADOW_RADIUS_RATIO * 2;
      parts.shadows.setMatrixAt(
        shadowCount++,
        m.compose(pos.set(p.x, p.y + 0.012, p.z), q, sc.set(d, 1, d * 0.85)),
      );
    }
    for (const sid of [...parts.anim.keys()]) if (!seenAnim.has(sid)) parts.anim.delete(sid);
    for (const [k, mesh] of parts.bodies) {
      mesh.count = counts.get(k)!;
      mesh.instanceMatrix.needsUpdate = true;
      const attr = mesh.geometry.getAttribute('aVat') as InstancedBufferAttribute | undefined;
      if (attr) attr.needsUpdate = true;
    }
    parts.shadows.count = shadowCount;
    parts.shadows.instanceMatrix.needsUpdate = true;
    // 이름표: 온몸인 사람은 머리 위, 이름표만인 사람은 머리 높이에 조금 작게
    const all = [...full.map(p => ({ p, small: false })), ...tags.map(p => ({ p, small: true }))].slice(
      0,
      TAG_SLOTS,
    );
    const seen = new Set<string>();
    // 화면에서 겹치는 이름표는 가까운 사람 것부터 두고 뒤의 것을 한 칸씩 위로(최대 TAG_STACK_MAX칸, 부드럽게 옮김)
    const cam = state.camera as PerspectiveCamera;
    const tanH = Math.tan((cam.fov * Math.PI) / 360);
    const placed: { x: number; y: number; hw: number; hh: number }[] = [];
    all.forEach(({ p, small }, i) => {
      const label = labelOf(p);
      const key = `${label.teacher ? 't' : 'v'}:${label.text}`;
      const prev = parts.slots.get(p.sid);
      // 칸 = 이번 순서(i). 같은 칸에 같은 글이면 다시 그리지 않음
      const owner = [...parts.slots.entries()].find(([, v]) => v.slot === i);
      if (!prev || prev.slot !== i || prev.text !== key || (owner && owner[0] !== p.sid)) {
        if (owner && owner[0] !== p.sid) parts.slots.delete(owner[0]);
        drawTag(i, label.text, label.teacher);
        parts.slots.set(p.sid, { slot: i, text: key });
      }
      seen.add(p.sid);
      const tall = p.character.startsWith('teacher')
        ? config().CHAR_HEIGHT_M.teacher
        : config().CHAR_HEIGHT_M.student;
      const s = small ? 0.75 : 1;
      const baseY = p.y + tall + 0.28;
      let target = 0;
      view.set(p.x, baseY, p.z).applyMatrix4(cam.matrixWorldInverse);
      const dist = -view.z;
      if (dist > 0.1) {
        const k = 1 / (dist * tanH);
        const x = (view.x * k) / cam.aspect;
        const hw = (0.8 * s * k) / cam.aspect;
        const hh = 0.1 * s * k;
        const step = TAG_STACK_STEP_M * s * k;
        const hit = (y: number): boolean =>
          placed.some(r => Math.abs(r.x - x) < r.hw + hw && Math.abs(r.y - y) < r.hh + hh);
        while (target < TAG_STACK_MAX && hit(view.y * k + target * step)) target++;
        placed.push({ x, y: view.y * k + target * step, hw, hh });
      }
      const lift = parts.tagLift.get(p.sid) ?? target;
      const next = lift + (target - lift) * Math.min(1, dtIn * 8);
      parts.tagLift.set(p.sid, Math.abs(next - target) < 0.01 ? target : next);
      if (Math.abs(next - target) >= 0.01) moving = true;
      parts.center.setXYZ(i, p.x, baseY + next * TAG_STACK_STEP_M * s, p.z);
      parts.size.setXY(i, 1.6 * s, 0.2 * s);
      parts.slot.setX(i, i);
    });
    for (const sid of [...parts.slots.keys()]) if (!seen.has(sid)) parts.slots.delete(sid);
    for (const sid of [...parts.tagLift.keys()]) if (!seen.has(sid)) parts.tagLift.delete(sid);
    parts.geo.instanceCount = all.length;
    parts.center.needsUpdate = true;
    parts.size.needsUpdate = true;
    parts.slot.needsUpdate = true;
    if (moving || busy()) invalidate();
  });

  return (
    <group>
      {[...parts.bodies.values()].map((b, i) => (
        <primitive key={i} object={b} />
      ))}
      <primitive object={parts.shadows} />
      <primitive object={parts.tags} />
    </group>
  );
};
