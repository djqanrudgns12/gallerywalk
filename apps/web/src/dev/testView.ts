import { config } from '@gallery/core/config';
import { computeLayout } from '@gallery/core/layout';
import { type ExhibitionView, ExhibitionViewSchema, ReactionSettingsSchema } from '@gallery/core/types';

/**
 * 시험용 보기 묶음(합성 글·가상 작가만, AGENTS.md §2). 전시실마다 작품 수를 받아 배치 엔진으로 실제 배치를 만든다.
 * 각 전시실의 4번째 작품(번호 3)마다 글 작품 — 그림이 없어 상주 관리에서 빠진다. 시험·개발 화면만 가져다 쓴다(운영 화면은 쓰지 않음).
 */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const TEST_EXHIBITION_ID = uuid(1);
export const testRoomId = (r: number): string => uuid(2 + r);
export const testArtworkId = (r: number, i: number): string => uuid(0x1000 * (r + 1) + i);
export const testAssetId = (r: number, i: number): string => uuid(0x100000 * (r + 1) + i);

const variants = [
  { name: 'thumb', ext: 'webp', w: 512, h: 341, bytes: 30_000 },
  { name: 'wall', ext: 'webp', w: 1600, h: 1067, bytes: 280_000 },
  { name: 'wall-lo', ext: 'webp', w: 1024, h: 683, bytes: 120_000 },
] as const;

export const testExhibitionView = (roomSizes: readonly number[] = [4]): ExhibitionView => {
  const artworks = roomSizes.flatMap((n, r) =>
    Array.from({ length: n }, (_, i) => {
      const text = i === 3;
      return {
        id: testArtworkId(r, i),
        roomId: testRoomId(r),
        order: i,
        title: `작품 ${i + 1}`,
        author: i === 0 ? null : `가상 작가 ${i}`,
        caption: null,
        description: null,
        kind: text ? ('TEXT' as const) : ('IMAGE' as const),
        form: text ? ('TEXTCARD' as const) : ('LANDSCAPE' as const),
        textHeavy: false,
        featured: false,
        pageMode: 'AUTO' as const,
        image: text
          ? null
          : {
              asset: { assetId: testAssetId(r, i), variants: [...variants] },
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
        textBody: text ? '가상의 글' : null,
      };
    }),
  );
  const layout = computeLayout({
    exhibitionId: TEST_EXHIBITION_ID,
    templateId: 'modern-history',
    algoVersion: config().ALGO_VERSION,
    rooms: roomSizes.map((_, r) => ({ id: testRoomId(r), order: r, hasBgm: false })),
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
      id: TEST_EXHIBITION_ID,
      title: '시험 전시',
      subtitle: null,
      templateId: 'modern-history',
      poster: null,
      school: null,
      expiresAt: 1_900_000_000_000,
      reactions: ReactionSettingsSchema.parse({}),
    },
    rooms: roomSizes.map((_, r) => ({
      id: testRoomId(r),
      order: r,
      title: `전시실 ${r + 1}`,
      intro: null,
      bgm: null,
    })),
    artworks,
    layout,
    versions: { layoutVersion: 1, contentVersion: 1, settingsVersion: 1 },
    reactions: [],
  });
};
