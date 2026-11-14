import { AppError } from '@gallery/core/errors';
import { deletedArtworkPurgeAt } from '@gallery/core/retention';
import type { Arrangement, ArrangementResult, ArtworkBatch, PatchArtwork } from '@gallery/core/types';
import type { ArtworkRecord, Deps, ExhibitionRecord } from '../ports/index.ts';
import { assertRev, assertSameExhibition, bump, liveExhibition } from './common.ts';

/**
 * 작품 고치기·순서·한 번에 놓기·여러 개·지우기·되살리기(G-11·G-32, PLAN §9.2, ADR-074). 올리기(파일 받기·처리)는 P3-4.
 * 대표작 규칙(한 트랜잭션): 고르면 같은 전시실의 기존 대표작을 먼저 푼다 / 다른 전시실로 옮기면 풀린다 /
 * 되살릴 때(지운 작품 되살리기·놓기 되돌리기의 `restoreFeatured`) 그 전시실에 이미 대표작이 있으면 표시 없이 되살린다.
 */

const live = (deps: Deps, ex: ExhibitionRecord, id: string): ArtworkRecord => {
  const a = deps.store.artworks.get(id);
  assertSameExhibition(a, ex.id);
  if (a!.deletedAt !== null) throw new AppError('E_NOT_FOUND');
  return a!;
};

const unsetFeaturedIn = (deps: Deps, exhibitionId: string, roomId: string, exceptId: string): void => {
  for (const other of deps.store.artworks.listByExhibition(exhibitionId))
    if (other.roomId === roomId && other.featured && other.id !== exceptId)
      deps.store.artworks.update(other.id, {
        featured: false,
        rev: other.rev + 1,
        updatedAt: deps.clock.now(),
      });
};

/** 그 전시실 끝 순서(지운 작품의 옛 순서까지 넘어서 — 되살려도 겹치지 않게). 올리기·되살리기·옮기기가 쓴다 */
export const nextOrder = (deps: Pick<Deps, 'store'>, exhibitionId: string, roomId: string): number =>
  deps.store.artworks
    .listByExhibition(exhibitionId, { includeDeleted: true })
    .filter(a => a.roomId === roomId)
    .reduce((m, a) => Math.max(m, a.order), -1) + 1;

/** 판 안의 차례: `order`, 같으면 ID(서버의 "지금 배열") */
const byOrder = (a: { order: number; id: string }, b: { order: number; id: string }): number =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** 배치에 영향을 주는 칸: 게시 집합·전시실·대표작·형태. 글 많음·쪽 방식은 기기의 쪽 계획만 바꾼다(배치 밖). */
const LAYOUT_FIELDS: readonly (keyof PatchArtwork)[] = ['roomId', 'status', 'featured', 'formOverride'];

/** `PATCH /api/teacher/artworks/{aid}` (`If-Match: {rev}`) */
export const patchArtwork = (
  deps: Deps,
  exhibitionId: string,
  artworkId: string,
  patch: PatchArtwork,
  ifMatch: number | null,
): ArtworkRecord =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const a = live(deps, ex, artworkId);
    assertRev(a, ifMatch);
    if (a.status === 'PROCESSING' || a.status === 'FAILED') {
      if (patch.status !== undefined || patch.featured !== undefined) throw new AppError('E_CONFLICT');
    }
    if (patch.textBody !== undefined && a.kind !== 'TEXT') throw new AppError('E_VALIDATION');
    let roomId = a.roomId;
    let order = a.order;
    let featured = patch.featured ?? a.featured;
    if (patch.roomId !== undefined && patch.roomId !== a.roomId) {
      assertSameExhibition(deps.store.rooms.get(patch.roomId), ex.id);
      roomId = patch.roomId;
      order = nextOrder(deps, ex.id, roomId);
      featured = patch.featured ?? false; // 옮기면 대표 표시가 풀린다
    }
    if (featured) unsetFeaturedIn(deps, ex.id, roomId, a.id);
    const { textBody, author, caption, description, ...rest } = patch;
    const updated = deps.store.artworks.update(a.id, {
      ...rest,
      ...(textBody !== undefined ? { textBody } : {}),
      ...(author !== undefined ? { author } : {}),
      ...(caption !== undefined ? { captionShort: caption } : {}),
      ...(description !== undefined ? { descriptionLong: description } : {}),
      roomId,
      order,
      featured,
      rev: a.rev + 1,
      updatedAt: deps.clock.now(),
    });
    bump(deps, ex, { content: true, layout: LAYOUT_FIELDS.some(k => patch[k] !== undefined) });
    return updated;
  });

