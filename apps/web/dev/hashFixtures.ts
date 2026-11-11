import type { ArtworkForm, LayoutInput } from '@gallery/core/types';

/**
 * 런타임 간 배치 해시 비교용 고정 입력 20개(PLAN §4.11 "Node와 Chromium·WebKit에서 같은 해시").
 * `/dev/hash` 화면(브라우저)과 `tests/e2e/layout-hash.spec.ts`(Node)가 같은 함수로 같은 입력을 만든다.
 * 난수 대신 정수 식만 써서 어느 런타임에서도 같은 입력이 나온다.
 */

const FORMS: readonly ArtworkForm[] = [
  'LANDSCAPE',
  'PORTRAIT',
  'SQUARE',
  'PANORAMA',
  'TALL',
  'MULTIPAGE',
  'TEXTCARD',
  'SOUND',
];
const PIXELS: Readonly<Record<ArtworkForm, readonly [number, number]>> = {
  PANORAMA: [7200, 2000],
  LANDSCAPE: [3000, 2000],
  SQUARE: [2000, 2000],
  PORTRAIT: [2000, 2900],
  TALL: [800, 20000],
  MULTIPAGE: [2480, 3508],
  TEXTCARD: [0, 0],
  SOUND: [0, 0],
};
const KIND = { MULTIPAGE: 'PDF', TEXTCARD: 'TEXT', SOUND: 'AUDIO' } as const;

const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0');
const uuid = (a: number, b: number): string => `${hex(a, 8)}-0000-4000-8000-${hex(b, 12)}`;

export const hashFixtures = (): LayoutInput[] =>
  Array.from({ length: 20 }, (_, f) => {
    const roomCount = 1 + (f % 6);
    const rooms = Array.from({ length: roomCount }, (_, r) => ({
      id: uuid(1000 + f, 100 + r),
      order: r,
      hasBgm: (f + r) % 2 === 0,
    }));
    const artworks = rooms.flatMap((room, r) =>
      Array.from({ length: 1 + ((f * 7 + r * 5) % 15) }, (_, i) => {
        const form = FORMS[(f + r * 3 + i) % FORMS.length]!;
        const [w, h] = PIXELS[form];
        return {
          id: uuid(2000 + f, r * 100 + i),
          roomId: room.id,
          order: (i * 7) % 31,
          kind: KIND[form as keyof typeof KIND] ?? ('IMAGE' as const),
          form,
          featured: i === f % 5 && r % 2 === 0,
          textHeavy: form === 'MULTIPAGE' || form === 'TALL',
          pixel: { w: w + ((f * 37 + i * 11) % 400), h: h + ((f * 53 + i * 13) % 300) },
          pageCount: form === 'MULTIPAGE' ? 1 + (i % 9) : null,
        };
      }),
    );
    return { exhibitionId: uuid(3000, f), templateId: 'modern-history', algoVersion: 1, rooms, artworks };
  });
