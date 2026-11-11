import { AppError } from '@gallery/core/errors';
import {
  ExhibitionViewSchema,
  normalizeLine,
  ReactionSettingsSchema,
  type ExhibitionView,
  type ReactionSettings,
} from '@gallery/core/types';
import { vi } from 'vitest';
import type { DeviceStore, StudentApi, TeacherApi, TokenTools } from '../ports/index.ts';
import { TEST_EXHIBITION_ID, testExhibitionView, uuid } from './testView.ts';

/**
 * 학생 흐름(P4-1, `app/student`) 시험 재료 — 시험 파일에서만 가져온다. 합성 전시·가상 글만 쓴다(AGENTS.md §2).
 * 보기 묶음은 `testView.ts`의 `testExhibitionView`에 포스터·학교·소개·지워지는 날·반응 설정만 덮어쓴다.
 */

export const EX_ID = TEST_EXHIBITION_ID;
export const POSTER_ID = uuid(0xabc);
export const CODE = '123456';
/** 2026-12-12 10:00 KST */
export const EXPIRES_AT = Date.UTC(2026, 11, 12, 1, 0, 0);
export const VIEW_TITLE = '합성 근대사 전시';
export const VIEW_SUBTITLE = '가상의 한 줄 소개';
/** 작품 수(글 작품이 끼지 않는 3점) */
export const VIEW_ARTWORKS = 3;

export interface ViewOptions {
  readonly poster?: boolean;
  readonly school?: { readonly schoolName: string | null; readonly className: string | null } | null;
  readonly reactions?: Partial<ReactionSettings>;
}

export const makeView = (opts: ViewOptions = {}): ExhibitionView => {
  const base = testExhibitionView([VIEW_ARTWORKS]);
  return ExhibitionViewSchema.parse({
    ...base,
    exhibition: {
      ...base.exhibition,
      title: VIEW_TITLE,
      subtitle: VIEW_SUBTITLE,
      poster: opts.poster
        ? {
            assetId: POSTER_ID,
            variants: [
              { name: 'thumb', ext: 'webp', w: 512, h: 341, bytes: 30_000 },
              { name: 'wall', ext: 'webp', w: 1600, h: 1067, bytes: 200_000 },
            ],
          }
        : null,
      school: opts.school ?? null,
      expiresAt: EXPIRES_AT,
      reactions: ReactionSettingsSchema.parse(opts.reactions ?? {}),
    },
  });
};

/** 메모리 키-값 저장소(`localStorage` 대신) */
export const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string): string | null => m.get(k) ?? null,
    setItem: (k: string, v: string): void => void m.set(k, v),
    removeItem: (k: string): void => void m.delete(k),
    size: (): number => m.size,
  };
};

/** 미리 정해 둔 답. `fail`이면 그 오류로 거절 */
export type Outcome = { readonly fail: AppError | Error } | { readonly ok: true };

export interface FakeStudentOptions {
  readonly device: DeviceStore;
  readonly tokens: TokenTools;
  readonly view?: ExhibitionView;
  /** 전시 불러오기 결과(없으면 `view`) */
  readonly exhibition?: () => Promise<ExhibitionView>;
  readonly register?: Outcome;
  readonly rename?: Outcome;
}

/**
 * 가짜 `StudentApi`. 방문자 등록은 포트 약속대로 — 토큰이 없으면 만들어 **보내기 전에** 저장하고, 성공해야 동의 판·별명을 남긴다.
 */
export const fakeStudentApi = (opts: FakeStudentOptions) => {
  const view = opts.view ?? makeView();
  const exhibition = vi.fn<StudentApi['exhibition']>(opts.exhibition ?? (async () => view));
  const registerVisitor = vi.fn<StudentApi['registerVisitor']>(async (target, input) => {
    const saved = opts.device.visitor(target.exhibitionId);
    const token = saved?.token ?? opts.tokens.newToken();
    if (!saved) opts.device.setVisitor(target.exhibitionId, { token, consentVersion: null, nickname: null });
    const r = opts.register ?? { ok: true };
    if ('fail' in r) throw r.fail;
    const nickname = input.nickname === undefined ? null : normalizeLine(input.nickname) || null;
    opts.device.setVisitor(target.exhibitionId, { token, consentVersion: input.consentVersion, nickname });
  });
  const changeNickname = vi.fn<StudentApi['changeNickname']>(async (target, nickname) => {
    const saved = opts.device.visitor(target.exhibitionId);
    if (!saved) throw new AppError('E_AUTH');
    const r = opts.rename ?? { ok: true };
    if ('fail' in r) throw r.fail;
    opts.device.setVisitor(target.exhibitionId, { ...saved, nickname: normalizeLine(nickname) });
  });
  const student: StudentApi = {
    exhibition,
    versions: vi.fn<StudentApi['versions']>(async () => ({ ...view.versions, status: 'OPEN' })),
    registerVisitor,
    changeNickname,
    myReactions: vi.fn<StudentApi['myReactions']>(async () => []),
    putReaction: vi.fn<StudentApi['putReaction']>(async () => {
      throw new AppError('E_REACTIONS_OFF');
    }),
  };
  return { student, exhibition, registerVisitor, changeNickname };
};

/** 학생 시험에서 부르면 안 되는 교사 경로(부르면 `E_AUTH`) */
export const unusedTeacherApi = (): TeacherApi =>
  new Proxy({} as TeacherApi, {
    get: () => () => Promise.reject(new AppError('E_AUTH')),
  });

/** 열린 약속(값을 시험이 나중에 정함) */
export const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
