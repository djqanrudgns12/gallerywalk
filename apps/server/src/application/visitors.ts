import { AppError } from '@gallery/core/errors';
import { sha256Hex } from '@gallery/core/layout';
import { checkReaction, isBlocked, prepareNickname } from '@gallery/core/reactions';
import { isGone } from '@gallery/core/retention';
import type { ReactionBody, ReactionView } from '@gallery/core/types';
import type { Deps, ExhibitionRecord, ReactionRecord, VisitorRecord } from '../ports/index.ts';

/**
 * 학생 쪽 방문자·반응(PLAN §9.2 학생 표, G-07). 방문자 토큰은 기기가 만든 256비트 — 서버는 해시만 안다(ADR-025).
 * - 등록은 멱등: 같은 토큰 해시가 이미 있으면 그대로(별명·동의는 처음 값 유지, 별명은 `PATCH`로 바꾼다).
 * - 반응은 기기 1대 = 작품 1개에 하나(멱등 PUT). 반응 ID는 (방문자, 작품)에서 정해지므로 다시 보내도 같은 행.
 * - 학생 반응으로는 버전을 올리지 않는다(모두가 60초마다 다시 받지 않게) — 공개 집계는 다음에 보기를 받을 때 반영.
 */

/** 입장 코드 → 열린 전시(준비 중·닫힘은 그 코드, 없거나 만료·지우는 중이면 없음) */
const openByCode = (deps: Deps, entryCode: string): ExhibitionRecord => {
  const ex = deps.store.exhibitions.getByEntryCode(entryCode);
  if (!ex || isGone(ex, deps.clock.now())) throw new AppError('E_NOT_FOUND');
  if (ex.status === 'DRAFT') throw new AppError('E_EXHIBITION_DRAFT');
  if (ex.status === 'CLOSED') throw new AppError('E_EXHIBITION_CLOSED');
  return ex;
};

const nicknameOf = (raw: string): { display: string; norm: string } => {
  const p = prepareNickname(raw);
  if ('error' in p) throw new AppError('E_VALIDATION', { fields: { nickname: p.error } });
  return p;
};

/** (방문자, 작품) → 반응 ID(UUID 모양, 결정적) — 다시 보낸 PUT이 같은 행을 고치게 */
export const reactionIdOf = (visitorTokenHash: string, artworkId: string): string => {
  const h = sha256Hex(`reaction:${visitorTokenHash}:${artworkId}`);
  const variant = ((Number.parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export interface VisitorResult {
  /** 서버가 정리한 별명(없으면 null — 익명 방식이거나 아직 안 정함) */
  readonly nickname: string | null;
}

export const registerVisitor = (
  deps: Deps,
  entryCode: string,
  body: {
    readonly tokenHash: string;
    readonly nickname?: string | undefined;
    readonly consentVersion: string;
  },
): VisitorResult =>
  deps.store.transaction(() => {
    const ex = openByCode(deps, entryCode);
    const existing = deps.store.visitors.get(body.tokenHash, ex.id);
    if (existing) return { nickname: existing.nickname };
    const nick = body.nickname === undefined ? null : nicknameOf(body.nickname);
    const now = deps.clock.now();
    const rec: VisitorRecord = {
      tokenHash: body.tokenHash,
      exhibitionId: ex.id,
      nickname: nick?.display ?? null,
      nicknameNorm: nick?.norm ?? null,
      consentVersion: body.consentVersion,
      consentAt: now,
      createdAt: now,
    };
    deps.store.visitors.insert(rec);
    return { nickname: rec.nickname };
  });

/** 방문자 토큰 해시 → 그 전시의 방문자(없으면 `E_AUTH`) */
const visitorOf = (deps: Deps, ex: ExhibitionRecord, tokenHash: string): VisitorRecord => {
  const v = deps.store.visitors.get(tokenHash, ex.id);
  if (!v) throw new AppError('E_AUTH');
  return v;
};

export const renameVisitor = (
  deps: Deps,
  entryCode: string,
  tokenHash: string,
  nickname: string,
): VisitorResult =>
  deps.store.transaction(() => {
    const ex = openByCode(deps, entryCode);
    visitorOf(deps, ex, tokenHash);
    const nick = nicknameOf(nickname);
    const next = deps.store.visitors.update(tokenHash, ex.id, {
      nickname: nick.display,
      nicknameNorm: nick.norm,
    });
    return { nickname: next.nickname };
  });

const toView = (r: ReactionRecord): ReactionView => ({
  artworkId: r.artworkId,
  sticker: r.sticker,
  memo: r.memo,
  scoreFact: r.scoreFact,
  scoreDelivery: r.scoreDelivery,
  updatedAt: r.updatedAt,
});

/** 내가 남긴 반응(이 전시) */
export const myReactions = (deps: Deps, entryCode: string, tokenHash: string): ReactionView[] => {
  const ex = openByCode(deps, entryCode);
  visitorOf(deps, ex, tokenHash);
  return deps.store.reactions
    .listByExhibition(ex.id)
    .filter(r => r.visitorTokenHash === tokenHash)
    .sort((a, b) => a.updatedAt - b.updatedAt || (a.artworkId < b.artworkId ? -1 : 1))
    .map(toView);
};

/**
 * 반응 남기기·고치기. 반응 꺼짐 → `E_REACTIONS_OFF`, 설정이 받지 않는 칸 → `E_VALIDATION`(fields), 메모 걸러짐 →
 * `E_MEMO_BLOCKED`, 게시되지 않은 작품·다른 전시의 작품 → `E_NOT_FOUND`. 닫힌 전시는 보기부터 막힌다.
 */
export const putReaction = (
  deps: Deps,
  entryCode: string,
  tokenHash: string,
  artworkId: string,
  body: ReactionBody,
): ReactionView =>
  deps.store.transaction(() => {
    const ex = openByCode(deps, entryCode);
    visitorOf(deps, ex, tokenHash);
    const art = deps.store.artworks.get(artworkId);
    if (!art || art.exhibitionId !== ex.id || art.status !== 'PUBLISHED' || art.deletedAt !== null)
      throw new AppError('E_NOT_FOUND');
    const check = checkReaction(ex.settings.reactions, body);
    if (check === 'REACTIONS_OFF') throw new AppError('E_REACTIONS_OFF');
    if (check === 'FIELD_NOT_ACCEPTED')
      throw new AppError('E_VALIDATION', { fields: { _: 'field_not_accepted' } });
    if (body.memo !== null && isBlocked(body.memo)) throw new AppError('E_MEMO_BLOCKED');
    const now = deps.clock.now();
    const prev = deps.store.reactions.getByVisitor(artworkId, tokenHash);
    const rec: ReactionRecord = {
      id: prev?.id ?? reactionIdOf(tokenHash, artworkId),
      exhibitionId: ex.id,
      artworkId,
      visitorTokenHash: tokenHash,
      sticker: body.sticker,
      memo: body.memo,
      scoreFact: body.scoreFact,
      scoreDelivery: body.scoreDelivery,
      // 교사가 숨긴 표시는 그대로. 공개로 골라 둔 메모는 글이 바뀌면 다시 고르게(검토 안 한 글이 공개되지 않게)
      hidden: prev?.hidden ?? false,
      publicSelected: prev !== null && prev.memo === body.memo ? prev.publicSelected : false,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    deps.store.reactions.upsert(rec);
    return toView(rec);
  });
