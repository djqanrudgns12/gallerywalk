import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, overrideConfig, resetConfig } from '@gallery/core/config';
import { ApiErrorSchema, LiveStatsSchema, okEnvelope, type DeviceReport } from '@gallery/core/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDeviceDiag } from '../../src/application/diag.ts';
import { createExhibition } from '../../src/application/exhibitions.ts';
import { createDeviceReportFiles, type DeviceReportFileWriter } from '../../src/deps.ts';
import { createApp } from '../../src/http/app.ts';
import { createLifecycle } from '../../src/http/lifecycle.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import type { LiveAudience } from '../../src/live/hub.ts';
import type { Deps, DeviceDiag } from '../../src/ports/index.ts';
import { createSecurity } from '../../src/security/index.ts';
import { tokenHash } from '../../src/security/tokens.ts';
import type { Db } from '../../src/store/db.ts';
import { TEST_JSON_LIMIT_BYTES } from '../helpers/server.ts';
import { randomDeviceId, randomStrongPin, randomToken, tempDb, type TempDb } from '../security/support.ts';
import { sqliteTestDeps, type TestDeps } from '../support/sqliteDeps.ts';

/**
 * 기기 진단(HW-02, ADR-070) `POST /api/e/{code}/diag`와 교사 지금 관람 수 `GET /api/teacher/exhibitions/{id}/live`.
 * 기기 ID·토큰은 시험 안에서 만든 난수, IP는 문서용 주소(RFC 5737), 보고 값은 가상 값. 시계는 가짜(2026-11-11 01:00 UTC).
 */

const IP = '203.0.113.7';
// 요청 머리는 ASCII만 실을 수 있다(ByteString). 파일에 남지 않는지 볼 표지 글을 끝에 붙인다
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-X200) FakeDeviceMarker';
const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

const REPORT: DeviceReport = {
  v: 1,
  platform: 'android',
  osMajor: 14,
  browser: 'samsung',
  device: 'tablet',
  gpu: 'mali',
  memGb: 4,
  net: '4g',
  mode: '3d',
  fallback: null,
  tierStart: 'MEDIUM',
  tierEnd: 'LOW',
  posterMs: 900,
  readyMs: 8200,
  enterMs: 9100,
  firstFrameMs: 9600,
  fpsP50: 41,
  fpsP10: 22,
  frameP95Ms: 48,
  inputP50Ms: 60,
  inputP95Ms: 140,
  inputCount: 30,
  longTasks: 12,
  liveOk: true,
  liveKbps: 6.5,
  peersMax: 14,
  durSec: 300,
};

let t: TempDb;
let s: TestDeps & { readonly db: Db };
let deps: Deps;
let diag: DeviceDiag;
let files: DeviceReportFileWriter;
let reportsDir: string;
let log: Logger;
let app: ReturnType<typeof createApp>;
let exhibitionId: string;
let code: string;
let teacherToken: string;
let audience: Map<string, LiveAudience>;

const newExhibition = (token: string): string => {
  const id = randomUUID();
  createExhibition(
    deps,
    {
      exhibitionId: id,
      title: '시험 전시',
      templateId: 'modern-history',
      pin: randomStrongPin(),
      linkTokenHash: tokenHash(token),
    },
    { deviceRegistered: true },
  );
  return id;
};

beforeEach(async () => {
  t = await tempDb();
  s = sqliteTestDeps();
  const security = createSecurity(t.env, { db: s.db, clock: s.deps.clock });
  reportsDir = join(t.root, 'data', 'reports');
  files = createDeviceReportFiles(reportsDir, { now: s.deps.clock.now });
  diag = createDeviceDiag({ clock: s.deps.clock, files });
  deps = { ...s.deps, security, diag };
  log = createLogger({ dir: join(t.root, 'logs'), keepFiles: 1 });
  teacherToken = randomToken();
  exhibitionId = newExhibition(teacherToken);
  deps.store.exhibitions.update(exhibitionId, { status: 'OPEN', openedAt: s.at() });
  code = deps.store.exhibitions.get(exhibitionId)!.entryCode;
  audience = new Map();
  app = createApp({
    db: s.db,
    log,
    mediaDir: t.root,
    queueLength: () => 0,
    lifecycle: createLifecycle(),
    limits: { jsonBodyMaxBytes: TEST_JSON_LIMIT_BYTES, hstsMaxAgeSec: 31_536_000 },
    useCases: deps,
    teacher: {
      security,
      live: {
        closeExhibition: () => undefined,
        exhibitionCounts: id => audience.get(id) ?? { visitors: 0, teachers: 0 },
      },
    },
  });
});

