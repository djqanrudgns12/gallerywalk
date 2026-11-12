import { AppError } from '@gallery/core/errors';
import {
  ArtworkTeacherSchema,
  ExhibitionSettingsSchema,
  ExhibitionTeacherSchema,
  TeacherReactionSchema,
  type ArtworkTeacher,
  type ExhibitionTeacher,
  type ReactionSettings,
  type TeacherExhibitionView,
  type TeacherReaction,
} from '@gallery/core/types';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { createDeviceStore } from '../adapters/deviceStore.ts';
import { createTokenTools } from '../adapters/tokens.ts';
import { ServicesContext, type AppServices } from '../app/services.ts';
import { createVisitorPrefs } from '../app/student/visitorPrefs.ts';
import type { DeviceStore, StudentApi, TeacherApi, TokenTools } from '../ports/index.ts';
import { memoryStorage } from './studentFixtures.ts';
import { testRoomId, uuid } from './testView.ts';

/**
 * 교사 앞 화면·관리 둘레 부품(P5-A: 첫 화면·새 전시·열기 시트·`···` 메뉴·반응 탭) 시험 재료 — 시험 파일에서만 가져온다.
 * 합성 전시·가상 글만 쓴다(AGENTS.md §2).
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

export const T_EX_A = uuid(0xa001);
export const T_EX_B = uuid(0xa002);
export const T_EX_C = uuid(0xa003);
export const T_TITLE_A = '합성 연대기 전시관';
export const T_TITLE_B = '가상 시화전';
export const T_TITLE_C = '지난 가상 전시';
export const T_ENTRY = '482913';
/** 시험 시각: 2026-11-12 09:00 KST */
export const T_NOW = Date.UTC(2026, 10, 12, 0, 0, 0);
export const T_DAY_MS = 86_400_000;
export const T_MEMO_1 = '가상 메모 하나';
export const T_MEMO_2 = '가상 메모 둘';
export const T_NICK = '가상별명';
export const T_SCHOOL = '가상초등학교';
export const T_CLASS = '5학년 1반';

export const teacherExhibition = (over: Partial<ExhibitionTeacher> = {}): ExhibitionTeacher =>
  ExhibitionTeacherSchema.parse({
    id: T_EX_A,
    entryCode: T_ENTRY,
    title: T_TITLE_A,
    subtitle: null,
    templateId: 'modern-history',
    poster: null,
    schoolName: null,
    className: null,
    showSchool: false,
    settings: ExhibitionSettingsSchema.parse({}),
    status: 'DRAFT',
    rev: 3,
    createdAt: T_NOW,
    expiresAt: T_NOW + 30 * T_DAY_MS,
    openedAt: null,
    closedAt: null,
    ...over,
  });

export const withReactions = (patch: Partial<ReactionSettings>): ExhibitionTeacher => {
  const base = teacherExhibition();
  return { ...base, settings: { ...base.settings, reactions: { ...base.settings.reactions, ...patch } } };
};

export const teacherView = (exhibition: ExhibitionTeacher = teacherExhibition()): TeacherExhibitionView => ({
  exhibition,
  rooms: [],
  artworks: [],
  layout: null,
  versions: { layoutVersion: 0, contentVersion: 1, settingsVersion: 1 },
});

export const artworkId = (i: number): string => uuid(0xb000 + i);

export const teacherArtwork = (i: number, over: Partial<ArtworkTeacher> = {}): ArtworkTeacher =>
  ArtworkTeacherSchema.parse({
    id: artworkId(i),
    roomId: testRoomId(0),
    order: i,
    title: `가상 작품 ${i + 1}`,
    author: null,
    caption: null,
    description: null,
    kind: 'TEXT',
    form: 'TEXTCARD',
    textHeavy: false,
    featured: false,
    pageMode: 'AUTO',
    image: null,
    pages: null,
    audio: null,
    textBody: '가상 본문',
    status: 'PUBLISHED',
    formAuto: 'TEXTCARD',
    formOverride: null,
    textHeavyAuto: false,
    textHeavyOverride: null,
    warnings: [],
    failCode: null,
    rev: 1,
    deletedAt: null,
    createdAt: T_NOW,
    updatedAt: T_NOW,
    ...over,
  });

