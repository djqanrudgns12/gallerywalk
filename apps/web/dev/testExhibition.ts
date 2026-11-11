import { config } from '@gallery/core/config';
import { computeLayout } from '@gallery/core/layout';
import { templateGeometry } from '@gallery/core/templates';
import type { ArtworkForm, Layout, LayoutInput } from '@gallery/core/types';
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { ModulePlacement } from '../src/viewer/scene/TemplateModules.tsx';
import type { ViewerArtwork } from '../src/viewer/scene/types.ts';

/**
 * `/dev/viewer` 시험 전시(P1-4 → P2-7). 실제 학생 작품이 아닌 합성 그림만 쓴다(AGENTS.md §2).
 * 6점짜리 전시실을 `?rooms=n`(1~17, 기본 1)만큼 되풀이해 배치 엔진(`computeLayout`)에 넣고, 나온 배치를 그대로 조립한다.
 * 그림 텍스처는 6장만 만들어 함께 쓴다(100점이어도 캔버스 메모리가 늘지 않게).
 */

const LIGHT_MAT = '#efe7d6';
const DARK_MAT = '#2f2a26';
const TEMPLATE = 'modern-history' as const;

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

const makeImage = (aspect: number, paint: Painter) => {
  const long = config().WALL_PX;
  const w = aspect >= 1 ? long : Math.round(long * aspect);
  const h = aspect >= 1 ? Math.round(long / aspect) : long;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx, w, h);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, src: canvas.toDataURL('image/png') };
};

const serif = (px: number, weight = 700) => `${weight} ${px}px "Noto Serif KR", "AppleMyungjo", serif`;
const sans = (px: number, weight = 500) =>
  `${weight} ${px}px "Pretendard", "Apple SD Gothic Neo", sans-serif`;

const newspaper: Painter = (ctx, w, h) => {
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1d1a16';
  ctx.font = serif(Math.round(h * 0.12), 900);
  ctx.fillText('하늘고래 호외', w * 0.05, h * 0.16);
  ctx.fillRect(w * 0.05, h * 0.2, w * 0.9, 4);
  ctx.font = sans(Math.round(h * 0.035));
  const line = '1905년 11월, 나라의 외교권을 빼앗는 조약이 맺어졌다는 소식이 전해졌다.';
  for (let i = 0; i < 14; i++) ctx.fillText(line, w * 0.05, h * (0.28 + i * 0.05), w * 0.55);
  ctx.fillStyle = '#6b5a44';
  ctx.fillRect(w * 0.64, h * 0.26, w * 0.31, h * 0.62);
};

const poster: Painter = (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#20334a');
  g.addColorStop(1, '#0e1620');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e9c46a';
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.38, w * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4efe4';
  ctx.font = serif(Math.round(w * 0.11), 900);
  ctx.textAlign = 'center';
  ctx.fillText('대한 독립', w / 2, h * 0.76);
  ctx.font = sans(Math.round(w * 0.045));
  ctx.fillText('1919 · 우리 모둠 포스터', w / 2, h * 0.84);
};

const painting: Painter = (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#9fb7c9');
  g.addColorStop(0.55, '#e7d7b8');
  g.addColorStop(1, '#5b6b4a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3e4a33';
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.moveTo(w * (i / 9), h);
    ctx.lineTo(w * (i / 9 + 0.08), h * (0.48 + (i % 3) * 0.05));
    ctx.lineTo(w * (i / 9 + 0.18), h);
    ctx.fill();
  }
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(w * 0.47, h * 0.42, w * 0.015, h * 0.3);
  ctx.fillStyle = '#f5f0e6';
  ctx.fillRect(w * 0.485, h * 0.42, w * 0.06, h * 0.04);
};

const emblem: Painter = (ctx, w, h) => {
  ctx.fillStyle = '#f3ede2';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#7a2e1d';
  ctx.lineWidth = w * 0.03;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#7a2e1d';
  ctx.font = serif(Math.round(w * 0.2), 900);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S.O.S', w / 2, h / 2);
};

const webtoonTop: Painter = (ctx, w, h) => {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const panel = (y: number, ph: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(w * 0.06, y, w * 0.88, ph);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 6;
    ctx.strokeRect(w * 0.06, y, w * 0.88, ph);
  };
  panel(h * 0.04, h * 0.3, '#ffe9c7');
  panel(h * 0.38, h * 0.26, '#d9ecff');
  panel(h * 0.68, h * 0.3, '#e9f5dc');
  ctx.fillStyle = '#111';
  ctx.font = sans(Math.round(w * 0.06), 700);
  ctx.fillText('"의병이 모였대!"', w * 0.12, h * 0.12);
};

const poemCard: Painter = (ctx, w, h) => {
  ctx.fillStyle = '#f7f1e3';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2a241d';
  ctx.font = serif(Math.round(w * 0.075), 800);
  ctx.fillText('삼월의 하늘', w * 0.1, h * 0.14);
  ctx.font = serif(Math.round(w * 0.05), 500);
  const lines = ['태극기 물결이', '골목마다 피어나고', '', '만세 소리는', '바람이 되어', '먼 곳까지 갔다'];
  lines.forEach((l, i) => ctx.fillText(l, w * 0.1, h * (0.26 + i * 0.075)));
  ctx.font = sans(Math.round(w * 0.04));
  ctx.fillText('— 별빛모둠', w * 0.1, h * 0.88);
};

