import { AppError } from '@gallery/core/errors';
import {
  ExhibitionSettingsSchema,
  type ArtworkTeacher,
  type ExhibitionTeacher,
  type RoomTeacher,
  type TeacherExhibitionView,
} from '@gallery/core/types';
import type { TeacherApi } from '../ports/index.ts';
import { testArtworkId, testAssetId, testRoomId, TEST_EXHIBITION_ID, uuid } from './testView.ts';

/**
 * 교사 관리 화면 시험 자료(합성 글·가상 작가만, AGENTS.md §2)와 메모리 안의 가짜 교사 서버.
 * 가짜 서버는 rev 검사(`E_CONFLICT`)·순서·여러 장·지우기·되살리기·전시실 지우기(첫 다른 전시실로 옮김)를 서버 규칙대로 흉내 낸다.
 */

export const T_EX = TEST_EXHIBITION_ID;
export const T_TITLE = '합성 근대사 전시';
export const T_ROOM_TITLES = ['1관 개항', '2관 독립운동'] as const;
export const T_NEW_TITLE = '새로 고친 제목';
export const T_ARRIVAL = '이 전시는 오늘부터 30일 동안 열 수 있어요';

const variants = [
  { name: 'thumb', ext: 'webp', w: 512, h: 341, bytes: 30_000 },
  { name: 'wall', ext: 'webp', w: 1600, h: 1067, bytes: 280_000 },
] as const;

export const teacherExhibition = (over: Partial<ExhibitionTeacher> = {}): ExhibitionTeacher => ({
  id: T_EX,
  entryCode: '123456',
  title: T_TITLE,
  subtitle: null,
  templateId: 'modern-history',
  poster: null,
  schoolName: null,
  className: null,
  showSchool: false,
  settings: ExhibitionSettingsSchema.parse({}),
  status: 'DRAFT',
  rev: 1,
  createdAt: Date.UTC(2026, 10, 12),
  expiresAt: Date.UTC(2026, 11, 12),
  openedAt: null,
  closedAt: null,
  ...over,
});

export const teacherRoom = (r: number, over: Partial<RoomTeacher> = {}): RoomTeacher => ({
  id: testRoomId(r),
  order: r,
  title: T_ROOM_TITLES[r] ?? `전시실 ${r + 1}`,
  intro: null,
  bgm: null,
  rev: 1,
  ...over,
});

