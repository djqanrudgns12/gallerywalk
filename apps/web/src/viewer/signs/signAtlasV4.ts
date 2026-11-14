import { config } from '@gallery/core/config';
import { facadeTitle } from '@gallery/core/copy';
import type { TemplateLook } from '@gallery/core/templates';
import type { Fixture, Layout, LayoutSign } from '@gallery/core/types';
import type { Tier } from '../textures/residency.ts';
import { type FitBox, type FitResult, fitSign } from './fitSign.ts';
import type { SignRoom } from './signs.ts';

/**
 * 공간 v4 안내판 체계(PRD_V2 W-03 ①~⑦, ADR-071 결정 3)의 계산 — 순수 함수. 그리기는 `SignsV4.tsx`.
 *
 * - 사인마다 글을 고르고(`contentOf`) 글 덩이(번호·제목·본문)를 상자에 맞춘다(`fitSign`: 압축·자르기 없음, 넘치면 상자를 키움).
 * - 판 없이 벽에 놓인 글자: 포털 위 레터링·소개 벽·프리즈·출구. 판 + 글: 돌출 사인(양면)·토템·현수막.
 * - 보이는 범위는 `layout.zones`: 지금 구역 + 이웃 구역(벽 두께·방 사이 틈 안)의 사인만 그린다. 판과 글은 같은 규칙.
 * - 아틀라스 한 장에 보이는 사인의 글 덩이를 선반 쌓기로 넣고, 넘치면 모든 덩이의 해상도를 같은 비율로 낮춘다.
 *
 * 사인 지역 좌표: 원점 = `pos`, +X = 오른쪽 (cos θ, 0, −sin θ), +Y = 위, +Z = 앞 (sin θ, 0, cos θ).
 */

export type SignKindV4 = LayoutSign['kind'];
export type SignFace = 'title' | 'body';
export type SignTone = 'brass' | 'bronze' | 'ivory';
export type SignPlate = 'none' | 'blade' | 'totem' | 'banner' | 'rail';
export type Zone = NonNullable<Layout['zones']>[number];
/** 글꼴 크기 1에서의 글 폭(얼굴별) */
export type MeasureFace = (text: string, face: SignFace) => number;

/**
 * 모습 값. **`config.ts`·`look.ts`로 옮길 값**(통합 담당에게 보고): 글자 크기 상한·하한, 아틀라스 크기, 판 치수, 색.
 * 하한은 PRD_V2 W-03 수치(레터링 0.22m · 돌출 사인 0.12m · 소개 글 0.045m).
 */
/** 안내판 글꼴(SignTexts와 같은 이름 — Hahmlet 제목, Pretendard 본문)·굵기. 수치는 `config.ts` `SIGN_V4`에서 */
const SIGN_FONT = {
  font: {
    title: '"Hahmlet", "Noto Serif KR", "AppleMyungjo", serif',
    body: '"Pretendard Variable", "Pretendard", "Apple SD Gothic Neo", sans-serif',
  },
  weight: { title: 600, body: 500 },
} as const;

/** 안내판 v4 수치(`config.ts` `SIGN_V4`) + 글꼴 */
export const signV4 = () => ({ ...SIGN_FONT, ...config().SIGN_V4 });

interface BlockStyle {
  readonly face: SignFace;
  readonly max: number;
  readonly min: number;
  readonly maxLines: number;
  readonly lineHeight: number;
  readonly tone: SignTone;
}

interface KindStyle {
  readonly plate: SignPlate;
  readonly doubleSided: boolean;
  /** 판 안 여백(m) */
  readonly pad: number;
  readonly align: 'left' | 'center';
  readonly valign: 'top' | 'middle';
  /** 넘쳐 키울 때 고정하는 쪽: 세로(가운데·위·아래) · 가로(가운데·벽 쪽) */
  readonly growY: 'center' | 'top' | 'bottom';
  readonly growX: 'center' | 'wall';
  /** 덩이 놓기: 위아래로 쌓기 · 번호 옆에 이름(포털 레터링) */
  readonly arrange: 'stack' | 'row';
  /** 쌓기에서 첫 덩이가 쓸 수 있는 높이 몫 · 덩이 사이(m) */
  readonly headShare: number;
  readonly gap: number;
  readonly number?: BlockStyle;
  readonly title?: BlockStyle;
  readonly body?: BlockStyle;
}

