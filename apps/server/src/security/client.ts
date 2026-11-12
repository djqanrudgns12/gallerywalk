import { createHmac, type KeyObject } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import type { HttpBindings } from '@hono/node-server';
import type { Context } from 'hono';
import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { UuidSchema } from '@gallery/core/types';
import type { AppEnv } from '../http/types.ts';
import { hmacKey, type KeySource } from './tokens.ts';

export type { KeySource } from './tokens.ts';

/**
 * 사용자 IP와 기기 구분 한 곳(PLAN §11.2·§11.3). HTTP 경로와 함께 관람 연결(`live/attach.ts`, `live/ip.ts`가 다시 내보냄)이
 * 같은 규칙을 쓴다.
 *
 * - IP: 머리 하나(`CLIENT_IP_HEADER`)만 믿는다. `X-Forwarded-For`는 보지 않는다. 운영에서 그 머리가 없거나 IP가 아니면
 *   거절, 개발·시험은 소켓 주소(없으면 `127.0.0.1` — 서버는 루프백에서만 듣는다).
 * - IP 칸 묶음: IPv4 그대로, `::ffff:` IPv4는 IPv4로, 그 밖의 IPv6는 앞 64비트.
 * - 기기: `X-Device-Id`(UUID) → 칸 키. 머리가 없거나 형식이 틀리면 그 IP의 "이름 없는 기기" 칸 하나로 묶는다
 *   (머리를 빼서 기기 칸을 피하지 못하게).
 * - 칸 키는 원문이 아니라 `HMAC(RATE_KEY_SECRET, …)`(base64url)이다. IP·기기 ID 원문은 저장하지 않고 기록에도 넣지 않는다.
 */

/** IPv6 주소의 16비트 묶음 수와 /64 앞부분 묶음 수(주소 형식에서 오는 값, 조정할 수치가 아님) */
const V6_GROUPS = 8;
const V6_PREFIX_GROUPS = 4;
/** `::ffff:a.b.c.d`(IPv4를 담은 IPv6)의 앞 5묶음 0 + `ffff` */
const V4_MAPPED_ZERO_GROUPS = 5;
const V4_MAPPED_MARK = 0xffff;
const BYTE_BITS = 8;
const BYTE_MASK = 0xff;
const HEX = 16;

/** 개발·시험에서 믿는 머리도 소켓 주소도 없을 때(`app.request()` 시험 등) — 서버가 듣는 루프백 주소 */
const DEV_LOOPBACK = '127.0.0.1';

/** 기기가 처음 열 때 만든 무작위 UUID를 보내는 머리(PLAN §11.2) */
export const DEVICE_ID_HEADER = 'x-device-id';

/** HMAC 입력의 앞말 — 기기 ID·이름 없는 기기·IP 묶음이 같은 키를 만들지 않게(IP 묶음은 앞말 없이 그대로) */
const DEVICE_PREFIX = 'device:';
const ANON_DEVICE_PREFIX = 'anon:';
const VISITOR_PREFIX = 'visitor:';

declare const subjectBrand: unique symbol;
/** 칸 주인 키: HMAC으로만 만든다(원문 IP·기기 ID가 칸 표에 들어가지 못하게 타입으로 막음) */
export type SubjectKey = string & { readonly [subjectBrand]: true };

export interface IpRequest {
  readonly headers: IncomingHttpHeaders;
  readonly socket: { readonly remoteAddress?: string | undefined };
}

/** 믿는 머리 값(문자열 하나, IP 모양)만 받는다. 아니면 운영 `null`, 개발은 소켓 주소. */
const trustedIp = (
  raw: string | readonly string[] | undefined,
  socketAddress: string | undefined,
  production: boolean,
): string | null => {
  const value = typeof raw === 'string' ? raw.trim() : undefined;
  if (value !== undefined && isIP(value) !== 0) return value;
  if (production) return null;
  return socketAddress !== undefined && isIP(socketAddress) !== 0 ? socketAddress : null;
};

