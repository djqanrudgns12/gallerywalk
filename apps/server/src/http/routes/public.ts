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
import { ok } from '../respond.ts';
import type { AppEnv } from '../types.ts';
import { readJson } from '../validate.ts';

/**
 * 학생 경로(PLAN §9.2 학생 표, 권한 없음). 형식이 틀린 입장 코드도 "없음"으로 답한다(있는지 캐내지 못하게).
 * 속도 칸(기기 30/분·IP 600/분·틀린 코드 IP 60/10분)은 보안 모듈(P3-2)이 생기면 앞에 붙인다.
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

export const publicRoutes = (deps: Deps): Hono<AppEnv> => {
  const r = new Hono<AppEnv>();
  r.get('/api/e/:code', c => {
    const view = exhibitionView(deps, entryCode(c.req.param('code')));
    c.set('exhibitionId', view.exhibition.id);
    return ok(c, view);
  });
  r.get('/api/e/:code/v', c => ok(c, versionInfo(deps, entryCode(c.req.param('code')))));
  r.post('/api/e/:code/visitor', async c => {
    const code = entryCode(c.req.param('code'));
    const body = await readJson(c, VisitorRegisterSchema);
    return ok(c, registerVisitor(deps, code, body));
  });
  r.patch('/api/e/:code/visitor', async c => {
    const code = entryCode(c.req.param('code'));
    const hash = visitorHash(c);
    const body = await readJson(c, NicknamePatchSchema);
    return ok(c, renameVisitor(deps, code, hash, body.nickname));
  });
  r.get('/api/e/:code/me', c => ok(c, myReactions(deps, entryCode(c.req.param('code')), visitorHash(c))));
  r.put('/api/e/:code/reactions/:artworkId', async c => {
    const code = entryCode(c.req.param('code'));
    const hash = visitorHash(c);
    const artworkId = artworkIdOf(c.req.param('artworkId'));
    const body = await readJson(c, ReactionBodySchema);
    return ok(c, putReaction(deps, code, hash, artworkId, body));
  });
  return r;
};