afterEach(async () => {
  resetConfig();
  await files.settled();
  log.close();
  s.close();
  await t.close();
});

interface Send {
  readonly device?: string;
  readonly ip?: string;
  readonly code?: string;
}

/** 기기처럼 보낸다: `Content-Length`가 있는 JSON(웹은 `fetch keepalive` — 길이를 아는 본문) */
const post = (body: unknown, o: Send = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return app.request(`/api/e/${o.code ?? code}/diag`, {
    method: 'POST',
    headers: {
      [config().CLIENT_IP_HEADER]: o.ip ?? IP,
      'x-device-id': o.device ?? randomDeviceId(),
      'user-agent': UA,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(text)),
    },
    body: text,
  });
};

const failure = async (res: Response) => ({
  status: res.status,
  ...ApiErrorSchema.parse(await res.json()).error,
});

const liveStats = async (token = teacherToken, id = exhibitionId) => {
  const res = await app.request(`/api/teacher/exhibitions/${id}/live`, {
    headers: { [config().CLIENT_IP_HEADER]: IP, authorization: `Bearer ${token}` },
  });
  return { status: res.status, json: (await res.json()) as unknown };
};

const reportFiles = async (): Promise<string[]> => {
  try {
    return (await readdir(reportsDir)).sort();
  } catch {
    return [];
  }
};

