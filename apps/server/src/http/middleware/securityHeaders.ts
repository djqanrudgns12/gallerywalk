import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.ts';

/**
 * PLAN §11.4 그대로. wasm = KTX2 변환기, 인라인 style = R3F·부품 위치 계산. 외부 출처는 하나도 열지 않는다.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), fullscreen=(self), screen-wake-lock=(self)';

export interface SecurityHeaderOptions {
  /** HSTS `max-age`(초). 상위 도메인 HSTS가 `includeSubDomains`라 하위 도메인도 반드시 HTTPS(§11.4) */
  readonly hstsMaxAgeSec: number;
}

/** 모든 응답(오류·없는 경로 포함)에 보안 머리를 덮어쓴다. */
export const securityHeaders = (options: SecurityHeaderOptions): MiddlewareHandler<AppEnv> => {
  const hsts = `max-age=${Math.trunc(options.hstsMaxAgeSec)}; includeSubDomains`;
  return async (c, next) => {
    await next();
    c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Permissions-Policy', PERMISSIONS_POLICY);
    c.header('Strict-Transport-Security', hsts);
  };
};

/** `/api/*`는 어디에도 캐시하지 않는다(PLAN §9.6). */
export const apiNoStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
};