/** `PUT /api/teacher/rooms/{roomId}/artwork-order` — 집합이 지금(지우지 않은 작품)과 다르면 충돌 */
export const reorderArtworks = (
  deps: Deps,
  exhibitionId: string,
  roomId: string,
  ids: readonly string[],
): void =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    assertSameExhibition(deps.store.rooms.get(roomId), ex.id);
    const inRoom = deps.store.artworks.listByExhibition(ex.id).filter(a => a.roomId === roomId);
    const current = new Set(inRoom.map(a => a.id));
    if (ids.length !== current.size || ids.some(id => !current.has(id))) throw new AppError('E_CONFLICT');
    const now = deps.clock.now();
    ids.forEach((id, order) => {
      const a = inRoom.find(x => x.id === id)!;
      if (a.order !== order) deps.store.artworks.update(id, { order, rev: a.rev + 1, updatedAt: now });
    });
    bump(deps, ex, { content: true, layout: true });
  });

/**
 * `PUT /api/teacher/exhibitions/{id}/arrangement`(ADR-074): 같은 판 순서·다른 판 n번째·여러 개 옮기기·되돌리기를 한 번에.
 *
 * - 검사: 모든 전시실이 이 전시의 것(아니면 `E_NOT_FOUND`). 서버의 지금 배열(지우지 않은 작품, `order` 차례)에서
 *   `base`에 없는 작품(그사이 올라온 것)을 뺀 것이 판마다 `base`와 같아야 한다 — 다르면 `E_CONFLICT`.
 *   그래서 두 기기가 같은 판을 바꾸면 나중 것이 충돌로 멈추고, 올리는 중에 새 작품이 생긴 것은 충돌이 아니다.
 * - 효과(한 트랜잭션): 판마다 `rooms`의 차례로 `roomId`·`order`(0부터), 그사이 올라온 작품은 그 판 끝에.
 *   전시실이 바뀐 작품은 대표작이 풀린다 — `restoreFeatured`에 있고 그 판에 남은 대표작이 없으면 되살린다.
 *   바뀐 작품만 rev+1. 바뀐 것이 있으면 내용 버전을 올리고 배치를 다시 계산하게 표시한다(라우트가 `settle`).
 * - 돌려줌: 놓은 뒤 판들의 배열, 그 판들 작품의 rev, 전시 내용 판(`versions.contentVersion`과 같은 수).
 */
export const arrangeArtworks = (deps: Deps, exhibitionId: string, body: Arrangement): ArrangementResult =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    for (const r of body.rooms) assertSameExhibition(deps.store.rooms.get(r.roomId), ex.id);
    const seen = new Set(body.base.flatMap(r => r.ids));
    const current = new Map<string, ArtworkRecord[]>(body.base.map(r => [r.roomId, []]));
    for (const a of deps.store.artworks.listByExhibition(ex.id)) current.get(a.roomId)?.push(a);
    for (const list of current.values()) list.sort(byOrder);
    // 기기가 이미 알던 작품이 그사이 이 판에 들어왔으면(다른 기기가 옮겨 넣음) 말없이 덮지 않고 충돌로(검토 M4)
    const known = new Set(body.known ?? []);
    for (const r of body.base) {
      const now = (current.get(r.roomId) ?? []).filter(a => seen.has(a.id)).map(a => a.id);
      if ((current.get(r.roomId) ?? []).some(a => !seen.has(a.id) && known.has(a.id)))
        throw new AppError('E_CONFLICT');
      if (!sameOrder(now, r.ids)) throw new AppError('E_CONFLICT');
    }

    const byId = new Map([...current.values()].flat().map(a => [a.id, a]));
    const finalRooms = body.rooms.map(r => ({
      roomId: r.roomId,
      ids: [...r.ids, ...(current.get(r.roomId) ?? []).filter(a => !seen.has(a.id)).map(a => a.id)],
    }));
    const restore = new Set(body.restoreFeatured ?? []);
    const t = deps.clock.now();
    const revs: Record<string, number> = {};
    let changed = false;
    for (const room of finalRooms) {
      const arts = room.ids.map(id => byId.get(id)!);
      // 그 판에 그대로 남는 대표작이 있으면 되살리지 않는다(전시실마다 대표작 하나)
      let hasFeatured = arts.some(a => a.roomId === room.roomId && a.featured);
      arts.forEach((a, order) => {
        let featured = a.featured;
        if (a.roomId !== room.roomId) {
          featured = restore.has(a.id) && !hasFeatured && a.status !== 'PROCESSING' && a.status !== 'FAILED';
          if (featured) hasFeatured = true;
        }
        if (a.roomId === room.roomId && a.order === order && a.featured === featured) {
          revs[a.id] = a.rev;
          return;
        }
        deps.store.artworks.update(a.id, {
          roomId: room.roomId,
          order,
          featured,
          rev: a.rev + 1,
          updatedAt: t,
        });
        revs[a.id] = a.rev + 1;
        changed = true;
      });
    }
    const after = changed ? bump(deps, ex, { content: true, layout: true }) : ex;
    return { rooms: finalRooms, revs, revision: after.contentVersion };
  });