/**
 * 믿는 머리의 IP. 머리가 없거나 IP가 아니면(쉼표 목록 포함) 운영은 `null`(거절), 개발·시험은 소켓 주소.
 */
export const clientIp = (req: IpRequest, header: string, production: boolean): string | null =>
  trustedIp(req.headers[header.toLowerCase()], req.socket.remoteAddress, production);

const v6Groups = (ip: string): number[] | null => {
  const [head = '', tail, extra] = ip.split('::');
  if (extra !== undefined) return null;
  const parts = (text: string): number[] | null => {
    if (text === '') return [];
    const out: number[] = [];
    for (const piece of text.split(':')) {
      if (isIP(piece) === 4) {
        const [a = 0, b = 0, c = 0, d = 0] = piece.split('.').map(Number);
        out.push((a << BYTE_BITS) | b, (c << BYTE_BITS) | d);
      } else if (/^[0-9a-f]{1,4}$/i.test(piece)) out.push(Number.parseInt(piece, HEX));
      else return null;
    }
    return out;
  };
  const left = parts(head);
  const right = tail === undefined ? [] : parts(tail);
  if (!left || !right) return null;
  const fill = tail === undefined ? 0 : V6_GROUPS - left.length - right.length;
  if (fill < 0 || left.length + fill + right.length !== V6_GROUPS) return null;
  return [...left, ...new Array<number>(fill).fill(0), ...right];
};

const v4FromGroups = (hi: number, lo: number): string =>
  [hi >> BYTE_BITS, hi & BYTE_MASK, lo >> BYTE_BITS, lo & BYTE_MASK].join('.');

/**
 * 칸 묶음: IPv4는 그대로, IPv4를 담은 IPv6(`::ffff:…`)는 IPv4로, 그 밖의 IPv6는 앞 64비트(`a:b:c:d::/64`).
 * IP가 아니면 `null`.
 */
export const ipBucket = (ip: string): string | null => {
  const address = ip.split('%', 1)[0] ?? '';
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return null;
  const groups = v6Groups(address);
  if (!groups) return null;
  const mapped =
    groups.slice(0, V4_MAPPED_ZERO_GROUPS).every(g => g === 0) &&
    groups[V4_MAPPED_ZERO_GROUPS] === V4_MAPPED_MARK;
  if (mapped) return v4FromGroups(groups[V6_GROUPS - 2] ?? 0, groups[V6_GROUPS - 1] ?? 0);
  return `${groups
    .slice(0, V6_PREFIX_GROUPS)
    .map(g => g.toString(HEX))
    .join(':')}::/64`;
};

const subjectKey = (key: KeyObject, text: string): SubjectKey =>
  createHmac('sha256', key).update(text).digest('base64url') as SubjectKey;

/** IP → 칸 키(HMAC-SHA256, base64url). 묶음을 만들 수 없는 값은 `null` */
export const createIpKeyer = (secret: KeySource | KeyObject): ((ip: string) => SubjectKey | null) => {
  const key = hmacKey(secret);
  return ip => {
    const bucket = ipBucket(ip);
    return bucket === null ? null : subjectKey(key, bucket);
  };
};

export interface DeviceKey {
  readonly key: SubjectKey;
  /** `X-Device-Id`가 맞는 UUID였는가. 아니면 그 IP의 "이름 없는 기기" 칸 */
  readonly named: boolean;
}

export interface ClientKeys {
  /** IP → 칸 키(묶음을 만들 수 없으면 `null`) */
  ip(ip: string): SubjectKey | null;
  /** `X-Device-Id` 값 + 그 요청의 IP → 기기 칸 키. IP 묶음을 만들 수 없으면 `null` */
  device(deviceId: string | undefined, ip: string): DeviceKey | null;
  /** 방문자 토큰 해시 → 방문자 칸 키(학생 경로 별명·반응 칸, PLAN §9.2) */
  visitor(tokenHash: string): SubjectKey;
}