/** 종류별 모양(`config.ts` `SIGN_V4_KINDS`) */
const kindOf = (kind: SignKindV4): KindStyle => config().SIGN_V4_KINDS[kind];

/** 사인 글의 재료: 전시 이름 · 관 ID → 전시실 이름·소개(VisitorScene `signRooms`와 같은 값) · 출구 글 · 토템 제목 */
export interface SignWordsV4 {
  readonly title: string;
  readonly rooms: ReadonlyMap<string, SignRoom>;
  readonly exit: string;
  readonly totemTitle?: string | undefined;
}

interface Content {
  readonly number: string;
  readonly title: string;
  readonly body: string;
}

/** 방 번호 = 걷는 순서의 관 번호(1부터, `layout.parts` 순서 — 서쪽 1·2·3 → 동쪽) */
export const roomNumberOf = (layout: Layout, partId: string | null): number =>
  partId === null ? 0 : layout.parts.findIndex(p => p.partId === partId) + 1;

/** 사인에 쓸 글. 쓸 글이 없으면 null(판·글 모두 그리지 않음 — 빈 판 없음) */
export const contentOf = (s: LayoutSign, layout: Layout, words: SignWordsV4): Content | null => {
  const room = s.ref === null ? undefined : words.rooms.get(s.ref);
  const name = room?.title.trim() ?? '';
  const n = roomNumberOf(layout, s.ref);
  const title = words.title.trim();
  switch (s.kind) {
    case 'frieze':
      return title ? { number: '', title: facadeTitle(title), body: '' } : null;
    case 'banner':
      return title ? { number: '', title, body: '' } : null;
    case 'portalLettering':
    case 'blade':
      return n > 0 ? { number: String(n), title: name, body: '' } : null;
    case 'introWall':
      return name ? { number: '', title: name, body: room?.intro?.trim() ?? '' } : null;
    case 'exit':
      return words.exit.trim() ? { number: '', title: words.exit.trim(), body: '' } : null;
    case 'totem': {
      const list = layout.parts.flatMap((p, i) => {
        const r = words.rooms.get(p.partId);
        return r && r.title.trim() ? [`${i + 1} ${r.title.trim()}`] : [];
      });
      return list.length > 0
        ? { number: '', title: words.totemTitle?.trim() ?? '', body: list.join('\n') }
        : null;
    }
  }
};

export interface PlannedBlock {
  readonly lines: readonly string[];
  readonly face: SignFace;
  readonly tone: SignTone;
  /** 금속 글자(위가 밝은 결) — 놋쇠·청동 */
  readonly metal: boolean;
  readonly size: number;
  readonly lineHeight: number;
  readonly align: 'left' | 'center';
  /** 덩이 사각형(사인 지역 좌표 m, 여백 포함): 가운데 · 폭 · 높이 */
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  readonly margin: number;
}

export interface SignPlan {
  /** `layout.signs` 안 순서 */
  readonly index: number;
  readonly kind: SignKindV4;
  readonly zone: string;
  readonly pos: readonly [number, number, number];
  readonly rotY: number;
  /** 판·글 상자(사인 지역 좌표 m) — 넘쳤으면 키운 것 */
  readonly box: { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number };
  readonly grown: boolean;
  readonly plate: SignPlate;
  readonly doubleSided: boolean;
  readonly blocks: readonly PlannedBlock[];
  /** 돌출 사인이 붙은 벽: 지역 x 쪽(−1·1, 0 = 모름)과 사인 자리에서 벽까지(지역 x 방향) */
  readonly wall: { readonly side: -1 | 0 | 1; readonly dist: number };
}

const TINY = 1e-3;

const fitBlock = (text: string, st: BlockStyle, box: FitBox, measure: MeasureFace): FitResult =>
  fitSign({
    text,
    box: { w: Math.max(box.w, TINY), h: Math.max(box.h, TINY) },
    maxSize: st.max,
    minSize: st.min,
    maxLines: st.maxLines,
    lineHeight: st.lineHeight,
    measure: t => measure(t, st.face),
  });

