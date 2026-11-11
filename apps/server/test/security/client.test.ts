import { rm } from 'node:fs/promises';
import { overrideConfig, resetConfig } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { ApiErrorSchema } from '@gallery/core/types';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/http/middleware/errors.ts';
import type { AppEnv } from '../../src/http/types.ts';
import { createLogger } from '../../src/log.ts';
import {
  clientRequestOf,
  createClientKeys,
  DEVICE_ID_HEADER,
  identifyClient,
  type ClientRequest,
} from '../../src/security/client.ts';
import { makeTempDir } from '../helpers/server.ts';
import { randomDeviceId, randomKey } from './support.ts';

/**
 * 사용자 IP·기기 구분(PLAN §11.2·§11.3): 믿는 머리 하나, `X-Forwarded-For` 무시, IPv6 /64, 운영에서 머리 없음 거절,
 * 기기 머리 없음·형식 틀림 → 그 IP의 이름 없는 기기 칸 하나. IP는 문서용 주소만 쓴다.
 */

const VIEWER = 'x-gw-viewer-ip';

const request = (headers: Record<string, string>, remoteAddress?: string): ClientRequest => {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { header: name => lower.get(name.toLowerCase()), remoteAddress };
};

const errorCodeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return `${err.code}:${err.fields?.['_'] ?? ''}`;
    throw err;
  }
  return undefined;
};

afterEach(() => resetConfig());

describe('사용자 IP', () => {
  it('믿는 머리의 IP로 칸 키를 만든다(앞뒤 공백 무관)', () => {
    const keys = createClientKeys(randomKey());
    const id = identifyClient(request({ [VIEWER]: ' 203.0.113.7 ' }, '127.0.0.1'), keys, true);
    expect(id.ip).toBe(keys.ip('203.0.113.7'));
  });

  it('X-Forwarded-For는 믿지 않는다: 운영은 거절, 개발은 소켓 주소', () => {
    const keys = createClientKeys(randomKey());
    const xff = { 'x-forwarded-for': '203.0.113.7' };
    expect(errorCodeOf(() => identifyClient(request(xff, '127.0.0.1'), keys, true))).toBe(
      'E_VALIDATION:client_ip',
    );
    const dev = identifyClient(request(xff, '127.0.0.1'), keys, false);
    expect(dev.ip).toBe(keys.ip('127.0.0.1'));
    expect(dev.ip).not.toBe(keys.ip('203.0.113.7'));
  });

  it('운영에서 머리가 없거나 IP가 아니거나 여럿이면 거절', () => {
    const keys = createClientKeys(randomKey());
    for (const headers of [{}, { [VIEWER]: 'nope' }, { [VIEWER]: '203.0.113.7, 198.51.100.4' }]) {
      expect(errorCodeOf(() => identifyClient(request(headers, '127.0.0.1'), keys, true))).toBe(
        'E_VALIDATION:client_ip',
      );
    }
  });

  it('개발은 머리가 없으면 소켓 주소, 소켓 주소도 없으면 127.0.0.1', () => {
    const keys = createClientKeys(randomKey());
    expect(identifyClient(request({}, '::1'), keys, false).ip).toBe(keys.ip('::1'));
    expect(identifyClient(request({ [VIEWER]: 'nope' }), keys, false).ip).toBe(keys.ip('127.0.0.1'));
    expect(identifyClient(request({}), keys, false).ip).toBe(keys.ip('127.0.0.1'));
  });

  it('IPv6는 /64로 묶고, ::ffff: IPv4는 IPv4와 같은 칸', () => {
    const keys = createClientKeys(randomKey());
    const ipOf = (ip: string) => identifyClient(request({ [VIEWER]: ip }), keys, true).ip;
    expect(ipOf('2001:db8:1:2::1')).toBe(ipOf('2001:db8:1:2:ffff::9'));
    expect(ipOf('2001:db8:1:2::1')).not.toBe(ipOf('2001:db8:1:3::1'));
    expect(ipOf('::ffff:203.0.113.7')).toBe(ipOf('203.0.113.7'));
  });

  it('CLIENT_IP_HEADER를 바꾸면 그 머리 하나만 본다', () => {
    overrideConfig({ CLIENT_IP_HEADER: 'cf-connecting-ip' });
    const keys = createClientKeys(randomKey());
    const both = { 'CF-Connecting-IP': '198.51.100.4', [VIEWER]: '203.0.113.7' };
    expect(identifyClient(request(both), keys, true).ip).toBe(keys.ip('198.51.100.4'));
    expect(errorCodeOf(() => identifyClient(request({ [VIEWER]: '203.0.113.7' }), keys, true))).toBe(
      'E_VALIDATION:client_ip',
    );
  });
});