/** `RATE_KEY_SECRET`으로 IP·기기 칸 키를 만드는 묶음 */
export const createClientKeys = (secret: KeySource | KeyObject): ClientKeys => {
  const key = hmacKey(secret);
  const ip = createIpKeyer(key);
  return {
    ip,
    device(deviceId, address) {
      const parsed = UuidSchema.safeParse(deviceId?.trim().toLowerCase());
      if (parsed.success) return { key: subjectKey(key, `${DEVICE_PREFIX}${parsed.data}`), named: true };
      const bucket = ipBucket(address);
      return bucket === null
        ? null
        : { key: subjectKey(key, `${ANON_DEVICE_PREFIX}${bucket}`), named: false };
    },
    visitor: hash => subjectKey(key, `${VISITOR_PREFIX}${hash}`),
  };
};

/** 요청에서 필요한 것만(Hono·Node 어느 쪽에서도 만들 수 있게) */
export interface ClientRequest {
  /** 머리 이름은 대소문자를 가리지 않는다. 같은 머리가 여럿이면 쉼표로 이은 값(→ IP가 아니므로 없는 것으로) */
  header(name: string): string | undefined;
  readonly remoteAddress?: string | undefined;
}

export interface ClientIdentity {
  /** IP 칸 키 */
  readonly ip: SubjectKey;
  /** 기기 칸 키(이름 없는 기기면 그 IP의 칸) */
  readonly device: SubjectKey;
  /** 기기 ID가 맞는 UUID였는가 — 시작 코드 기기 등록은 이름 있는 기기만(`startCode.ts`) */
  readonly namedDevice: boolean;
}

/**
 * 요청의 IP·기기 칸 키. 운영에서 믿는 머리가 없거나 IP가 아니면 `E_VALIDATION`(`fields._ = client_ip`) —
 * 함께 관람 연결의 거절(400)과 같은 코드.
 */
export const identifyClient = (req: ClientRequest, keys: ClientKeys, production: boolean): ClientIdentity => {
  const ip =
    trustedIp(req.header(config().CLIENT_IP_HEADER), req.remoteAddress, production) ??
    (production ? null : DEV_LOOPBACK);
  const ipKey = ip === null ? null : keys.ip(ip);
  const device = ip === null ? null : keys.device(req.header(DEVICE_ID_HEADER), ip);
  if (ipKey === null || device === null) throw new AppError('E_VALIDATION', { fields: { _: 'client_ip' } });
  return { ip: ipKey, device: device.key, namedDevice: device.named };
};

/** Hono 문맥 → `ClientRequest`. `app.request()` 시험에는 Node 요청(`c.env.incoming`)이 없다 */
export const clientRequestOf = <E extends AppEnv>(c: Context<E>): ClientRequest => {
  const bindings = c.env as Partial<HttpBindings> | undefined;
  return { header: name => c.req.header(name), remoteAddress: bindings?.incoming?.socket.remoteAddress };
};

/** 고정 창 칸(메모리). 키마다 창이 시작된 때부터 `windowMs` 동안 `limit`번까지 */
export interface WindowLimiter {
  /** 한 번 세고, 한도 안이면 `true` */
  take(key: string, now: number, limit: number): boolean;
  /** 창이 끝난 칸을 지운다 */
  sweep(now: number): void;
  size(): number;
}

export const createWindowLimiter = (windowMs: number): WindowLimiter => {
  const slots = new Map<string, { start: number; count: number }>();
  return {
    take(key, now, limit) {
      const slot = slots.get(key);
      if (!slot || now - slot.start >= windowMs) {
        slots.set(key, { start: now, count: 1 });
        return limit >= 1;
      }
      slot.count += 1;
      return slot.count <= limit;
    },
    sweep(now) {
      for (const [key, slot] of slots) if (now - slot.start >= windowMs) slots.delete(key);
    },
    size: () => slots.size,
  };
};
