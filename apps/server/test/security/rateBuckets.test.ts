import { config, overrideConfig, resetConfig } from '@gallery/core/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClientKeys, type ClientKeys, type SubjectKey } from '../../src/security/client.ts';
import {
  bucketKey,
  createPinGuard,
  createRateBuckets,
  GLOBAL_SUBJECT,
  PIN_BUCKET,
  type PinGuard,
  type PinSubjects,
  type RateBuckets,
} from '../../src/security/rateBuckets.ts';
import { fakeClock, randomDeviceId, randomKey, storedText, tempDb, type TempDb } from './support.ts';

/** `rate_buckets` 고정 창(가짜 시계): 창 경계·잠금 시간·세지 않고 보기·정리, PIN 실패 칸 셋(PLAN §11.2). */

const SEC = 1000;
const MIN = 60 * SEC;

let t: TempDb;
let time: ReturnType<typeof fakeClock>;
let buckets: RateBuckets;
let keys: ClientKeys;

const ipKey = (ip: string): SubjectKey => {
  const key = keys.ip(ip);
  if (key === null) throw new Error(`not an ip: ${ip}`);
  return key;
};

/** 그 IP의 기기 하나(기기 ID를 주지 않으면 새 UUID, `null`이면 머리 없는 기기) */
const subjects = (ip: string, deviceId: string | null = randomDeviceId()): PinSubjects => {
  const device = keys.device(deviceId ?? undefined, ip);
  if (device === null) throw new Error(`not an ip: ${ip}`);
  return { device: device.key, ip: ipKey(ip) };
};

beforeEach(async () => {
  t = await tempDb();
  time = fakeClock();
  buckets = createRateBuckets(t.db, time.clock);
  keys = createClientKeys(randomKey());
});

afterEach(async () => {
  resetConfig();
  await t.close();
});

