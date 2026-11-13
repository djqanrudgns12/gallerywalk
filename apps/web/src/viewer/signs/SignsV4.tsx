import { copy } from '@gallery/core/copy';
import type { TemplateLook } from '@gallery/core/templates';
import type { Layout } from '@gallery/core/types';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three';
import { withDim } from '../scene/materials.ts';
import type { Tier } from '../textures/residency.ts';
import {
  type AtlasRect,
  atlasItemsOf,
  atlasSizeOf,
  type MeasureFace,
  type MeshArrays,
  neighborGapM,
  packAtlas,
  type PlannedBlock,
  planSigns,
  plansInView,
  plateArrays,
  signV4,
  type SignFace,
  signFontSample,
  type SignPaletteV4,
  type SignPlan,
  signPaletteOf,
  type SignWordsV4,
  textArrays,
  type Zone,
  zoneAt,
} from './signAtlasV4.ts';
import type { SignRoom } from './signs.ts';

/**
 * 공간 v4 안내판 체계(PRD_V2 W-03 ①~⑦, M3-3). `layout.schemaVersion === 3`일 때만 쓴다 — v3는 `SignTexts`·`FacadeSign` 그대로.
 *
 * - 보이는 사인(지금 구역 + 이웃 구역)의 글을 **아틀라스 한 장**에 그리고 글 네모를 한 기하로 모아 **글 그리기 1회**.
 *   판(돌출 사인·토템·현수막·대문 봉)은 상자들을 한 기하로 모아 **판 그리기 1회**. 판과 글은 같은 보이기 규칙이라 빈 판이 없다.
 * - 글은 조명 없이 제 색으로(톤 매핑 없음), 깊이는 쓰지 않고(`depthWrite: false`) 벽 쪽으로 밀어 넣는 `polygonOffset`과
 *   `renderOrder`로 벽에 묻히거나 깜빡이지 않게 한다. 멀리서도 판과 함께 보인다(밉맵, 판만 남는 일 없음).
 * - 정지 상태에서 다시 그리지 않는다: 글꼴을 받고 아틀라스를 다 그린 뒤 한 번 `invalidate`. 구역이 바뀔 때만 다시 만든다.
 * - 떼어 낼 때 텍스처·기하·재질을 `dispose()`.
 */

export interface SignsV4Props {
  readonly layout: Layout;
  /** 관 ID → 전시실 이름·소개(VisitorScene `signRooms`와 같은 값) */
  readonly rooms: ReadonlyMap<string, SignRoom>;
  /** 전시 이름(프리즈·현수막) */
  readonly title: string;
  readonly look: TemplateLook;
  readonly tier: Tier;
  /** 캐릭터(또는 카메라)의 바닥 자리 `[x, z]` — 1m 칸이면 충분하다 */
  readonly at: { readonly x: number; readonly z: number };
  /** 토템 제목("전시실 안내", copy에 들어오면 그것). 없으면 방 목록만 */
  readonly totemTitle?: string | undefined;
}

const NO_ZONES: readonly Zone[] = [];
/** 글 폭을 잴 때 쓰는 기준 글꼴 크기(px) */
const REF_PX = 100;

const fontOf = (face: SignFace, px: number): string =>
  `${signV4().weight[face]} ${px}px ${signV4().font[face]}`;

