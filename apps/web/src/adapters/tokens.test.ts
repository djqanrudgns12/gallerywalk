import { sha256Hex as sha256HexPure } from '@gallery/core/layout';
import { describe, expect, it, vi } from 'vitest';
import { base64url, createTokenTools, isTokenText, randomUuid, type CryptoLike } from './tokens.ts';

const bytes = (s: string) => new TextEncoder().encode(s);

/** NIST FIPS 180-2 부록 B 표준 벡터 */
const VECTORS: readonly (readonly [string, string])[] = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
];

describe('base64url', () => {
  it('RFC 4648 §10 벡터(채움 없이)', () => {
    expect(base64url(bytes(''))).toBe('');
    expect(base64url(bytes('f'))).toBe('Zg');
    expect(base64url(bytes('fo'))).toBe('Zm8');
    expect(base64url(bytes('foo'))).toBe('Zm9v');
    expect(base64url(bytes('foob'))).toBe('Zm9vYg');
    expect(base64url(bytes('fooba'))).toBe('Zm9vYmE');
    expect(base64url(bytes('foobar'))).toBe('Zm9vYmFy');
  });

  it('주소에 안전한 글자(+ / 대신 - _)', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_');
    expect(base64url(new Uint8Array([0xff, 0xff]))).toBe('__8');
  });
});

describe('createTokenTools', () => {
  const tools = createTokenTools();

  it('newToken: 32바이트를 받아 base64url 43자', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const token = tools.newToken();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]?.[0] as Uint8Array).byteLength).toBe(32);
    spy.mockRestore();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tools.isToken(token)).toBe(true);
  });

  it('newToken: 같은 바이트면 같은 글, 매번 다른 바이트면 다른 글', () => {
    const fixed: CryptoLike = {
      getRandomValues: a => {
        a.fill(0xab);
        return a;
      },
    };
    const t = createTokenTools(fixed).newToken();
    expect(t).toBe(base64url(new Uint8Array(32).fill(0xab)));
    expect(t).toHaveLength(43);
    const many = new Set(Array.from({ length: 50 }, () => tools.newToken()));
    expect(many.size).toBe(50);
  });

  it('isToken: 길이·글자가 다르면 아님', () => {
    expect(isTokenText('A'.repeat(43))).toBe(true);
    expect(isTokenText('A'.repeat(42))).toBe(false);
    expect(isTokenText('A'.repeat(44))).toBe(false);
    expect(isTokenText(`${'A'.repeat(42)}+`)).toBe(false);
    expect(isTokenText(`${'A'.repeat(42)}=`)).toBe(false);
  });

  it('sha256Hex: 표준 벡터(Web Crypto)', async () => {
    for (const [text, hex] of VECTORS) expect(await tools.sha256Hex(text)).toBe(hex);
  });

  it('sha256Hex: 한글·4바이트 글자도 UTF-8로 해시해 core 순수 구현과 같다', async () => {
    const samples = ['선생님 링크', 'é', '\u{20000}', tools.newToken(), 'x'.repeat(1000)];
    for (const s of samples) {
      const hex = await tools.sha256Hex(s);
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
      expect(hex).toBe(sha256HexPure(s));
    }
  });

  it('sha256Hex: crypto.subtle이 없는 출처(http 개발 주소)에서도 같은 값', async () => {
    const insecure: CryptoLike = { getRandomValues: a => globalThis.crypto.getRandomValues(a) };
    const fallback = createTokenTools(insecure);
    for (const [text, hex] of VECTORS) expect(await fallback.sha256Hex(text)).toBe(hex);
  });
});

describe('randomUuid', () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('randomUUID가 있으면 그것', () => {
    expect(randomUuid()).toMatch(V4);
  });

  it('randomUUID가 없으면 getRandomValues로 v4 모양', () => {
    const noUuid: CryptoLike = { getRandomValues: a => globalThis.crypto.getRandomValues(a) };
    for (let i = 0; i < 20; i++) expect(randomUuid(noUuid)).toMatch(V4);
    const zeros: CryptoLike = {
      getRandomValues: a => {
        a.fill(0);
        return a;
      },
    };
    expect(randomUuid(zeros)).toBe('00000000-0000-4000-8000-000000000000');
  });
});
