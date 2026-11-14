import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { sha256Hex } from '@gallery/core/layout';
import {
  DiagBodySchema,
  EntryCodeSchema,
  NicknamePatchSchema,
  ReactionBodySchema,
  UuidSchema,
  VisitorRegisterSchema,
} from '@gallery/core/types';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { acceptDiag } from '../../application/diag.ts';
import { exhibitionView, versionInfo } from '../../application/views.ts';
import { myReactions, putReaction, registerVisitor, renameVisitor } from '../../application/visitors.ts';
import type { Deps } from '../../ports/index.ts';
import {
  type BucketSubject,
  type ClientIdentity,
  clientRequestOf,
  type ServerSecurity,
} from '../../security/index.ts';
import { ok } from '../respond.ts';
import type { AppEnv } from '../types.ts';
import { readJson } from '../validate.ts';

/**
 * 학생 경로(PLAN §9.2 학생 표, 권한 없음). 형식이 틀린 입장 코드도 "없음"으로 답한다(있는지 캐내지 못하게).
 * 속도 칸(`PUBLIC_RATE`, §9.2 학생 표·ADR-062): 보안 묶음(`security`)이 있을 때만 센다(시작 코드는 늘 준다 — 없는 것은 시험).
 * 넘으면 `E_RATE_LIMITED` + `Retry-After`. 틀린 입장 코드는 기기 칸(`badCodeDevice`)과 IP 칸(`badCodeIp`, 더 넉넉)에서
 * 함께 세어, 넘은 칸의 기기(또는 IP)는 창이 끝날 때까지 입장 조회·진단을 못 한다 — 한 학생의 연타는 그 기기만 막고,
 * 공인 IP 하나를 쓰는 학교 전체는 IP 칸이 넘칠 때만 막힌다(G-24, ADR-070).
 * 방문자 토큰은 `Authorization: Bearer {원문}` → SHA-256 16진(웹 어댑터와 같은 계산). 원문은 기록·저장하지 않는다.
 *
 * 진단(`POST /api/e/{code}/diag`, HW-02): 토큰 없이 `X-Device-Id`만. 본문 `DEVICE_REPORT_MAX_BYTES` 넘으면
 * `E_VALIDATION`(`fields._ = body_too_large`, JSON 한도와 같은 코드) → 기기·IP 칸(`diag*`) → zod → 열린 전시 →
 * 204(본문 없음). 입장 코드를 캐내는 길이 되지 않게 틀린 코드 잠금도 입장 조회와 같이 본다.
 */
const entryCode = (raw: string): string => {
  const parsed = EntryCodeSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('E_NOT_FOUND');
  return parsed.data;
};

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 방문자 토큰(Bearer) → 해시. 없거나 모양이 틀리면 `E_AUTH` */
const visitorHash = (c: Context<AppEnv>): string => {
  const m = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '');
  const raw = m?.[1];
  if (!raw || !TOKEN_RE.test(raw)) throw new AppError('E_AUTH');
  return sha256Hex(raw);
};

const artworkIdOf = (raw: string): string => {
  const parsed = UuidSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('E_NOT_FOUND');
  return parsed.data;
};

type RateName = keyof ReturnType<typeof config>['PUBLIC_RATE'];
type Rule = readonly [name: RateName, subject: (client: ClientIdentity) => BucketSubject];