/** 구역 사각형에서 가장 가까운 변 = 사인이 붙은 벽 */
const wallOf = (s: LayoutSign, zones: readonly Zone[]): SignPlan['wall'] => {
  const z = zones.find(q => q.id === s.zone);
  if (!z) return { side: 0, dist: 0 };
  const x = s.pos[0];
  const y = s.pos[2];
  const edges: { d: number; n: readonly [number, number] }[] = [
    { d: x - z.min[0], n: [-1, 0] },
    { d: z.max[0] - x, n: [1, 0] },
    { d: y - z.min[1], n: [0, -1] },
    { d: z.max[1] - y, n: [0, 1] },
  ];
  const near = edges.reduce((a, b) => (b.d < a.d ? b : a));
  const dot = Math.cos(s.rotY) * near.n[0] - Math.sin(s.rotY) * near.n[1];
  if (Math.abs(dot) < 0.5) return { side: 0, dist: 0 };
  return { side: dot > 0 ? 1 : -1, dist: near.d / Math.abs(dot) };
};

interface Fitted {
  readonly text: string;
  readonly st: BlockStyle;
  readonly fit: FitResult;
  readonly align: 'left' | 'center';
}

/** 사인 하나: 글 덩이를 상자에 맞추고 놓는다 */
export const planSign = (
  s: LayoutSign,
  index: number,
  c: Content,
  zones: readonly Zone[],
  measure: MeasureFace,
): SignPlan => {
  const k = kindOf(s.kind);
  const totem = s.kind === 'totem' ? signV4().plate.totem : null;
  // 원래 상자(토템은 받침대 위 판)와 그 가운데
  const w0 = s.w;
  const h0 = totem ? Math.max(s.h - totem.plinthH, TINY) : s.h;
  const bx0 = 0;
  const by0 = totem ? totem.plinthH + h0 / 2 : 0;
  const iw = Math.max(w0 - 2 * k.pad, TINY);
  const ih = Math.max(h0 - 2 * k.pad, TINY);

  const placed: { f: Fitted; cx: number; cy: number }[] = [];
  let innerW = iw;
  let innerH = ih;
  if (k.arrange === 'row' && k.number && k.title) {
    // 번호(고정 크기) 옆에 이름. 이름은 남은 폭에 맞춘다
    const ns = Math.floor(Math.min(ih, k.title.max * signV4().numberRatio) * 1000) / 1000;
    const nw = measure(c.number, k.number.face) * ns;
    const g = c.title ? ns * signV4().rowGap : 0;
    const numFit: FitResult = {
      size: ns,
      lines: [c.number],
      width: nw,
      height: ns * k.number.lineHeight,
      box: { w: nw, h: ns },
      grown: false,
      brokeWord: false,
    };
    const name = c.title ? fitBlock(c.title, k.title, { w: iw - nw - g, h: ih }, measure) : null;
    const rowW = nw + g + (name?.width ?? 0);
    innerW = Math.max(iw, nw + g + (name?.box.w ?? 0));
    innerH = Math.max(ih, numFit.height, name?.box.h ?? 0);
    const x0 = -rowW / 2;
    placed.push({
      f: { text: c.number, st: k.number, fit: numFit, align: 'center' },
      cx: x0 + nw / 2,
      cy: 0,
    });
    if (name)
      placed.push({
        f: { text: c.title, st: k.title, fit: name, align: 'left' },
        cx: x0 + nw + g + name.width / 2,
        cy: 0,
      });
  } else {
    const parts: { text: string; st: BlockStyle }[] = [];
    if (c.number && k.number) parts.push({ text: c.number, st: k.number });
    if (c.title && k.title) parts.push({ text: c.title, st: k.title });
    if (c.body && k.body) parts.push({ text: c.body, st: k.body });
    const fitted: Fitted[] = [];
    let used = 0;
    let width = iw;
    parts.forEach((p, i) => {
      // 첫 덩이는 높이 몫만큼, 다음 덩이들은 남은 높이를 나눠 쓴다
      const budget =
        i === 0 ? (parts.length > 1 ? ih * k.headShare : ih) : (ih - used - k.gap) / (parts.length - i);
      const fit = fitBlock(p.text, p.st, { w: width, h: budget }, measure);
      width = Math.max(width, fit.box.w);
      used += fit.height + (i > 0 ? k.gap : 0);
      fitted.push({ text: p.text, st: p.st, fit, align: k.align });
    });
    innerW = Math.max(iw, ...fitted.map(f => f.fit.box.w));
    innerH = Math.max(ih, used);
    let top = k.valign === 'middle' ? used / 2 : innerH / 2;
    fitted.forEach((f, i) => {
      if (i > 0) top -= k.gap;
      const cx = f.align === 'left' ? -innerW / 2 + f.fit.width / 2 : 0;
      placed.push({ f, cx, cy: top - f.fit.height / 2 });
      top -= f.fit.height;
    });
  }

  // 키운 상자: 고정할 쪽을 남기고 옮긴다
  const W = innerW + 2 * k.pad;
  const H = innerH + 2 * k.pad;
  const wall = k.growX === 'wall' ? wallOf(s, zones) : ({ side: 0, dist: 0 } as const);
  const dx = k.growX === 'wall' && wall.side !== 0 ? (-wall.side * (W - w0)) / 2 : 0;
  const dy = k.growY === 'top' ? (h0 - H) / 2 : k.growY === 'bottom' ? (H - h0) / 2 : 0;
  const box = { cx: bx0 + dx, cy: by0 + dy, w: W, h: H };
  const blocks: PlannedBlock[] = placed.map(({ f, cx, cy }) => {
    const margin = f.fit.size * signV4().inkMargin;
    return {
      lines: f.fit.lines,
      face: f.st.face,
      tone: f.st.tone,
      metal: f.st.tone !== 'ivory',
      size: f.fit.size,
      lineHeight: f.st.lineHeight,
      align: f.align,
      cx: box.cx + cx,
      cy: box.cy + cy,
      w: f.fit.width + 2 * margin,
      h: f.fit.height + 2 * margin,
      margin,
    };
  });
  // 광장(대문)의 출구 글자는 붙을 벽이 없다 → 문기둥 사이 봉
  const inPlaza = (zones.find(z => z.id === s.zone)?.kind ?? s.zone) === 'plaza';
  const plate: SignPlate = s.kind === 'exit' && inPlaza ? 'rail' : k.plate;
  return {
    index,
    kind: s.kind,
    zone: s.zone,
    pos: s.pos,
    rotY: s.rotY,
    box,
    grown: W > w0 + 1e-6 || H > h0 + 1e-6,
    plate,
    doubleSided: k.doubleSided,
    blocks,
    wall,
  };
};