/** `POST /api/teacher/artworks/batch` — 숨기기·게시·옮기기(처리 중·실패는 건너뜀) */
export const batchArtworks = (deps: Deps, exhibitionId: string, batch: ArtworkBatch): number =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const targets = batch.ids.map(id => live(deps, ex, id));
    if (batch.action === 'MOVE') assertSameExhibition(deps.store.rooms.get(batch.roomId), ex.id);
    const now = deps.clock.now();
    let changed = 0;
    let order = batch.action === 'MOVE' ? nextOrder(deps, ex.id, batch.roomId) : 0;
    for (const a of targets) {
      if (a.status === 'PROCESSING' || a.status === 'FAILED') continue;
      if (batch.action === 'MOVE') {
        if (a.roomId === batch.roomId) continue;
        deps.store.artworks.update(a.id, {
          roomId: batch.roomId,
          order: order++,
          featured: false,
          rev: a.rev + 1,
          updatedAt: now,
        });
      } else {
        const status = batch.action === 'HIDE' ? 'HIDDEN' : 'PUBLISHED';
        if (a.status === status) continue;
        deps.store.artworks.update(a.id, { status, rev: a.rev + 1, updatedAt: now });
      }
      changed++;
    }
    if (changed > 0) bump(deps, ex, { content: true, layout: true });
    return changed;
  });

/** `DELETE /api/teacher/artworks/{aid}` — 표시만(되살리기 `UNDO_DELETE_SEC` 안내, 파일은 24시간 뒤 정리) */
export const deleteArtwork = (
  deps: Deps,
  exhibitionId: string,
  artworkId: string,
  ifMatch: number | null,
): void =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const a = live(deps, ex, artworkId);
    assertRev(a, ifMatch);
    deps.store.artworks.update(a.id, {
      deletedAt: deps.clock.now(),
      rev: a.rev + 1,
      updatedAt: deps.clock.now(),
    });
    bump(deps, ex, { content: true, layout: true });
  });

/** `POST …/{aid}/restore` — 정리되기 전까지. 그 전시실 끝으로(ADR-074), 대표작이 이미 있으면 표시 없이 */
export const restoreArtwork = (deps: Deps, exhibitionId: string, artworkId: string): ArtworkRecord =>
  deps.store.transaction(() => {
    const ex = liveExhibition(deps, exhibitionId);
    const a = deps.store.artworks.get(artworkId);
    assertSameExhibition(a, ex.id);
    if (a!.deletedAt === null) return a!;
    const now = deps.clock.now();
    if (now >= deletedArtworkPurgeAt(a!.deletedAt)) throw new AppError('E_NOT_FOUND');
    if (!deps.store.rooms.get(a!.roomId)) throw new AppError('E_NOT_FOUND');
    const roomHasFeatured = deps.store.artworks
      .listByExhibition(ex.id)
      .some(o => o.roomId === a!.roomId && o.featured && o.id !== a!.id);
    const restored = deps.store.artworks.update(a!.id, {
      deletedAt: null,
      order: nextOrder(deps, ex.id, a!.roomId),
      featured: a!.featured && !roomHasFeatured,
      rev: a!.rev + 1,
      updatedAt: now,
    });
    bump(deps, ex, { content: true, layout: true });
    return restored;
  });
