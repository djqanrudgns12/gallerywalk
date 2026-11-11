import type { Layout } from '@gallery/core/types';

/**
 * 모아 보기(G-04) 목록: 전시실마다 작품을 전시 순서(정지 지점 순서)로. 나뉜 관(1관·2관)은 한 전시실로 묶는다.
 * 작품을 누르면 그 정지 지점으로 걸어가 바로 크게 본다 — 그래서 정지 지점 번호를 함께 둔다.
 */
export interface CollectionRoom {
  readonly roomId: string;
  readonly items: readonly { readonly artworkId: string; readonly stopIndex: number }[];
}

export const collectionOf = (layout: Layout, roomOrder: readonly string[]): CollectionRoom[] => {
  const roomOfPart = new Map(layout.parts.map(p => [p.partId, p.roomId]));
  const byRoom = new Map<string, { artworkId: string; stopIndex: number }[]>();
  layout.stops.forEach((s, stopIndex) => {
    if (s.kind !== 'artwork' || !s.artworkId || !s.partId) return;
    const roomId = roomOfPart.get(s.partId);
    if (!roomId) return;
    const list = byRoom.get(roomId) ?? [];
    list.push({ artworkId: s.artworkId, stopIndex });
    byRoom.set(roomId, list);
  });
  return roomOrder.flatMap(roomId => {
    const items = byRoom.get(roomId);
    return items && items.length > 0 ? [{ roomId, items }] : [];
  });
};
