import type { ServerEnv } from '../env.ts';
import type { Clock, Security } from '../ports/index.ts';
import type { Db } from '../store/db.ts';
import {
  createClientKeys,
  identifyClient,
  type ClientIdentity,
  type ClientKeys,
  type ClientRequest,
} from './client.ts';
import { isWeakPin, pinHmac } from './pin.ts';
import { createPinGuard, createRateBuckets, type PinGuard, type RateBuckets } from './rateBuckets.ts';
import {
  createTeacherDevices,
  readStartCodeDigest,
  startCodeMatches,
  type TeacherDevices,
} from './startCode.ts';
import { hmacKey } from './tokens.ts';

export * from './client.ts';
export * from './pin.ts';
export * from './rateBuckets.ts';
export * from './startCode.ts';
export * from './tokens.ts';
export { WEAK_PINS } from './weakPins.ts';

/**
 * 보안 모듈 묶음(PLAN §11). 유스케이스 포트 `Security`(PIN HMAC·쉬운 PIN·시작 코드)를 구현하고, 라우트가 쓸
 * 칸(`rate_buckets`)·PIN 실패 칸 셋·시작 코드 기기·IP/기기 칸 키를 함께 준다. 비밀값은 여기서 한 번 `KeyObject`로 바꾼다.
 */

export interface ServerSecurity extends Security {
  readonly buckets: RateBuckets;
  readonly pinGuard: PinGuard;
  readonly devices: TeacherDevices;
  readonly clientKeys: ClientKeys;
  /** 요청의 IP·기기 칸 키. 운영에서 믿는 IP 머리가 없으면 `E_VALIDATION` */
  identify(req: ClientRequest): ClientIdentity;
}

export interface SecurityDeps {
  readonly db: Db;
  readonly clock: Clock;
}

export const createSecurity = (
  env: Pick<ServerEnv, 'nodeEnv' | 'secrets'>,
  deps: SecurityDeps,
): ServerSecurity => {
  const pinKey = hmacKey(env.secrets.pinHmac);
  const startKey = hmacKey(env.secrets.startCodeHmac);
  const clientKeys = createClientKeys(env.secrets.rateKey);
  const production = env.nodeEnv === 'production';
  const buckets = createRateBuckets(deps.db, deps.clock);
  return {
    pinHmac: pin => pinHmac(pinKey, pin),
    isWeakPin,
    // 저장값은 운영 스크립트가 바꿀 수 있어 물을 때마다 읽는다(만들기에서만 불리므로 드묾)
    startCodeOk: code => startCodeMatches(startKey, readStartCodeDigest(deps.db), code),
    buckets,
    pinGuard: createPinGuard(buckets),
    devices: createTeacherDevices(deps.db, deps.clock),
    clientKeys,
    identify: req => identifyClient(req, clientKeys, production),
  };
};
