import { config } from '@gallery/core/config';
import { computeLayout } from '@gallery/core/layout';
import { templateLooks } from '@gallery/core/templates';
import { ExhibitionViewSchema, ReactionSettingsSchema } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { sceneOf } from './exhibitionScene.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const EX = uuid(1);
const ROOM = uuid(2);

const variants = [
  { name: 'thumb', ext: 'webp', w: 512, h: 341, bytes: 30_000 },
  { name: 'wall', ext: 'webp', w: 1600, h: 1067, bytes: 280_000 },
  { name: 'wall-lo', ext: 'webp', w: 1024, h: 683, bytes: 120_000 },
] as const;

const view = () => {
  const artworks = [0, 1, 2, 3].map(i => ({
    id: uuid(10 + i),
    roomId: ROOM,
    order: i,
    title: `작품 ${i + 1}`,
    author: i === 0 ? null : `가상 작가 ${i}`,
    caption: null,
    description: null,
    kind: i === 3 ? ('TEXT' as const) : ('IMAGE' as const),
    form: i === 3 ? ('TEXTCARD' as const) : ('LANDSCAPE' as const),
    textHeavy: false,
    featured: false,
    pageMode: 'AUTO' as const,
    image:
      i === 3
        ? null
        : {
            asset: { assetId: uuid(100 + i), variants: [...variants] },
            w: 3000,
            h: 2000,
            analysis: {
              edgeLuma: i === 1 ? 0.95 : 0.3,
              linePitchPx: null,
              linePitchConfidence: 0,
              lineProfile: null,
              profileBinPx: 8,
            },
          },
    pages: null,
    audio: null,
    textBody: i === 3 ? '가상의 글' : null,
  }));
  const layout = computeLayout({
    exhibitionId: EX,
    templateId: 'modern-history',
    algoVersion: config().ALGO_VERSION,
    rooms: [{ id: ROOM, order: 0, hasBgm: false }],
    artworks: artworks.map(a => ({
      id: a.id,
      roomId: a.roomId,
      order: a.order,
      kind: a.kind,
      form: a.form,
      featured: false,
      textHeavy: false,
      pixel: a.image ? { w: 3000, h: 2000 } : { w: 0, h: 0 },
      pageCount: null,
    })),
  });
  return ExhibitionViewSchema.parse({
    exhibition: {
      id: EX,
      title: '시험 전시',
      subtitle: null,
      templateId: 'modern-history',
      poster: null,
      school: null,
      expiresAt: 1_900_000_000_000,
      reactions: ReactionSettingsSchema.parse({}),
    },
    rooms: [{ id: ROOM, order: 0, title: '전시실 1', intro: null, bgm: null }],
    artworks,
    layout,
    versions: { layoutVersion: 1, contentVersion: 1, settingsVersion: 1 },
    reactions: [],
  });
};

describe('sceneOf', () => {
  it('배치의 액자 자리·작품 글·매트 색(가장자리 밝으면 어두운 매트)·이젤', () => {
    const v = view();
    const s = sceneOf(v);
    expect(s.artworks).toHaveLength(4);
    const look = templateLooks['modern-history'];
    const a0 = s.artworks.find(a => a.id === uuid(10))!;
    const a1 = s.artworks.find(a => a.id === uuid(11))!;
    expect(a0.author).toBe('');
    expect(a0.matColor).toBe(look.mat.light);
    expect(a1.matColor).toBe(look.mat.dark);
    const frame = v.layout.frames.find(f => f.artworkId === uuid(10))!;
    expect(a0.center).toEqual({ x: frame.center[0], y: frame.center[1], z: frame.center[2] });
    expect(s.artworks.some(a => a.mount === 'EASEL')).toBe(v.layout.frames.some(f => f.mount === 'EASEL'));
  });

  it('상주 관리 입력은 그림 있는 작품만, 걷는 순서·변형 크기, 미디어 주소', () => {
    const s = sceneOf(view());
    expect(s.resident.map(r => r.id).sort()).toEqual([uuid(10), uuid(11), uuid(12)].sort());
    const orders = s.resident.map(r => r.order).sort();
    expect(new Set(orders).size).toBe(3);
    expect(s.resident[0]!.sizes.wall).toEqual({ w: 1600, h: 1067 });
    expect(s.urlOf(uuid(10), 'wall')).toBe(`/assets/g/m/${EX}/${uuid(100)}/wall.webp`);
    expect(s.urlOf(uuid(13), 'thumb')).toBeNull();
    expect(s.artworks.find(a => a.id === uuid(13))!.media).toBeNull();
  });
});