/** 배치의 모든 v4 사인(쓸 글이 없는 것은 뺌) */
export const planSigns = (layout: Layout, words: SignWordsV4, measure: MeasureFace): SignPlan[] => {
  const zones = layout.zones ?? [];
  const out: SignPlan[] = [];
  (layout.signs ?? []).forEach((s, i) => {
    const c = contentOf(s, layout, words);
    if (c) out.push(planSign(s, i, c, zones, measure));
  });
  return out;
};

/** 글꼴을 먼저 받을 글자(그 글자의 하위 꾸러미만 받는다) */
export const signFontSample = (layout: Layout, words: SignWordsV4): string => {
  const rooms = layout.parts.flatMap(p => {
    const r = words.rooms.get(p.partId);
    return r ? [r.title, r.intro ?? ''] : [];
  });
  return [facadeTitle(words.title), words.exit, words.totemTitle ?? '', '0123456789', ...rooms].join(' ');
};

// ── 보이는 범위 ─────────────────────────────────────────────────

const rectDist = (q: Zone, x: number, z: number): number =>
  Math.hypot(Math.max(q.min[0] - x, 0, x - q.max[0]), Math.max(q.min[1] - z, 0, z - q.max[1]));

const zoneGap = (a: Zone, b: Zone): number =>
  Math.hypot(
    Math.max(a.min[0] - b.max[0], 0, b.min[0] - a.max[0]),
    Math.max(a.min[1] - b.max[1], 0, b.min[1] - a.max[1]),
  );