describe('고정 창', () => {
  it('창 안에서 한도까지 받고, 넘으면 거절, 창이 끝나는 순간 새로 센다', () => {
    const who = ipKey('203.0.113.7');
    const hits = [0, 1, 2].map(() => buckets.hit('entry_ip', who, 3, 60));
    expect(hits.map(h => [h.allowed, h.count])).toEqual([
      [true, 1],
      [true, 2],
      [true, 3],
    ]);
    expect(hits[2]?.retryAfterSec).toBe(60);
    expect(buckets.hit('entry_ip', who, 3, 60)).toEqual({
      allowed: false,
      count: 4,
      lockedUntil: null,
      retryAfterSec: 60,
    });
    time.advance(60 * SEC - 1);
    expect(buckets.hit('entry_ip', who, 3, 60)).toMatchObject({ allowed: false, count: 5, retryAfterSec: 1 });
    time.advance(1);
    expect(buckets.hit('entry_ip', who, 3, 60)).toEqual({
      allowed: true,
      count: 1,
      lockedUntil: null,
      retryAfterSec: 0,
    });
  });

  it('주인·종류마다 따로 세고, 전역 칸은 하나', () => {
    const a = ipKey('203.0.113.7');
    const b = ipKey('198.51.100.4');
    buckets.hit('entry_ip', a, 1, 60);
    expect(buckets.hit('entry_ip', b, 1, 60).allowed).toBe(true);
    expect(buckets.hit('visitor_ip', a, 1, 60).allowed).toBe(true);
    expect(buckets.hit('entry_ip', a, 1, 60).allowed).toBe(false);
    expect(buckets.hit('create', GLOBAL_SUBJECT, 2, 60).count).toBe(1);
    expect(buckets.hit('create', GLOBAL_SUBJECT, 2, 60).count).toBe(2);
    const stored = t.db.prepare('SELECT key FROM rate_buckets').pluck().all();
    expect(new Set(stored)).toEqual(
      new Set([`entry_ip:${a}`, `entry_ip:${b}`, 'global:create', `visitor_ip:${a}`]),
    );
    expect(storedText(t.db)).not.toMatch(/203\.0\.113|198\.51\.100/);
  });

  it('잠금: 한도에 닿으면 그때부터 잠그고, 잠긴 동안은 세지 않고 거절, 풀리면 새 창', () => {
    const who = ipKey('203.0.113.7');
    expect(buckets.hit('pin_x', who, 3, 600, 600).lockedUntil).toBeNull();
    time.advance(5 * SEC);
    expect(buckets.hit('pin_x', who, 3, 600, 600).lockedUntil).toBeNull();
    time.advance(5 * SEC);
    const third = buckets.hit('pin_x', who, 3, 600, 600);
    expect(third).toEqual({
      allowed: true,
      count: 3,
      lockedUntil: time.at() + 600 * SEC,
      retryAfterSec: 600,
    });
    const lockEnd = time.at() + 600 * SEC;
    time.advance(600 * SEC - 1);
    expect(buckets.hit('pin_x', who, 3, 600, 600)).toEqual({
      allowed: false,
      count: 3,
      lockedUntil: lockEnd,
      retryAfterSec: 1,
    });
    expect(buckets.peek('pin_x', who, 3, 600)).toMatchObject({ allowed: false, lockedUntil: lockEnd });
    time.advance(1);
    expect(buckets.hit('pin_x', who, 3, 600, 600)).toEqual({
      allowed: true,
      count: 1,
      lockedUntil: null,
      retryAfterSec: 0,
    });
  });

  it('peek은 세지 않는다', () => {
    const who = ipKey('203.0.113.7');
    expect(buckets.peek('entry_ip', who, 2, 60)).toEqual({
      allowed: true,
      count: 0,
      lockedUntil: null,
      retryAfterSec: 0,
    });
    buckets.hit('entry_ip', who, 2, 60);
    buckets.hit('entry_ip', who, 2, 60);
    time.advance(10 * SEC);
    expect(buckets.peek('entry_ip', who, 2, 60)).toEqual({
      allowed: false,
      count: 2,
      lockedUntil: null,
      retryAfterSec: 50,
    });
    expect(buckets.peek('entry_ip', who, 2, 60).count).toBe(2);
    time.advance(50 * SEC);
    expect(buckets.peek('entry_ip', who, 2, 60)).toMatchObject({ allowed: true, count: 0 });
  });

  it('종류 이름이 틀리면 던진다(칸 키가 섞이지 않게)', () => {
    const who = ipKey('203.0.113.7');
    for (const bad of ['', 'global', 'Pin', 'pin:ip', '1pin']) {
      expect(() => bucketKey(bad, who)).toThrow();
      expect(() => buckets.hit(bad, who, 1, 60)).toThrow();
    }
    expect(bucketKey('pin_ip', who)).toBe(`pin_ip:${who}`);
    expect(bucketKey('pin_global', GLOBAL_SUBJECT)).toBe('global:pin_global');
  });

  it('정리: 창이 지난 칸은 지우고, 잠긴 칸은 잠김이 풀릴 때까지 남긴다', () => {
    const old = ipKey('203.0.113.7');
    const locked = ipKey('198.51.100.4');
    const fresh = ipKey('192.0.2.1');
    buckets.hit('entry_ip', old, 5, 60);
    buckets.hit('pin_x', locked, 1, 60, 3600);
    time.advance(30 * MIN);
    buckets.hit('entry_ip', fresh, 5, 60);
    expect(buckets.sweep(10 * 60)).toBe(1);
    const left = () => new Set(t.db.prepare('SELECT key FROM rate_buckets').pluck().all());
    expect(left()).toEqual(new Set([`entry_ip:${fresh}`, `pin_x:${locked}`]));
    time.advance(30 * MIN);
    expect(buckets.sweep(10 * 60)).toBe(2);
    expect(left()).toEqual(new Set());
  });
});