export const teacherArtwork = (r: number, i: number, over: Partial<ArtworkTeacher> = {}): ArtworkTeacher => ({
  id: testArtworkId(r, i),
  roomId: testRoomId(r),
  order: i,
  title: `가상 작품 ${r + 1}-${i + 1}`,
  author: null,
  caption: null,
  description: null,
  kind: 'IMAGE',
  form: 'LANDSCAPE',
  textHeavy: false,
  featured: false,
  pageMode: 'AUTO',
  image: {
    asset: { assetId: testAssetId(r, i), variants: [...variants] },
    w: 3000,
    h: 2000,
    analysis: {
      edgeLuma: 0.3,
      linePitchPx: null,
      linePitchConfidence: 0,
      lineProfile: null,
      profileBinPx: 8,
    },
  },
  pages: null,
  audio: null,
  textBody: null,
  status: 'PUBLISHED',
  formAuto: 'LANDSCAPE',
  formOverride: null,
  textHeavyAuto: false,
  textHeavyOverride: null,
  warnings: [],
  failCode: null,
  rev: 1,
  deletedAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

/** 전시실마다 작품 수 */
export const teacherView = (roomSizes: readonly number[] = [3, 1]): TeacherExhibitionView => ({
  exhibition: teacherExhibition(),
  rooms: roomSizes.map((_, r) => teacherRoom(r)),
  artworks: roomSizes.flatMap((n, r) => Array.from({ length: n }, (_, i) => teacherArtwork(r, i))),
  layout: null,
  versions: { layoutVersion: 1, contentVersion: 1, settingsVersion: 1 },
});

export interface FakeCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

const clone = <T>(v: T): T => structuredClone(v);

/**
 * 메모리 안의 교사 서버. `over`로 메서드 하나를 바꿔 끼운다(실패·지연). 바꾸지 않은 메서드는 상태를 고친다.
 * 이 시험에서 쓰지 않는 경로는 `E_AUTH`로 거절한다.
 */
export const fakeTeacherServer = (
  initial: TeacherExhibitionView = teacherView(),
  over: Partial<TeacherApi> = {},
) => {
  const state = clone(initial);
  const calls: FakeCall[] = [];
  let newRoomSeq = 0x900;

  const art = (id: string) => {
    const a = state.artworks.find(x => x.id === id);
    if (!a) throw new AppError('E_NOT_FOUND');
    return a;
  };
  const room = (id: string) => {
    const r = state.rooms.find(x => x.id === id);
    if (!r) throw new AppError('E_NOT_FOUND');
    return r;
  };
  const bump = <T extends { rev: number }>(x: T, patch: Partial<T>): T =>
    Object.assign(x, patch, { rev: x.rev + 1 });

  const base: Partial<TeacherApi> = {
    exhibition: async () => clone(state),
    patchExhibition: async (_e, rev, patch) => {
      if (rev !== state.exhibition.rev) throw new AppError('E_CONFLICT');
      return clone(bump(state.exhibition, patch as Partial<ExhibitionTeacher>));
    },
    patchArtwork: async (_e, id, rev, patch) => {
      const a = art(id);
      if (rev !== a.rev) throw new AppError('E_CONFLICT');
      return clone(bump(a, patch as Partial<ArtworkTeacher>));
    },
    reorderArtworks: async (_e, roomId, ids) => {
      const current = state.artworks.filter(a => a.roomId === roomId && a.deletedAt === null).map(a => a.id);
      if (current.length !== ids.length || current.some(id => !ids.includes(id)))
        throw new AppError('E_CONFLICT');
      ids.forEach((id, order) => {
        const a = art(id);
        if (a.order !== order) bump(a, { order });
      });
    },
    batchArtworks: async (_e, batch) => {
      for (const id of batch.ids) {
        const a = art(id);
        if (batch.action === 'MOVE') bump(a, { roomId: batch.roomId });
        else bump(a, { status: batch.action === 'HIDE' ? 'HIDDEN' : 'PUBLISHED' });
      }
    },
    deleteArtwork: async (_e, id, rev) => {
      const a = art(id);
      if (rev !== a.rev) throw new AppError('E_CONFLICT');
      bump(a, { deletedAt: 1 });
    },
    restoreArtwork: async (_e, id) => clone(bump(art(id), { deletedAt: null })),
    createRoom: async (_e, body) => {
      const r: RoomTeacher = {
        id: body.id,
        order: body.order,
        title: body.title,
        intro: body.intro ?? null,
        bgm: null,
        rev: 1,
      };
      state.rooms.push(r);
      return clone(r);
    },
    patchRoom: async (_e, id, rev, patch) => {
      const r = room(id);
      if (rev !== r.rev) throw new AppError('E_CONFLICT');
      return clone(bump(r, patch as Partial<RoomTeacher>));
    },
    deleteRoom: async (_e, id, rev) => {
      const r = room(id);
      if (rev !== r.rev) throw new AppError('E_CONFLICT');
      const target = state.rooms.filter(x => x.id !== id).sort((a, b) => a.order - b.order)[0];
      const moving = state.artworks.filter(x => x.roomId === id).sort((a, b) => a.order - b.order);
      if (moving.length > 0 && !target) throw new AppError('E_CONFLICT');
      if (target) {
        // 서버처럼 옮겨 간 전시실의 끝에 이어 붙인다
        let order = state.artworks
          .filter(x => x.roomId === target.id)
          .reduce((m, x) => Math.max(m, x.order), -1);
        for (const a of moving) bump(a, { roomId: target.id, order: ++order });
      }
      state.rooms = state.rooms.filter(x => x.id !== id);
    },
    reorderRooms: async (_e, ids) => {
      ids.forEach((id, order) => bump(room(id), { order }));
    },
    removeBgm: async (_e, id) => {
      bump(room(id), { bgm: null });
    },
    uploadArtwork: async (_e, meta, _file, opts) => {
      opts?.onProgress?.({ loaded: 1, total: 2 });
      opts?.onProgress?.({ loaded: 2, total: 2 });
      const a = teacherArtwork(0, 0, {
        id: meta.id,
        roomId: meta.roomId,
        order: meta.order,
        title: meta.title,
        kind: meta.kind,
        image: {
          ...teacherArtwork(0, 0).image!,
          asset: { assetId: uuid(newRoomSeq++), variants: [...variants] },
        },
      });
      state.artworks.push(a);
      return clone(a);
    },
    createArtwork: async (_e, body) => {
      const a = teacherArtwork(0, 0, {
        id: body.id,
        roomId: body.roomId,
        order: body.order,
        title: body.title,
        kind: body.kind,
        form: 'TEXTCARD',
        image: null,
        textBody: body.kind === 'TEXT' ? body.textBody : null,
      });
      state.artworks.push(a);
      return clone(a);
    },
    uploadBgm: async (_e, roomId) => clone(bump(room(roomId), {})),
  };

  const api = new Proxy({} as TeacherApi, {
    get: (_t, key: string) => {
      const f = (over as Record<string, unknown>)[key] ?? (base as Record<string, unknown>)[key];
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
        if (typeof f !== 'function') return Promise.reject(new AppError('E_AUTH'));
        return (f as (...a: unknown[]) => Promise<unknown>)(...args);
      };
    },
  });

  return {
    api,
    state,
    calls,
    named: (name: string) => calls.filter(c => c.name === name),
  };
};

/** 합성 PNG 머리(IHDR만 — 사전 검사가 치수를 읽는다). 내용 해시가 겹치지 않게 `seed` 바이트를 붙인다 */
export const pngFile = (name: string, w: number, h: number, seed = 0): File => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  b[39] = seed;
  return new File([b], name, { type: 'image/png' });
};

export const SYNTH_FILE_NAMES = {
  first: '01_가상 그림.png',
  second: '02_합성 풍경.png',
  third: '03_가상 지도.png',
  fourth: '04_합성 사진.png',
  tiny: '작은 그림.png',
  video: '수업 영상.mp4',
  pdf: '가상 보고서.pdf',
  folderA: '1_개항/01_가상 항구.png',
  folderB: '2_독립/01_가상 만세.png',
  folderBgm: '2_독립/배경 노래.mp3',
} as const;
