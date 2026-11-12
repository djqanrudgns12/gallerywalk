import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import type { ArtworkBatch, ArtworkTeacher } from '@gallery/core/types';
import { createContext, useContext, useMemo } from 'react';
import type { PatchArtworkInput, PatchRoomInput, TeacherApi } from '../../../ports/index.ts';
import { randomUuid } from '../../../adapters/tokens.ts';
import { roomArtworks, useTeacherStore } from './teacherStore.ts';

/**
 * 관리 화면의 서버 일(PLAN §7.4). 모든 고치기는 지금 상태의 `rev`로 보내고, `E_CONFLICT`면 토스트 + 새로 불러오기(§9.2).
 * 순서 바꾸기·옮기기·지우기는 화면을 먼저 바꾸고(끌어 놓는 손이 기다리지 않게), 실패하면 새로 불러와 되돌린다.
 */

const MS_PER_SEC = 1000;
/** 보통 토스트가 떠 있는 시간(ms) — `TOAST_SEC`(교사 공용 토스트와 같게) */
export const toastMs = (): number => config().TOAST_SEC * MS_PER_SEC;

export interface ManageActions {
  reload(): Promise<void>;
  /** 실패를 알린다(충돌이면 새로 불러옴). 다시 던진다 — 칸 옆 다시 시도가 알 수 있게 */
  fail(err: unknown): never;
  renameExhibition(title: string): Promise<void>;
  patchArtwork(id: string, patch: PatchArtworkInput): Promise<void>;
  reorderArtworks(roomId: string, ids: readonly string[]): Promise<void>;
  /** 앞으로(-1)·뒤로(+1) 한 칸 */
  nudgeArtwork(id: string, delta: number): Promise<void>;
  /** 끌어서 전시실 칩 위에 놓기: 한 장은 `patchArtwork({roomId})`, 여러 장은 `batchArtworks(MOVE)`. 옮긴 곳의 끝에 붙는다 */
  moveArtworks(ids: readonly string[], roomId: string): Promise<void>;
  batch(batch: ArtworkBatch): Promise<void>;
  deleteArtwork(id: string): Promise<void>;
  createRoom(): Promise<string | null>;
  patchRoom(roomId: string, patch: PatchRoomInput): Promise<void>;
  reorderRooms(ids: readonly string[]): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  removeBgm(roomId: string): Promise<void>;
}

export const newId = (): string => randomUuid();

const codeOf = (err: unknown) => (err instanceof AppError ? err.code : 'E_SERVER');

