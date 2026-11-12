import { describe, expect, it, vi } from 'vitest';
import { createMediaCache, planPreload, type WorkerConnection } from './mediaCache.ts';
import { ART, EX, view } from '../../sw/testSupport.ts';
import type { PreloadProgress } from '../../ports/mediaCache.ts';
import { testArtworkId, testAssetId, testExhibitionView, uuid } from '../../dev/testView.ts';
import type { ExhibitionView, MediaVariant } from '@gallery/core/types';

const setup = () => {
  const connection: WorkerConnection = {
    register: vi.fn(async () => true),
    send: vi.fn(async () => ({ kind: 'DONE' as const })),
  };
  const estimate = vi.fn(async () => ({ quota: 10_000_000, usage: 0 }));
  const cache = createMediaCache({
    production: true,
    pathname: '/123456',
    connection,
    estimate,
    templates: { 'modern-history': ['/assets/g/core-hash.glb', '/assets/g/fixtures-hash.glb'] },
  });
  return { cache, connection, estimate };
};

describe('기기 캐시 포트', () => {
  it('개발 모드와 /dev 경로에서는 등록·미리 받지 않는다', async () => {
    for (const options of [
      { production: false, pathname: '/' },
      { production: true, pathname: '/dev/seam' },
    ]) {
      const connection: WorkerConnection = { register: vi.fn(async () => true), send: vi.fn() };
      const cache = createMediaCache({
        ...options,
        connection,
        estimate: async () => ({}),
        templates: { 'modern-history': [] },
      });
      expect(await cache.register()).toBe(false);
      expect(await cache.preload(view(), () => {})).toEqual({ kind: 'UNAVAILABLE' });
      expect(connection.register).not.toHaveBeenCalled();
    }
  });
  it('공간이 모자라면 첫 다운로드 전에 NO_SPACE를 알린다', async () => {
    const s = setup();
    s.estimate.mockResolvedValue({ quota: 10, usage: 9 });
    const progress: PreloadProgress[] = [];
    expect(await s.cache.preload(view(), p => progress.push(p))).toEqual({ kind: 'NO_SPACE' });
    expect(progress.at(-1)?.kind).toBe('NO_SPACE');
    expect(s.connection.send).not.toHaveBeenCalled();
  });
  it('받는 중 공간이 줄거나 quota 쓰기가 거절되어도 멈춘다', async () => {
    const s = setup();
    s.estimate
      .mockResolvedValueOnce({ quota: 10_000_000, usage: 0 })
      .mockResolvedValue({ quota: 2, usage: 1 });
    expect(await s.cache.preload(view(), () => {})).toEqual({ kind: 'NO_SPACE' });
    expect(vi.mocked(s.connection.send).mock.calls.filter(([m]) => m.type === 'PRELOAD_URL')).toHaveLength(0);
    const t = setup();
    vi.mocked(t.connection.send)
      .mockResolvedValueOnce({ kind: 'DONE' })
      .mockResolvedValue({ kind: 'NO_SPACE' });
    expect(await t.cache.preload(view(), () => {})).toEqual({ kind: 'NO_SPACE' });
  });
  it('등록·시작·복귀 알림과 순차 미리 받기 진행률을 제공한다', async () => {
    const s = setup();
    expect(await s.cache.register()).toBe(true);
    await s.cache.appStarted();
    await s.cache.screenResumed();
    vi.mocked(s.connection.send).mockImplementation(async m =>
      m.type === 'PRELOAD_URL' ? { kind: 'CACHED', bytes: 20 } : { kind: 'DONE' },
    );
    const progress: PreloadProgress[] = [];
    expect(await s.cache.preload(view(), p => progress.push(p))).toEqual({ kind: 'READY' });
    expect(s.connection.send).toHaveBeenCalledWith({ type: 'APP_START' });
    expect(s.connection.send).toHaveBeenCalledWith({ type: 'SCREEN_RESUME' });
    expect(progress.at(-1)).toEqual({ kind: 'READY', completed: 2, total: 2, bytes: 40 });
  });
  it('첫 관 액자만: 모든 썸네일 + 대표작·첫 작품 벽용, 중복·소리·다른 관 제외', () => {
    const v = view();
    const image = (id: string, featured: boolean) => ({
      id,
      roomId: v.rooms[0]!.id,
      order: 0,
      title: '가상 작품',
      author: null,
      caption: null,
      description: null,
      kind: 'IMAGE' as const,
      form: 'PORTRAIT' as const,
      textHeavy: false,
      featured,
      pageMode: 'AUTO' as const,
      image: {
        asset: {
          assetId: id,
          variants: [
            { name: 'thumb', ext: 'webp' as const, bytes: 40, w: 512, h: 512 },
            { name: 'wall', ext: 'webp' as const, bytes: 300, w: 1600, h: 1600 },
          ],
        },
        w: 1600,
        h: 1600,
        analysis: {
          edgeLuma: 0.5,
          linePitchPx: null,
          linePitchConfidence: 0,
          lineProfile: null,
          profileBinPx: 8,
        },
      },
      pages: null,
      audio: null,
      textBody: null,
    });
    const a = image(ART, false),
      b = image(ART.replace(/3$/, '4'), true),
      c = image(ART.replace(/3$/, '5'), false);
    v.artworks.push(a, b, c);
    const frame = (id: string, partId: string) => ({
      artworkId: id,
      partId,
      mount: 'WALL' as const,
      wall: 'N' as const,
      center: [0, 0, 0] as [number, number, number],
      normal: [0, 1] as [number, number],
      art: { w: 1, h: 1 },
      mat: { w: 0 },
      outer: { w: 1, h: 1 },
      featured: id === b.id,
    });
    v.layout.frames.push(frame(a.id, 'first'), frame(b.id, 'first'), frame(c.id, 'second'));
    const part = { ...v.layout.parts[0]!, partId: 'first' };
    v.layout.parts.splice(0, v.layout.parts.length, part, { ...part, partId: 'second' });
    const urls = planPreload(v, ['/assets/g/core.glb']).map(x => x.url);
    expect(urls).toEqual([
      '/assets/g/core.glb',
      `/assets/g/m/${EX}/${ART}/thumb.webp`,
      `/assets/g/m/${EX}/${b.id}/thumb.webp`,
      `/assets/g/m/${EX}/${b.id}/wall.webp`,
      `/assets/g/m/${EX}/${ART}/wall.webp`,
    ]);
  });
});