describe('진단 받기 POST /api/e/{code}/diag', () => {
  it('fail: 본문 없는 204, 까닭별 수만 메모리에(파일 없음)', async () => {
    const res = await post({ kind: 'fail', reason: 'ready_timeout' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect((await post({ kind: 'fail', reason: 'module_fail' })).status).toBe(204);
    expect((await post({ kind: 'fail', reason: 'ready_timeout' })).status).toBe(204);
    expect(diag.recent(exhibitionId)).toEqual({ light: 3, reasons: { ready_timeout: 2, module_fail: 1 } });
    await files.settled();
    expect(await reportFiles()).toEqual([]);
  });

  it('report: KST 날짜 파일에 한 줄(at·전시 ID·보고) — IP·기기 ID·UA는 없다', async () => {
    const device = randomDeviceId();
    const res = await post({ kind: 'report', report: REPORT }, { device });
    expect(res.status).toBe(204);
    await files.settled();
    // 가짜 시계 2026-11-11 01:00 UTC = 10:00 KST
    expect(await reportFiles()).toEqual(['device-2026-11-11.jsonl']);
    const text = await readFile(join(reportsDir, 'device-2026-11-11.jsonl'), 'utf8');
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ at: '2026-11-11T01:00:00.000Z', exhibitionId, ...REPORT });
    for (const secret of [IP, device, UA, 'Mozilla', teacherToken]) expect(text).not.toContain(secret);
    // 보고는 가벼운 화면 수에 들지 않는다(그 수는 fail만)
    expect(diag.recent(exhibitionId).light).toBe(0);
  });

  it('KST 날짜: 15:00 UTC는 다음 날 파일', async () => {
    s.advance(14 * 60 * MS_PER_MIN); // 15:00 UTC = 다음 날 00:00 KST
    expect((await post({ kind: 'report', report: REPORT })).status).toBe(204);
    await files.settled();
    expect(await reportFiles()).toEqual(['device-2026-11-12.jsonl']);
  });

  it.each([
    ['까닭이 약속 밖', { kind: 'fail', reason: 'unknown' }],
    ['종류가 없음', { reason: 'ready_timeout' }],
    ['fail에 다른 칸', { kind: 'fail', reason: 'ready_timeout', ip: IP }],
    ['보고에 다른 칸(strict)', { kind: 'report', report: { ...REPORT, ua: UA } }],
    ['보고 값 범위 밖', { kind: 'report', report: { ...REPORT, fpsP50: 1000 } }],
    ['깨진 JSON', '{"kind":'],
  ])('형식이 틀리면 400 E_VALIDATION: %s', async (_name, body) => {
    const res = await post(body);
    expect(await failure(res)).toMatchObject({ status: 400, code: 'E_VALIDATION' });
    await files.settled();
    expect(await reportFiles()).toEqual([]);
    expect(diag.recent(exhibitionId).light).toBe(0);
  });

  it('본문이 DEVICE_REPORT_MAX_BYTES를 넘으면 400 E_VALIDATION(body_too_large)', async () => {
    const max = config().DEVICE_REPORT_MAX_BYTES;
    const big = { kind: 'fail', reason: 'ready_timeout', pad: 'x'.repeat(max) };
    expect(await failure(await post(big))).toMatchObject({
      status: 400,
      code: 'E_VALIDATION',
      fields: { _: 'body_too_large' },
    });
    expect(diag.recent(exhibitionId).light).toBe(0);
  });

  it('닫힌 전시 409 E_EXHIBITION_CLOSED, 준비 중 409 E_EXHIBITION_DRAFT, 없는 코드 404 — 세지 않는다', async () => {
    deps.store.exhibitions.update(exhibitionId, { status: 'CLOSED', closedAt: s.at() });
    expect(await failure(await post({ kind: 'fail', reason: 'webgl_none' }))).toMatchObject({
      status: 409,
      code: 'E_EXHIBITION_CLOSED',
    });
    const draft = deps.store.exhibitions.get(newExhibition(randomToken()))!;
    expect(
      await failure(await post({ kind: 'fail', reason: 'webgl_none' }, { code: draft.entryCode })),
    ).toMatchObject({ status: 409, code: 'E_EXHIBITION_DRAFT' });
    const missing = String((Number(code) + 1) % 1_000_000).padStart(config().ENTRY_CODE_DIGITS, '0');
    expect(
      await failure(await post({ kind: 'fail', reason: 'webgl_none' }, { code: missing })),
    ).toMatchObject({ status: 404, code: 'E_NOT_FOUND' });
    expect(await failure(await post({ kind: 'fail', reason: 'webgl_none' }, { code: 'abc' }))).toMatchObject({
      status: 404,
      code: 'E_NOT_FOUND',
    });
    expect(diag.recent(exhibitionId).light).toBe(0);
    expect(diag.recent(draft.id).light).toBe(0);
  });

  it('속도 칸: 기기 칸(diagDevice)이 먼저 그 기기만 막고, 같은 IP의 다른 기기는 받는다', async () => {
    const [max] = config().PUBLIC_RATE.diagDevice;
    const device = randomDeviceId();
    for (let i = 0; i < max; i++)
      expect((await post({ kind: 'fail', reason: 'fps_low' }, { device })).status).toBe(204);
    const over = await post({ kind: 'fail', reason: 'fps_low' }, { device });
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await failure(over)).code).toBe('E_RATE_LIMITED');
    expect((await post({ kind: 'fail', reason: 'fps_low' })).status).toBe(204);
    expect(diag.recent(exhibitionId)).toEqual({ light: max + 1, reasons: { fps_low: max + 1 } });
  });

  it('속도 칸: IP 칸(diagIp)이 차면 그 IP의 새 기기도 막히고, 다른 IP는 받는다', async () => {
    const ipMax = 3;
    // `Config`는 중첩 칸의 숫자 타입을 넓히지 않아(기본값 그대로의 글자 타입) 시험에서만 낮춘 한도를 바꿔 넣는다
    const rate = { ...config().PUBLIC_RATE, diagIp: [ipMax, 600] } as unknown as ReturnType<
      typeof config
    >['PUBLIC_RATE'];
    overrideConfig({ PUBLIC_RATE: rate });
    for (let i = 0; i < ipMax; i++)
      expect((await post({ kind: 'fail', reason: 'chunk_fail' })).status).toBe(204);
    expect((await post({ kind: 'fail', reason: 'chunk_fail' })).status).toBe(429);
    expect((await post({ kind: 'fail', reason: 'chunk_fail' }, { ip: '198.51.100.9' })).status).toBe(204);
  });

  it('창: DIAG_COUNT_WINDOW_MIN분이 지난 수는 버린다', async () => {
    expect((await post({ kind: 'fail', reason: 'context_lost' })).status).toBe(204);
    s.advance((config().DIAG_COUNT_WINDOW_MIN - 1) * MS_PER_MIN);
    expect((await post({ kind: 'fail', reason: 'ready_timeout' })).status).toBe(204);
    expect(diag.recent(exhibitionId)).toEqual({ light: 2, reasons: { ready_timeout: 1, context_lost: 1 } });
    s.advance(MS_PER_MIN);
    expect(diag.recent(exhibitionId)).toEqual({ light: 1, reasons: { ready_timeout: 1 } });
    s.advance(config().DIAG_COUNT_WINDOW_MIN * MS_PER_MIN);
    expect(diag.recent(exhibitionId)).toEqual({ light: 0, reasons: {} });
  });

  it('1분 수: takeMinute()는 그 사이 받은 fail·report 수를 꺼내고 비운다', async () => {
    await post({ kind: 'fail', reason: 'ready_timeout' });
    await post({ kind: 'fail', reason: 'module_fail' });
    await post({ kind: 'report', report: REPORT });
    expect(diag.takeMinute()).toEqual({ fail: 2, report: 1 });
    expect(diag.takeMinute()).toEqual({ fail: 0, report: 0 });
  });
});

