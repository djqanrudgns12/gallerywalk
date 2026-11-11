import { config } from '@gallery/core/config';
import type { ArtworkPublic, MediaVariant } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { zoomPagesFor } from './zoomPages.ts';

const EX = '00000000-0000-4000-8000-000000000001';
const ASSET = '00000000-0000-4000-8000-000000000009';
const analysis = {
  edgeLuma: 0.9,
  linePitchPx: null,
  linePitchConfidence: 0,
  lineProfile: null,
  profileBinPx: 8,
};

const base = (over: Partial<ArtworkPublic>): ArtworkPublic => ({
  id: '00000000-0000-4000-8000-000000000003',
  roomId: '00000000-0000-4000-8000-000000000002',
  order: 0,
  title: '의병 이야기',
  author: null,
  caption: null,
  description: null,
  kind: 'IMAGE',
  form: 'LANDSCAPE',
  textHeavy: false,
  featured: false,
  pageMode: 'AUTO',
  image: null,
  pages: null,
  audio: null,
  textBody: null,
  ...over,
});

const v = (name: string, w: number, h: number): MediaVariant => ({ name, ext: 'webp', w, h, bytes: 1000 });

describe('zoomPagesFor', () => {
  it('웹툰 800×20000: 띠 10장을 이어 쪽마다 빈틈없이 덮고, 띠 경계를 넘는 쪽도 맞게 자른다', () => {
    const stripVariants = Array.from({ length: 10 }, (_, i) =>
      v(`strip-${i}`, 800, i < 9 ? 2048 : 20000 - 9 * 2048),
    );
    const art = base({
      form: 'TALL',
      textHeavy: true,
      image: {
        asset: { assetId: ASSET, variants: [v('wall', 991, 1600), ...stripVariants] },
        w: 800,
        h: 20000,
        analysis,
      },
    });
    const pages = zoomPagesFor(EX, art, { w: 390, h: 650 }, 3);
    expect(pages.length).toBeGreaterThan(10);
    const scale = pages[0]!.plan.scale;
    expect(scale).toBeCloseTo(390 / 800, 6);
    let crossed = 0;
    for (const p of pages) {
      expect(p.w).toBeCloseTo(390, 6);
      const covered = p.pieces.reduce((s, x) => s + x.dh, 0);
      expect(covered).toBeCloseTo(p.h, 6);
      let y = 0;
      for (const piece of p.pieces) {
        expect(piece.dy).toBeCloseTo(y, 6);
        y += piece.dh;
        const strip = stripVariants.find(s => piece.url.endsWith(`${s.name}.webp`))!;
        expect(piece.sy).toBeGreaterThanOrEqual(0);
        expect(piece.sy + piece.sh).toBeLessThanOrEqual(strip.h + 1e-9);
      }
      if (p.pieces.length > 1) crossed++;
    }
    expect(crossed).toBeGreaterThan(0);
    // 이웃 쪽은 PAGE_OVERLAP만큼 겹친다
    const view = 650 / scale;
    const first = pages[0]!.pieces[0]!;
    const second = pages[1]!.pieces[0]!;
    const start2 =
      stripVariants
        .slice(
          0,
          stripVariants.findIndex(s => second.url.endsWith(`${s.name}.webp`)),
        )
        .reduce((s, x) => s + x.h, 0) + second.sy;
    expect(first.sy).toBe(0);
    expect(view - start2).toBeCloseTo(view * config().PAGE_OVERLAP, -1);
  });

  it('가로 그림: 화면 화소보다 늘여야 할 때만 zoom-hi', () => {
    const art = base({
      image: {
        asset: { assetId: ASSET, variants: [v('zoom', 2048, 1365), v('zoom-hi', 3000, 2000)] },
        w: 3000,
        h: 2000,
        analysis,
      },
    });
    const low = zoomPagesFor(EX, art, { w: 1440, h: 700 }, 1);
    expect(low).toHaveLength(1);
    expect(low[0]!.pieces[0]!.url).toMatch(/\/zoom\.webp$/);
    const high = zoomPagesFor(EX, art, { w: 1440, h: 700 }, 2);
    expect(high[0]!.pieces[0]!.url).toMatch(/\/zoom-hi\.webp$/);
    expect(high[0]!.w).toBeLessThanOrEqual(1440 + 1e-6);
    expect(high[0]!.h).toBeLessThanOrEqual(700 + 1e-6);
  });

  it('PDF: 쪽마다 따로, 원본 쪽 번호가 붙는다. 글·소리는 빈 목록', () => {
    const page = (idx: number) => ({
      idx,
      asset: { assetId: `00000000-0000-4000-8000-00000000010${idx}`, variants: [v('zoom', 1448, 2048)] },
      w: 2400,
      h: 3394,
      analysis,
    });
    const pdf = base({ kind: 'PDF', form: 'MULTIPAGE', textHeavy: true, pages: [page(1), page(2), page(3)] });
    const pages = zoomPagesFor(EX, pdf, { w: 1180, h: 640 }, 1);
    expect(new Set(pages.map(p => p.source))).toEqual(new Set([1, 2, 3]));
    expect(
      zoomPagesFor(EX, base({ kind: 'TEXT', form: 'TEXTCARD', textBody: '글' }), { w: 390, h: 650 }, 2),
    ).toEqual([]);
  });
});
