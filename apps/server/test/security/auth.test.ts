import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ApiErrorSchema } from '@gallery/core/types';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExhibition } from '../../src/application/exhibitions.ts';
import { teacherAuth, type TeacherEnv } from '../../src/http/middleware/auth.ts';
import { errorHandler, notFoundHandler } from '../../src/http/middleware/errors.ts';
import { requestId } from '../../src/http/middleware/requestId.ts';
import type { AppEnv } from '../../src/http/types.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import type { Deps } from '../../src/ports/index.ts';
import { clientRequestOf } from '../../src/security/client.ts';
import { createSecurity, type ServerSecurity } from '../../src/security/index.ts';
import { tokenHash } from '../../src/security/tokens.ts';
import type { Db } from '../../src/store/db.ts';
import { sqliteTestDeps, type TestDeps } from '../support/sqliteDeps.ts';
import { randomDeviceId, randomStrongPin, randomToken, readLogs, tempDb, type TempDb } from './support.ts';

/**
 * 교사 인증 미들웨어(임시 SQLite): 맞는 토큰·없는 토큰·지운 세션·만료·지우는 중, `last_used_at` 갱신,
 * 기록에 토큰·IP 원문이 없음. 토큰·PIN·기기 ID는 시험 안에서 만든 난수, IP는 문서용 주소.
 */

const VIEWER_IP = '203.0.113.7';

let t: TempDb;
let s: TestDeps & { readonly db: Db };
let deps: Deps;
let security: ServerSecurity;
let log: Logger;
let logDir: string;
let app: Hono<AppEnv>;
let exhibitionId: string;
let linkToken: string;

beforeEach(async () => {
  t = await tempDb();
  s = sqliteTestDeps();
  security = createSecurity(t.env, { db: s.db, clock: s.deps.clock });
  deps = { ...s.deps, security };
  logDir = join(t.root, 'logs');
  log = createLogger({ dir: logDir, keepFiles: 1 });

  exhibitionId = randomUUID();
  linkToken = randomToken();
  createExhibition(
    deps,
    {
      exhibitionId,
      title: '시험 전시',
      templateId: 'modern-history',
      pin: randomStrongPin(),
      linkTokenHash: tokenHash(linkToken),
    },
    { deviceRegistered: true },
  );

  const teacher = new Hono<TeacherEnv>();
  teacher.use('/api/teacher/*', teacherAuth(deps));
  teacher.get('/api/teacher/me', c => {
    const client = security.identify(clientRequestOf(c));
    return c.json({
      data: { ...c.get('teacher'), named: client.namedDevice },
      requestId: c.get('requestId'),
    });
  });
  app = new Hono<AppEnv>();
  app.use('*', requestId(log));
  app.route('/', teacher);
  app.notFound(notFoundHandler);
  app.onError(errorHandler(log));
});

afterEach(async () => {
  log.close();
  s.close();
  await t.close();
});

const me = (headers: Record<string, string> = {}) =>
  app.request('/api/teacher/me', { headers: { 'x-gw-viewer-ip': VIEWER_IP, ...headers } });

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const errorOf = async (res: Response): Promise<{ status: number; code: string }> => ({
  status: res.status,
  code: ApiErrorSchema.parse(await res.json()).error.code,
});

describe('교사 인증', () => {
  it('맞는 링크 토큰 → 전시 ID·세션 종류가 문맥에, last_used_at 갱신', async () => {
    const hash = tokenHash(linkToken);
    const before = s.store.sessions.get(hash)?.lastUsedAt;
    s.advance(5000);
    const res = await me({ ...bearer(linkToken), 'X-Device-Id': randomDeviceId() });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ data: { exhibitionId, sessionKind: 'LINK', named: true } });
    expect(before).toBeDefined();
    expect(s.store.sessions.get(hash)?.lastUsedAt).toBe(s.at());
    expect(s.store.sessions.get(hash)?.lastUsedAt).not.toBe(before);
  });

  it('PIN 세션 토큰도 같은 길, 종류는 PIN', async () => {
    const pinToken = randomToken();
    s.store.sessions.insert({
      tokenHash: tokenHash(pinToken),
      exhibitionId,
      kind: 'PIN',
      createdAt: s.at(),
      lastUsedAt: s.at(),
    });
    const res = await me(bearer(pinToken));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { exhibitionId, sessionKind: 'PIN', named: false } });
  });

  it.each([
    ['머리 없음', {}],
    ['Bearer 아님', { Authorization: `Basic ${randomToken()}` }],
    ['토큰 모양 아님', { Authorization: 'Bearer not-a-token' }],
    ['해시를 토큰처럼', { Authorization: `Bearer ${'a'.repeat(64)}` }],
    ['모르는 토큰', { Authorization: `Bearer ${randomToken()}` }],
  ])('%s → 401 E_AUTH', async (_name, headers) => {
    expect(await errorOf(await me(headers))).toEqual({ status: 401, code: 'E_AUTH' });
  });

  it('지운 세션(선생님 링크 새로 만들기) → E_AUTH', async () => {
    s.store.sessions.deleteKind(exhibitionId, 'LINK');
    expect(await errorOf(await me(bearer(linkToken)))).toEqual({ status: 401, code: 'E_AUTH' });
  });

  it('만료된 전시 → 404 E_NOT_FOUND, last_used_at은 그대로', async () => {
    const ex = s.store.exhibitions.get(exhibitionId);
    if (!ex) throw new Error('exhibition');
    const before = s.store.sessions.get(tokenHash(linkToken))?.lastUsedAt;
    s.advance(ex.expiresAt - s.at());
    expect(await errorOf(await me(bearer(linkToken)))).toEqual({ status: 404, code: 'E_NOT_FOUND' });
    expect(s.store.sessions.get(tokenHash(linkToken))?.lastUsedAt).toBe(before);
  });

  it('지우는 중인 전시 → 404 E_NOT_FOUND', async () => {
    s.store.exhibitions.update(exhibitionId, { deleting: true });
    expect(await errorOf(await me(bearer(linkToken)))).toEqual({ status: 404, code: 'E_NOT_FOUND' });
  });

  it('기록에 토큰·토큰 해시·IP 원문이 없고, 통과한 요청은 전시 ID가 남는다', async () => {
    const unknown = randomToken();
    await me(bearer(linkToken));
    await me(bearer(unknown));
    await me({ Authorization: `Bearer ${unknown}x` });
    log.close();
    const text = await readLogs(logDir);
    expect(text).toContain(exhibitionId);
    expect(text).toContain('E_AUTH');
    for (const secret of [linkToken, unknown, tokenHash(linkToken), tokenHash(unknown), VIEWER_IP]) {
      expect(text).not.toContain(secret);
    }
  });
});
