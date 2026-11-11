import { config } from '@gallery/core/config';
import type { Clock } from '../ports/index.ts';
import { transaction, type Db } from '../store/db.ts';
import type { SubjectKey } from './client.ts';

/**
 * 속도 제한 칸(PLAN §9.2 제한 열·§11.2·§11.3) — `rate_buckets` 표 위의 고정 창.
 *
 * - 칸 키: `{종류}:{HMAC(RATE_KEY_SECRET, 기기 또는 IP)}` 또는 `global:{종류}`. 주인 키는 `client.ts`가 만든
 *   `SubjectKey`만 받는다(원문 IP·기기 ID를 저장하지 못하게).
 * - 창: 첫 번째로 센 때부터 `windowSec` 동안. 창이 지나면 새로 센다. 창 안 수가 `limit`을 넘으면 거절.
 * - 잠금(`lockSec`): 창 안 수가 `limit`에 닿는 순간 그때부터 `lockSec` 동안 잠그고, 잠긴 동안은 세지 않고 거절한다.
 *   PIN 실패 칸처럼 "n번 틀리면 잠금"에 쓴다.
 * - 시각은 `Clock`에서만(시험은 가짜 시계). 한 번 세기는 트랜잭션 하나(바깥 트랜잭션 안이면 savepoint).
 */

const MS_PER_SEC = 1000;
const SEC_PER_MIN = 60;
/** 종류 이름: 칸 키의 앞부분이라 `:`가 없어야 한다 */
const KIND = /^[a-z][a-z0-9_]*$/;
const GLOBAL = 'global';

/** 전역 칸(주인 없이 모두가 하나) */
export type BucketSubject = SubjectKey | typeof GLOBAL;
export const GLOBAL_SUBJECT: BucketSubject = GLOBAL;

export interface BucketState {
  /**
   * `hit`: 이번 것을 받아도 되는가(잠기지 않았고 창 안 수 ≤ 한도).
   * `peek`: 지금 하나 더 세면 받는가.
   */
  readonly allowed: boolean;
  /** 지금 창에서 센 수(`hit`은 이번 것 포함) */
  readonly count: number;
  /** 잠김이 풀리는 시각(UTC ms). 잠기지 않았으면 `null` */
  readonly lockedUntil: number | null;
  /** 다음 것이 받아질 때까지 남은 초(올림, `Retry-After`·"{분}분" 문구용). 지금 받아지면 0 */
  readonly retryAfterSec: number;
}

export interface RateBuckets {
  /** 한 번 센다 */
  hit(kind: string, subject: BucketSubject, limit: number, windowSec: number, lockSec?: number): BucketState;
  /** 세지 않고 지금 상태만 본다 */
  peek(kind: string, subject: BucketSubject, limit: number, windowSec: number): BucketState;
  /**
   * 오래된 칸 정리: 창이 시작된 지 `maxWindowSec`(쓰는 창 중 가장 긴 것) 넘었고 잠기지 않은 칸을 지운다. 지운 수.
   */
  sweep(maxWindowSec: number): number;
}

interface BucketRow {
  readonly window_start: number;
  readonly count: number;
  readonly locked_until: number | null;
}

const isBucketRow = (row: unknown): row is BucketRow =>
  typeof row === 'object' &&
  row !== null &&
  'window_start' in row &&
  typeof row.window_start === 'number' &&
  'count' in row &&
  typeof row.count === 'number' &&
  'locked_until' in row &&
  (row.locked_until === null || typeof row.locked_until === 'number');

/** 칸 키(표의 `key`). 종류 이름이 틀리면 프로그램 잘못이라 던진다 */
export const bucketKey = (kind: string, subject: BucketSubject): string => {
  if (!KIND.test(kind) || kind === GLOBAL) throw new Error(`bad rate bucket kind: ${kind}`);
  return subject === GLOBAL ? `${GLOBAL}:${kind}` : `${kind}:${subject}`;
};

const ceilSec = (ms: number): number => Math.max(0, Math.ceil(ms / MS_PER_SEC));

export const createRateBuckets = (db: Db, clock: Clock): RateBuckets => {
  const select = db.prepare('SELECT window_start, count, locked_until FROM rate_buckets WHERE key = ?');
  const upsert = db.prepare(
    `INSERT INTO rate_buckets (key, window_start, count, locked_until) VALUES (@key, @start, @count, @locked)
     ON CONFLICT (key) DO UPDATE SET
       window_start = excluded.window_start, count = excluded.count, locked_until = excluded.locked_until`,
  );
  const prune = db.prepare(
    `DELETE FROM rate_buckets
     WHERE window_start <= @cutoff AND (locked_until IS NULL OR locked_until <= @now)`,
  );

  const read = (key: string): BucketRow | null => {
    const row: unknown = select.get(key);
    if (row === undefined) return null;
    if (!isBucketRow(row)) throw new Error('rate_buckets row has an unexpected shape');
    return row;
  };

  /** 잠김이 살아 있으면 그 상태 */
  const lockedState = (row: BucketRow | null, now: number): BucketState | null =>
    row !== null && row.locked_until !== null && row.locked_until > now
      ? {
          allowed: false,
          count: row.count,
          lockedUntil: row.locked_until,
          retryAfterSec: ceilSec(row.locked_until - now),
        }
      : null;

  return {
    hit(kind, subject, limit, windowSec, lockSec) {
      const key = bucketKey(kind, subject);
      const windowMs = windowSec * MS_PER_SEC;
      return transaction(db, () => {
        const now = clock.now();
        const row = read(key);
        const locked = lockedState(row, now);
        if (locked) return locked;
        const fresh = row === null || now - row.window_start >= windowMs;
        const start = fresh ? now : row.window_start;
        const count = fresh ? 1 : row.count + 1;
        const lockedUntil = lockSec !== undefined && count >= limit ? now + lockSec * MS_PER_SEC : null;
        upsert.run({ key, start, count, locked: lockedUntil });
        const retryAfterSec =
          lockedUntil !== null
            ? ceilSec(lockedUntil - now)
            : count >= limit
              ? ceilSec(start + windowMs - now)
              : 0;
        return { allowed: count <= limit, count, lockedUntil, retryAfterSec };
      });
    },

    peek(kind, subject, limit, windowSec) {
      const key = bucketKey(kind, subject);
      const windowMs = windowSec * MS_PER_SEC;
      const now = clock.now();
      const row = read(key);
      const locked = lockedState(row, now);
      if (locked) return locked;
      const count = row === null || now - row.window_start >= windowMs ? 0 : row.count;
      const full = count >= limit;
      return {
        allowed: !full,
        count,
        lockedUntil: null,
        retryAfterSec: full && row !== null ? ceilSec(row.window_start + windowMs - now) : 0,
      };
    },

    sweep(maxWindowSec) {
      const now = clock.now();
      return prune.run({ cutoff: now - maxWindowSec * MS_PER_SEC, now }).changes;
    },
  };
};

