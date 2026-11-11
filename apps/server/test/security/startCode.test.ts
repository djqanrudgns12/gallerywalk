import { randomInt, randomUUID } from 'node:crypto';
import { AppError } from '@gallery/core/errors';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExhibition } from '../../src/application/exhibitions.ts';
import { loadEnv } from '../../src/env.ts';
import { createSecurity, type ServerSecurity } from '../../src/security/index.ts';
import { pinHmac } from '../../src/security/pin.ts';
import {
  readStartCodeDigest,
  START_CODE_META_KEY,
  startCodeDigest,
  storeStartCode,
} from '../../src/security/startCode.ts';
import { tokenHash } from '../../src/security/tokens.ts';
import type { Db } from '../../src/store/db.ts';
import { testEnvSource } from '../helpers/server.ts';
import { sqliteTestDeps, type TestDeps } from '../support/sqliteDeps.ts';
import {
  fakeClock,
  randomDeviceId,
  randomStrongPin,
  randomToken,
  storedText,
  tempDb,
  type TempDb,
} from './support.ts';

/**
 * 시작 코드(ADR-048)·시작 코드 기기·보안 포트(`createSecurity`). 코드·PIN·비밀값은 시험 안에서 만든 난수.
 */

const randomCode = (): string => String(randomInt(10_000_000, 100_000_000));

let t: TempDb;
let time: ReturnType<typeof fakeClock>;
let security: ServerSecurity;

const identify = (headers: Record<string, string>) =>
  security.identify({ header: name => headers[name.toLowerCase()] });

beforeEach(async () => {
  t = await tempDb();
  time = fakeClock();
  security = createSecurity(t.env, { db: t.db, clock: time.clock });
});

afterEach(async () => {
  await t.close();
});

describe('시작 코드', () => {
  it('저장값이 없으면 어떤 코드도 맞지 않는다', () => {
    expect(readStartCodeDigest(t.db)).toBeNull();
    expect(security.startCodeOk(randomCode())).toBe(false);
    expect(security.startCodeOk('')).toBe(false);
  });

  it('HMAC만 저장하고, 맞는 코드만 통과, 저장값을 바꾸면 바로 따른다', () => {
    const code = randomCode();
    storeStartCode(t.db, t.env.secrets.startCodeHmac, code);
    const stored = readStartCodeDigest(t.db);
    expect(stored).toBe(startCodeDigest(t.env.secrets.startCodeHmac, code));
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(storedText(t.db)).not.toContain(code);
    expect(security.startCodeOk(code)).toBe(true);
    expect(security.startCodeOk(`${code}0`)).toBe(false);
    expect(security.startCodeOk(code.slice(1))).toBe(false);
    let next = randomCode();
    while (next === code) next = randomCode();
    storeStartCode(t.db, t.env.secrets.startCodeHmac, next);
    expect(security.startCodeOk(code)).toBe(false);
    expect(security.startCodeOk(next)).toBe(true);
  });

  it('START_CODE_HMAC 비밀이 다르면 같은 코드도 맞지 않는다', () => {
    const code = randomCode();
    storeStartCode(t.db, t.env.secrets.startCodeHmac, code);
    const otherEnv = loadEnv(testEnvSource(t.root));
    const other = createSecurity(otherEnv, { db: t.db, clock: time.clock });
    expect(other.startCodeOk(code)).toBe(false);
  });

  it('숫자가 아닌 코드는 저장하지 않고, 모양이 틀린 저장값은 없는 것으로', () => {
    expect(() => storeStartCode(t.db, t.env.secrets.startCodeHmac, 'abc')).toThrow();
    expect(() => storeStartCode(t.db, t.env.secrets.startCodeHmac, '')).toThrow();
    t.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(START_CODE_META_KEY, 'not-a-digest');
    expect(readStartCodeDigest(t.db)).toBeNull();
    expect(security.startCodeOk('not-a-digest')).toBe(false);
  });
});

describe('시작 코드 기기', () => {
  it('이름 있는 기기만 남기고(원문 기기 ID 없이), 다시 남겨도 하나', () => {
    const deviceId = randomDeviceId();
    const me = identify({ 'x-device-id': deviceId });
    expect(security.devices.isRegistered(me)).toBe(false);
    expect(security.devices.register(me)).toBe(true);
    expect(security.devices.register(me)).toBe(true);
    expect(security.devices.isRegistered(me)).toBe(true);
    expect(security.devices.isRegistered(identify({ 'x-device-id': randomDeviceId() }))).toBe(false);
    const rows = t.db.prepare('SELECT device_hash, registered_at FROM teacher_devices').all();
    expect(rows).toEqual([{ device_hash: me.device, registered_at: time.at() }]);
    expect(storedText(t.db)).not.toContain(deviceId);
  });

  it('이름 없는 기기(머리 없음·형식 틀림)는 남기지 않는다 — 같은 IP의 다른 기기가 코드 없이 만들지 못하게', () => {
    const anon = identify({});
    const malformed = identify({ 'x-device-id': 'not-a-uuid' });
    expect(security.devices.register(anon)).toBe(false);
    expect(security.devices.register(malformed)).toBe(false);
    expect(security.devices.isRegistered(anon)).toBe(false);
    expect(t.db.prepare('SELECT count(*) FROM teacher_devices').pluck().get()).toBe(0);
  });
});

describe('보안 포트로 전시 만들기', () => {
  let s: TestDeps & { readonly db: Db };
  let port: ServerSecurity;

  beforeEach(() => {
    s = sqliteTestDeps();
    port = createSecurity(t.env, { db: s.db, clock: s.deps.clock });
  });

  afterEach(() => {
    s.close();
  });

  const body = (pin: string, startCode?: string) => ({
    exhibitionId: randomUUID(),
    title: '시험 전시',
    templateId: 'modern-history' as const,
    pin,
    linkTokenHash: tokenHash(randomToken()),
    ...(startCode === undefined ? {} : { startCode }),
  });

  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (err) {
      if (err instanceof AppError) return err.code;
      throw err;
    }
    return undefined;
  };

  it('쉬운 PIN 거절, 시작 코드 확인, PIN은 PIN_HMAC_SECRET의 HMAC으로 저장', () => {
    const deps = { ...s.deps, security: port };
    const code = randomCode();
    storeStartCode(s.db, t.env.secrets.startCodeHmac, code);
    expect(codeOf(() => createExhibition(deps, body(randomStrongPin()), { deviceRegistered: false }))).toBe(
      'E_START_CODE',
    );
    expect(
      codeOf(() => createExhibition(deps, body(randomStrongPin(), `${code}1`), { deviceRegistered: false })),
    ).toBe('E_START_CODE');
    expect(codeOf(() => createExhibition(deps, body('123123', code), { deviceRegistered: false }))).toBe(
      'E_PIN_WEAK',
    );
    const pin = randomStrongPin();
    const input = body(pin, code);
    const created = createExhibition(deps, input, { deviceRegistered: false });
    expect(created.registerDevice).toBe(true);
    const row = s.store.exhibitions.get(input.exhibitionId);
    expect(row?.pinHmac).toBe(pinHmac(t.env.secrets.pinHmac, pin));
    expect(port.pinHmac(pin)).toBe(row?.pinHmac);
    expect(codeOf(() => createExhibition(deps, body(pin), { deviceRegistered: true }))).toBe('E_PIN_TAKEN');
  });
});