describe('보고 파일 보관 DEVICE_REPORT_KEEP_DAYS', () => {
  it('날이 바뀐 뒤 처음 쓸 때 오늘 포함 보관 날보다 오래된 파일만 지운다', async () => {
    await mkdir(reportsDir, { recursive: true });
    // 오늘(KST) 2026-11-11, 보관 14일 → 10-29..11-11을 남기고 10-28 이전은 지움
    overrideConfig({ DEVICE_REPORT_KEEP_DAYS: 14 });
    for (const name of [
      'device-2026-10-27.jsonl',
      'device-2026-10-28.jsonl',
      'device-2026-10-29.jsonl',
      'notes.txt',
    ])
      await writeFile(join(reportsDir, name), '{}\n');
    expect((await post({ kind: 'report', report: REPORT })).status).toBe(204);
    await files.settled();
    expect(await reportFiles()).toEqual(['device-2026-10-29.jsonl', 'device-2026-11-11.jsonl', 'notes.txt']);

    // 같은 날 다시 쓸 때는 보지 않는다(하루 한 번)
    await writeFile(join(reportsDir, 'device-2026-10-01.jsonl'), '{}\n');
    expect((await post({ kind: 'report', report: REPORT })).status).toBe(204);
    await files.settled();
    expect(await reportFiles()).toContain('device-2026-10-01.jsonl');

    // 다음 날 처음 쓸 때 다시 본다 → 10-29도 지난 날이 됨
    s.advance(MS_PER_DAY);
    expect((await post({ kind: 'report', report: REPORT })).status).toBe(204);
    await files.settled();
    expect(await reportFiles()).toEqual(['device-2026-11-11.jsonl', 'device-2026-11-12.jsonl', 'notes.txt']);
  });

  it('쓰기에 실패해도 요청은 성공하고 다음 쓰기는 이어 간다', async () => {
    // 보고 폴더 자리에 파일이 있으면 mkdir·appendFile이 실패한다
    await mkdir(join(t.root, 'data'), { recursive: true });
    await writeFile(reportsDir, 'not a folder');
    expect((await post({ kind: 'report', report: REPORT })).status).toBe(204);
    await files.settled();
    expect(await readFile(reportsDir, 'utf8')).toBe('not a folder');
    await rm(reportsDir);
    expect((await post({ kind: 'report', report: REPORT })).status).toBe(204);
    await files.settled();
    expect(await reportFiles()).toEqual(['device-2026-11-11.jsonl']);
  });
});

describe('교사 지금 관람 수 GET /api/teacher/exhibitions/{id}/live', () => {
  it('인증이 없으면 401 E_AUTH, 다른 전시의 토큰이면 404', async () => {
    const res = await app.request(`/api/teacher/exhibitions/${exhibitionId}/live`, {
      headers: { [config().CLIENT_IP_HEADER]: IP },
    });
    expect(await failure(res)).toMatchObject({ status: 401, code: 'E_AUTH' });
    const other = randomToken();
    newExhibition(other);
    expect((await liveStats(other)).status).toBe(404);
  });

  it('함께 관람 학생·교사 수 + 최근 창 안 가벼운 화면 수(까닭별)', async () => {
    expect(okEnvelope(LiveStatsSchema).parse((await liveStats()).json).data).toEqual({
      visitors: 0,
      teachers: 0,
      light: 0,
      reasons: {},
    });
    audience.set(exhibitionId, { visitors: 27, teachers: 1 });
    await post({ kind: 'fail', reason: 'ready_timeout' });
    await post({ kind: 'fail', reason: 'ready_timeout' });
    await post({ kind: 'fail', reason: 'webgl_none' });
    await post({ kind: 'report', report: REPORT });
    const got = await liveStats();
    expect(got.status).toBe(200);
    expect(okEnvelope(LiveStatsSchema).parse(got.json).data).toEqual({
      visitors: 27,
      teachers: 1,
      light: 3,
      reasons: { ready_timeout: 2, webgl_none: 1 },
    });
    // 토큰·기기 정보는 응답에 없다
    expect(JSON.stringify(got.json)).not.toContain(teacherToken);
  });
});