/** PIN 실패 칸 셋의 종류 이름(칸 키 앞부분) */
export const PIN_BUCKET = { device: 'pin_device', ip: 'pin_ip', global: 'pin_global' } as const;

export interface PinSubjects {
  readonly device: SubjectKey;
  readonly ip: SubjectKey;
}

export interface PinGate {
  /** 이 기기 또는 이 IP의 PIN 입력이 잠겼는가(→ `E_PIN_LOCKED`) */
  readonly locked: boolean;
  /** 잠김이 풀릴 때까지(초, 올림). 잠기지 않았으면 0 */
  readonly retryAfterSec: number;
  /** 응답 전에 기다릴 시간(ms): 전역 실패가 `PIN_GLOBAL_SLOW_AT` 이상이면 `PIN_GLOBAL_DELAY_MS`, 아니면 0 */
  readonly delayMs: number;
}

/**
 * PIN 실패 칸 셋(PLAN §11.2, ADR-024). 숫자는 모두 `config.ts`.
 * ① 기기: `PIN_MAX_FAILS`번 → `PIN_LOCK_MIN`분 잠금 ② IP: `PIN_IP_MAX_FAILS`번 → 그 IP의 PIN 입력만 `PIN_LOCK_MIN`분 잠금
 * ③ 전역: `PIN_GLOBAL_SLOW_AT`번 이상 → 모든 PIN 응답(맞아도) `PIN_GLOBAL_DELAY_MS` 지연.
 * 세는 창은 셋 다 `PIN_LOCK_MIN`분(PLAN의 "10분" — 따로 된 설정 키가 없어 잠금 시간과 같은 키를 쓴다).
 *
 * 쓰는 법(라우트): `check` → 잠겼으면 `delayMs` 기다린 뒤 `E_PIN_LOCKED` / PIN이 틀렸거나 전시 만들기의
 * "이미 쓰이는 PIN"이면 `fail` → 그 결과의 `delayMs`를 기다리고 답(이번 실패로 잠겼으면 `locked`) / 맞으면 `check`의 `delayMs`.
 */
export interface PinGuard {
  check(subjects: PinSubjects): PinGate;
  fail(subjects: PinSubjects): PinGate;
}

export const createPinGuard = (buckets: RateBuckets): PinGuard => {
  const rules = () => {
    const c = config();
    const windowSec = c.PIN_LOCK_MIN * SEC_PER_MIN;
    return {
      windowSec,
      lockSec: c.PIN_LOCK_MIN * SEC_PER_MIN,
      deviceMax: c.PIN_MAX_FAILS,
      ipMax: c.PIN_IP_MAX_FAILS,
      slowAt: c.PIN_GLOBAL_SLOW_AT,
      delayMs: c.PIN_GLOBAL_DELAY_MS,
    };
  };
  const gate = (
    device: BucketState,
    ip: BucketState,
    global: BucketState,
    slowAt: number,
    delay: number,
  ) => ({
    locked: device.lockedUntil !== null || ip.lockedUntil !== null,
    retryAfterSec: Math.max(
      device.lockedUntil === null ? 0 : device.retryAfterSec,
      ip.lockedUntil === null ? 0 : ip.retryAfterSec,
    ),
    delayMs: global.count >= slowAt ? delay : 0,
  });
  return {
    check(subjects) {
      const r = rules();
      return gate(
        buckets.peek(PIN_BUCKET.device, subjects.device, r.deviceMax, r.windowSec),
        buckets.peek(PIN_BUCKET.ip, subjects.ip, r.ipMax, r.windowSec),
        buckets.peek(PIN_BUCKET.global, GLOBAL_SUBJECT, r.slowAt, r.windowSec),
        r.slowAt,
        r.delayMs,
      );
    },
    fail(subjects) {
      const r = rules();
      return gate(
        buckets.hit(PIN_BUCKET.device, subjects.device, r.deviceMax, r.windowSec, r.lockSec),
        buckets.hit(PIN_BUCKET.ip, subjects.ip, r.ipMax, r.windowSec, r.lockSec),
        buckets.hit(PIN_BUCKET.global, GLOBAL_SUBJECT, r.slowAt, r.windowSec),
        r.slowAt,
        r.delayMs,
      );
    },
  };
};
