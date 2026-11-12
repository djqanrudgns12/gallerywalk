import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { sha256Hex } from '@gallery/core/layout';
import {
  EntryCodeSchema,
  NicknamePatchSchema,
  ReactionBodySchema,
  UuidSchema,
  VisitorRegisterSchema,
} from '@gallery/core/types';
import type { Context } from 'hono';
import { Hono } from 'hono';
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
 * 넘으면 `E_RATE_LIMITED` + `Retry-After`. 틀린 입장 코드는 IP마다 세어, 넘은 IP는 창이 끝날 때까지 입장 조회를 못 한다.
 * 방문자 토큰은 `Authorization: Bearer {원문}` → SHA-256 16진(웹 어댑터와 같은 계산). 원문은 기록·저장하지 않는다.
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

  r.get('/api/e/:code', c => {
    const client = limit(c, [
      ['viewDevice', cl => cl.device],
      ['viewIp', cl => cl.ip],
    ]);
    const bad = config().PUBLIC_RATE.badCodeIp;
    if (security && client) {
      // 틀린 코드를 많이 넣은 IP는 맞는 코드도 창이 끝날 때까지 막는다(세지 않고 본다)
      const seen = security.buckets.peek(kindOf('badCodeIp'), client.ip, bad[0], bad[1]);
      if (!seen.allowed) throw refuse(c, seen.retryAfterSec);
    }
    try {
      const view = exhibitionView(deps, entryCode(c.req.param('code')));
      c.set('exhibitionId', view.exhibition.id);
      return ok(c, view);
    } catch (err) {
      if (security && client && err instanceof AppError && err.code === 'E_NOT_FOUND')
        security.buckets.hit(kindOf('badCodeIp'), client.ip, bad[0], bad[1]);
      throw err;
    }
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
