import { ExhibitionViewSchema, mediaPath, type AssetRef, type ExhibitionView } from '@gallery/core/types';
import type { TemplateId } from '@gallery/core/templates';
import { z } from 'zod';
import type { MediaCache, PreloadProgress, PreloadResult } from '../../ports/mediaCache.ts';
import { SW_TEMPLATE_RESERVE_BYTES } from '../../sw/constants.ts';
import type { WorkerConnection } from './connection.ts';
export type { WorkerConnection } from './connection.ts';

export interface PreloadItem {
  readonly url: string;
  readonly expectedBytes: number;
}
export interface MediaCacheOptions {
  readonly production: boolean;
  readonly pathname: string;
  readonly connection: WorkerConnection | null;
  readonly estimate: () => Promise<unknown>;
  readonly templates: Readonly<Record<TemplateId, readonly string[]>>;
}
const EstimateSchema = z.object({
  quota: z.number().finite().nonnegative().optional(),
  usage: z.number().finite().nonnegative().optional(),
});

/** 첫 관 액자 순서. PDF는 첫 쪽, 소리 작품은 표지, 글 작품은 기기 카드이므로 파일이 없다. */
export const planPreload = (view: ExhibitionView, templates: readonly string[]): readonly PreloadItem[] => {
  const uniqueTemplates = [...new Set(templates)];
  const items: PreloadItem[] = uniqueTemplates.map(url => ({
    url,
    expectedBytes: SW_TEMPLATE_RESERVE_BYTES / uniqueTemplates.length,
  }));
  const first = view.layout.parts[0];
  if (!first) return items;
  const frames = view.layout.frames.filter(frame => frame.partId === first.partId);
  const assets: { asset: AssetRef; featured: boolean }[] = [];
  for (const frame of frames) {
    const art = view.artworks.find(a => a.id === frame.artworkId);
    const asset = art?.image?.asset ?? art?.pages?.[0]?.asset ?? art?.audio?.cover;
    if (asset) assets.push({ asset, featured: frame.featured });
  }
  const append = (asset: AssetRef, name: string): void => {
    const variant = asset.variants.find(v => v.name === name);
    if (variant)
      items.push({
        url: mediaPath(view.exhibition.id, asset.assetId, variant),
        expectedBytes: variant.bytes,
      });
  };
  for (const { asset } of assets) append(asset, 'thumb');
  const featured = assets.find(item => item.featured);
  if (featured) append(featured.asset, 'wall');
  if (assets[0]) append(assets[0].asset, 'wall');
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
};

export const createMediaCache = (options: MediaCacheOptions): MediaCache => {
  const enabled =
    options.production && !/^\/dev(?:\/|$)/.test(options.pathname) && options.connection !== null;
  let registration: Promise<boolean> | undefined;
  const register = (): Promise<boolean> => {
    if (!enabled || !options.connection) return Promise.resolve(false);
    return (registration ??= options.connection
      .register()
      .catch(() => false)
      .then(ok => {
        if (!ok) registration = undefined;
        return ok;
      }));
  };
  const space: MediaCache['space'] = async requiredBytes => {
    try {
      const parsed = EstimateSchema.safeParse(await options.estimate());
      if (!parsed.success || parsed.data.quota === undefined || parsed.data.usage === undefined)
        return { availableBytes: null, sufficient: null };
      const availableBytes = Math.max(0, parsed.data.quota - parsed.data.usage);
      return { availableBytes, sufficient: availableBytes >= requiredBytes };
    } catch {
      return { availableBytes: null, sufficient: null };
    }
  };
  const notify = async (type: 'APP_START' | 'SCREEN_RESUME'): Promise<void> => {
    if (await register()) await options.connection?.send({ type }).catch(() => {});
  };
  // 같은 전시의 동시 준비는 전송·진행률을 공유한다. 파일은 하나씩 받는다.
  let running: Promise<PreloadResult> | undefined;
  let runningId: string | undefined;
  const listeners = new Set<(p: PreloadProgress) => void>();
  let latest: PreloadProgress | undefined;
  const publish = (p: PreloadProgress): void => {
    latest = p;
    for (const listener of listeners) listener(p);
  };
  const preload: MediaCache['preload'] = async (input, onProgress) => {
    const parsed = ExhibitionViewSchema.safeParse(input);
    if (!parsed.success) return { kind: 'FAILED' };
    const view = parsed.data;
    while (running && runningId !== view.exhibition.id) await running;
    listeners.add(onProgress);
    if (running) {
      if (latest) onProgress(latest);
      try {
        return await running;
      } finally {
        listeners.delete(onProgress);
      }
    }
    runningId = view.exhibition.id;
    latest = undefined;
    const run = async (): Promise<PreloadResult> => {
      const items = planPreload(view, options.templates[view.exhibition.templateId]);
      let completed = 0;
      let bytes = 0;
      let remaining = items.reduce((sum, item) => sum + item.expectedBytes, 0);
      const finish = (kind: PreloadResult['kind']): PreloadResult => {
        publish({ kind, completed, total: items.length, bytes });
        return { kind };
      };
      if (!(await register()) || !options.connection) return finish('UNAVAILABLE');
      if ((await space(remaining)).sufficient === false) return finish('NO_SPACE');
      const remembered = await options.connection.send({
        type: 'REMEMBER_EXHIBITION',
        exhibitionId: view.exhibition.id,
        expiresAt: view.exhibition.expiresAt,
      });
      if (remembered.kind !== 'DONE') return finish(remembered.kind === 'NO_SPACE' ? 'NO_SPACE' : 'FAILED');
      publish({ kind: 'LOADING', completed, total: items.length, bytes });
      for (const item of items) {
        if ((await space(remaining)).sufficient === false) return finish('NO_SPACE');
        const reply = await options.connection.send({ type: 'PRELOAD_URL', url: item.url });
        if (reply.kind !== 'CACHED') return finish(reply.kind === 'NO_SPACE' ? 'NO_SPACE' : 'FAILED');
        completed++;
        bytes += reply.bytes;
        remaining -= item.expectedBytes;
        publish({ kind: 'LOADING', completed, total: items.length, bytes });
      }
      return finish('READY');
    };
    running = run().catch(() => {
      publish({
        kind: 'FAILED',
        completed: latest?.completed ?? 0,
        total: latest?.total ?? 0,
        bytes: latest?.bytes ?? 0,
      });
      return { kind: 'FAILED' as const };
    });
    try {
      return await running;
    } finally {
      running = undefined;
      runningId = undefined;
      listeners.delete(onProgress);
    }
  };
  return {
    register,
    space,
    preload,
    appStarted: () => notify('APP_START'),
    screenResumed: () => notify('SCREEN_RESUME'),
  };
};