let reactionSeq = 0;
export const teacherReaction = (artwork: number, over: Partial<TeacherReaction> = {}): TeacherReaction =>
  TeacherReactionSchema.parse({
    id: uuid(0xc000 + reactionSeq++),
    artworkId: artworkId(artwork),
    sticker: null,
    memo: null,
    scoreFact: null,
    scoreDelivery: null,
    nickname: null,
    hidden: false,
    publicSelected: false,
    createdAt: T_NOW,
    updatedAt: T_NOW,
    ...over,
  });

/** 부르지 않은 교사 경로는 `E_AUTH`로 거절하는 가짜(부른 것만 `vi.fn`으로 덮어쓴다) */
export const fakeTeacher = (over: Partial<TeacherApi> = {}): TeacherApi =>
  new Proxy(over as TeacherApi, {
    get: (target, key: string) =>
      key in target
        ? (target as unknown as Record<string, unknown>)[key]
        : () => Promise.reject(new AppError('E_AUTH')),
  });

const unusedStudent = (): StudentApi =>
  new Proxy({} as StudentApi, { get: () => () => Promise.reject(new AppError('E_AUTH')) });

export interface TeacherTestServices {
  readonly services: AppServices;
  readonly device: DeviceStore;
  readonly tokens: TokenTools;
}

export const teacherServices = (
  teacher: TeacherApi,
  now: () => number = () => T_NOW,
): TeacherTestServices => {
  const storage = memoryStorage();
  const device = createDeviceStore({ storage: () => storage, now });
  const tokens = createTokenTools();
  const services: AppServices = {
    api: { student: unusedStudent(), teacher },
    device,
    tokens,
    prefs: createVisitorPrefs(() => storage),
    userAgent: 'test',
  };
  return { services, device, tokens };
};

/** 이 기기에 그 전시의 교사 토큰을 둔다 */
export const giveSession = (
  device: DeviceStore,
  tokens: TokenTools,
  exhibitionId: string,
  kind: 'LINK' | 'PIN' = 'LINK',
): string => {
  const token = tokens.newToken();
  device.setTeacherSession(exhibitionId, {
    kind,
    token,
    linkToken: kind === 'LINK' ? token : null,
    pendingLinkToken: null,
  });
  return token;
};

/** 지금 주소(경로 + 조각 + 넘긴 상태)를 시험이 읽게 그린다 */
const LocationProbe = () => {
  const loc = useLocation();
  return (
    <output
      data-testid="location"
      data-path={loc.pathname}
      data-hash={loc.hash}
      data-state={JSON.stringify(loc.state ?? null)}
    />
  );
};

/**
 * 교사 부품 하나를 `MemoryRouter` 안에 그린다. `element`는 `path`에서 보이고, 다른 경로로 가면 빈 자리 + 위치 표시만 남는다.
 */
export const mountTeacher = (element: ReactNode, services: AppServices, at = '/t', path = '/t') => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <ServicesContext value={services}>
          <Routes>
            <Route path={path} element={element} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
          <LocationProbe />
        </ServicesContext>
      </MemoryRouter>,
    );
  });
  const q = <E extends Element = HTMLElement>(sel: string): E | null => document.body.querySelector<E>(sel);
  return {
    container,
    q,
    all: (sel: string): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>(sel)),
    location: () => {
      const el = q('[data-testid="location"]');
      return {
        path: el?.dataset.path ?? '',
        hash: el?.dataset.hash ?? '',
        state: JSON.parse(el?.dataset.state ?? 'null') as unknown,
      };
    },
    unmount: (): void => {
      act(() => root.unmount());
      container.remove();
    },
  };
};
