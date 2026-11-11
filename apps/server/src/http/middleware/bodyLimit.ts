import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { AppError } from '@gallery/core/errors';
import type { AppEnv } from '../types.ts';

/**
 * 파일 경로(PLAN §9.2)의 multipart 본문은 이 제한을 건너뛴다. 그 경로는 Hono 파서를 쓰지 않고 Node 요청을
 * busboy로 스트리밍하며 `Content-Length`·파일 크기 한도를 따로 지킨다(§9.4, P3-4).
 * 같은 경로라도 JSON(글 작품·PDF 1단계)이면 아래 JSON 한도를 그대로 받는다.
 * 쪽 올리기는 ADR-056의 `/api/teacher/artworks/{aid}/pages/{i}`를 따른다.
 */
const UPLOAD_ROUTES: readonly (readonly [method: string, path: RegExp])[] = [
  ['POST', /^\/api\/teacher\/exhibitions\/[^/]+\/artworks$/],
  ['PUT', /^\/api\/teacher\/exhibitions\/[^/]+\/poster$/],
  ['PUT', /^\/api\/teacher\/rooms\/[^/]+\/bgm$/],
  ['PUT', /^\/api\/teacher\/artworks\/[^/]+\/pages\/[^/]+$/],
];

const MULTIPART = /^multipart\/form-data(?:;|$)/i;

export const isStreamingUpload = (c: Context<AppEnv>): boolean =>
  MULTIPART.test(c.req.header('content-type')?.trim() ?? '') &&
  UPLOAD_ROUTES.some(([method, path]) => method === c.req.method && path.test(c.req.path));

export interface JsonBodyLimitOptions {
  readonly maxBytes: number;
  readonly skip?: (c: Context<AppEnv>) => boolean;
}

/**
 * JSON 본문 한도(PLAN §9.3). 넘으면 `E_VALIDATION`(`fields._ = body_too_large`) — PLAN에 코드가 없어 정한 것:
 * `E_FILE_TOO_LARGE`의 화면 문구는 "파일이 너무 커요"라 JSON 요청에 맞지 않고, 정상 기기는 글자 수 한도(zod·config)에
 * 먼저 걸리므로 이 한도에 닿는 것은 잘못 만든 요청뿐이다. `Content-Length`가 있으면 본문을 읽기 전에 거절하고,
 * 없으면(chunked) 읽으면서 센다.
 */
export const jsonBodyLimit = (options: JsonBodyLimitOptions): MiddlewareHandler<AppEnv> => {
  const skip = options.skip ?? isStreamingUpload;
  const limit = bodyLimit({
    maxSize: options.maxBytes,
    onError: () => {
      throw new AppError('E_VALIDATION', { fields: { _: 'body_too_large' } });
    },
  });
  return async (c, next) => (skip(c) ? next() : limit(c, next));
};
