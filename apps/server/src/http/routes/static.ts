import { constants, type Stats } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { config } from '@gallery/core/config';
import { MEDIA_PATH_PREFIX } from '@gallery/core/types';
import { respondError } from '../middleware/errors.ts';
import type { AppEnv } from '../types.ts';

/**
 * 파일 응답(작품 미디어·앱 정적 파일이 함께 씀)과 앱 정적 경로(PLAN §9.6 표, ADR-028·049).
 *
 * 파일 응답: 강한 `ETag`(크기·고친 시각 — 한 번 쓴 파일은 바꾸지 않으므로 같은 주소·같은 값이면 같은 바이트, §10.3),
 * `If-None-Match` → 304, 한 구간 `Range` → 206(맞출 수 없으면 416), `Accept-Ranges: bytes`, HEAD는 머리만.
 * 마지막 이름이 링크면 열지 않는다(`O_NOFOLLOW`). 정규 파일이 아니면(폴더 등) 없는 것으로.
 */

/** 링크를 따라가지 않고 연다(이 상수가 없는 운영체제는 0 — 맥미니·리눅스에는 있다) */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

/** 없음으로 다룰 열기 오류: 없음·폴더 아님·링크(`O_NOFOLLOW` → ELOOP)·이름이 너무 김 */
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG']);

const isMissing = (err: unknown): boolean =>
  err instanceof Error && 'code' in err && typeof err.code === 'string' && MISSING_CODES.has(err.code);

/** 16진수(ETag 조각) */
const HEX = 16;

export interface FileReply {
  readonly path: string;
  readonly contentType: string;
  readonly cacheControl: string;
  /** 앱 빌드 파일에만 적용한다. 작품 미디어는 기존 원본 응답을 유지한다. */
  readonly precompressed?: boolean;
}

type ContentEncoding = 'br' | 'gzip';
const ENCODINGS: readonly ContentEncoding[] = ['br', 'gzip'];
const ENCODING_SUFFIX: Readonly<Record<ContentEncoding, string>> = { br: '.br', gzip: '.gz' };
/** RFC 9110 qvalue: 0~1, 소수 세 자리까지. 잘못 쓴 가중치는 허용하지 않는다. */
const QUALITY = /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/** 높은 q부터 고르고, 같은 q면 br을 우선한다. 명시한 값은 `*`보다 우선하며 q=0은 제외한다. */
const acceptedEncodings = (header: string | undefined): readonly ContentEncoding[] => {
  if (header === undefined) return [];
  const qualities = new Map<string, number>();
  for (const part of header.toLowerCase().split(',')) {
    const [coding = '', ...parameters] = part.trim().split(/\s*;\s*/);
    const match = parameters.length === 1 ? QUALITY.exec(parameters[0] ?? '') : null;
    qualities.set(coding, parameters.length === 0 ? 1 : match ? Number(match[1]) : 0);
  }
  return ENCODINGS.map(encoding => ({
    encoding,
    quality: qualities.get(encoding) ?? qualities.get('*') ?? 0,
  }))
    .filter(item => item.quality > 0)
    .sort((a, b) => b.quality - a.quality)
    .map(item => item.encoding);
};

/** 원본과 압축 사본 모두 같은 링크·정규 파일 검사를 거친다. */
const openRegularFile = async (
  path: string,
): Promise<{ readonly handle: FileHandle; readonly stat: Stats } | null> => {
  let handle: FileHandle;
  try {
    handle = await open(path, OPEN_FLAGS);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  try {
    const stat = await handle.stat();
    if (stat.isFile()) return { handle, stat };
  } catch (err) {
    await handle.close();
    throw err;
  }
  await handle.close();
  return null;
};

type ByteRange = { readonly start: number; readonly end: number };

/** `Range` 해석 결과: 무시(전체 200) · 한 구간(206) · 맞출 수 없음(416) */
type RangePlan =
  { readonly kind: 'full' } | ({ readonly kind: 'partial' } & ByteRange) | { readonly kind: 'unsatisfiable' };

const RANGE = /^bytes=(\d*)-(\d*)$/i;

/**
 * 한 구간만 받는다. 여러 구간·다른 단위·잘못 쓴 값은 무시하고 전체를 보낸다(RFC 9110 §14.2 "무시해도 된다").
 * `a-b`(b가 크기를 넘으면 끝까지), `a-`, `-n`(끝에서 n바이트, n이 크기보다 크면 전체). 시작이 크기 이상이거나 `-0`이면 416.
 */
export const planRange = (header: string | undefined, size: number): RangePlan => {
  if (header === undefined) return { kind: 'full' };
  const match = RANGE.exec(header.trim());
  if (!match) return { kind: 'full' };
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return { kind: 'full' };
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  // 끝이 시작보다 앞이면 잘못 쓴 값(무시), 시작이 크기 이상이면 겹치는 바이트가 없음(416)
  if (last !== '' && Number(last) < start) return { kind: 'full' };
  if (start >= size) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end: last === '' ? size - 1 : Math.min(Number(last), size - 1) };
};

