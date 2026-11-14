import { config } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import type { BubbleContent } from '@gallery/core/live';
import { buildOf, type CharacterId } from '@gallery/core/types';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  type PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from 'three';
import { ktx2LoaderFor } from '../scene/gltf.ts';
import {
  type AtlasRect,
  drawPlaceholderStickers,
  drawTextSlot,
  SlotCache,
  STICKER_ATLAS_URL,
  stickerRect,
  TEXT_ATLAS_W,
  TEXT_GLYPH_RATIO,
  TEXT_SLOTS,
  textAtlasHeight,
} from './bubbleAtlas.ts';
import { BUBBLE_ME, type BubbleBoard, bubbleLook, bubblePx, bubbleRange, bubbleSeen } from './bubbleBoard.ts';
import type { PeerView } from './peerBuffer.ts';
import { createRedrawLimiter } from './redrawLimiter.ts';
import { placeTags } from './tagLayout.ts';

/**
 * 머리 위 말풍선(PRD_V2 W-02, M4-3). 그리기 호출은 사람 수와 상관없이 **2회 이하**: 스티커 아틀라스 하나 + 말 글자 아틀라스 하나에
 * 화면을 보는 네모를 인스턴스로(떠 있는 것이 없는 묶음은 그리지 않음).
 * - 자리: 머리 위 `headM`(다른 사람은 버퍼가 보간한 자리, 나는 걷기 상태). 화면 CSS px로 키를 정해(`bubblePx` — 멀어도 작아지지
 *   않음) 꼬리 끝이 머리 위 점에 오게 세운다. 깊이 검사 없이 이름표 위에 그리고, 먼 것부터 그려 가까운 것이 위에 온다.
 * - 보이기: `BUBBLE_MAX_DIST_M` 안 + 벽 너머가 아닌 구역(`bubbleSeen`). 화면에서 겹치면 가까운 사람 것을 제자리에, 먼 것을 위로
 *   비켜 `tiers`단까지(`placeTags` — 이름표와 같은 규칙), 그래도 겹치면 숨김.
 * - 다시 그리기: 튀어 오르거나 사라지는 동안만 `LIVE_PEER_REDRAW_FPS` 상한으로 깨우고, 머무는 동안은 사라지기 시작할 때 한 번 깨운다
 *   (정지 상태 다시 그리기 0, PRD 10장).
 * - 스티커 그림(M4-1): 붙자마자는 임시 캔버스 칸으로 그리고, 처음 말풍선이 뜨거나 `BUBBLE_ATLAS.delayMs` 뒤에 `stk-1/atlas.ktx2`를
 *   받아 갈아 끼운다(첫 화면 예산 밖). 못 받으면 임시 칸 그대로.
 */

export type BubbleDevice = 'phone' | 'tablet' | 'desktop';

export interface BubblesProps {
  readonly board: BubbleBoard;
  /** 다른 사람 자리(보간된 값) — `Peers`와 같은 것 */
  readonly sample: () => readonly PeerView[];
  /** 내 발 자리 */
  readonly me: () => { readonly x: number; readonly y: number; readonly z: number };
  readonly myCharacter: CharacterId;
  /** 내 말풍선을 보일까(작품 크게 보기 등 내 캐릭터가 숨었을 때 false) */
  readonly mineVisible: () => boolean;
  /** 내 구역 · 자리 → 구역 · 지금 그리는 관 */
  readonly region: string;
  readonly regionOf: (x: number, z: number) => string;
  readonly visibleParts: ReadonlySet<string>;
  readonly device: BubbleDevice;
  readonly reducedMotion: boolean;
  readonly invalidate: () => void;
}

/** 한 묶음(스티커·말)의 네모 수 상한 — 18m 안에서 가까운 순서로 */
const MAX_BUBBLES = 40;

/** 화면을 보는 네모: 꼬리 끝(아래 가운데)을 머리 위 점에 두고 CSS px 크기로 세운다 */
const bubbleMaterial = (atlas: Texture): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { uAtlas: { value: atlas }, uView: { value: [1, 1] } },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute vec2 aSize;
      attribute float aLift;
      attribute vec4 aRect;
      attribute float aAlpha;
      uniform vec2 uView;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(aCenter, 1.0);
        vec2 px = position.xy * aSize + vec2(0.0, aSize.y * 0.5 + aLift);
        clip.xy += px / uView * 2.0 * clip.w;
        gl_Position = clip;
        vUv = mix(aRect.xy, aRect.zw, uv);
        vAlpha = aAlpha;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec4 c = texture2D(uAtlas, vUv);
        c.a *= vAlpha;
        if (c.a < 0.01) discard;
        gl_FragColor = c;
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

interface Batch {
  readonly atlas: CanvasTexture;
  readonly geo: InstancedBufferGeometry;
  readonly mat: ShaderMaterial;
  readonly mesh: Mesh;
  readonly center: InstancedBufferAttribute;
  readonly size: InstancedBufferAttribute;
  readonly lift: InstancedBufferAttribute;
  readonly rect: InstancedBufferAttribute;
  readonly alpha: InstancedBufferAttribute;
}

