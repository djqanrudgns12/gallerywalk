import { EntryCodeSchema, UuidSchema, VariantNameSchema } from '@gallery/core/types';

export type Route =
  | { readonly kind: 'pass' | 'shell' | 'asset' }
  | { readonly kind: 'exhibition'; readonly code: string }
  | { readonly kind: 'media'; readonly exhibitionId: string; readonly audio: boolean };

/** 요청 객체만 읽는다. 다른 출처·인증 요청·쓰기·부분 API는 SW의 책임 밖이다. */
export const classifyRequest = (request: Request, origin: string): Route => {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== origin || request.headers.has('Authorization'))
    return { kind: 'pass' };
  const path = url.pathname;
  if (path === '/sw.js' || /^\/dev(?:\/|$)/.test(path)) return { kind: 'pass' };
  const api = /^\/api\/e\/([^/]+)$/.exec(path);
  if (api?.[1] && EntryCodeSchema.safeParse(api[1]).success) return { kind: 'exhibition', code: api[1] };
  if (path.startsWith('/api/')) return { kind: 'pass' };
  const media = /^\/assets\/g\/m\/([^/]+)\/([^/]+)\/([^.]+)\.(webp|mp3|m4a)$/.exec(path);
  if (path.startsWith('/assets/g/m/')) {
    if (
      !media?.[1] ||
      !UuidSchema.safeParse(media[1]).success ||
      !UuidSchema.safeParse(media[2]).success ||
      !VariantNameSchema.safeParse(media[3]).success
    )
      return { kind: 'pass' };
    return { kind: 'media', exhibitionId: media[1], audio: media[4] === 'mp3' || media[4] === 'm4a' };
  }
  if (path.startsWith('/assets/g/')) return { kind: 'asset' };
  if (
    path === '/' ||
    path === '/index.html' ||
    path === '/t' ||
    path === '/privacy' ||
    path.startsWith('/t/') ||
    EntryCodeSchema.safeParse(path.slice(1)).success
  )
    return { kind: 'shell' };
  return { kind: 'pass' };
};