/** 캔버스 `measureText`로 잰 글 폭(글꼴 크기 1 기준). 캔버스가 없으면(시험 환경) 글자 수로 어림한다 */
const canvasMeasure = (): MeasureFace => {
  const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  const memo = new Map<string, number>();
  return (text, face) => {
    const key = `${face}\u0000${text}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let v = Array.from(text).length;
    if (ctx) {
      ctx.font = fontOf(face, REF_PX);
      v = ctx.measureText(text).width / REF_PX;
    }
    memo.set(key, v);
    return v;
  };
};

/** 사인 글자의 글꼴을 받는다(그 글자의 하위 꾸러미만). 받을 때마다 1씩 늘어난다 — 0이면 아직 재지 않는다 */
const useFontEpoch = (sample: string): number => {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let alive = true;
    const done = (): void => {
      if (alive) setEpoch(e => e + 1);
    };
    const fonts = typeof document !== 'undefined' && 'fonts' in document ? document.fonts : null;
    if (fonts)
      Promise.all([
        fonts.load(fontOf('title', signV4().emPx.title), sample),
        fonts.load(fontOf('body', signV4().emPx.body), sample),
      ]).then(done, done);
    else done();
    return () => {
      alive = false;
    };
  }, [sample]);
  return epoch;
};

const gray = (v: number): string => {
  const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${g},${g},${g})`;
};

/**
 * 글 덩이 하나를 아틀라스에 흰색 계열로 그린다(색은 정점 색이 입힌다). 가로로 누르지 않는다(`maxWidth` 없음).
 * 눌린 그늘(오른쪽 아래로 조금) 위에 글자, 금속 글자는 위가 밝은 결.
 */
const drawBlock = (ctx: CanvasRenderingContext2D, b: PlannedBlock, r: AtlasRect): void => {
  const d = r.pxPerM;
  const px = b.size * d;
  const m = b.margin * d;
  const step = b.lineHeight * px;
  const { shade, dx, dy } = signV4().relief;
  ctx.font = fontOf(b.face, px);
  ctx.textBaseline = 'middle';
  ctx.textAlign = b.align === 'left' ? 'left' : 'center';
  const x = b.align === 'left' ? r.x + m : r.x + r.w / 2;
  b.lines.forEach((line, i) => {
    const y = r.y + m + (i + 0.5) * step;
    ctx.fillStyle = gray(shade);
    ctx.fillText(line, x + dx * px, y + dy * px);
    if (b.metal) {
      const g = ctx.createLinearGradient(0, y - px / 2, 0, y + px / 2);
      g.addColorStop(0, gray(signV4().metal.top));
      g.addColorStop(1, gray(signV4().metal.bottom));
      ctx.fillStyle = g;
    } else ctx.fillStyle = gray(1);
    ctx.fillText(line, x, y);
  });
};

const geometryOf = (a: MeshArrays): BufferGeometry => {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(a.position, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(a.uv, 2));
  geo.setAttribute('color', new Float32BufferAttribute(a.color, 3));
  if (a.normal.length > 0) geo.setAttribute('normal', new Float32BufferAttribute(a.normal, 3));
  geo.setIndex(a.index);
  geo.computeBoundingSphere();
  return geo;
};

interface Built {
  readonly text: Mesh;
  readonly plates: Mesh | null;
  readonly dispose: () => void;
}

const build = (plans: readonly SignPlan[], palette: SignPaletteV4, tier: Tier): Built | null => {
  if (plans.length === 0) return null;
  const { width, maxHeight } = atlasSizeOf(tier);
  const atlas = packAtlas(atlasItemsOf(plans), width, maxHeight, signV4().atlas.gutterPx);
  const canvas = document.createElement('canvas');
  canvas.width = atlas.width;
  canvas.height = atlas.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    let k = 0;
    for (const p of plans)
      for (const b of p.blocks) {
        const r = atlas.rects[k++];
        if (r) drawBlock(ctx, b, r);
      }
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  const textGeo = geometryOf(textArrays(plans, atlas, palette));
  const textMat = withDim(
    new MeshBasicMaterial({
      map,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
  );
  const text = new Mesh(textGeo, textMat);
  text.renderOrder = signV4().renderOrder;
  const plate = plateArrays(plans, palette);
  const plateGeo = plate.index.length > 0 ? geometryOf(plate) : null;
  const plateMat = plateGeo
    ? withDim(new MeshStandardMaterial({ vertexColors: true, ...signV4().plateFinish }))
    : null;
  const plates = plateGeo && plateMat ? new Mesh(plateGeo, plateMat) : null;
  return {
    text,
    plates,
    dispose: () => {
      map.dispose();
      textGeo.dispose();
      textMat.dispose();
      plateGeo?.dispose();
      plateMat?.dispose();
    },
  };
};

export const SignsV4 = ({ layout, rooms, title, look, tier, at, totemTitle }: SignsV4Props) => {
  const invalidate = useThree(st => st.invalidate);
  const words = useMemo<SignWordsV4>(
    () => ({ title, rooms, exit: copy.viewer.signExit, totemTitle }),
    [title, rooms, totemTitle],
  );
  const sample = useMemo(() => signFontSample(layout, words), [layout, words]);
  const epoch = useFontEpoch(sample);
  // 글꼴을 받은 뒤에 잰다(대체 글꼴로 재면 그릴 때 폭이 달라진다)
  const plans = useMemo(
    () => (epoch > 0 ? planSigns(layout, words, canvasMeasure()) : []),
    [epoch, layout, words],
  );
  const zones = layout.zones ?? NO_ZONES;
  const currentId = zoneAt(zones, at.x, at.z)?.id ?? null;
  const shown = useMemo(
    () => plansInView(plans, zones, currentId, neighborGapM()),
    [plans, zones, currentId],
  );
  const palette = useMemo(() => signPaletteOf(look), [look]);
  const built = useMemo(() => build(shown, palette, tier), [shown, palette, tier]);
  useEffect(() => {
    invalidate();
    return () => built?.dispose();
  }, [built, invalidate]);
  if (!built) return null;
  return (
    <>
      {built.plates && <primitive object={built.plates} />}
      <primitive object={built.text} />
    </>
  );
};