/** 전시 전체(P5-10) 시험 재료: 전시실 2곳(작품 4·2), 1관 배경음악, 2관 작품 하나는 소리(표지 있음), 포스터 */
const wholeView = (): ExhibitionView => {
  const v = testExhibitionView([4, 2]);
  const variant = (name: string, ext: MediaVariant['ext'], bytes: number): MediaVariant => ({
    name,
    ext,
    w: ext === 'webp' ? 512 : 0,
    h: ext === 'webp' ? 512 : 0,
    bytes,
  });
  v.exhibition.poster = {
    assetId: uuid(0xf001),
    variants: [variant('thumb', 'webp', 10), variant('wall', 'webp', 100)],
  };
  v.rooms[0]!.bgm = {
    asset: { assetId: uuid(0xf002), variants: [variant('audio', 'm4a', 3_000_000)] },
    durationMs: 150_000,
    analysis: { audibleStartMs: 0, audibleEndMs: 150_000, loudnessDb: -16 },
  };
  const sound = v.artworks.find(a => a.id === testArtworkId(1, 1))!;
  sound.kind = 'AUDIO';
  sound.image = null;
  sound.audio = {
    asset: { assetId: uuid(0xf003), variants: [variant('audio', 'mp3', 2_000_000)] },
    durationMs: 60_000,
    analysis: { audibleStartMs: 0, audibleEndMs: 60_000, loudnessDb: null },
    cover: { assetId: uuid(0xf004), variants: [variant('thumb', 'webp', 20), variant('wall', 'webp', 200)] },
  };
  return v;
};
const m = (asset: string, file: string) =>
  `/assets/g/m/${testExhibitionView().exhibition.id}/${asset}/${file}`;

