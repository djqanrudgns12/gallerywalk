import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { config } from '@gallery/core/config';
import { ApiErrorSchema } from '@gallery/core/types';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExhibition } from '../../src/application/exhibitions.ts';
import { errorHandler, notFoundHandler } from '../../src/http/middleware/errors.ts';
import { requestId } from '../../src/http/middleware/requestId.ts';
import { publicRoutes } from '../../src/http/routes/public.ts';
import type { AppEnv } from '../../src/http/types.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import type { Deps } from '../../src/ports/index.ts';
import { createSecurity } from '../../src/security/index.ts';
import { tokenHash } from '../../src/security/tokens.ts';
import type { Db } from '../../src/store/db.ts';
import { sqliteTestDeps, type TestDeps } from '../support/sqliteDeps.ts';
import { randomDeviceId, randomStrongPin, randomToken, tempDb, type TempDb } from '../security/support.ts';

/**
 * 학생 경로 속도 칸(PLAN §9.2 학생 표, ADR-062): 기기·IP·방문자 칸, 틀린 입장 코드 IP 칸. 보안 묶음이 없으면 세지 않는다.
 * 기기 ID·토큰·IP는 시험 안에서 만든 난수·문서용 주소.
 */

const IP_A = '203.0.113.7';
const IP_B = '198.51.100.9';

let t: TempDb;
let s: TestDeps & { readonly db: Db };
let deps: Deps;
let log: Logger;
let app: Hono<AppEnv>;
let code: string;

const mount = (withSecurity: boolean): Hono<AppEnv> => {
  const a = new Hono<AppEnv>();
  a.use('*', requestId(log));
  a.route(
    '/',
    publicRoutes(deps, withSecurity ? createSecurity(t.env, { db: s.db, clock: s.deps.clock }) : undefined),
  );
  a.notFound(notFoundHandler);
  a.onError(errorHandler(log));
  return a;
};

beforeEach(async () => {
  t = await tempDb();
  s = sqliteTestDeps();
  deps = { ...s.deps, security: createSecurity(t.env, { db: s.db, clock: s.deps.clock }) };
  log = createLogger({ dir: join(t.root, 'logs'), keepFiles: 1 });
  const exhibitionId = randomUUID();
  createExhibition(
    deps,
    {
      exhibitionId,
      title: '시험 전시',
      templateId: 'modern-history',
      pin: randomStrongPin(),
      linkTokenHash: tokenHash(randomToken()),
    },
    { deviceRegistered: true },
  );
  code = deps.store.exhibitions.get(exhibitionId)!.entryCode;
  app = mount(true);
});

afterEach(async () => {
  log.close();
  s.close();
  await t.close();
});

const get = (path: string, ip: string, device: string) =>
  app.request(path, { headers: { 'x-gw-viewer-ip': ip, 'x-device-id': device } });
const codeOf = async (res: Response): Promise<string> => ApiErrorSchema.parse(await res.json()).error.code;

/** 한도와 다른 값이면서 형식은 맞는 6자리(없는 코드) */
const missingCode = (i: number): string => {
  const n = (Number(code) + 1 + i) % 1_000_000;
  return String(n === 0 ? 1 : n).padStart(config().ENTRY_CODE_DIGITS, '0');
};

describe('학생 경로 속도 칸', () => {
  it('버전 확인: 기기마다 한도까지 받고 넘으면 429 + Retry-After, 다른 기기는 따로 센다', async () => {
    const [max] = config().PUBLIC_RATE.versionDevice;
    const device = randomDeviceId();
    for (let i = 0; i < max; i++) expect((await get(`/api/e/${code}/v`, IP_A, device)).status).not.toBe(429);
    const over = await get(`/api/e/${code}/v`, IP_A, device);
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await codeOf(over)).toBe('E_RATE_LIMITED');
    expect((await get(`/api/e/${code}/v`, IP_A, randomDeviceId())).status).not.toBe(429);
  });

  it('틀린 입장 코드를 IP 한도만큼 넣으면 그 IP는 있는 코드도 막힌다(다른 IP는 그대로)', async () => {
    const [max] = config().PUBLIC_RATE.badCodeIp;
    // 기기 칸(분당)에 먼저 걸리지 않게 요청마다 새 기기
    for (let i = 0; i < max; i++) {
      const res = await get(`/api/e/${missingCode(i)}`, IP_A, randomDeviceId());
      expect(res.status).toBe(404);
    }
    const blocked = await get(`/api/e/${code}`, IP_A, randomDeviceId());
    expect(blocked.status).toBe(429);
    expect(await codeOf(blocked)).toBe('E_RATE_LIMITED');
    // 준비 중 전시 → 막히지 않은 IP는 원래 답(409)
    const other = await get(`/api/e/${code}`, IP_B, randomDeviceId());
    expect(await codeOf(other)).toBe('E_EXHIBITION_DRAFT');
  });

  it('별명 바꾸기: 방문자(토큰)마다 한도, 넘으면 429', async () => {
    const [max] = config().PUBLIC_RATE.renameVisitor;
    const token = randomToken();
    const patch = (tok: string) =>
      app.request(`/api/e/${code}/visitor`, {
        method: 'PATCH',
        headers: {
          'x-gw-viewer-ip': IP_A,
          'x-device-id': randomDeviceId(),
          authorization: `Bearer ${tok}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ nickname: '구름' }),
      });
    for (let i = 0; i < max; i++) expect((await patch(token)).status).not.toBe(429);
    expect((await patch(token)).status).toBe(429);
    expect((await patch(randomToken())).status).not.toBe(429);
  });

  it('보안 묶음이 없으면(시험용 앱) 세지 않는다', async () => {
    app = mount(false);
    const [max] = config().PUBLIC_RATE.versionDevice;
    const device = randomDeviceId();
    for (let i = 0; i <= max; i++) expect((await get(`/api/e/${code}/v`, IP_A, device)).status).not.toBe(429);
  });
});