/** 그 자리를 품은 구역(먼저 나온 것), 어느 구역에도 없으면(포털 두께·방 사이 통로) 가장 가까운 구역 */
export const zoneAt = (zones: readonly Zone[], x: number, z: number): Zone | null => {
  let best: Zone | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const q of zones) {
    const d = rectDist(q, x, z);
    if (d < bestD - 1e-9) {
      best = q;
      bestD = d;
    }
  }
  return best;
};

/** 이웃 구역의 거리 기준: 방 사이 틈(두꺼운 벽) + 벽 두께 — 홀↔방(벽 두께), 같은 날개 방↔방(틈), 광장↔현관↔홀 */
export const neighborGapM = (): number => config().LAYOUT_V4.roomGap + config().WALL_THICKNESS_M;

/** 지금 구역 + 이웃 구역 */
export const zonesInView = (zones: readonly Zone[], current: Zone, gap: number): Set<string> =>
  new Set(zones.filter(q => q.id === current.id || zoneGap(q, current) <= gap + 1e-6).map(q => q.id));

/** 방 안쪽을 보는 사인(소개 벽) — 홀에서는 포털 너머로 맞은편 벽만 보이므로 그 방·이웃 방에 있을 때만 */
const INWARD: ReadonlySet<SignKindV4> = new Set<SignKindV4>(['introWall']);

/** 그릴 사인: 구역이 없는 배치면 모두 */
export const plansInView = (
  plans: readonly SignPlan[],
  zones: readonly Zone[],
  currentId: string | null,
  gap: number,
): readonly SignPlan[] => {
  const current = currentId === null ? undefined : zones.find(z => z.id === currentId);
  if (!current) return plans;
  const view = zonesInView(zones, current, gap);
  return plans.filter(p => view.has(p.zone) && (!INWARD.has(p.kind) || current.kind === 'gallery'));
};

// ── 아틀라스 ───────────────────────────────────────────────────

export interface AtlasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 이 덩이의 실제 해상도(px/m) */
  readonly pxPerM: number;
}

export interface AtlasPlan {
  readonly rects: readonly AtlasRect[];
  readonly width: number;
  readonly height: number;
  /** 바란 해상도 대비 줄인 비율(1 = 그대로) */
  readonly scale: number;
}

/** 덩이마다 바라는 해상도: 글꼴 크기 1em이 `emPx` 화소 */
export const atlasItemsOf = (plans: readonly SignPlan[]): { w: number; h: number; pxPerM: number }[] =>
  plans.flatMap(p => p.blocks.map(b => ({ w: b.w, h: b.h, pxPerM: signV4().emPx[b.face] / b.size })));

const pow2 = (v: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, v)));

/**
 * 선반 쌓기(높은 것부터, 같으면 원래 순서): 덩이 사이 `gutter` px. 덩이 폭이 아틀라스 폭을 넘으면 그 덩이만 해상도를 낮추고,
 * 쌓은 높이가 `maxHeight`를 넘으면 모든 덩이의 해상도를 같은 비율로 낮춰 다시 쌓는다. 높이는 2의 거듭제곱으로 올림.
 */
export const packAtlas = (
  items: readonly { w: number; h: number; pxPerM: number }[],
  width: number,
  maxHeight: number,
  gutter: number,
): AtlasPlan => {
  const usable = width - 2 * gutter;
  let scale = 1;
  for (let attempt = 0; ; attempt++) {
    const sized = items.map((it, i) => {
      const d = Math.min(it.pxPerM * scale, usable / Math.max(it.w, TINY));
      return { i, d, w: Math.max(1, Math.ceil(it.w * d)), h: Math.max(1, Math.ceil(it.h * d)) };
    });
    const order = [...sized].sort((a, b) => b.h - a.h || a.i - b.i);
    const rects: AtlasRect[] = [];
    let x = gutter;
    let y = gutter;
    let row = 0;
    for (const s of order) {
      if (x + s.w + gutter > width && x > gutter) {
        x = gutter;
        y += row + gutter;
        row = 0;
      }
      rects[s.i] = { x, y, w: s.w, h: s.h, pxPerM: s.d };
      x += s.w + gutter;
      row = Math.max(row, s.h);
    }
    const used = y + row + gutter;
    if (used <= maxHeight || attempt >= 8) return { rects, width, height: pow2(used), scale };
    scale *= Math.sqrt(maxHeight / used) * 0.97;
  }
};

