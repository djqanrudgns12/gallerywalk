import { config } from '@gallery/core/config';
import { copy, errorCopy, eulReul, fill, roAfter } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import type { ArtworkBatch, ArtworkTeacher } from '@gallery/core/types';
import { createContext, useContext, useMemo } from 'react';
import type { PatchArtworkInput, PatchRoomInput, TeacherApi } from '../../../ports/index.ts';
import { randomUuid } from '../../../adapters/tokens.ts';
import { roomArtworks, useTeacherStore } from './teacherStore.ts';
import { columnsOf, diffArrangement, locate, placeCards, type Arrangement } from './arrange.ts';
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
  /**
   * 한 번에 놓기(ADR-074, G-32): 끌어 놓기·Alt+←→·살펴보기 타일·여러 개 옮기기·되돌리기가 모두 이 길로 간다.
   * 화면을 먼저 바꾸고 `PUT …/arrangement`를 차례로 하나씩 보낸다. 성공하면 응답의 `revs`를 바로 반영한다(자동 저장 PATCH가
   * 옛 rev로 스스로 충돌하지 않게). 실패·충돌이면 알리고 서버 상태로 되돌린 뒤 false.
   */
  arrange(a: Arrangement, opts?: ArrangeOptions): Promise<boolean>;
  /** 한 판 안의 새 순서(`arrange`로 보냄). `movedId`: 옮긴 작품(이웃끼리 바꾸면 순서만으로는 알 수 없어 토스트 문장에 씀) */
  reorderArtworks(roomId: string, ids: readonly string[], movedId?: string): Promise<void>;
  /** 앞으로(-1)·뒤로(+1) 한 칸 */
  nudgeArtwork(id: string, delta: number): Promise<void>;
  /** 작품들을 그 전시실의 `index` 자리로(없으면 끝). 여러 개면 보드 차례대로. 살펴보기 타일·여러 개 막대가 쓴다 */
  moveArtworks(ids: readonly string[], roomId: string, index?: number): Promise<void>;
  batch(batch: ArtworkBatch): Promise<void>;
  deleteArtwork(id: string): Promise<void>;
  createRoom(): Promise<string | null>;
  patchRoom(roomId: string, patch: PatchRoomInput): Promise<void>;
  reorderRooms(ids: readonly string[]): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  removeBgm(roomId: string): Promise<void>;
  /** 가장 최근 편집을 되돌린다(토스트 `되돌리기` · Ctrl/⌘+Z) */
  undo(): Promise<void>;
  /** 화면을 떠날 때: 늦게 온 답이 저장소를 덮지 않게 한다(줄 선 요청은 그대로 보낸다) */
  dispose(): void;
  /** 화면이 (다시) 올라올 때 — 개발 모드(StrictMode)는 효과를 내렸다 다시 올린다 */
  activate(): void;
}

export interface ArrangeOptions {
  /** 토스트 문장에 쓸 옮긴 작품(끈 작품·여러 개면 그 무리). 없으면 가장 많이 움직인 작품 */
  readonly moved?: readonly string[];
  /** 되돌리기만: 옮기며 풀린 대표작을 되살린다 */
  readonly restoreFeatured?: readonly string[];
}

export const newId = (): string => randomUuid();

const codeOf = (err: unknown) => (err instanceof AppError ? err.code : 'E_SERVER');

/** 놓기의 바꾼 뒤 배열을 작품 목록에 입힌다(서버와 같은 규칙: 다른 판으로 간 대표작은 풀고, 되돌리기면 되살림) */
const applyArrangement = (
  arts: readonly ArtworkTeacher[],
  a: Arrangement,
  restore: ReadonlySet<string>,
): ArtworkTeacher[] => {
  const target = new Map<string, { roomId: string; order: number }>();
  for (const room of a.rooms) room.ids.forEach((id, order) => target.set(id, { roomId: room.roomId, order }));
  return arts.map(x => {
    const t = target.get(x.id);
    if (!t) return x;
    const featured = t.roomId === x.roomId ? x.featured : restore.has(x.id);
    return { ...x, roomId: t.roomId, order: t.order, featured };
  });
};

