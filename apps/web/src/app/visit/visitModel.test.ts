import { copy, fill } from '@gallery/core/copy';
import { describe, expect, it } from 'vitest';
import { TEST_EXHIBITION_ID, testArtworkId, testAssetId, testExhibitionView } from '../../dev/testView.ts';
import { visitModelOf } from './visitModel.ts';

describe('visitModelOf', () => {
  it('작품은 배치 자리 그대로, 텍스처는 비워 두고(상주 관리가 올림) 크게 보기 주소는 벽용', () => {
    const view = testExhibitionView([4]);
    const m = visitModelOf(view);
    expect(m.artworks).toHaveLength(4);
    const a0 = m.artworks.find(a => a.id === testArtworkId(0, 0))!;
    const frame = view.layout.frames.find(f => f.artworkId === a0.id)!;
    expect(a0.center).toEqual({ x: frame.center[0], y: frame.center[1], z: frame.center[2] });
    expect(a0.texture).toBeNull();
    expect(a0.imageSrc).toBe(`/assets/g/m/${TEST_EXHIBITION_ID}/${testAssetId(0, 0)}/wall.webp`);
    // 글 작품은 그림이 없다
    expect(m.artworks.find(a => a.id === testArtworkId(0, 3))!.imageSrc).toBeNull();
    expect(m.textures.arts.map(a => a.id)).not.toContain(testArtworkId(0, 3));
    expect(Object.keys(m.holders).sort()).toEqual(m.artworks.map(a => a.id).sort());
    // 글 작품은 카드 글로(벽에 기기가 조판), 그림 작품은 카드 없음
    expect(m.cards.get(testArtworkId(0, 3))).toEqual({
      kind: 'TEXT',
      title: '작품 4',
      author: '가상 작가 3',
      body: '가상의 글',
    });
    expect(m.cards.has(testArtworkId(0, 0))).toBe(false);
  });

  it('자리 이름: 외관 = "{이름판} 앞", 회랑 = 전시명, 관 = 전시실 이름(나뉜 관은 "{전시실} · {n}관")', () => {
    const view = testExhibitionView([3, 40]);
    const m = visitModelOf(view);
    // '…전시'로 끝나면 '전시관'을 덧붙이지 않는다(V-57: "시험 전시 전시관" 겹침)
    expect(m.facade).toBe('시험 전시');
    expect(m.placeOf('exterior')).toBe('시험 전시 앞');
    expect(m.placeOf('spine')).toBe('시험 전시');
    expect(m.placeOf('없는 구역')).toBe('');
    const split = m.layout.parts.filter(p => p.partCount > 1);
    expect(split.length).toBeGreaterThan(1);
    for (const p of m.layout.parts) {
      const room = p.roomId === view.rooms[0]!.id ? '전시실 1' : '전시실 2';
      expect(m.placeOf(p.partId)).toBe(p.partCount > 1 ? `${room} · ${p.partIndex + 1}관` : room);
    }
  });
});

describe('명판 셋째 줄(PRD 6.4, V-23)', () => {
  it('긴 세로 그림은 "이어서 보기", 여러 쪽 PDF는 쪽 수, 그 밖은 없음', () => {
    const v = testExhibitionView([3]);
    const [tall, pdf, plain] = v.artworks;
    const view = {
      ...v,
      artworks: [
        { ...tall!, form: 'TALL' as const },
        {
          ...pdf!,
          kind: 'PDF' as const,
          form: 'MULTIPAGE' as const,
          pages: [1, 2, 3].map(idx => ({
            idx,
            asset: pdf!.image!.asset,
            w: 1240,
            h: 1754,
            analysis: pdf!.image!.analysis,
          })),
        },
        plain!,
      ],
    };
    const m = visitModelOf(view);
    const note = (id: string) => m.artworks.find(a => a.id === id)?.plateNote;
    expect(note(tall!.id)).toBe(copy.viewer.continueReading);
    expect(note(pdf!.id)).toBe(fill(copy.viewer.platePages, { n: 3 }));
    expect(note(plain!.id)).toBeUndefined();
  });
});

describe('소리 명판 표지(V-23)', () => {
  it('표지가 있는 소리 작품은 벽 그림을 가운데 잘라 채우고(`fit: cover`), 크게 보기 그림 주소는 없음(재생 명판)', () => {
    const v = testExhibitionView([2]);
    const [audio, plain] = v.artworks;
    const assetId = audio!.image!.asset.assetId;
    const view = {
      ...v,
      artworks: [
        {
          ...audio!,
          kind: 'AUDIO' as const,
          form: 'SOUND' as const,
          image: null,
          audio: {
            asset: {
              assetId,
              variants: [{ name: 'audio', ext: 'm4a' as const, w: 0, h: 0, bytes: 900_000 }],
            },
            durationMs: 60_000,
            analysis: { audibleStartMs: 0, audibleEndMs: 60_000, loudnessDb: -14 },
            cover: {
              assetId,
              variants: [{ name: 'cover', ext: 'webp' as const, w: 512, h: 512, bytes: 40_000 }],
            },
          },
        },
        plain!,
      ],
    };
    const m = visitModelOf(view);
    const a = m.artworks.find(x => x.id === audio!.id)!;
    expect(a.fit).toBe('cover');
    expect(a.imageSrc).toBeNull();
    expect(m.textures.urlOf(a.id, 'thumb')).toBe(`/assets/g/m/${TEST_EXHIBITION_ID}/${assetId}/cover.webp`);
    // 크게 보기 재생 명판·표지를 받기 전 벽에는 지금 카드를 그대로 쓴다
    expect(m.cards.get(a.id)?.kind).toBe('AUDIO');
    expect(m.artworks.find(x => x.id === plain!.id)!.fit).toBeUndefined();
  });
});
