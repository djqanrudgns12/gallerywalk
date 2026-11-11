import type { KeyObject } from 'node:crypto';
import type { Clock } from '../ports/index.ts';
import type { Db } from '../store/db.ts';
import type { ClientIdentity } from './client.ts';
import { hashEquals, hmacHex, hmacKey, type KeySource } from './tokens.ts';

/**
 * 전시 만들기 시작 코드(ADR-048, PLAN §11.3) — 그 기기의 첫 만들기에만 묻는다.
 *
 * - 비밀값 `START_CODE_HMAC`은 HMAC 키다. 사용자가 정한 코드는 원문이 아니라 `HMAC(START_CODE_HMAC, 코드)`(16진)만
 *   `meta` 표의 `start_code_hmac` 칸에 둔다. 운영 스크립트(U-17 설정 때)가 `storeStartCode`로 넣는다 —
 *   환경 값을 하나 더 늘리지 않고, 코드를 바꿔도 서버를 다시 시작하지 않아도 된다.
 * - 저장값이 없으면 어떤 코드도 맞지 않는다(닫힌 쪽으로 실패). `START_CODE_REQUIRED=false`면 유스케이스가 묻지 않는다.
 * - 확인은 HMAC끼리 상수 시간 비교.
 * - 맞힌 기기는 `teacher_devices`에 기기 칸 키(HMAC, 원문 기기 ID 아님)로 남긴다. "이름 없는 기기"(`X-Device-Id`가
 *   없거나 틀림)는 그 IP의 모든 기기가 함께 쓰는 칸이라 등록하지 않는다 — 다음에도 코드를 묻는다.
 */

/** `meta` 표에서 시작 코드 HMAC을 두는 칸 이름 */
export const START_CODE_META_KEY = 'start_code_hmac';

const HEX_DIGEST = /^[0-9a-f]{64}$/;
const DIGITS = /^\d+$/;

export const startCodeDigest = (secret: KeySource | KeyObject, code: string): string =>
  hmacHex(hmacKey(secret), code);

/** 저장된 시작 코드 HMAC(없거나 모양이 틀리면 `null`) */
export const readStartCodeDigest = (db: Db): string | null => {
  const value: unknown = db.prepare('SELECT value FROM meta WHERE key = ?').pluck().get(START_CODE_META_KEY);
  return typeof value === 'string' && HEX_DIGEST.test(value) ? value : null;
};

/** 운영 설정용: 사용자가 정한 숫자 코드의 HMAC을 저장한다(원문은 저장하지 않는다) */
export const storeStartCode = (db: Db, secret: KeySource | KeyObject, code: string): void => {
  if (!DIGITS.test(code)) throw new Error('start code must be digits');
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(START_CODE_META_KEY, startCodeDigest(secret, code));
};

/** 받은 코드가 저장값과 맞는가. 저장값이 없으면 늘 `false` */
export const startCodeMatches = (
  secret: KeySource | KeyObject,
  stored: string | null,
  code: string,
): boolean => stored !== null && hashEquals(startCodeDigest(secret, code), stored);

export interface TeacherDevices {
  /** 이 기기가 이미 시작 코드를 맞혔는가(유스케이스 `CreateContext.deviceRegistered`) */
  isRegistered(client: ClientIdentity): boolean;
  /** 맞힌 기기를 남긴다. 이름 없는 기기는 남기지 않고 `false` */
  register(client: ClientIdentity): boolean;
}

export const createTeacherDevices = (db: Db, clock: Clock): TeacherDevices => {
  const find = db.prepare('SELECT 1 FROM teacher_devices WHERE device_hash = ?').pluck();
  const insert = db.prepare(
    'INSERT INTO teacher_devices (device_hash, registered_at) VALUES (?, ?) ON CONFLICT (device_hash) DO NOTHING',
  );
  return {
    isRegistered: client => client.namedDevice && find.get(client.device) !== undefined,
    register(client) {
      if (!client.namedDevice) return false;
      insert.run(client.device, clock.now());
      return true;
    },
  };
};
