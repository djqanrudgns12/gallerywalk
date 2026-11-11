import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { clientIp, createIpKeyer, createWindowLimiter, ipBucket } from '../../src/live/ip.ts';

/** 함께 관람 IP 규칙(PLAN §11.3): 머리 하나만 믿기, IPv6 /64 묶기, 칸 키는 HMAC. 문서용 주소만 쓴다. */

const HEADER = 'x-gw-viewer-ip';
const req = (headers: Record<string, string | string[]>, remoteAddress?: string) => ({
  headers,
  socket: { remoteAddress },
});
const secret = () => {
  const bytes = randomBytes(32);
  return { bytes: () => Buffer.from(bytes) };
};

describe('함께 관람 IP', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::ffff:cb00:7107', '203.0.113.7'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:0DB8:0001:0002:ffff:0:0:9', '2001:db8:1:2::/64'],
    ['2001:db8::', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['fe80::1%en0', 'fe80:0:0:0::/64'],
    ['64:ff9b::198.51.100.4', '64:ff9b:0:0::/64'],
    ['not-an-ip', null],
    ['203.0.113.300', null],
  ])('묶음: %s → %s', (ip, bucket) => {
    expect(ipBucket(ip)).toBe(bucket);
  });

  it('믿는 머리만 본다: 운영은 없거나 틀리면 null, 개발은 소켓 주소', () => {
    expect(clientIp(req({ [HEADER]: ' 203.0.113.7 ' }, '127.0.0.1'), HEADER, true)).toBe('203.0.113.7');
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7' }, '127.0.0.1'), HEADER, true)).toBeNull();
    expect(clientIp(req({ [HEADER]: '203.0.113.7, 198.51.100.4' }, '127.0.0.1'), HEADER, true)).toBeNull();
    expect(
      clientIp(req({ [HEADER]: ['203.0.113.7', '198.51.100.4'] }, '127.0.0.1'), HEADER, true),
    ).toBeNull();
    expect(clientIp(req({}, '127.0.0.1'), HEADER, false)).toBe('127.0.0.1');
    expect(clientIp(req({ [HEADER]: 'nope' }, '::1'), HEADER, false)).toBe('::1');
    expect(clientIp(req({}, undefined), HEADER, false)).toBeNull();
    expect(clientIp(req({ 'cf-connecting-ip': '198.51.100.4' }), 'CF-Connecting-IP', true)).toBe(
      '198.51.100.4',
    );
  });

  it('칸 키: 같은 묶음은 같은 키, 비밀이 다르면 다른 키, IP 원문이 들어 있지 않다', () => {
    const one = createIpKeyer(secret());
    const two = createIpKeyer(secret());
    const key = one('203.0.113.7');
    expect(key).not.toBeNull();
    expect(key).not.toContain('203.0.113');
    expect(one('::ffff:203.0.113.7')).toBe(key);
    expect(two('203.0.113.7')).not.toBe(key);
    expect(one('2001:db8:1:2::1')).toBe(one('2001:db8:1:2:ffff::9'));
    expect(one('2001:db8:1:2::1')).not.toBe(one('2001:db8:1:3::1'));
    expect(one('nope')).toBeNull();
  });

  it('고정 창 칸: 창 안에서 한도까지, 창이 지나면 새로 세고, 지난 칸은 치운다', () => {
    const limiter = createWindowLimiter(1000);
    expect([0, 10, 20].map(at => limiter.take('k', at, 2))).toEqual([true, true, false]);
    expect(limiter.take('other', 20, 2)).toBe(true);
    expect(limiter.take('k', 999, 2)).toBe(false);
    expect(limiter.take('k', 1000, 2)).toBe(true);
    limiter.sweep(1020);
    expect(limiter.size()).toBe(1);
    limiter.sweep(2000);
    expect(limiter.size()).toBe(0);
  });
});