describe('PIN 실패 칸 셋', () => {
  let guard: PinGuard;
  beforeEach(() => {
    guard = createPinGuard(buckets);
  });

  it('기기: PIN_MAX_FAILS번 틀리면 PIN_LOCK_MIN분 잠금, 같은 IP의 다른 기기는 그대로', () => {
    const me = subjects('203.0.113.7');
    const neighbor = subjects('203.0.113.7');
    const max = config().PIN_MAX_FAILS;
    for (let i = 1; i < max; i++) expect(guard.fail(me).locked).toBe(false);
    const last = guard.fail(me);
    expect(last).toEqual({ locked: true, retryAfterSec: config().PIN_LOCK_MIN * 60, delayMs: 0 });
    expect(guard.check(me).locked).toBe(true);
    expect(guard.check(neighbor).locked).toBe(false);
    time.advance(config().PIN_LOCK_MIN * MIN - 1);
    expect(guard.check(me)).toMatchObject({ locked: true, retryAfterSec: 1 });
    time.advance(1);
    expect(guard.check(me)).toEqual({ locked: false, retryAfterSec: 0, delayMs: 0 });
  });

  it('IP: 여러 기기가 합쳐 PIN_IP_MAX_FAILS번 틀리면 그 IP의 PIN만 잠금', () => {
    const max = config().PIN_IP_MAX_FAILS;
    for (let i = 1; i < max; i++) expect(guard.fail(subjects('203.0.113.7')).locked).toBe(false);
    expect(guard.fail(subjects('203.0.113.7')).locked).toBe(true);
    expect(guard.check(subjects('203.0.113.7'))).toMatchObject({
      locked: true,
      retryAfterSec: config().PIN_LOCK_MIN * 60,
    });
    expect(guard.check(subjects('198.51.100.4')).locked).toBe(false);
  });

  it('이름 없는 기기(머리 없음·형식 틀림)도 기기 칸 기준이 그대로 걸린다', () => {
    const anon = subjects('203.0.113.7', null);
    const malformed = subjects('203.0.113.7', 'not-a-uuid');
    expect(malformed.device).toBe(anon.device);
    for (let i = 0; i < config().PIN_MAX_FAILS; i++) guard.fail(anon);
    expect(guard.check(malformed)).toMatchObject({ locked: true, retryAfterSec: config().PIN_LOCK_MIN * 60 });
    expect(guard.check(subjects('203.0.113.7')).locked).toBe(false);
  });

  it('전역: 창 안 실패가 PIN_GLOBAL_SLOW_AT번이면 모든 PIN 응답을 PIN_GLOBAL_DELAY_MS 늦추고, 창이 지나면 멈춘다', () => {
    const slowAt = config().PIN_GLOBAL_SLOW_AT;
    for (let i = 1; i < slowAt; i++) {
      const gate = guard.fail(subjects(`2001:db8:${i.toString(16)}::1`));
      expect(gate.delayMs).toBe(0);
    }
    expect(guard.check(subjects('203.0.113.7')).delayMs).toBe(0);
    expect(guard.fail(subjects('2001:db8:ffff::1')).delayMs).toBe(config().PIN_GLOBAL_DELAY_MS);
    expect(guard.check(subjects('203.0.113.7'))).toEqual({
      locked: false,
      retryAfterSec: 0,
      delayMs: config().PIN_GLOBAL_DELAY_MS,
    });
    time.advance(config().PIN_LOCK_MIN * MIN);
    expect(guard.check(subjects('203.0.113.7')).delayMs).toBe(0);
  });

  it('숫자는 config.ts에서 온다', () => {
    overrideConfig({ PIN_MAX_FAILS: 2, PIN_LOCK_MIN: 1, PIN_GLOBAL_SLOW_AT: 3, PIN_GLOBAL_DELAY_MS: 50 });
    const me = subjects('203.0.113.7');
    expect(guard.fail(me).locked).toBe(false);
    expect(guard.fail(me)).toEqual({ locked: true, retryAfterSec: 60, delayMs: 0 });
    expect(guard.fail(subjects('198.51.100.4')).delayMs).toBe(50);
    const row = t.db
      .prepare('SELECT count FROM rate_buckets WHERE key = ?')
      .pluck()
      .get(bucketKey(PIN_BUCKET.global, GLOBAL_SUBJECT));
    expect(row).toBe(3);
  });

  it('칸 표에 IP·기기 ID 원문이 없다', () => {
    const deviceId = randomDeviceId();
    guard.fail(subjects('203.0.113.7', deviceId));
    guard.fail(subjects('198.51.100.4', null));
    const text = storedText(t.db);
    expect(text).not.toContain(deviceId);
    expect(text).not.toMatch(/203\.0\.113|198\.51\.100/);
  });
});
