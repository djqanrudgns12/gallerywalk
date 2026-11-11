import { relative, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { config } from '@gallery/core/config';
import { isGone, mediaCacheSeconds, type ExhibitionLifetime } from '@gallery/core/retention';
import { MEDIA_PATH_PREFIX, UuidSchema, VariantNameSchema } from '@gallery/core/types';
import type { Deps } from '../../ports/index.ts';
import type { AppEnv } from '../types.ts';
import { notFound, sendFile } from './static.ts';

/**
 * 작품 미디어 `GET|HEAD /assets/g/m/{exhibitionId}/{assetId}/{variant}.{ext}`(PLAN §9.6 표·§9.7·§10.3, ADR-028·049).
 *
 * 순서: ① 경로 모양(UUID 둘·파생 이름·확장자 목록) — 어긋나면 저장소·디스크를 보기 전에 404
 * ② 전시가 있고 없어지지 않았나(만료·지우는 중, 상태 캐시 10초) ③ asset 행이 그 전시의 것이고 그 파생이 행에 있나
 * ④ `MEDIA_DIR/exh/{exhibitionId}/{assetId}/{variant}.{ext}` 파일(링크는 따라가지 않음).
 *
 * 없음·없어짐·남의 전시·이상한 경로는 모두 같은 404 `E_NOT_FOUND` + `no-store`(410을 쓰지 않음): 있었는지를 알려 주지 않고
 * (§9.2 전시 경계와 같은 원칙), §9.7 "학생·미디어 요청은 `E_NOT_FOUND`"와 맞추며, 서비스 워커는 404·410을 똑같이
 * "그 전시 캐시를 지움"으로 다룬다(§9.6).
 *
 * 캐시 머리: `public, max-age={min(30일, 남은 기간)}, s-maxage={min(1일, 남은 기간)}, stale-if-error={min(1일, 남은 기간)}`
 * (`mediaCacheSeconds`) — 브라우저 사본은 보관 기간을 넘지 않고, 삭제 뒤 CDN 사본은 길어야 1일.
 */

const MS_PER_SECOND = 1000;

/** 작품 파일이 쌓이는 곳 `MEDIA_DIR/exh/…`(§10.3, `deps.ts`의 `exhibitionMediaDir`와 같은 자리) */
const EXHIBITIONS_DIR = 'exh';

/** 저장하는 파생 확장자(§10.3). 행의 파생 목록이 최종 판정이다 */
const CONTENT_TYPES = {
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
} as const satisfies Record<string, string>;
type MediaExt = keyof typeof CONTENT_TYPES;

const isMediaExt = (ext: string): ext is MediaExt => Object.hasOwn(CONTENT_TYPES, ext);

/** `{variant}.{ext}` — 파생 이름에는 점이 없으므로 점은 하나뿐이어야 한다 */
const FILE_NAME = /^([a-z0-9-]+)\.([a-z0-9]+)$/;

interface MediaRequest {
  readonly exhibitionId: string;
  readonly assetId: string;
  readonly variant: string;
  readonly ext: MediaExt;
}

/** 경로 세 칸 검사(디스크·저장소를 보지 않음). Hono가 이미 퍼센트 인코딩을 푼 값이 온다 */
const parseMediaRequest = (exhibitionId: string, assetId: string, file: string): MediaRequest | null => {
  const name = FILE_NAME.exec(file);
  if (!name) return null;
  const [, variant = '', ext = ''] = name;
  if (!isMediaExt(ext)) return null;
  if (!VariantNameSchema.safeParse(variant).success) return null;
  if (!UuidSchema.safeParse(exhibitionId).success || !UuidSchema.safeParse(assetId).success) return null;
  return { exhibitionId, assetId, variant, ext };
};

interface CachedLifetime extends ExhibitionLifetime {
  readonly checkedAt: number;
}

export interface ExhibitionStatusCache {
  /** 전시의 만료 시각·지우는 중 표시(없는 전시면 `null`). `MEDIA_STATE_CACHE_SEC` 동안 저장소를 다시 보지 않는다 */
  lifetime(exhibitionId: string): ExhibitionLifetime | null;
}

/**
 * 미디어 요청용 전시 상태 메모리 캐시(PLAN §9.7 "미디어 요청은 전시 상태를 메모리 캐시(10초)로 확인").
 * - 캐시하는 것은 만료 시각과 `deleting`뿐이고, 없어졌는지(`isGone`)는 **요청마다 지금 시각으로** 판정한다 —
 *   만료는 캐시 10초도 기다리지 않는다.
 * - "지금 삭제"의 `deleting = 1`은 길어야 `MEDIA_STATE_CACHE_SEC`(10초) 늦게 보인다. 그 사이에도 폴더 삭제(§9.7 3단계)가
 *   끝나면 파일이 없어 404다.
 * - 없는 전시는 캐시하지 않고(아무 UUID로 메모리를 채우지 못하게), 새로 읽을 때 오래된 항목을 치운다 —
 *   크기는 최근 10초 안에 미디어를 요청받은 전시 수를 넘지 않는다.
 */
export const createExhibitionStatusCache = (deps: Pick<Deps, 'store' | 'clock'>): ExhibitionStatusCache => {
  const entries = new Map<string, CachedLifetime>();
  return {
    lifetime(exhibitionId) {
      const now = deps.clock.now();
      const ttlMs = config().MEDIA_STATE_CACHE_SEC * MS_PER_SECOND;
      const fresh = (entry: CachedLifetime): boolean =>
        now >= entry.checkedAt && now - entry.checkedAt < ttlMs;
      const hit = entries.get(exhibitionId);
      if (hit && fresh(hit)) return hit;
      for (const [id, entry] of entries) if (!fresh(entry)) entries.delete(id);
      const row = deps.store.exhibitions.get(exhibitionId);
      if (!row) return null;
      const entry: CachedLifetime = { expiresAt: row.expiresAt, deleting: row.deleting, checkedAt: now };
      entries.set(exhibitionId, entry);
      return entry;
    },
  };
};

export interface MediaRouteOptions {
  readonly deps: Pick<Deps, 'store' | 'clock'>;
  /** `MEDIA_DIR`(파일은 그 아래 `exh/…`) */
  readonly mediaDir: string;
}

export const mediaRoutes = (options: MediaRouteOptions): Hono<AppEnv> => {
  const { deps } = options;
  const mediaRoot = resolve(options.mediaDir, EXHIBITIONS_DIR);
  const status = createExhibitionStatusCache(deps);
  const app = new Hono<AppEnv>();
  // Hono는 HEAD를 GET 처리기로 보낸다(`sendFile`이 본문 없이 머리만)
  app.get(`${MEDIA_PATH_PREFIX}/:exhibitionId/:assetId/:file`, async c => {
    const req = parseMediaRequest(c.req.param('exhibitionId'), c.req.param('assetId'), c.req.param('file'));
    if (!req) return notFound(c);
    c.set('exhibitionId', req.exhibitionId);

    const now = deps.clock.now();
    const lifetime = status.lifetime(req.exhibitionId);
    if (!lifetime || isGone(lifetime, now)) return notFound(c);
    const asset = deps.store.assets.get(req.assetId);
    if (!asset || asset.exhibitionId !== req.exhibitionId) return notFound(c);
    if (!asset.variants.some(v => v.name === req.variant && v.ext === req.ext)) return notFound(c);

    // 위 검사로 이미 안전하지만 `deps.ts` `exhibitionMediaDir`의 규칙을 그대로 한 번 더: 풀어 쓴 경로가
    // `MEDIA_DIR/exh/` 아래 정확히 그 세 칸(전시/asset/파일)이 아니면 거절
    const parts = [req.exhibitionId, req.assetId, `${req.variant}.${req.ext}`] as const;
    const path = resolve(mediaRoot, ...parts);
    if (relative(mediaRoot, path) !== parts.join(sep)) return notFound(c);

    const cache = mediaCacheSeconds(lifetime.expiresAt, now);
    const cacheControl = `public, max-age=${cache.maxAge}, s-maxage=${cache.sMaxAge}, stale-if-error=${cache.staleIfError}`;
    return (await sendFile(c, { path, contentType: CONTENT_TYPES[req.ext], cacheControl })) ?? notFound(c);
  });
  return app;
};
