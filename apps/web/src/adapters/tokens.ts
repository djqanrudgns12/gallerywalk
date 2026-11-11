import { sha256Hex as sha256HexPure } from '@gallery/core/layout';
import type { TokenTools } from '../ports/index.ts';

/**
 * 토큰 도구(ADR-025, PLAN §11.1): 선생님 링크·PIN 세션·방문자 토큰은 기기가 만든 256비트, 서버는 SHA-256만.
 * 토큰 해시 = 토큰 글(base64url 43자)의 UTF-8 바이트 SHA-256, 소문자 16진 — 서버도 받은 토큰을 같은 방식으로 해시한다.
 *
 * `crypto.subtle`은 보안 출처(HTTPS·localhost)에서만 있다. 개발 중 같은 와이파이의 태블릿으로 `http://{맥 IP}:4522`를 열면
 * 없으므로, 그때는 core의 순수 TS SHA-256(배치 해시와 같은 함수, Node `crypto`와 대조 시험됨)으로 계산한다.
 */

/** 256비트(ADR-025 고정값, 조정할 수치가 아님) */
const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** `newToken()`이 만든 모양인가(base64url 43자) */
export const isTokenText = (value: string): boolean => TOKEN_RE.test(value);

/** 바이트 → base64url(RFC 4648 §5, 채움 `=` 없음) */
export const base64url = (bytes: Uint8Array): string => {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]! + B64URL[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]!;
  }
  return out;
};

const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/** Web Crypto에서 쓰는 것만(시험에서 바꿔 끼움). `subtle`·`randomUUID`는 보안 출처가 아니면 없다 */
export interface CryptoLike {
  getRandomValues<T extends Uint8Array<ArrayBuffer>>(array: T): T;
  readonly subtle?: Pick<SubtleCrypto, 'digest'> | undefined;
  readonly randomUUID?: (() => string) | undefined;
}

/** 무작위 UUID v4(기기 ID). `randomUUID`가 없으면 `getRandomValues`로 RFC 9562 §5.4 모양을 만든다 */
export const randomUuid = (crypto: CryptoLike = globalThis.crypto): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export const createTokenTools = (crypto: CryptoLike = globalThis.crypto): TokenTools => ({
  newToken: () => base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))),
  isToken: isTokenText,
  sha256Hex: async text => {
    const subtle = crypto.subtle;
    if (!subtle) return sha256HexPure(text);
    return toHex(new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text))));
  },
});