interface Spec {
  readonly title: string;
  readonly author: string;
  readonly caption: string;
  /** 벽에서 보이는 그림의 비율(가로 ÷ 세로) — 긴 세로는 위쪽 창 */
  readonly aspect: number;
  readonly form: ArtworkForm;
  /** 배치 엔진에 넣는 원본 화소 */
  readonly pixel: { readonly w: number; readonly h: number };
  readonly paint: Painter;
  readonly darkMat?: boolean;
}

const specs: readonly Spec[] = [
  {
    title: '하늘고래의 호외',
    author: '하늘고래',
    caption: '을사늑약 소식을 전하는 신문 기사',
    aspect: 1.5,
    form: 'LANDSCAPE',
    pixel: { w: 3000, h: 2000 },
    paint: newspaper,
  },
  {
    title: '대한 독립',
    author: '별빛모둠',
    caption: '3·1 운동을 알리는 포스터',
    aspect: 0.7,
    form: 'PORTRAIT',
    pixel: { w: 1400, h: 2000 },
    paint: poster,
  },
  {
    title: '청산리의 새벽',
    author: '푸른숲모둠',
    caption: '청산리 전투를 그린 그림',
    aspect: 4 / 3,
    form: 'LANDSCAPE',
    pixel: { w: 4000, h: 3000 },
    paint: painting,
  },
  {
    title: '모둠 상징',
    author: 'S.O.S',
    caption: '우리 프로젝트의 상징',
    aspect: 1,
    form: 'SQUARE',
    pixel: { w: 2000, h: 2000 },
    paint: emblem,
  },
  {
    title: '의병 이야기',
    author: '바람모둠',
    caption: '세로로 긴 웹툰(위쪽 창만 보임)',
    aspect: 0.62,
    form: 'TALL',
    pixel: { w: 800, h: 20000 },
    paint: webtoonTop,
  },
  {
    title: '삼월의 하늘',
    author: '별빛모둠',
    caption: '3·1 운동을 노래한 시',
    aspect: 0.72,
    form: 'PORTRAIT',
    pixel: { w: 1440, h: 2000 },
    paint: poemCard,
  },
];

/** 결정적인 UUID 모양 ID(배치 스키마가 UUID를 요구) */
const devId = (kind: number, n: number): string =>
  `00000000-0000-4000-8${kind.toString(16).padStart(3, '0')}-${n.toString(16).padStart(12, '0')}`;

export interface TestExhibition {
  readonly layout: Layout;
  readonly artworks: readonly ViewerArtwork[];
  /** 전시실 ID → 이름판 */
  readonly roomTitles: ReadonlyMap<string, string>;
  readonly title: string;
}

const roomCount = (): number => {
  const n = Number(new URLSearchParams(window.location.search).get('rooms') ?? '1');
  return Number.isInteger(n) ? Math.min(17, Math.max(1, n)) : 1;
};

export const buildTestExhibition = (): TestExhibition => {
  const rooms = roomCount();
  const images = specs.map(s => makeImage(s.aspect, s.paint));
  const roomTitles = new Map<string, string>();
  const input: LayoutInput = {
    exhibitionId: devId(1, 1),
    templateId: TEMPLATE,
    algoVersion: config().ALGO_VERSION,
    rooms: Array.from({ length: rooms }, (_, r) => {
      const id = devId(2, r + 1);
      roomTitles.set(id, `전시실 ${r + 1}`);
      return { id, order: r, hasBgm: false };
    }),
    artworks: Array.from({ length: rooms * specs.length }, (_, k) => {
      const s = specs[k % specs.length]!;
      const r = Math.floor(k / specs.length);
      return {
        id: devId(3, k + 1),
        roomId: devId(2, r + 1),
        order: k % specs.length,
        kind: 'IMAGE',
        form: s.form,
        featured: false,
        textHeavy: false,
        pixel: s.pixel,
        pageCount: null,
      };
    }),
  };
  const layout = computeLayout(input);
  const border = templateGeometry[TEMPLATE].frameBorderM;
  const stopOf = new Map(layout.stops.filter(st => st.artworkId).map(st => [st.artworkId!, st]));
  const artworks = layout.frames.map(f => {
    const k = Number.parseInt(f.artworkId.slice(-12), 16) - 1;
    const s = specs[k % specs.length]!;
    const image = images[k % specs.length]!;
    return {
      id: f.artworkId,
      title: s.title,
      author: s.author,
      caption: s.caption,
      texture: image.texture,
      imageSrc: image.src,
      art: f.art,
      mat: f.mat.w,
      frame: border,
      matColor: s.darkMat ? DARK_MAT : LIGHT_MAT,
      center: { x: f.center[0], y: f.center[1], z: f.center[2] },
      normal: { x: f.normal[0], y: 0, z: f.normal[1] },
      maxDistance: stopOf.get(f.artworkId)?.anchor.maxDistance ?? 4,
      mount: f.mount,
    } satisfies ViewerArtwork;
  });
  return { layout, artworks, roomTitles, title: '시험 전시' };
};

/** 배치의 조각 → 조립 자리 */
export const placementsOf = (layout: Layout): ModulePlacement[] =>
  layout.modules.map(m => ({ module: m.type, x: m.pos[0], y: m.pos[1], z: m.pos[2], rotY: m.rotY }));