const makeBatch = (canvas: HTMLCanvasElement, quad: PlaneGeometry, order: number): Batch => {
  const atlas = new CanvasTexture(canvas);
  atlas.colorSpace = SRGBColorSpace;
  const geo = new InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const attr = (n: number) =>
    new InstancedBufferAttribute(new Float32Array(MAX_BUBBLES * n), n).setUsage(DynamicDrawUsage);
  const center = attr(3);
  const size = attr(2);
  const lift = attr(1);
  const rect = attr(4);
  const alpha = attr(1);
  geo.setAttribute('aCenter', center);
  geo.setAttribute('aSize', size);
  geo.setAttribute('aLift', lift);
  geo.setAttribute('aRect', rect);
  geo.setAttribute('aAlpha', alpha);
  geo.instanceCount = 0;
  const mat = bubbleMaterial(atlas);
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.visible = false;
  return { atlas, geo, mat, mesh, center, size, lift, rect, alpha };
};

/** 말 칸 열쇠와 글(스티커는 null) */
const textOf = (b: BubbleContent): { key: string; text: string } | null =>
  b.k === 's'
    ? null
    : b.k === 'p'
      ? { key: `p:${b.i}`, text: copy.bubble.phrases[b.i] ?? '' }
      : { key: `x:${b.text}`, text: b.text };

interface Placed {
  readonly sticker: boolean;
  readonly anchor: Vector3;
  readonly depth: number;
  readonly sx: number;
  readonly sy: number;
  readonly w: number;
  readonly h: number;
  readonly rect: AtlasRect;
  readonly alpha: number;
}