export const createManageActions = (api: TeacherApi, exhibitionId: string): ManageActions => {
  const store = useTeacherStore.getState;
  const toast = (text: string) => store().showToast({ text, ms: toastMs() });
  /** 화면을 떠난 뒤(다른 전시로 가도) 늦게 온 답이 저장소를 덮지 않게(검토 L4) */
  let disposed = false;

  // ── 작품 쓰기 차례 줄(ADR-074, 검토 H1·M2) ─────────────────────────
  // 놓기·고치기·삭제·여러 개·판 순서를 모두 이 줄로 하나씩 보낸다. rev·base는 차례가 왔을 때 읽어 앞 요청의 결과를 본다.
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;
  /** 실패하면 올라간다 — 그 전에 줄에 선 놓기는 실패한 화면 위에 쌓인 것이라 보내지 않는다 */
  let epoch = 0;
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    pending += 1;
    const run = queue.then(task, task).finally(() => {
      pending -= 1;
    });
    queue = run.catch(() => undefined);
    return run;
  };
  /** 아직 답을 받지 않은 놓기(차례대로) — 새로 받은 보기 위에 다시 입힌다 */
  const inflight: { readonly a: Arrangement; readonly restore: ReadonlySet<string> }[] = [];
  const reapply = () => {
    if (inflight.length === 0) return;
    store().patchArtworks(arts => inflight.reduce((acc, f) => applyArrangement(acc, f.a, f.restore), arts));
  };

  const reload = async () => {
    const view = await api.exhibition(exhibitionId);
    if (disposed) return;
    store().setView(view);
    reapply();
  };

  const undoStack = createUndoStack(config().UNDO_STACK_MAX);
  /** 되돌리는 중에는 반대 요청을 다시 쌓지 않는다 */
  let replaying = false;
  /** 되돌리기를 겹쳐 부르지 않는다(줄을 기다리는 동안도) */
  let undoing = false;
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

  /**
   * 화면을 먼저 바꾼 일이 실패하면: 먼저 바꾸기 전 모습으로 되돌리고(학교망이 끊겨 새로 불러오기도 실패할 때 저장 안 된 화면이
   * 남지 않게 — 검토 H3), 알리고, 뒤에서 새로 불러온다.
   */
  const rollback = async (err: unknown, restoreView?: () => void) => {
    failures += 1;
    // 서버 상태로 다시 불러오므로 쌓아 둔 반대 요청은 더 맞지 않을 수 있다
    undoStack.clear();
    if (!disposed) restoreView?.();
    toast(errorCopy[codeOf(err)]);
    await reload().catch(() => undefined);
  };

  /** 편집 하나를 스택에 쌓고 `되돌리기` 토스트를 띄운다 */
  const record = (text: string, undo: () => Promise<void>) => {
    if (replaying || disposed) return;
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
  /** 한 작품을 원래 전시실·순서로(한 번에 놓기 하나 — 옛 PATCH+PUT 두 번 대신) */
  const putBack = async (id: string, roomId: string, order: readonly string[], featured: boolean) => {
    const columns = columnsOf(store().view);
    const after = placeCards(columns, [id], { roomId, index: Math.max(0, order.indexOf(id)) });
    const a = diffArrangement(columns, after);
    if (a) await actions.arrange(a, { moved: [id], restoreFeatured: featured ? [id] : [] });
  };

  /**
   * 놓기 되돌리기: 저장해 둔 반대 배열이 아니라 **지금** 배열에서 다시 계산한다(검토 M3). 그 판들의 작품을 놓기 전 차례로,
   * 그사이 지운 작품은 빼고, 그사이 들어온 작품(올리기·되살리기)은 지금 판 끝에 그대로 둔다.
   */
  const undoArrangement = async (a: Arrangement, unfeatured: readonly string[]) => {
    const now = columnsOf(store().view);
    const affected = new Set(a.base.map(c => c.roomId));
    const pool = new Set(now.filter(c => affected.has(c.roomId)).flatMap(c => c.ids));
    const original = new Set(a.base.flatMap(c => c.ids));
    const after = now.map(col => {
      const old = a.base.find(c => c.roomId === col.roomId);
      if (!old) return col;
      return {
        ...col,
        ids: [...old.ids.filter(id => pool.has(id)), ...col.ids.filter(id => !original.has(id))],
      };
    });
    const back = diffArrangement(now, after);
    if (back) await actions.arrange(back, { restoreFeatured: unfeatured.filter(id => pool.has(id)) });
  };

  /** 놓기의 토스트 문장: 여러 개 · 다른 전시실 n번째 · 같은 판 n번째 */
  const arrangeText = (
    a: Arrangement,
    before: ReadonlyMap<string, ArtworkTeacher>,
    moved?: readonly string[],
  ) => {
    const after = a.rooms;
    if (moved && moved.length > 1) {
      const at = locate(after, moved[0] ?? '');
      return at ? inRoom(copy.teacher.undo.movedMany, at.roomId, moved.length) : null;
    }
    const baseOf = (roomId: string): readonly string[] => a.base.find(b => b.roomId === roomId)?.ids ?? [];
    // 정하지 않았으면: 다른 판에서 들어온 작품, 없으면 가장 많이 움직인 작품
    const id =
      moved?.[0] ??
      after.flatMap(room => room.ids.filter(x => !baseOf(room.roomId).includes(x)))[0] ??
      after.map(room => movedItem(baseOf(room.roomId), room.ids)?.id).find(x => x !== undefined);
    if (id === undefined) return null;
    const at = locate(after, id);
    const art = before.get(id);
    if (!at || !art) return null;
    if (at.roomId === art.roomId) return titled(copy.teacher.undo.moved, art.title, { n: at.index + 1 });
    return titled(copy.teacher.undo.movedTo, art.title, { room: roomTitle(at.roomId), n: at.index + 1 });
  };

  /** 삭제한 작품은 고른 목록에서도 뺀다(검토 L3) */
  const unselect = (id: string) => {
    if (store().selected.includes(id)) store().toggleSelect(id);
  };

  const actions: ManageActions = {
    reload,
    fail,
    dispose() {
      disposed = true;
    },
    activate() {
      disposed = false;
    },

    async renameExhibition(title) {
      const ex = store().view?.exhibition;
      if (!ex) return;
      try {
        const next = await api.patchExhibition(exhibitionId, ex.rev, { title });
        if (!disposed) store().setExhibition(next);
      } catch (err) {
        fail(err);
      }
    },

    async patchArtwork(id, patch) {
      const before = artwork(id);
      const fromOrder = roomOrder(before.roomId);
      // 차례가 오면 그때의 rev로 보낸다 — 앞선 놓기가 rev를 올렸어도 스스로 충돌하지 않게(검토 M2)
      await serial(async () => {
        try {
          const next = await api.patchArtwork(exhibitionId, id, artwork(id).rev, patch);
          if (!disposed) store().upsertArtwork(next);
        } catch (err) {
          fail(err);
        }
      });
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
          putBack(id, before.roomId, fromOrder, before.featured),
        );
      }
    },

    arrange(a, opts = {}) {
      const view = store().view;
      if (!view) return Promise.resolve(false);
      const before = new Map(view.artworks.map(x => [x.id, x] as const));
      const restore = new Set(opts.restoreFeatured ?? []);
      const entry = { a, restore };
      const myEpoch = epoch;
      const text = arrangeText(a, before, opts.moved);
      // 화면 먼저 — 차례를 기다리지 않고 바로(다음 끌기·한 칸 옮기기가 이 결과 위에서 `base`를 만든다, 검토 H1)
      inflight.push(entry);
      store().patchArtworks(arts => applyArrangement(arts, a, restore));
      const settle = () => {
        const i = inflight.indexOf(entry);
        if (i >= 0) inflight.splice(i, 1);
      };
      /** 실패하면 이 놓기 전 자리로(이 뒤에 줄 선 놓기의 화면도 함께 걷힌다) */
      const restoreView = () =>
        store().patchArtworks(arts =>
          arts.map(x => {
            const b = before.get(x.id);
            return b ? { ...x, roomId: b.roomId, order: b.order, featured: b.featured } : x;
          }),
        );
      return serial(async () => {
        if (myEpoch !== epoch) {
          settle();
          return false;
        }
        let result;
        try {
          result = await api.putArrangement(exhibitionId, {
            base: a.base.map(c => ({ roomId: c.roomId, ids: [...c.ids] })),
            rooms: a.rooms.map(c => ({ roomId: c.roomId, ids: [...c.ids] })),
            // 이 기기가 아는 작품 — 판에 그사이 생긴 작품 중 이 기기가 알던 것(다른 기기가 옮겨 넣음)은 충돌로(검토 M4)
            known: [...before.values()]
              .filter(x => x.deletedAt === null && !a.base.some(c => c.ids.includes(x.id)))
              .map(x => x.id),
            ...(restore.size > 0 ? { restoreFeatured: [...restore] } : {}),
          });
        } catch (err) {
          settle();
          epoch += 1;
          inflight.length = 0;
          await rollback(err, restoreView);
          return false;
        }
        settle();
        if (disposed) return true;
        // 서버 배열(그사이 올라온 작품은 끝에)과 새 rev를 바로, 그 위에 아직 답을 받지 않은 놓기를 다시
        const placed = new Map<string, { roomId: string; order: number }>();
        for (const room of result.rooms)
          room.ids.forEach((id, order) => placed.set(id, { roomId: room.roomId, order }));
        const revs = result.revs;
        store().patchArtworks(arts =>
          arts.map(x => {
            const p = placed.get(x.id);
            const rev = revs[x.id];
            if (!p && rev === undefined) return x;
            return { ...x, ...(p ?? {}), ...(rev === undefined ? {} : { rev }) };
          }),
        );
        reapply();
        const unfeatured = [...before.values()]
          .filter(x => x.featured && placed.has(x.id) && placed.get(x.id)?.roomId !== x.roomId)
          .map(x => x.id);
        if (text) record(text, () => undoArrangement(a, unfeatured));
        // 지도(배치)를 새로: 차례를 기다리는 일이 없을 때만
        if (pending <= 1) void reload().catch(() => undefined);
        return true;
      });
    },

    async reorderArtworks(roomId, ids, movedId) {
      const columns = columnsOf(store().view);
      const after = columns.map(c => (c.roomId === roomId ? { ...c, ids } : c));
      const a = diffArrangement(columns, after);
      if (a) await actions.arrange(a, movedId === undefined ? {} : { moved: [movedId] });
    },

    async nudgeArtwork(id, delta) {
      // 저장소에는 줄 선 놓기까지 이미 입혀져 있다 — 연달아 눌러도 앞 이동 위에서 계산한다(검토 H1)
      const columns = columnsOf(store().view);
      const at = locate(columns, id);
      const column = columns.find(c => c.roomId === at?.roomId);
      if (!at || !column) return;
      const to = at.index + delta;
      if (to < 0 || to >= column.ids.length) return;
      const a = diffArrangement(columns, placeCards(columns, [id], { roomId: at.roomId, index: to }));
      if (a) await actions.arrange(a, { moved: [id] });
    },

    async moveArtworks(ids, roomId, index) {
      const columns = columnsOf(store().view);
      const ordered = columns.flatMap(c => c.ids.filter(id => ids.includes(id)));
      if (ordered.length === 0) return;
      const target = columns.find(c => c.roomId === roomId);
      if (!target) return;
      const rest = target.ids.filter(id => !ordered.includes(id)).length;
      const a = diffArrangement(columns, placeCards(columns, ordered, { roomId, index: index ?? rest }));
      if (a) await actions.arrange(a, { moved: ordered });
    },

    async batch(batch) {
      if (batch.action === 'MOVE') {
        // 여러 개 옮기기도 한 번에 놓기로(옮긴 곳 끝, 보드 차례대로)
        await actions.moveArtworks(batch.ids, batch.roomId);
        store().clearSelection();
        return;
      }
      const view = store().view;
      const prev = new Map((view?.artworks ?? []).filter(a => batch.ids.includes(a.id)).map(a => [a.id, a]));
      const ok = await serial(async () => {
        try {
          await api.batchArtworks(exhibitionId, batch);
        } catch (err) {
          await rollback(err);
          return false;
        }
        return true;
      });
      if (!ok) return;
      store().clearSelection();
      await reload().catch(() => undefined);
      const arts = [...prev.values()];
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
      const was = artwork(id);
      const now = Date.now();
      store().patchArtworks(arts => arts.map(a => (a.id === id ? { ...a, deletedAt: now } : a)));
      unselect(id);
      if (store().overlay?.kind === 'artwork') store().setOverlay(null);
      const ok = await serial(async () => {
        try {
          await api.deleteArtwork(exhibitionId, id, artwork(id).rev);
        } catch (err) {
          await rollback(err, () =>
            store().patchArtworks(arts =>
              arts.map(a => (a.id === id ? { ...a, deletedAt: was.deletedAt } : a)),
            ),
          );
          return false;
        }
        return true;
      });
      if (!ok) return;
      const restore = () =>
        serial(async () => {
          const back = await api.restoreArtwork(exhibitionId, id);
          if (!disposed) store().upsertArtwork(back);
        });
      const entry: UndoEntry = { text: copy.teacher.panel.deleted, undo: restore };
      if (!replaying && !disposed) undoStack.push(entry);
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
        if (disposed) return null;
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
        const next = await api.patchRoom(exhibitionId, roomId, room.rev, patch);
        if (!disposed) store().upsertRoom(next);
      } catch (err) {
        fail(err);
      }
    },

    async reorderRooms(ids) {
      const view = store().view;
      if (!view) return;
      const rooms = view.rooms;
      // 바꾸기 전 순서를 함께 보내 다른 기기가 먼저 바꿨으면 충돌로 멈춘다(ADR-074)
      const base = rooms.map(r => r.id);
      if (base.length === ids.length && base.every((id, i) => id === ids[i])) return;
      const order = new Map(ids.map((id, i) => [id, i]));
      store().setRooms(rooms.map(r => ({ ...r, order: order.get(r.id) ?? r.order })));
      const ok = await serial(async () => {
        try {
          await api.reorderRooms(exhibitionId, ids, base);
        } catch (err) {
          await rollback(err, () => store().setRooms(rooms));
          return false;
        }
        return true;
      });
      if (!ok) return;
      // 새로 불러오기만 실패한 것은 순서 바꾸기 실패가 아니다(검토 L8)
      void reload().catch(() => undefined);
      const moved = movedItem(base, ids);
      if (moved)
        record(titled(copy.teacher.undo.moved, roomTitle(moved.id), { n: moved.index + 1 }), () =>
          actions.reorderRooms(base),
        );
    },

    async deleteRoom(roomId) {
      const room = store().view?.rooms.find(r => r.id === roomId);
      if (!room) return;
      try {
        await serial(() => api.deleteRoom(exhibitionId, roomId, room.rev));
        if (disposed) return;
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
      if (undoing) return;
      undoing = true;
      try {
        // 줄에 선 쓰기가 끝나(그 되돌리기 항목이 쌓인) 뒤 꺼낸다 — 막 놓은 것을 건너뛰지 않게(검토 M1)
        await queue;
        const entry = undoStack.pop();
        if (!entry) {
          toast(copy.teacher.undo.nothing);
          return;
        }
        const before = failures;
        replaying = true;
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
      } finally {
        undoing = false;
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