/** `If-None-Match`는 약한 비교(RFC 9110 §13.1.2): `W/`를 떼고 같으면 맞음, `*`는 언제나 맞음 */
const noneMatch = (header: string | undefined, etag: string): boolean =>
  header !== undefined &&
  header.split(',').some(tag => {
    const value = tag.trim();
    return value === '*' || value.replace(/^W\//, '') === etag;
  });

/** `If-Range`는 강한 비교: 지금 ETag와 글자까지 같아야(약한 값·날짜는 맞지 않음 → 전체 200) */
const rangeAllowed = (header: string | undefined, etag: string): boolean =>
  header === undefined || header.trim() === etag;

/**
 * 파일을 보낸다. 파일이 없거나(링크·폴더 포함) 정규 파일이 아니면 `null` — 부른 쪽이 404를 정한다.
 * 그 밖의 디스크 오류는 던진다(오류 봉투 → 500, CDN은 `stale-if-error`로 이미 가진 사본을 낸다).
 */
export async function sendFile(c: Context<AppEnv>, reply: FileReply): Promise<Response | null> {
  let file = await openRegularFile(reply.path);
  if (file === null) return null;
  let streaming = false;
  try {
    let encoding: ContentEncoding | undefined;
    // Range가 잘못 쓰였거나 If-Range가 맞지 않아도 원본을 보낸다. 바이트 구간의 기준을 바꾸지 않는다.
    if (reply.precompressed && c.req.header('range') === undefined) {
      for (const candidate of acceptedEncodings(c.req.header('accept-encoding'))) {
        const compressed = await openRegularFile(`${reply.path}${ENCODING_SUFFIX[candidate]}`);
        if (compressed === null) continue;
        const original = file;
        file = compressed;
        await original.handle.close();
        encoding = candidate;
        break;
      }
    }
    const { handle, stat } = file;
    const size = stat.size;
    // 같은 크기·시각의 원본과 사본도 서로 다른 강한 ETag를 가진다.
    const etag = `"${size.toString(HEX)}-${Math.trunc(stat.mtimeMs).toString(HEX)}${encoding ? `-${encoding}` : ''}"`;
    const headers: Record<string, string> = {
      'Cache-Control': reply.cacheControl,
      ETag: etag,
      'Accept-Ranges': 'bytes',
    };
    if (reply.precompressed) headers['Vary'] = 'Accept-Encoding';
    if (encoding) headers['Content-Encoding'] = encoding;
    if (noneMatch(c.req.header('if-none-match'), etag)) return c.body(null, 304, headers);

    const plan = rangeAllowed(c.req.header('if-range'), etag)
      ? planRange(c.req.header('range'), size)
      : ({ kind: 'full' } as const);
    // 416은 그 요청의 Range에만 맞는 답이라 주소에 붙잡아 두지 않는다(CDN이 주소 하나로 모두에게 내주지 않게)
    if (plan.kind === 'unsatisfiable')
      return c.body(null, 416, {
        ...headers,
        'Cache-Control': 'no-store',
        'Content-Range': `bytes */${size}`,
      });

    const { start, end } = plan.kind === 'partial' ? plan : { start: 0, end: size - 1 };
    const length = end - start + 1;
    const status = plan.kind === 'partial' ? 206 : 200;
    headers['Content-Type'] = reply.contentType;
    headers['Content-Length'] = String(length);
    if (plan.kind === 'partial') headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    // HEAD(Hono가 GET 처리기로 보냄)와 빈 파일은 스트림을 열지 않는다 — 버려질 본문이 파일을 붙잡지 않게
    if (c.req.method === 'HEAD' || length === 0) return c.body(null, status, headers);
    // 스트림이 끝나거나 끊기면(받는 쪽 취소 포함) 파일을 닫는다(`autoClose`)
    const stream = handle.createReadStream({ start, end, autoClose: true });
    streaming = true;
    return c.body(Readable.toWeb(stream), status, headers);
  } finally {
    if (!streaming) await file.handle.close();
  }
}

/** 오류·없음 답은 어디에도 붙잡아 두지 않는다(CDN·브라우저·서비스 워커) */
export const notFound = (c: Context<AppEnv>): Response => {
  c.header('Cache-Control', 'no-store');
  return respondError(c, 'E_NOT_FOUND');
};

// ── 앱 정적 경로 ─────────────────────────────────────────────

/** Vite `build.assetsDir`(apps/web/vite.config.ts)와 같은 자리 */
const APP_ASSET_PREFIX = '/assets/g/';
const APP_ASSET_DIR = ['assets', 'g'] as const;
/** 작품 미디어 자리(`media.ts`). 앱 파일로 찾지 않는다 */
const MEDIA_SEGMENT = MEDIA_PATH_PREFIX.slice(APP_ASSET_PREFIX.length);

/** 한 칸 이름: 글자·숫자·`_-.@+~`, 점으로 시작하지 않음(`.`·`..`·숨김 파일 거절). `%`·`\`·NUL·빈 칸은 받지 않는다 */
const SAFE_SEGMENT = /^[A-Za-z0-9_@+~-][A-Za-z0-9_.@+~-]*$/;

const UTF8 = '; charset=utf-8';
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': `text/html${UTF8}`,
  '.js': `text/javascript${UTF8}`,
  '.mjs': `text/javascript${UTF8}`,
  '.css': `text/css${UTF8}`,
  '.json': `application/json${UTF8}`,
  '.map': `application/json${UTF8}`,
  '.webmanifest': `application/manifest+json${UTF8}`,
  '.txt': `text/plain${UTF8}`,
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const contentTypeOf = (path: string): string =>
  CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';

/** `/assets/g/` 뒤 경로 → 웹 폴더 안 파일 경로. 한 칸이라도 이상하거나 폴더 밖이면 `null`(디스크를 보기 전에) */
const appAssetPath = (assetRoot: string, requestPath: string): string | null => {
  if (!requestPath.startsWith(APP_ASSET_PREFIX)) return null;
  const segments = requestPath.slice(APP_ASSET_PREFIX.length).split('/');
  if (segments[0] === MEDIA_SEGMENT) return null;
  if (!segments.every(segment => SAFE_SEGMENT.test(segment))) return null;
  const target = resolve(assetRoot, ...segments);
  const rel = relative(assetRoot, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
};

export interface StaticRouteOptions {
  /** Vite 빌드 폴더(`apps/web/dist`): `index.html`·`sw.js`·`assets/g/*` */
  readonly webDir: string;
}

/**
 * 앱 정적 경로(PLAN §9.6 표):
 * - `/assets/g/*` 해시 이름 파일 → `public, max-age=1년, immutable, stale-if-error=7일`. 없으면 404(index.html 아님)
 * - `/`, `/{입장 코드}`, `/t`, `/t/*`, `/privacy`(처리방침, P6-8) → 앱 `index.html` + `no-cache`(배포하면 바로 새 껍데기를 받게)
 * - `/sw.js` → `no-cache`
 * 보안 머리(CSP 등)는 앱 미들웨어가 모든 응답에 붙인다. 그 밖의 경로는 붙이지 않는다(앱의 404 봉투).
 */
export const staticRoutes = (options: StaticRouteOptions): Hono<AppEnv> => {
  const webRoot = resolve(options.webDir);
  const assetRoot = resolve(webRoot, ...APP_ASSET_DIR);
  const indexPath = join(webRoot, 'index.html');
  const swPath = join(webRoot, 'sw.js');

  const html = async (c: Context<AppEnv>): Promise<Response> =>
    (await sendFile(c, {
      path: indexPath,
      contentType: contentTypeOf(indexPath),
      cacheControl: 'no-cache',
      precompressed: true,
    })) ?? notFound(c);

  const app = new Hono<AppEnv>();
  app.get('/sw.js', async c => {
    const reply = await sendFile(c, {
      path: swPath,
      contentType: contentTypeOf(swPath),
      cacheControl: 'no-cache',
      precompressed: true,
    });
    return reply ?? notFound(c);
  });
  app.get(`${APP_ASSET_PREFIX}*`, async c => {
    const path = appAssetPath(assetRoot, c.req.path);
    if (path === null) return notFound(c);
    const cfg = config();
    const cacheControl =
      `public, max-age=${cfg.STATIC_ASSET_MAX_AGE_SEC}, immutable, ` +
      `stale-if-error=${cfg.STATIC_STALE_IF_ERROR_SEC}`;
    return (
      (await sendFile(c, { path, contentType: contentTypeOf(path), cacheControl, precompressed: true })) ??
      notFound(c)
    );
  });
  app.get('/', html);
  app.get(`/:code{[0-9]{${config().ENTRY_CODE_DIGITS}}}`, html);
  app.get('/t', html);
  app.get('/t/*', html);
  app.get('/privacy', html);
  return app;
};
