import {
  ExhibitionViewSchema,
  mediaPath,
  type ArtworkPublic,
  type AssetRef,
  type ExhibitionView,
} from '@gallery/core/types';
import type { TemplateId } from '@gallery/core/templates';
import { z } from 'zod';
import type { MediaCache, PreloadProgress, PreloadResult, PreloadScope } from '../../ports/mediaCache.ts';
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

/** 액자에 걸리는 그림: 그림 작품은 그림, PDF는 첫 쪽, 소리 작품은 표지. 글 작품은 기기 카드라 파일이 없다. */
const wallAssetOf = (art: ArtworkPublic | undefined): AssetRef | undefined =>
  art?.image?.asset ?? art?.pages?.[0]?.asset ?? art?.audio?.cover ?? undefined;

const dedupe = (items: readonly PreloadItem[]): readonly PreloadItem[] => {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
};

/**
 * 받을 목록. `FIRST_ROOM`(기본): 템플릿 + 첫 관 액자 썸네일 전부 + 대표작·첫 작품 벽용(§2.5).
 * `WHOLE`(교사 수업 전 미리 불러오기, P5-10): 템플릿 → 포스터 → 모든 액자 썸네일 → 관 차례대로 [그 관의 벽용(`wall`·`wall-lo`)
 * → 그 전시실 배경음악] → 소리 작품의 소리. 줌 그림(`zoom`·`zoom-hi`)은 크게 볼 때만 받으므로 넣지 않는다.
 */
export const planPreload = (
  view: ExhibitionView,
  templates: readonly string[],
  scope: PreloadScope = 'FIRST_ROOM',
): readonly PreloadItem[] => {
  const uniqueTemplates = [...new Set(templates)];
  const items: PreloadItem[] = uniqueTemplates.map(url => ({
    url,
    expectedBytes: SW_TEMPLATE_RESERVE_BYTES / uniqueTemplates.length,
  }));
  const append = (asset: AssetRef, name: string): void => {
    const variant = asset.variants.find(v => v.name === name);
    if (variant)
      items.push({
        url: mediaPath(view.exhibition.id, asset.assetId, variant),
        expectedBytes: variant.bytes,
      });
  };
  const artOf = new Map(view.artworks.map(a => [a.id, a]));
  const framesOf = (partId: string) => view.layout.frames.filter(frame => frame.partId === partId);
  if (scope === 'WHOLE') {
    const poster = view.exhibition.poster;
    // 학생 포스터 화면이 고르는 그림(`posterView.ts`, 서버는 그림마다 `wall`을 만든다)
    const posterVariant =
      poster && ['wall', 'wall-lo', 'thumb'].find(n => poster.variants.some(v => v.name === n));
    if (poster && posterVariant) append(poster, posterVariant);
    const parts = view.layout.parts.map(part => ({
      part,
      assets: framesOf(part.partId).flatMap(frame => {
        const asset = wallAssetOf(artOf.get(frame.artworkId));
        return asset ? [asset] : [];
      }),
    }));
    for (const { assets } of parts) for (const asset of assets) append(asset, 'thumb');
    const bgmOf = new Map(view.rooms.map(room => [room.id, room.bgm]));
    for (const { part, assets } of parts) {
      for (const asset of assets) {
        append(asset, 'wall');
        append(asset, 'wall-lo');
      }
      const bgm = bgmOf.get(part.roomId)?.asset;
      if (bgm) append(bgm, 'audio');
    }
    for (const frame of view.layout.frames) {
      const sound = artOf.get(frame.artworkId)?.audio?.asset;
      if (sound) append(sound, 'audio');
    }
    return dedupe(items);
  }
  const first = view.layout.parts[0];
  if (!first) return items;
  const assets: { asset: AssetRef; featured: boolean }[] = [];
  for (const frame of framesOf(first.partId)) {
    const asset = wallAssetOf(artOf.get(frame.artworkId));
    if (asset) assets.push({ asset, featured: frame.featured });
  }
  for (const { asset } of assets) append(asset, 'thumb');
  const featured = assets.find(item => item.featured);
  if (featured) append(featured.asset, 'wall');
  if (assets[0]) append(assets[0].asset, 'wall');
  return dedupe(items);
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
  // 같은 전시·같은 범위의 동시 준비는 전송·진행률을 공유한다(교사가 시트를 닫았다 다시 열어도 이어서 본다). 파일은 하나씩 받는다.
  let running: Promise<PreloadResult> | undefined;
  let runningKey: string | undefined;
  const listeners = new Set<(p: PreloadProgress) => void>();
  let latest: PreloadProgress | undefined;
  const publish = (p: PreloadProgress): void => {
    latest = p;
    for (const listener of listeners) listener(p);
  };
  const preload: MediaCache['preload'] = async (input, onProgress, preloadOptions) => {
    const parsed = ExhibitionViewSchema.safeParse(input);
    if (!parsed.success) return { kind: 'FAILED' };
    const view = parsed.data;
    const scope = preloadOptions?.scope ?? 'FIRST_ROOM';
    const runKey = `${view.exhibition.id}:${scope}`;
    while (running && runningKey !== runKey) await running;
    listeners.add(onProgress);
    if (running) {
      if (latest) onProgress(latest);
      try {
        return await running;
      } finally {
        listeners.delete(onProgress);
      }
    }
    runningKey = runKey;
    latest = undefined;
    const run = async (): Promise<PreloadResult> => {
      const items = planPreload(view, options.templates[view.exhibition.templateId], scope);
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
      runningKey = undefined;
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