export const atlasSizeOf = (tier: Tier): { width: number; maxHeight: number } => ({
  width: signV4().atlas.width[tier],
  maxHeight: signV4().atlas.maxHeight[tier],
});

// ── 기하 배열 ──────────────────────────────────────────────────

export interface SignPaletteV4 {
  readonly brass: string;
  readonly bronze: string;
  readonly ivory: string;
  /** 판(돌출 사인·토템·현수막 천) */
  readonly plate: string;
}

/** 판 색은 `look.signFace`, 글자 색은 `look.signLetters`(PRD_V2 §3.3 팔레트) */
export const signPaletteOf = (look: TemplateLook): SignPaletteV4 => ({
  ...look.signLetters,
  plate: look.signFace,
});

type Rgb = readonly [number, number, number];
type V3 = readonly [number, number, number];

/** sRGB 16진 → 선형(three 정점 색은 선형으로 받는다) */
export const linearRgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const ch = (shift: number): number => {
    const c = ((n >> shift) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [ch(16), ch(8), ch(0)];
};

export interface MeshArrays {
  readonly position: number[];
  readonly uv: number[];
  readonly normal: number[];
  readonly color: number[];
  readonly index: number[];
}

const empty = (): MeshArrays => ({ position: [], uv: [], normal: [], color: [], index: [] });

/** 지역 (x, y, z) → 세계 */
const toWorld = (
  pos: readonly [number, number, number],
  rotY: number,
  x: number,
  y: number,
  z: number,
): [number, number, number] => {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  return [pos[0] + c * x + s * z, pos[1] + y, pos[2] - s * x + c * z];
};

const plateDepthOf = (p: SignPlan): number =>
  p.plate === 'blade'
    ? signV4().plate.blade.depth
    : p.plate === 'totem'
      ? signV4().plate.totem.depth
      : p.plate === 'banner'
        ? signV4().plate.banner.depth
        : 0;

/**
 * 글 네모(덩이마다 하나, 양면 사인은 뒤에도 하나): 정점 색 = 글자 색. `rects`는 `atlasItemsOf(plans)` 순서.
 * 뒷면은 θ + π 쪽에서 같은 판 위에 놓아 뒤에서도 바르게 읽힌다.
 */
export const textArrays = (
  plans: readonly SignPlan[],
  atlas: AtlasPlan,
  palette: SignPaletteV4,
): MeshArrays => {
  const out = empty();
  const tone: Record<SignTone, Rgb> = {
    brass: linearRgb(palette.brass),
    bronze: linearRgb(palette.bronze),
    ivory: linearRgb(palette.ivory),
  };
  let k = 0;
  for (const p of plans) {
    const front = plateDepthOf(p) / 2 + signV4().lift;
    for (const b of p.blocks) {
      const r = atlas.rects[k++];
      if (!r) continue;
      const rgb = tone[b.tone].map(v => v * signV4().letterLight);
      const sides = p.doubleSided
        ? [
            { rot: p.rotY, cx: b.cx },
            { rot: p.rotY + Math.PI, cx: b.cx - 2 * p.box.cx },
          ]
        : [{ rot: p.rotY, cx: b.cx }];
      for (const side of sides) {
        const base = out.position.length / 3;
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const) {
          out.position.push(
            ...toWorld(p.pos, side.rot, side.cx + (sx * b.w) / 2, b.cy + (sy * b.h) / 2, front),
          );
          out.uv.push(
            (r.x + (sx > 0 ? r.w : 0)) / atlas.width,
            1 - (r.y + (sy > 0 ? 0 : r.h)) / atlas.height,
          );
          out.color.push(...rgb);
        }
        out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
  return out;
};

/** 면마다 (바깥 법선, u, v): u × v = 법선이라 네 꼭짓점이 바깥에서 반시계 */
const FACES: readonly (readonly [V3, V3, V3])[] = [
  [
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
  ],
  [
    [-1, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, -1],
  ],
  [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, -1],
    [-1, 0, 0],
    [0, 1, 0],
  ],
];

const pushBox = (out: MeshArrays, p: SignPlan, center: V3, size: V3, rgb: Rgb): void => {
  const at = (i: 0 | 1 | 2, n: V3, u: V3, v: V3, su: number, sv: number): number =>
    center[i] + ((n[i] + su * u[i] + sv * v[i]) * size[i]) / 2;
  for (const [n, u, v] of FACES) {
    const base = out.position.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      out.position.push(
        ...toWorld(p.pos, p.rotY, at(0, n, u, v, su, sv), at(1, n, u, v, su, sv), at(2, n, u, v, su, sv)),
      );
      out.normal.push(...toWorld([0, 0, 0], p.rotY, n[0], n[1], n[2]));
      out.uv.push(0, 0);
      out.color.push(...rgb);
    }
    out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
};

/** 판(돌출 사인·토템·현수막·대문 봉): 상자들을 한 기하로, 정점 색으로 판 색·놋쇠를 가른다 */
export const plateArrays = (plans: readonly SignPlan[], palette: SignPaletteV4): MeshArrays => {
  const out = empty();
  const plate = linearRgb(palette.plate);
  const brass = linearRgb(palette.brass);
  for (const p of plans) {
    const { cx, cy, w, h } = p.box;
    switch (p.plate) {
      case 'blade': {
        const b = signV4().plate.blade;
        pushBox(out, p, [cx, cy, 0], [w + 2 * b.trim, h + 2 * b.trim, b.depth * 0.6], brass);
        pushBox(out, p, [cx, cy, 0], [w, h, b.depth], plate);
        // 위 봉: 벽(지역 x = 쪽 × 거리)에서 판의 먼 끝까지. 벽 쪽을 모르면 판 폭만큼
        const ry = cy + h / 2 + b.trim + b.rod / 2;
        const half = w / 2 + b.trim;
        const a = p.wall.side === 0 ? cx - half : cx - p.wall.side * half;
        const z = p.wall.side === 0 ? cx + half : p.wall.side * p.wall.dist;
        pushBox(out, p, [(a + z) / 2, ry, 0], [Math.abs(z - a), b.rod, b.rod], brass);
        break;
      }
      case 'totem': {
        const t = signV4().plate.totem;
        const pw = p.box.w * t.plinthW;
        pushBox(out, p, [0, t.plinthH / 2, 0], [pw, t.plinthH, t.plinthD], plate);
        pushBox(out, p, [0, t.plinthH - t.cap / 2, 0], [pw + 2 * t.cap, t.cap, t.plinthD + 2 * t.cap], brass);
        pushBox(out, p, [cx, cy, 0], [w + 2 * t.trim, h + 2 * t.trim, t.depth * 0.6], brass);
        pushBox(out, p, [cx, cy, 0], [w, h, t.depth], plate);
        break;
      }
      case 'banner': {
        const b = signV4().plate.banner;
        pushBox(out, p, [cx, cy, 0], [w, h, b.depth], plate);
        pushBox(out, p, [cx, cy + h / 2 + b.rod / 2, 0], [w + 2 * b.rodOver, b.rod, b.rod], brass);
        pushBox(out, p, [cx, cy - h / 2 - b.rod * 0.3, 0], [w, b.rod * 0.6, b.rod * 0.6], brass);
        break;
      }
      case 'rail': {
        // 벽 없는 대문 자리: 문기둥 사이를 잇는 봉 둘 사이에 글자
        const r = signV4().plate.rail;
        const len = Math.max(w, config().LAYOUT_V4.gate.w);
        for (const s of [1, -1] as const)
          pushBox(out, p, [cx, cy + s * (h / 2 + r.rod), 0], [len, r.rod, r.rod], brass);
        break;
      }
      case 'none':
        break;
    }
  }
  return out;
};

/** v4 배치에도 남아 있는 옛 사인 설비(v3 그리기용). v4에서는 이 렌더러가 대신하므로 설비 모델·옛 글에서 뺀다 */
export const LEGACY_SIGN_FIXTURES: ReadonlySet<Fixture['kind']> = new Set<Fixture['kind']>([
  'nameplate',
  'introPanel',
  'corridorNameplate',
  'hallSign',
  'exitSign',
  'facadeSign',
]);

export const withoutLegacySigns = (fixtures: readonly Fixture[]): Fixture[] =>
  fixtures.filter(f => !LEGACY_SIGN_FIXTURES.has(f.kind));
