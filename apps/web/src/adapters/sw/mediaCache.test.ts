import { describe, expect, it, vi } from 'vitest';
import { createMediaCache, planPreload, type WorkerConnection } from './mediaCache.ts';
import { ART, EX, view } from '../../sw/testSupport.ts';
import type { PreloadProgress } from '../../ports/mediaCache.ts';

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
