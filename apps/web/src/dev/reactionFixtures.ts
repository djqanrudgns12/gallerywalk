import { AppError } from '@gallery/core/errors';
import {
  normalizeLine,
  ReactionBodySchema,
  type ExhibitionView,
  type ReactionSettings,
  type ReactionView,
} from '@gallery/core/types';
import { vi } from 'vitest';
import { createDeviceStore } from '../adapters/deviceStore.ts';
import { createTokenTools } from '../adapters/tokens.ts';
import type { AppServices } from '../app/services.ts';
import { createVisitorPrefs } from '../app/student/visitorPrefs.ts';
import type { DeviceStore, StudentApi, TokenTools } from '../ports/index.ts';
import { makeView, memoryStorage, unusedTeacherApi } from './studentFixtures.ts';
import { testArtworkId } from './testView.ts';

/**
 * 반응(P4-6, `app/reactions`) 시험 재료 — 시험 파일에서만 가져온다. 합성 전시·가상 글만 쓴다(AGENTS.md §2).
 * 가짜 학생 경로는 서버처럼 기억한다: 등록한 방문자 토큰·작품별 반응. `online`을 끄면 모든 요청이 `E_OFFLINE`.
 */

export const ART_A = testArtworkId(0, 0);
export const ART_B = testArtworkId(0, 1);
export const REACTION_CODE = '123456';

export const reactionView = (reactions: Partial<ReactionSettings> = {}): ExhibitionView =>
  makeView({ reactions });

export interface FakeReactionServer {
  online: boolean;
  /** 다음 PUT 하나를 이 오류로 거절(끊김보다 먼저 본다) */
  readonly putErrors: AppError[];
  /** 다음 등록 하나를 이 오류로 거절 */
  readonly registerErrors: AppError[];
  /** 서버에 등록된 방문자 토큰 → 별명 */
  readonly visitors: Map<string, string | null>;
  /** 작품 ID → 반응 */
  readonly reactions: Map<string, ReactionView>;
  clock: number;
}

export const fakeReactionApi = (device: DeviceStore, tokens: TokenTools) => {
  const server: FakeReactionServer = {
    online: true,
    putErrors: [],
    registerErrors: [],
    visitors: new Map(),
    reactions: new Map(),
    clock: 1_800_000_000_000,
  };
  const offline = (): void => {
    if (!server.online) throw new AppError('E_OFFLINE');
  };
  const tokenOf = (exhibitionId: string): string => {
    const v = device.visitor(exhibitionId);
    if (!v) throw new AppError('E_AUTH');
    return v.token;
  };

  const student: StudentApi = {
    exhibition: vi.fn<StudentApi['exhibition']>(async () => reactionView()),
    versions: vi.fn<StudentApi['versions']>(async () => ({
      layoutVersion: 1,
      contentVersion: 1,
      settingsVersion: 1,
      status: 'OPEN' as const,
    })),
    registerVisitor: vi.fn<StudentApi['registerVisitor']>(async (target, input) => {
      const saved = device.visitor(target.exhibitionId);
      const token = saved?.token ?? tokens.newToken();
      if (!saved) device.setVisitor(target.exhibitionId, { token, consentVersion: null, nickname: null });
      const fail = server.registerErrors.shift();
      if (fail) throw fail;
      offline();
      const nickname = input.nickname === undefined ? null : normalizeLine(input.nickname) || null;
      if (!server.visitors.has(token)) server.visitors.set(token, nickname);
      device.setVisitor(target.exhibitionId, {
        token,
        consentVersion: input.consentVersion,
        nickname: server.visitors.get(token) ?? null,
      });
    }),
    changeNickname: vi.fn<StudentApi['changeNickname']>(async (target, nickname) => {
      const token = tokenOf(target.exhibitionId);
      offline();
      if (!server.visitors.has(token)) throw new AppError('E_AUTH');
      const n = normalizeLine(nickname);
      server.visitors.set(token, n);
      const saved = device.visitor(target.exhibitionId);
      if (saved) device.setVisitor(target.exhibitionId, { ...saved, nickname: n });
    }),
    myReactions: vi.fn<StudentApi['myReactions']>(async target => {
      const token = tokenOf(target.exhibitionId);
      offline();
      if (!server.visitors.has(token)) throw new AppError('E_AUTH');
      return [...server.reactions.values()];
    }),
    putReaction: vi.fn<StudentApi['putReaction']>(async (target, artworkId, body) => {
      const token = tokenOf(target.exhibitionId);
      const fail = server.putErrors.shift();
      if (fail) throw fail;
      offline();
      if (!server.visitors.has(token)) throw new AppError('E_AUTH');
      const parsed = ReactionBodySchema.parse(body);
      server.clock += 1000;
      const view: ReactionView = { artworkId, ...parsed, updatedAt: server.clock };
      server.reactions.set(artworkId, view);
      return view;
    }),
  };
  return { student, server };
};

/** 반응 시험용 서비스 묶음(가짜 학생 경로 + 메모리 기기 저장) */
export const makeReactionServices = () => {
  const storage = memoryStorage();
  const device = createDeviceStore({ storage: () => storage });
  const tokens = createTokenTools();
  const fake = fakeReactionApi(device, tokens);
  const services: AppServices = {
    api: { student: fake.student, teacher: unusedTeacherApi() },
    device,
    tokens,
    prefs: createVisitorPrefs(() => storage),
    userAgent: 'test',
  };
  return { services, device, tokens, ...fake };
};

/** 이 기기를 서버에 등록해 둔다(입장 때 별명을 적은 학생처럼) */
export const registerOnServer = (
  ctx: ReturnType<typeof makeReactionServices>,
  exhibitionId: string,
  nickname: string | null,
  consentVersion: string,
): string => {
  const token = ctx.tokens.newToken();
  ctx.device.setVisitor(exhibitionId, { token, consentVersion, nickname });
  ctx.server.visitors.set(token, nickname);
  return token;
};

/** 이미 남긴 반응을 서버에 둔다 */
export const seedReaction = (
  server: FakeReactionServer,
  artworkId: string,
  r: Partial<Omit<ReactionView, 'artworkId'>>,
): ReactionView => {
  const view: ReactionView = {
    artworkId,
    sticker: null,
    memo: null,
    scoreFact: null,
    scoreDelivery: null,
    updatedAt: server.clock,
    ...r,
  };
  server.reactions.set(artworkId, view);
  return view;
};
