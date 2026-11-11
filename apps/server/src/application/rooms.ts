import { AppError } from '@gallery/core/errors';
import type { z } from 'zod';
import type { CreateRoomSchema, PatchRoomSchema } from '@gallery/core/types';
import type { Deps, RoomRecord } from '../ports/index.ts';
import { assertRev, assertSameExhibition, bump, createHashOf, liveExhibition } from './common.ts';

/** 전시실(G-12, PLAN §9.2). ID는 기기가 만든 UUID — 만들기는 멱등, 고치기·지우기는 `If-Match`. */

type CreateRoom = z.infer<typeof CreateRoomSchema>;
type PatchRoom = z.infer<typeof PatchRoomSchema>;

export const createRoom = (deps: Deps, exhibitionId: string, body: CreateRoom): RoomRecord => {
  const hash = createHashOf(body);
  return deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const existing = deps.store.rooms.get(body.id);
    if (existing) {
      if (existing.exhibitionId !== ex.id || existing.createHash !== hash) throw new AppError('E_CONFLICT');
      return existing;
    }
    const now = deps.clock.now();
    const rec: RoomRecord = {
      id: body.id,
      exhibitionId: ex.id,
      order: body.order,
      title: body.title,
      intro: body.intro ?? null,
      bgmAssetId: null,
      rev: 1,
      createHash: hash,
      createdAt: now,
      updatedAt: now,
    };
    deps.store.rooms.insert(rec);
    bump(deps, ex, { content: true, layout: true });
    return rec;
  });
};

export const patchRoom = (
  deps: Deps,
  exhibitionId: string,
  roomId: string,
  patch: PatchRoom,
  ifMatch: number | null,
): RoomRecord =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const room = deps.store.rooms.get(roomId);
    assertSameExhibition(room, ex.id);
    assertRev(room!, ifMatch);
    const updated = deps.store.rooms.update(roomId, {
      ...patch,
      rev: room!.rev + 1,
      updatedAt: deps.clock.now(),
    });
    // 이름·소개는 배치에 들어가지 않는다(ADR-052) — 내용 버전만
    bump(deps, ex, { content: true });
    return updated;
  });

/**
 * 전시실 지우기: 작품이 있으면 남은 전시실 중 첫째(순서) 끝으로 옮긴다("작품 n개는 전시실 1로 옮겨져요").
 * 작품이 있는데 남는 전시실이 없으면 지울 수 없다.
 */
export const deleteRoom = (deps: Deps, exhibitionId: string, roomId: string, ifMatch: number | null): void =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const room = deps.store.rooms.get(roomId);
    assertSameExhibition(room, ex.id);
    assertRev(room!, ifMatch);
    const others = deps.store.rooms
      .listByExhibition(ex.id)
      .filter(r => r.id !== roomId)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    const moving = deps.store.artworks
      .listByExhibition(ex.id, { includeDeleted: true })
      .filter(a => a.roomId === roomId)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    const target = others[0];
    if (moving.length > 0 && !target) throw new AppError('E_CONFLICT');
    if (target) {
      const base =
        deps.store.artworks
          .listByExhibition(ex.id, { includeDeleted: true })
          .filter(a => a.roomId === target.id)
          .reduce((m, a) => Math.max(m, a.order), -1) + 1;
      const targetHasFeatured = deps.store.artworks
        .listByExhibition(ex.id)
        .some(a => a.roomId === target.id && a.featured);
      moving.forEach((a, i) =>
        deps.store.artworks.update(a.id, {
          roomId: target.id,
          order: base + i,
          // 대표작은 전시실마다 하나 — 옮겨 간 곳에 이미 있으면 푼다
          featured: a.featured && !targetHasFeatured,
          rev: a.rev + 1,
          updatedAt: deps.clock.now(),
        }),
      );
    }
    deps.store.rooms.delete(roomId);
    bump(deps, ex, { content: true, layout: true });
  });

/** `PUT …/{id}/rooms/order` — 받은 ID 집합이 지금 집합과 다르면 충돌 */
export const reorderRooms = (deps: Deps, exhibitionId: string, ids: readonly string[]): void =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const rooms = deps.store.rooms.listByExhibition(ex.id);
    const current = new Set(rooms.map(r => r.id));
    if (ids.length !== current.size || ids.some(id => !current.has(id))) throw new AppError('E_CONFLICT');
    const now = deps.clock.now();
    ids.forEach((id, order) => {
      const r = rooms.find(x => x.id === id)!;
      if (r.order !== order) deps.store.rooms.update(id, { order, rev: r.rev + 1, updatedAt: now });
    });
    bump(deps, ex, { content: true, layout: true });
  });
