import { config } from '@gallery/core/config';
import { copy, errorCopy, eulReul, fill, roAfter } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import type { ArtworkBatch, ArtworkTeacher } from '@gallery/core/types';
import { createContext, useContext, useMemo } from 'react';
import type { PatchArtworkInput, PatchRoomInput, TeacherApi } from '../../../ports/index.ts';
import { randomUuid } from '../../../adapters/tokens.ts';
import { roomArtworks, useTeacherStore } from './teacherStore.ts';
import { createUndoStack, movedItem, type UndoEntry } from './undo.ts';

/**
 * 관리 화면의 서버 일(PLAN §7.4). 모든 고치기는 지금 상태의 `rev`로 보내고, `E_CONFLICT`면 토스트 + 새로 불러오기(§9.2).
 * 순서 바꾸기·옮기기·지우기는 화면을 먼저 바꾸고(끌어 놓는 손이 기다리지 않게), 실패하면 새로 불러와 되돌린다.
 * 옮기기·순서·숨기기·전시실 바꾸기·삭제는 되돌리기 스택에 반대 요청을 쌓는다(HT-08). 되돌리기도 지금 rev로 보내고,
 * 그사이 다른 곳에서 바뀌었으면 `E_CONFLICT` → 새로 불러오기 안내 + 스택 비우기.
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
  /** `movedId`: 옮긴 작품(이웃끼리 바꾸면 순서만으로는 알 수 없어 토스트 문장에 씀) */
  reorderArtworks(roomId: string, ids: readonly string[], movedId?: string): Promise<void>;
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
  /** 가장 최근 편집을 되돌린다(토스트 `되돌리기` · Ctrl/⌘+Z) */
  undo(): Promise<void>;
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

  const undoStack = createUndoStack(config().UNDO_STACK_MAX);
  /** 되돌리는 중에는 반대 요청을 다시 쌓지 않는다 */
  let replaying = false;
  /** 실패 수 — 되돌리기가 성공했는지 알려고 센다(화면 먼저 바꾼 일은 실패를 삼킨다) */
  let failures = 0;

  const fail = (err: unknown): never => {
    const code = codeOf(err);
    failures += 1;
    toast(errorCopy[code]);
    if (code === 'E_CONFLICT') {
      undoStack.clear();
      void reload().catch(() => undefined);
    }
    throw err;
  };

  const artwork = (id: string): ArtworkTeacher => {
    const art = store().view?.artworks.find(a => a.id === id);
    if (!art) throw new AppError('E_NOT_FOUND');
    return art;
  };

  /** 화면을 먼저 바꾼 일이 실패하면: 알리고 새로 불러와 서버 상태로 */
  const rollback = async (err: unknown) => {
    failures += 1;
    // 서버 상태로 다시 불러오므로 쌓아 둔 반대 요청은 더 맞지 않을 수 있다
    undoStack.clear();
    toast(errorCopy[codeOf(err)]);
    await reload().catch(() => undefined);
  };

  /** 편집 하나를 스택에 쌓고 `되돌리기` 토스트를 띄운다 */
  const record = (text: string, undo: () => Promise<void>) => {
    if (replaying) return;
    undoStack.push({ text, undo });
    store().showToast({
      text,
      ms: toastMs(),
      action: {
        label: copy.teacher.undo.action,
        run: () => {
          store().hideToast();
          void actions.undo();
        },
      },
    });
  };

  const roomOrder = (roomId: string): string[] => roomArtworks(store().view, roomId).map(a => a.id);
  const roomTitle = (roomId: string): string => store().view?.rooms.find(r => r.id === roomId)?.title ?? '';
  const titled = (template: string, title: string, extra: Record<string, string | number> = {}) =>
    fill(template, { title, eul: eulReul(title), ...extra });
  const inRoom = (template: string, roomId: string, n: number) => {
    const room = roomTitle(roomId);
    return fill(template, { room, ro: roAfter(room), n });
  };
  /** 한 작품을 원래 전시실·순서로 */
  const putBack = async (id: string, roomId: string, order: readonly string[]) => {
    if (artwork(id).roomId !== roomId) await actions.patchArtwork(id, { roomId });
    await actions.reorderArtworks(roomId, order);
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
      const before = artwork(id);
      const fromOrder = roomOrder(before.roomId);
      try {
        store().upsertArtwork(await api.patchArtwork(exhibitionId, id, before.rev, patch));
      } catch (err) {
        fail(err);
      }
      // 되돌리기는 숨기기·게시와 전시실 바꾸기만(글 칸은 그 칸의 되돌리기를 쓴다)
      const keys = Object.keys(patch);
      if (keys.length !== 1) return;
      if (patch.status !== undefined && patch.status !== before.status) {
        const prev = before.status;
        const template = patch.status === 'HIDDEN' ? copy.teacher.undo.hidden : copy.teacher.undo.published;
        record(titled(template, before.title), async () => {
          if (prev === 'HIDDEN' || prev === 'PUBLISHED') await actions.patchArtwork(id, { status: prev });
        });
      } else if (patch.roomId !== undefined && patch.roomId !== before.roomId) {
        const room = roomTitle(patch.roomId);
        record(titled(copy.teacher.undo.movedRoom, before.title, { room, ro: roAfter(room) }), () =>
          putBack(id, before.roomId, fromOrder),
        );
      }
    },

    async reorderArtworks(roomId, ids, movedId) {
      const before = roomOrder(roomId);
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
        return;
      }
      const hinted = movedId !== undefined && before.includes(movedId) ? movedId : undefined;
      const moved =
        hinted !== undefined ? { id: hinted, index: ids.indexOf(hinted) } : movedItem(before, ids);
      if (moved) {
        const title = store().view?.artworks.find(a => a.id === moved.id)?.title ?? '';
        record(titled(copy.teacher.undo.moved, title, { n: moved.index + 1 }), () =>
          actions.reorderArtworks(roomId, before),
        );
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
      await actions.reorderArtworks(art.roomId, next, id);
    },

    async moveArtworks(ids, roomId) {
      const [only] = ids;
      if (ids.length !== 1 || only === undefined) {
        if (ids.length > 0) await actions.batch({ action: 'MOVE', ids: [...ids], roomId });
        return;
      }
      const art = artwork(only);
      if (art.roomId === roomId) return;
      const from = art.roomId;
      const fromOrder = roomOrder(from);
      const end = roomArtworks(store().view, roomId).reduce((m, a) => Math.max(m, a.order), -1) + 1;
      store().patchArtworks(arts => arts.map(a => (a.id === only ? { ...a, roomId, order: end } : a)));
      try {
        store().upsertArtwork(await api.patchArtwork(exhibitionId, only, art.rev, { roomId }));
        if (store().selected.includes(only)) store().clearSelection();
      } catch (err) {
        await rollback(err);
        return;
      }
      record(
        titled(copy.teacher.undo.movedRoom, art.title, {
          room: roomTitle(roomId),
          ro: roAfter(roomTitle(roomId)),
        }),
        () => putBack(only, from, fromOrder),
      );
    },

    async batch(batch) {
      const view = store().view;
      const prev = new Map((view?.artworks ?? []).filter(a => batch.ids.includes(a.id)).map(a => [a.id, a]));
      const fromRooms = new Map<string, string[]>();
      for (const a of prev.values())
        if (!fromRooms.has(a.roomId)) fromRooms.set(a.roomId, roomOrder(a.roomId));
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
        return;
      }
      const arts = [...prev.values()];
      if (batch.action === 'MOVE') {
        const movedArts = arts.filter(a => a.roomId !== batch.roomId);
        if (movedArts.length === 0) return;
        record(inRoom(copy.teacher.undo.movedMany, batch.roomId, movedArts.length), async () => {
          for (const [roomId, order] of fromRooms) {
            const back = movedArts.filter(a => a.roomId === roomId).map(a => a.id);
            if (back.length > 0) await actions.batch({ action: 'MOVE', ids: back, roomId });
            await actions.reorderArtworks(roomId, order);
          }
        });
        return;
      }
      const target = batch.action === 'HIDE' ? 'HIDDEN' : 'PUBLISHED';
      const changed = arts.filter(a => a.status !== target);
      if (changed.length === 0) return;
      const template =
        batch.action === 'HIDE' ? copy.teacher.undo.hiddenMany : copy.teacher.undo.publishedMany;
      record(fill(template, { n: changed.length }), async () => {
        const toPublish = changed.filter(a => a.status === 'PUBLISHED').map(a => a.id);
        const toHide = changed.filter(a => a.status === 'HIDDEN').map(a => a.id);
        if (toPublish.length > 0) await actions.batch({ action: 'PUBLISH', ids: toPublish });
        if (toHide.length > 0) await actions.batch({ action: 'HIDE', ids: toHide });
      });
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
      const restore = async () => {
        store().upsertArtwork(await api.restoreArtwork(exhibitionId, id));
      };
      const entry: UndoEntry = { text: copy.teacher.panel.deleted, undo: restore };
      if (!replaying) undoStack.push(entry);
      store().showToast({
        text: copy.teacher.panel.deleted,
        ms: config().UNDO_DELETE_SEC * MS_PER_SEC,
        action: {
          label: copy.teacher.panel.restore,
          run: () => {
            store().hideToast();
            // 토스트로 되살렸으면 Ctrl/⌘+Z가 같은 것을 다시 되살리지 않게
            undoStack.remove(entry);
            void restore().catch((err: unknown) => rollback(err));
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

    async undo() {
      if (replaying) return;
      const entry = undoStack.pop();
      if (!entry) {
        toast(copy.teacher.undo.nothing);
        return;
      }
      replaying = true;
      const before = failures;
      try {
        await entry.undo();
      } catch (err) {
        // 화면을 먼저 바꾸지 않은 요청(고치기·되살리기)의 실패: 알리고 서버 상태로
        if (failures === before) await rollback(err);
        return;
      } finally {
        replaying = false;
      }
      if (failures === before) toast(copy.teacher.undo.undone);
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
