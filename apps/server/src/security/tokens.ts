import { createHash, createHmac, createSecretKey, KeyObject, timingSafeEqual } from 'node:crypto';

/**
 * 토큰 해시와 비교(PLAN §11.1, ADR-025). 선생님 링크·PIN 세션·방문자 토큰은 기기가 만든 256비트(base64url 43자)이고,
 * 서버는 토큰 글의 UTF-8 바이트 SHA-256(소문자 16진)만 저장한다 — 기기(`apps/web/src/adapters/tokens.ts`)와 같은 식.
 * HMAC 키 다루기(`KeySource` → `KeyObject`)도 여기 한 곳에 둔다(PIN·시작 코드·칸 키가 함께 쓴다).
 */

/** `env.secrets.*`(`Secret`)와 같은 모양 — 바이트는 한 번만 꺼내 `KeyObject`로 둔다 */
export interface KeySource {
  bytes(): Buffer;
}

/** 비밀값 → HMAC 키. 이미 `KeyObject`면 그대로 */
export const hmacKey = (secret: KeySource | KeyObject): KeyObject =>
  secret instanceof KeyObject ? secret : createSecretKey(secret.bytes());

/** HMAC-SHA256, 소문자 16진 */
export const hmacHex = (key: KeyObject, text: string): string =>
  createHmac('sha256', key).update(text, 'utf8').digest('hex');

/** 기기가 만드는 토큰 모양(base64url 43자 = 256비트, 채움 `=` 없음) */
const TOKEN_TEXT = /^[A-Za-z0-9_-]{43}$/;

/** `Authorization: Bearer {토큰}` — 방식 이름은 대소문자를 가리지 않는다(RFC 9110 §11.1) */
const BEARER = /^bearer +(\S+)$/i;

export const isTokenText = (value: string): boolean => TOKEN_TEXT.test(value);

/** 받은 토큰 원문 → SHA-256 소문자 16진(저장·조회 키) */
export const tokenHash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * `Authorization` 머리에서 토큰 원문을 꺼낸다. 머리가 없거나, Bearer가 아니거나, 토큰 모양이 아니면 `null`.
 * 원문은 해시를 만든 뒤 버린다(기록·오류에 넣지 않는다).
 */
export const bearerToken = (header: string | undefined): string | null => {
  const match = BEARER.exec(header?.trim() ?? '');
  const token = match?.[1];
  return token !== undefined && isTokenText(token) ? token : null;
};

/**
 * 해시 글 두 개를 상수 시간으로 비교한다. 길이가 다르면 바로 `false`(해시 길이는 공개된 값이라 새는 것이 없다).
 */
export const hashEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};
