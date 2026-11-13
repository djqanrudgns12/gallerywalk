import { mediaPath } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { consentAudience, formatDay, posterArtworks, posterImageUrl, schoolSummary } from './posterView.ts';
import { EX_ID, EXPIRES_AT, makeView, POSTER_ID } from '../../dev/studentFixtures.ts';
import { testAssetId, testExhibitionView } from '../../dev/testView.ts';

const thumbOf = (r: number, i: number) => mediaPath(EX_ID, testAssetId(r, i), { name: 'thumb', ext: 'webp' });

describe('포스터 값', () => {
  it('포스터 그림 주소는 mediaPath(core)로, 벽용 크기가 먼저', () => {
    expect(posterImageUrl(makeView())).toBeNull();
    expect(posterImageUrl(makeView({ poster: true }))).toBe(
      mediaPath(EX_ID, POSTER_ID, { name: 'wall', ext: 'webp' }),
    );
  });

  it('포스터 위 작품: 첫 전시실 액자 썸네일(미리 받는 주소 그대로) 최대 3장, 글 작품은 빼고 대표작이 먼저', () => {
    // 첫 관 3점(모두 그림) — 차례는 배치의 액자 차례(작품 차례가 아님)
    const three = makeView();
    const urls3 = posterArtworks(three).map(a => a.url);
    expect([...urls3].sort()).toEqual([0, 1, 2].map(i => thumbOf(0, i)).sort());
    const assetOfArt = new Map(three.artworks.map(a => [a.id, a.image?.asset.assetId ?? '']));
    // 배치 엔진이 고른 대표 액자(featured)가 먼저, 나머지는 액자 차례
    const frames3 = [
      ...three.layout.frames.filter(f => f.featured),
      ...three.layout.frames.filter(f => !f.featured),
    ];
    expect(urls3).toEqual(
      frames3.map(f => mediaPath(EX_ID, assetOfArt.get(f.artworkId) ?? '', { name: 'thumb', ext: 'webp' })),
    );
    expect(posterArtworks(makeView())[0]).toMatchObject({ w: 512, h: 341 });
    // 6점(4번째는 글 작품) → 3장만, 글 작품은 그림이 없어 빠진다
    const six = testExhibitionView([6]);
    const urls = posterArtworks(six).map(a => a.url);
    expect(urls).toHaveLength(3);
    expect(urls).not.toContain(thumbOf(0, 3));
    // 대표작(featured)은 걸린 차례와 관계없이 맨 앞(배치 엔진이 고른 대표를 마지막 액자로 옮겨 본다)
    const lastFrame = six.layout.frames.filter(f => f.partId === six.layout.parts[0]?.partId).at(-1);
    const featured = {
      ...six,
      layout: {
        ...six.layout,
        frames: six.layout.frames.map(f => ({ ...f, featured: f === lastFrame })),
      },
    };
    const art = six.artworks.find(a => a.id === lastFrame?.artworkId);
    expect(posterArtworks(featured)[0]?.url).toBe(
      mediaPath(EX_ID, art?.image?.asset.assetId ?? '', { name: 'thumb', ext: 'webp' }),
    );
    expect(posterArtworks(featured)).toHaveLength(3);
  });

  it('학교·학급은 켰을 때만, 있는 것만 잇는다', () => {
    expect(schoolSummary(makeView())).toBeNull();
    expect(schoolSummary(makeView({ school: { schoolName: '가상초등학교', className: '5학년 2반' } }))).toBe(
      '가상초등학교 5학년 2반',
    );
    expect(schoolSummary(makeView({ school: { schoolName: null, className: '5학년 2반' } }))).toBe(
      '5학년 2반',
    );
    expect(schoolSummary(makeView({ school: { schoolName: null, className: null } }))).toBeNull();
  });

  it('날짜는 "{월} {일}" 모양', () => {
    expect(formatDay(EXPIRES_AT, 'Asia/Seoul')).toBe('12월 12일');
  });

  it('동의 문구 판: 이름표로 보이거나 공개가 하나라도 켜지면 "모두에게"', () => {
    const base = makeView().exhibition.reactions;
    expect(consentAudience(base, true)).toBe('everyone');
    expect(consentAudience(base, false)).toBe('teacher');
    const pub = makeView({ reactions: { stickerVisibility: 'PUBLIC' } }).exhibition.reactions;
    expect(consentAudience(pub, false)).toBe('everyone');
  });
});
