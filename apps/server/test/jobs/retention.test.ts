import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExhibition } from '../../src/application/exhibitions.ts';
import { teacherView } from '../../src/application/views.ts';
import { createServerDeps } from '../../src/deps.ts';
import { loadEnv } from '../../src/env.ts';
import { testEnvSource } from '../helpers/server.ts';
import { tempDb } from '../security/support.ts';
import { TEST_STORES, type TestDeps } from '../support/sqliteDeps.ts';

const exhibitionId = '10000000-0000-4000-8000-000000000001';
const body = {
  exhibitionId,
  title: '합성 기간 시험',
  templateId: 'modern-history' as const,
  pin: '58392647',
  linkTokenHash: 'a'.repeat(64),
};

describe.each(TEST_STORES)('분 단위 보관 기간 · $name', ({ make }) => {
  let t: TestDeps;
  beforeEach(() => {
    t = make();
  });
  afterEach(() => t.close());

  it('만들기·멱등 재전송·접근 차단이 같은 분 단위 만료 시각을 사용한다', () => {
    const deps = { ...t.deps, retentionTestMinutes: 2 };
    const created = createExhibition(deps, body, { deviceRegistered: true });
    expect(created.expiresAt).toBe(t.at() + 120_000);
    expect(t.store.exhibitions.get(exhibitionId)?.expiresAt).toBe(created.expiresAt);
    t.advance(119_999);
    expect(teacherView(deps, exhibitionId).exhibition.id).toBe(exhibitionId);
    expect(createExhibition(deps, body, { deviceRegistered: true }).expiresAt).toBe(created.expiresAt);
    t.advance(1);
    expect(() => teacherView(deps, exhibitionId)).toThrowError(
      expect.objectContaining({ code: 'E_NOT_FOUND' }),
    );
  });
});

it('개발 환경의 분 단위 값이 운영 의존성에서 전시 만들기까지 연결된다', async () => {
  const t = await tempDb({ NODE_ENV: 'development', RETENTION_TEST_MINUTES: '3' });
  try {
    const { deps, uploads } = createServerDeps(t.db, t.env);
    const start = deps.clock.now();
    const result = createExhibition(deps, body, { deviceRegistered: true });
    expect(result.expiresAt).toBeGreaterThanOrEqual(start + 180_000);
    expect(result.expiresAt).toBeLessThanOrEqual(deps.clock.now() + 180_000);
    await uploads.drainAll(0);
  } finally {
    await t.close();
  }
});

it('운영에서는 분 단위 시험 모드를 켠 환경 값을 거부한다', () => {
  expect(() =>
    loadEnv(
      testEnvSource('/srv/gallery-test', {
        NODE_ENV: 'production',
        RETENTION_TEST_MINUTES: '2',
      }),
    ),
  ).toThrow('RETENTION_TEST_MINUTES: not allowed in production');
});
