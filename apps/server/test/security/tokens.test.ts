import { createHash } from 'node:crypto';
import { TokenHashSchema } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { bearerToken, hashEquals, isTokenText, tokenHash } from '../../src/security/tokens.ts';
import { randomToken } from './support.ts';

/** 토큰 해시·Bearer 읽기·상수 시간 비교(PLAN §11.1, ADR-025). 토큰은 시험마다 새 난수. */

describe('토큰 해시', () => {
  it('SHA-256 소문자 16진(FIPS 180-2 예시 "abc")', () => {
    expect(tokenHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('토큰 글의 UTF-8 바이트 해시 — 기기가 보내는 `…TokenHash`와 같은 모양', () => {
    const token = randomToken();
    expect(isTokenText(token)).toBe(true);
    const hash = tokenHash(token);
    expect(hash).toBe(createHash('sha256').update(Buffer.from(token, 'utf8')).digest('hex'));
    expect(TokenHashSchema.safeParse(hash).success).toBe(true);
    expect(hash).not.toContain(token);
  });
});

describe('Bearer 머리', () => {
  it('Bearer + 토큰 모양만 꺼낸다(방식 이름 대소문자·앞뒤 공백 무관)', () => {
    const token = randomToken();
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`bearer ${token}`)).toBe(token);
    expect(bearerToken(`  BEARER   ${token}  `)).toBe(token);
  });

  it.each([
    ['없음', undefined],
    ['빈 값', ''],
    ['Basic', `Basic ${randomToken()}`],
    ['토큰 없음', 'Bearer'],
    ['짧은 토큰', 'Bearer abc'],
    ['긴 토큰', `Bearer ${randomToken()}x`],
    ['base64 채움', `Bearer ${randomToken().slice(0, 42)}=`],
    ['토큰 둘', `Bearer ${randomToken()} ${randomToken()}`],
  ])('%s → null', (_name, header) => {
    expect(bearerToken(header)).toBeNull();
  });
});

describe('상수 시간 비교', () => {
  it('같으면 참, 한 글자라도 다르거나 길이가 다르면 거짓', () => {
    const hash = tokenHash(randomToken());
    expect(hashEquals(hash, `${hash}`)).toBe(true);
    const flipped = `${hash.slice(0, -1)}${hash.endsWith('0') ? '1' : '0'}`;
    expect(hashEquals(hash, flipped)).toBe(false);
    expect(hashEquals(hash, hash.slice(1))).toBe(false);
    expect(hashEquals('', '')).toBe(true);
  });
});