describe('기기 구분', () => {
  it('머리 없음·형식 틀림은 그 IP의 이름 없는 기기 칸 하나', () => {
    const keys = createClientKeys(randomKey());
    const ip = { [VIEWER]: '203.0.113.7' };
    const none = identifyClient(request(ip), keys, true);
    expect(none.namedDevice).toBe(false);
    for (const bad of ['', 'not-a-uuid', `${randomDeviceId()}x`, randomDeviceId().replaceAll('-', '')]) {
      const id = identifyClient(request({ ...ip, [DEVICE_ID_HEADER]: bad }), keys, true);
      expect(id.namedDevice).toBe(false);
      expect(id.device).toBe(none.device);
    }
    const otherIp = identifyClient(request({ [VIEWER]: '198.51.100.4' }), keys, true);
    expect(otherIp.device).not.toBe(none.device);
    const sameV6 = (ip6: string) => identifyClient(request({ [VIEWER]: ip6 }), keys, true).device;
    expect(sameV6('2001:db8:1:2::1')).toBe(sameV6('2001:db8:1:2::abcd'));
  });

  it('맞는 UUID는 이름 있는 기기: IP와 상관없이 같은 칸, 대소문자 무관, 이름 없는 칸과 다름', () => {
    const keys = createClientKeys(randomKey());
    const deviceId = randomDeviceId();
    const a = identifyClient(request({ [VIEWER]: '203.0.113.7', 'X-Device-Id': deviceId }), keys, true);
    const b = identifyClient(
      request({ [VIEWER]: '198.51.100.4', 'X-Device-Id': deviceId.toUpperCase() }),
      keys,
      true,
    );
    const anon = identifyClient(request({ [VIEWER]: '203.0.113.7' }), keys, true);
    const other = identifyClient(
      request({ [VIEWER]: '203.0.113.7', 'X-Device-Id': randomDeviceId() }),
      keys,
      true,
    );
    expect(a.namedDevice).toBe(true);
    expect(b.device).toBe(a.device);
    expect(a.device).not.toBe(anon.device);
    expect(other.device).not.toBe(a.device);
    expect(a.ip).not.toBe(b.ip);
  });

  it('칸 키에는 IP·기기 ID 원문이 없고, 비밀이 다르면 키가 다르다', () => {
    const deviceId = randomDeviceId();
    const req = request({ [VIEWER]: '203.0.113.7', [DEVICE_ID_HEADER]: deviceId });
    const one = identifyClient(req, createClientKeys(randomKey()), true);
    const two = identifyClient(req, createClientKeys(randomKey()), true);
    for (const key of [one.ip, one.device]) {
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(key).not.toContain('203.0.113');
      expect(key).not.toContain(deviceId);
    }
    expect(two.ip).not.toBe(one.ip);
    expect(two.device).not.toBe(one.device);
  });
});

describe('Hono 요청', () => {
  it('`app.request()`(Node 요청 없음)에서도 머리를 읽고, 운영에서 머리가 없으면 400 E_VALIDATION', async () => {
    const root = await makeTempDir();
    const log = createLogger({ dir: root, keepFiles: 1 });
    try {
      const keys = createClientKeys(randomKey());
      const app = new Hono<AppEnv>();
      app.get('/who', c => {
        const id = identifyClient(clientRequestOf(c), keys, true);
        return c.json({ same: id.ip === keys.ip('203.0.113.7'), named: id.namedDevice });
      });
      app.onError(errorHandler(log));
      const ok = await app.request('/who', {
        headers: { [VIEWER]: '203.0.113.7', [DEVICE_ID_HEADER]: randomDeviceId() },
      });
      expect(await ok.json()).toEqual({ same: true, named: true });
      const refused = await app.request('/who', { headers: { 'x-forwarded-for': '203.0.113.7' } });
      expect(refused.status).toBe(400);
      const body = ApiErrorSchema.parse(await refused.json());
      expect(body.error.code).toBe('E_VALIDATION');
      expect(body.error.fields).toEqual({ _: 'client_ip' });
    } finally {
      log.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