export const Bubbles = ({
  board,
  sample,
  me,
  myCharacter,
  mineVisible,
  region,
  regionOf,
  visibleParts,
  device,
  reducedMotion,
  invalidate,
}: BubblesProps) => {
  const wakeRef = useRef(invalidate);
  wakeRef.current = invalidate;
  const limiter = useMemo(
    () => createRedrawLimiter(config().LIVE_PEER_REDRAW_FPS, () => wakeRef.current()),
    [],
  );
  const timer = useRef<{ id: ReturnType<typeof setTimeout>; at: number } | null>(null);
  useEffect(
    () => () => {
      limiter.cancel();
      if (timer.current) clearTimeout(timer.current.id);
    },
    [limiter],
  );

  const gl = useThree(s => s.gl);
  const parts = useMemo(() => {
    const quad = new PlaneGeometry(1, 1);
    const stickerCanvas = document.createElement('canvas');
    drawPlaceholderStickers(stickerCanvas);
    const textCanvas = document.createElement('canvas');
    textCanvas.width = TEXT_ATLAS_W;
    textCanvas.height = textAtlasHeight();
    return {
      quad,
      textCanvas,
      stickers: makeBatch(stickerCanvas, quad, 12),
      texts: makeBatch(textCanvas, quad, 12),
      slots: new SlotCache(TEXT_SLOTS),
      rects: new Map<number, AtlasRect>(),
      frame: 0,
      /** 받은 스티커 아틀라스(KTX2)와 받기 상태 */
      stickerAtlas: null as Texture | null,
      atlasState: 'idle' as 'idle' | 'loading' | 'done' | 'failed',
      gone: false,
    };
  }, []);
  useEffect(
    () => () => {
      parts.gone = true;
      for (const b of [parts.stickers, parts.texts]) {
        b.atlas.dispose();
        b.geo.dispose();
        b.mat.dispose();
      }
      parts.stickerAtlas?.dispose();
      parts.quad.dispose();
    },
    [parts],
  );

  /** 스티커 아틀라스 받기(한 번) — 받으면 임시 캔버스 칸을 놓고 갈아 끼운 뒤 한 번 다시 그린다 */
  const loadStickerAtlas = useCallback(() => {
    if (parts.atlasState !== 'idle') return;
    parts.atlasState = 'loading';
    ktx2LoaderFor(gl)
      .loadAsync(STICKER_ATLAS_URL)
      .then(
        tex => {
          if (parts.gone) {
            tex.dispose();
            return;
          }
          tex.colorSpace = SRGBColorSpace;
          parts.stickers.mat.uniforms['uAtlas']!.value = tex;
          parts.stickerAtlas = tex;
          parts.stickers.atlas.dispose();
          parts.atlasState = 'done';
          wakeRef.current();
        },
        () => {
          parts.atlasState = 'failed';
        },
      );
  }, [gl, parts]);
  useEffect(() => {
    const id = setTimeout(loadStickerAtlas, config().BUBBLE_ATLAS.delayMs);
    return () => clearTimeout(id);
  }, [loadStickerAtlas]);

  const view = useMemo(() => new Vector3(), []);
  const ndc = useMemo(() => new Vector3(), []);

  useFrame(state => {
    const c = config();
    const l = c.BUBBLE_LOOK;
    const now = Date.now();
    const items = board.active(now);
    parts.frame += 1;
    if (items.length > 0) loadStickerAtlas();
    const placed: Placed[] = [];
    if (items.length > 0) {
      const cam = state.camera as PerspectiveCamera;
      const { width: W, height: H } = state.size;
      const projY = cam.projectionMatrix.elements[5] ?? 1;
      const others = items.some(it => it.who !== BUBBLE_ME) ? new Map(sample().map(p => [p.sid, p])) : null;
      const stickerRange = bubbleRange(device, 'sticker', 1);
      const textRange = bubbleRange(device, 'text', TEXT_GLYPH_RATIO);
      for (const it of items) {
        let foot: { x: number; y: number; z: number };
        let character: CharacterId;
        if (it.who === BUBBLE_ME) {
          if (!mineVisible()) continue;
          foot = me();
          character = myCharacter;
        } else {
          const p = others?.get(it.who);
          if (!p) continue;
          if (!bubbleSeen(region, regionOf(p.x, p.z), visibleParts)) continue;
          foot = p;
          character = p.character;
        }
        const look = bubbleLook((now - it.at) / 1000, it.b.k, reducedMotion);
        if (!look) continue;
        const anchor = new Vector3(foot.x, foot.y + c.CHAR_HEIGHT_M[buildOf(character)] + l.headM, foot.z);
        view.copy(anchor).applyMatrix4(cam.matrixWorldInverse);
        const depth = -view.z;
        if (depth <= 0.1 || anchor.distanceTo(cam.position) > c.BUBBLE_MAX_DIST_M) continue;
        const b = it.b;
        const text = textOf(b);
        let rect: AtlasRect;
        if (b.k === 's') rect = stickerRect(b.i);
        else if (text) {
          const got = parts.slots.get(text.key, parts.frame);
          if (!got) continue;
          const known = parts.rects.get(got.slot);
          if (got.fresh || !known) {
            rect = drawTextSlot(parts.textCanvas, got.slot, text.text);
            parts.rects.set(got.slot, rect);
            parts.texts.atlas.needsUpdate = true;
          } else rect = known;
        } else continue;
        const worldH = text ? l.textM : l.stickerM;
        const h = bubblePx(worldH, depth, projY, H, text ? textRange : stickerRange) * look.scale;
        ndc.copy(anchor).project(cam);
        placed.push({
          sticker: !text,
          anchor,
          depth,
          sx: ((ndc.x + 1) / 2) * W,
          sy: ((ndc.y + 1) / 2) * H,
          w: h * rect.aspect,
          h,
          rect,
          alpha: look.alpha,
        });
      }
    }
    // 가까운 것부터 자리를 잡고(겹치면 먼 것을 위로), 그리기는 먼 것부터
    placed.sort((a, b) => a.depth - b.depth);
    const places = placeTags(
      placed.map(p => ({
        x: p.sx,
        y: p.sy + l.gapPx + p.h / 2,
        hw: p.w / 2,
        hh: p.h / 2,
        step: p.h + l.gapPx,
        dist: p.depth,
      })),
      { maxDistM: c.BUBBLE_MAX_DIST_M, stackMax: l.tiers - 1 },
    );
    const counts = { stickers: 0, texts: 0 };
    for (let i = placed.length - 1; i >= 0; i--) {
      const p = placed[i]!;
      const place = places[i];
      if (!place || place.hidden) continue;
      const batch = p.sticker ? parts.stickers : parts.texts;
      const key = p.sticker ? 'stickers' : 'texts';
      const n = counts[key];
      if (n >= MAX_BUBBLES) continue;
      batch.center.setXYZ(n, p.anchor.x, p.anchor.y, p.anchor.z);
      batch.size.setXY(n, p.w, p.h);
      batch.lift.setX(n, l.gapPx + place.stack * (p.h + l.gapPx));
      batch.rect.setXYZW(n, p.rect.u0, p.rect.v0, p.rect.u1, p.rect.v1);
      batch.alpha.setX(n, p.alpha);
      counts[key] = n + 1;
    }
    for (const [batch, n] of [
      [parts.stickers, counts.stickers],
      [parts.texts, counts.texts],
    ] as const) {
      batch.geo.instanceCount = n;
      batch.mesh.visible = n > 0;
      (batch.mat.uniforms['uView']!.value as number[])[0] = state.size.width;
      (batch.mat.uniforms['uView']!.value as number[])[1] = state.size.height;
      if (n > 0)
        for (const a of [batch.center, batch.size, batch.lift, batch.rect, batch.alpha]) a.needsUpdate = true;
    }
    // 다시 그리기: 움직이는 중이면 상한 안에서 곧, 머무는 중이면 사라지기 시작할 때 한 번
    const next = board.nextChange(now);
    if (next === null) return;
    if (next <= now) {
      limiter.request();
      return;
    }
    if (timer.current && timer.current.at === next) return;
    if (timer.current) clearTimeout(timer.current.id);
    timer.current = {
      at: next,
      id: setTimeout(() => {
        timer.current = null;
        wakeRef.current();
      }, next - now),
    };
  });

  return (
    <group>
      <primitive object={parts.stickers.mesh} />
      <primitive object={parts.texts.mesh} />
    </group>
  );
};