export const createManageActions = (api: TeacherApi, exhibitionId: string): ManageActions => {
  const store = useTeacherStore.getState;
  const toast = (text: string) => store().showToast({ text, ms: toastMs() });

  const reload = async () => {
    const view = await api.exhibition(exhibitionId);
    store().setView(view);
  };

  const fail = (err: unknown): never => {
    const code = codeOf(err);
    toast(errorCopy[code]);
    if (code === 'E_CONFLICT') void reload().catch(() => undefined);
    throw err;
  };

  const artwork = (id: string): ArtworkTeacher => {
    const art = store().view?.artworks.find(a => a.id === id);
    if (!art) throw new AppError('E_NOT_FOUND');
    return art;
  };

  /** 화면을 먼저 바꾼 일이 실패하면: 알리고 새로 불러와 서버 상태로 */
  const rollback = async (err: unknown) => {
    toast(errorCopy[codeOf(err)]);
    await reload().catch(() => undefined);
  };

  const actions: ManageActions = {
    reload,
    fail,

    async renameExhibition(title) {
      const ex = store().view?.exhibition;
      if (!ex) return;
      try {
        store().setExhibition(await api.patchExhibition(exhibitionId, ex.rev, { title }));
      } catch (err) {
        fail(err);
      }
    },

    async patchArtwork(id, patch) {
      try {
        store().upsertArtwork(await api.patchArtwork(exhibitionId, id, artwork(id).rev, patch));
      } catch (err) {
        fail(err);
      }
    },

    async reorderArtworks(roomId, ids) {
      const order = new Map(ids.map((id, i) => [id, i]));
      store().patchArtworks(arts =>
        arts.map(a => (a.roomId === roomId && order.has(a.id) ? { ...a, order: order.get(a.id)! } : a)),
      );
      try {
        await api.reorderArtworks(exhibitionId, roomId, ids);
        // 순서가 바뀐 작품의 rev가 올랐다 — 다음 고치기가 충돌하지 않게 새로
        await reload();
      } catch (err) {
        await rollback(err);
      }
    },

    async nudgeArtwork(id, delta) {
      const art = artwork(id);
      const ids = roomArtworks(store().view, art.roomId).map(a => a.id);
      const from = ids.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return;
      const next = [...ids];
      next.splice(from, 1);
      next.splice(to, 0, id);
      await actions.reorderArtworks(art.roomId, next);
    },

    async moveArtworks(ids, roomId) {
      const [only] = ids;
      if (ids.length !== 1 || only === undefined) {
        if (ids.length > 0) await actions.batch({ action: 'MOVE', ids: [...ids], roomId });
        return;
      }
      const art = artwork(only);
      if (art.roomId === roomId) return;
      const end = roomArtworks(store().view, roomId).reduce((m, a) => Math.max(m, a.order), -1) + 1;
      store().patchArtworks(arts => arts.map(a => (a.id === only ? { ...a, roomId, order: end } : a)));
      try {
        store().upsertArtwork(await api.patchArtwork(exhibitionId, only, art.rev, { roomId }));
        if (store().selected.includes(only)) store().clearSelection();
      } catch (err) {
        await rollback(err);
      }
    },

    async batch(batch) {
      if (batch.action === 'MOVE') {
        const ids = new Set(batch.ids);
        store().patchArtworks(arts => arts.map(a => (ids.has(a.id) ? { ...a, roomId: batch.roomId } : a)));
      }
      try {
        await api.batchArtworks(exhibitionId, batch);
        store().clearSelection();
        await reload();
      } catch (err) {
        await rollback(err);
      }
    },

    async deleteArtwork(id) {
      const art = artwork(id);
      const now = Date.now();
      store().patchArtworks(arts => arts.map(a => (a.id === id ? { ...a, deletedAt: now } : a)));
      if (store().overlay?.kind === 'artwork') store().setOverlay(null);
      try {
        await api.deleteArtwork(exhibitionId, id, art.rev);
      } catch (err) {
        await rollback(err);
        return;
      }
      store().showToast({
        text: copy.teacher.panel.deleted,
        ms: config().UNDO_DELETE_SEC * MS_PER_SEC,
        action: {
          label: copy.teacher.panel.restore,
          run: () => {
            store().hideToast();
            void api.restoreArtwork(exhibitionId, id).then(
              restored => store().upsertArtwork(restored),
              (err: unknown) => void rollback(err),
            );
          },
        },
      });
    },

    async createRoom() {
      const view = store().view;
      if (!view) return null;
      const id = newId();
      const order = view.rooms.reduce((m, r) => Math.max(m, r.order), -1) + 1;
      try {
        const room = await api.createRoom(exhibitionId, {
          id,
          order,
          title: fill(copy.teacher.manage.roomDefault, { n: view.rooms.length + 1 }),
        });
        store().upsertRoom(room);
        store().setRoom(room.id);
        return room.id;
      } catch (err) {
        toast(errorCopy[codeOf(err)]);
        return null;
      }
    },

    async patchRoom(roomId, patch) {
      const room = store().view?.rooms.find(r => r.id === roomId);
      if (!room) return;
      try {
        store().upsertRoom(await api.patchRoom(exhibitionId, roomId, room.rev, patch));
      } catch (err) {
        fail(err);
      }
    },

    async reorderRooms(ids) {
      const view = store().view;
      if (!view) return;
      const order = new Map(ids.map((id, i) => [id, i]));
      store().setRooms(view.rooms.map(r => ({ ...r, order: order.get(r.id) ?? r.order })));
      try {
        await api.reorderRooms(exhibitionId, ids);
        await reload();
      } catch (err) {
        await rollback(err);
      }
    },

    async deleteRoom(roomId) {
      const room = store().view?.rooms.find(r => r.id === roomId);
      if (!room) return;
      try {
        await api.deleteRoom(exhibitionId, roomId, room.rev);
        store().setOverlay(null);
        store().removeRoom(roomId);
        await reload();
      } catch (err) {
        fail(err);
      }
    },

    async removeBgm(roomId) {
      try {
        await api.removeBgm(exhibitionId, roomId);
        await reload();
      } catch (err) {
        fail(err);
      }
    },
  };
  return actions;
};

export const ManageContext = createContext<ManageActions | null>(null);

export const useManageActions = (): ManageActions => {
  const actions = useContext(ManageContext);
  if (!actions) throw new Error('ManageContext missing');
  return actions;
};

export const useCreateManageActions = (api: TeacherApi, exhibitionId: string): ManageActions =>
  useMemo(() => createManageActions(api, exhibitionId), [api, exhibitionId]);