/** 칸 종류 이름(`rate_buckets` 키 앞부분, 소문자·밑줄) */
const kindOf = (name: RateName): string => `public_${name.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`)}`;

/** 틀린 입장 코드 칸: 기기 먼저, 그다음 학교 공용 IP */
const BAD_CODE_RULES: readonly Rule[] = [
  ['badCodeDevice', cl => cl.device],
  ['badCodeIp', cl => cl.ip],
];

/** 진단 본문 한도(설정은 요청마다 읽는다 — 시험·운영 덮어쓰기). 넘으면 JSON 한도와 같은 `E_VALIDATION` */
const diagBodyLimit: MiddlewareHandler<AppEnv> = (c, next) =>
  bodyLimit({
    maxSize: config().DEVICE_REPORT_MAX_BYTES,
    onError: () => {
      throw new AppError('E_VALIDATION', { fields: { _: 'body_too_large' } });
    },
  })(c, next);

export const publicRoutes = (deps: Deps, security?: ServerSecurity): Hono<AppEnv> => {
  const r = new Hono<AppEnv>();

  const refuse = (c: Context<AppEnv>, retryAfterSec: number): AppError => {
    c.header('Retry-After', String(retryAfterSec));
    return new AppError('E_RATE_LIMITED');
  };
  /** 칸을 차례로 센다. 하나라도 넘으면 거절 */
  const limit = (c: Context<AppEnv>, rules: readonly Rule[]): ClientIdentity | null => {
    if (!security) return null;
    const client = security.identify(clientRequestOf(c));
    for (const [name, subject] of rules) {
      const [max, windowSec] = config().PUBLIC_RATE[name];
      const state = security.buckets.hit(kindOf(name), subject(client), max, windowSec);
      if (!state.allowed) throw refuse(c, state.retryAfterSec);
    }
    return client;
  };
  /** 방문자 칸(토큰 해시마다) */
  const limitVisitor = (c: Context<AppEnv>, name: RateName, hash: string): void => {
    if (!security) return;
    const [max, windowSec] = config().PUBLIC_RATE[name];
    const state = security.buckets.hit(kindOf(name), security.clientKeys.visitor(hash), max, windowSec);
    if (!state.allowed) throw refuse(c, state.retryAfterSec);
  };

  /**
   * 입장 코드로 찾기를 틀린 코드 잠금으로 감싼다: 기기·IP 칸 중 하나라도 찼으면 맞는 코드도 창이 끝날 때까지 막고
   * (세지 않고 본다), 찾다가 `E_NOT_FOUND`(형식이 틀린 코드 포함)면 두 칸을 함께 센다.
   */
  const guardCode = <T>(c: Context<AppEnv>, client: ClientIdentity | null, find: () => T): T => {
    if (security && client) {
      for (const [name, subject] of BAD_CODE_RULES) {
        const [max, windowSec] = config().PUBLIC_RATE[name];
        const seen = security.buckets.peek(kindOf(name), subject(client), max, windowSec);
        if (!seen.allowed) throw refuse(c, seen.retryAfterSec);
      }
    }
    try {
      return find();
    } catch (err) {
      if (security && client && err instanceof AppError && err.code === 'E_NOT_FOUND') {
        for (const [name, subject] of BAD_CODE_RULES) {
          const [max, windowSec] = config().PUBLIC_RATE[name];
          security.buckets.hit(kindOf(name), subject(client), max, windowSec);
        }
      }
      throw err;
    }
  };

  r.get('/api/e/:code', c => {
    const client = limit(c, [
      ['viewDevice', cl => cl.device],
      ['viewIp', cl => cl.ip],
    ]);
    const view = guardCode(c, client, () => exhibitionView(deps, entryCode(c.req.param('code'))));
    c.set('exhibitionId', view.exhibition.id);
    return ok(c, view);
  });
  r.post('/api/e/:code/diag', diagBodyLimit, async c => {
    const client = limit(c, [
      ['diagDevice', cl => cl.device],
      ['diagIp', cl => cl.ip],
    ]);
    const body = await readJson(c, DiagBodySchema);
    const exhibitionId = guardCode(c, client, () => acceptDiag(deps, entryCode(c.req.param('code')), body));
    c.set('exhibitionId', exhibitionId);
    return c.body(null, 204);
  });
  r.get('/api/e/:code/v', c => {
    limit(c, [['versionDevice', cl => cl.device]]);
    return ok(c, versionInfo(deps, entryCode(c.req.param('code'))));
  });
  r.post('/api/e/:code/visitor', async c => {
    const code = entryCode(c.req.param('code'));
    const body = await readJson(c, VisitorRegisterSchema);
    limit(c, [['registerIp', cl => cl.ip]]);
    return ok(c, registerVisitor(deps, code, body));
  });
  r.patch('/api/e/:code/visitor', async c => {
    const code = entryCode(c.req.param('code'));
    const hash = visitorHash(c);
    const body = await readJson(c, NicknamePatchSchema);
    limitVisitor(c, 'renameVisitor', hash);
    return ok(c, renameVisitor(deps, code, hash, body.nickname));
  });
  r.get('/api/e/:code/me', c => ok(c, myReactions(deps, entryCode(c.req.param('code')), visitorHash(c))));
  r.put('/api/e/:code/reactions/:artworkId', async c => {
    const code = entryCode(c.req.param('code'));
    const hash = visitorHash(c);
    const artworkId = artworkIdOf(c.req.param('artworkId'));
    const body = await readJson(c, ReactionBodySchema);
    limitVisitor(c, 'reactVisitor', hash);
    limit(c, [['reactIp', cl => cl.ip]]);
    return ok(c, putReaction(deps, code, hash, artworkId, body));
  });
  return r;
};