describe('수업 전 미리 불러오기 — 전시 전체(P5-10)', () => {
  it('모든 작품 썸네일·벽용, 배경음악, 소리 작품, 포스터, 템플릿이 목록에 들어간다(글 작품·줌 제외)', () => {
    const v = wholeView();
    const urls = planPreload(v, ['/assets/g/core.glb', '/assets/g/core.glb'], 'WHOLE').map(x => x.url);
    // 1관: 그림 3 + 글 1(번호 3) · 2관: 그림 1 + 소리 1(표지)
    const pictures = [testAssetId(0, 0), testAssetId(0, 1), testAssetId(0, 2), testAssetId(1, 0)];
    const cover = uuid(0xf004);
    for (const id of [...pictures, cover]) expect(urls).toContain(m(id, 'thumb.webp'));
    for (const id of pictures) {
      expect(urls).toContain(m(id, 'wall.webp'));
      expect(urls).toContain(m(id, 'wall-lo.webp'));
    }
    expect(urls).toContain(m(cover, 'wall.webp'));
    expect(urls).toContain(m(uuid(0xf002), 'audio.m4a'));
    expect(urls).toContain(m(uuid(0xf003), 'audio.mp3'));
    expect(urls).toContain(m(uuid(0xf001), 'wall.webp'));
    expect(urls[0]).toBe('/assets/g/core.glb');
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.some(u => /zoom/.test(u))).toBe(false);
    // 4 그림 × 3 + 표지 2 + 소리 2 + 포스터 1 + 템플릿 1
    expect(urls).toHaveLength(4 * 3 + 2 + 2 + 1 + 1);
    // 첫 전시실만(학생 포스터)은 그대로 — 다른 관·배경음악·소리는 없다
    const first = planPreload(v, ['/assets/g/core.glb']).map(x => x.url);
    expect(first).not.toContain(m(testAssetId(1, 0), 'thumb.webp'));
    expect(first).not.toContain(m(uuid(0xf002), 'audio.m4a'));
  });
  it('썸네일을 먼저 다 받고, 관 차례대로 벽용 뒤에 그 전시실 배경음악을 받는다', () => {
    const urls = planPreload(wholeView(), [], 'WHOLE').map(x => x.url);
    const lastThumb = Math.max(...urls.flatMap((u, i) => (u.endsWith('/thumb.webp') ? [i] : [])));
    const firstWall = urls.findIndex(u => u.endsWith('/wall.webp') && !u.includes(uuid(0xf001)));
    expect(lastThumb).toBeLessThan(firstWall);
    const bgm = urls.indexOf(m(uuid(0xf002), 'audio.m4a'));
    expect(bgm).toBeGreaterThan(urls.indexOf(m(testAssetId(0, 2), 'wall.webp')));
    expect(bgm).toBeLessThan(urls.indexOf(m(testAssetId(1, 0), 'wall.webp')));
  });
  it('WHOLE로 받으면 목록 전부를 보내고 진행률·저장 바이트를 알린다', async () => {
    const s = setup();
    vi.mocked(s.connection.send).mockImplementation(async msg =>
      msg.type === 'PRELOAD_URL' ? { kind: 'CACHED', bytes: 1000 } : { kind: 'DONE' },
    );
    const v = wholeView();
    const plan = planPreload(v, ['/assets/g/core-hash.glb', '/assets/g/fixtures-hash.glb'], 'WHOLE');
    const progress: PreloadProgress[] = [];
    expect(await s.cache.preload(v, p => progress.push(p), { scope: 'WHOLE' })).toEqual({ kind: 'READY' });
    const sent = vi
      .mocked(s.connection.send)
      .mock.calls.flatMap(([msg]) => (msg.type === 'PRELOAD_URL' ? [msg.url] : []));
    expect(sent).toEqual(plan.map(x => x.url));
    expect(sent).toContain(m(uuid(0xf002), 'audio.m4a'));
    expect(sent).toContain(m(testAssetId(1, 0), 'wall.webp'));
    expect(progress[0]).toEqual({ kind: 'LOADING', completed: 0, total: plan.length, bytes: 0 });
    expect(progress.at(-1)).toEqual({
      kind: 'READY',
      completed: plan.length,
      total: plan.length,
      bytes: plan.length * 1000,
    });
  });
  it('전시 전체가 남은 공간보다 크면 첫 다운로드 전에 NO_SPACE(첫 전시실은 들어가도)', async () => {
    const s = setup();
    s.estimate.mockResolvedValue({ quota: 6_000_000, usage: 0 });
    vi.mocked(s.connection.send).mockImplementation(async msg =>
      msg.type === 'PRELOAD_URL' ? { kind: 'CACHED', bytes: 1 } : { kind: 'DONE' },
    );
    const v = wholeView();
    const progress: PreloadProgress[] = [];
    expect(await s.cache.preload(v, p => progress.push(p), { scope: 'WHOLE' })).toEqual({
      kind: 'NO_SPACE',
    });
    expect(progress.at(-1)?.kind).toBe('NO_SPACE');
    expect(s.connection.send).not.toHaveBeenCalled();
    expect(await s.cache.preload(v, () => {})).toEqual({ kind: 'READY' });
  });
});
