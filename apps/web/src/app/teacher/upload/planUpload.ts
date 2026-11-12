import { groupUpload, type UploadEntry } from '@gallery/core/classify';
import type { ArtworkTeacher, RoomTeacher } from '@gallery/core/types';
import type { CreateRoomInput } from '../../../ports/index.ts';
import type { UploadJob } from './uploadQueue.ts';

/**
 * 받은 파일 → 만들 전시실 + 올릴 일(PLAN §5.2 폴더 규칙, `groupUpload`).
 * - 폴더 없는 파일은 지금 고른 전시실로. 전시실이 하나도 없으면 "전시실 1"을 새로 만든다.
 * - 폴더에서 온 전시실은 새로 만든다(이름판 = 폴더 이름 정리, 비면 "전시실 {n}"). 기존 전시실 뒤에 폴더 순서대로.
 * - 작품 순서는 그 전시실의 지금 마지막 다음부터. 작품·전시실 ID는 기기가 만든다(멱등 키, PLAN §9.2).
 */

export interface PickedFile extends UploadEntry {
  readonly file: Blob;
  readonly name: string;
}

export interface UploadPlanContext {
  readonly rooms: readonly RoomTeacher[];
  readonly artworks: readonly ArtworkTeacher[];
  readonly currentRoomId: string | null;
  readonly newId: () => string;
  /** 새 전시실 기본 이름(`{n}` = 몇 번째) */
  readonly roomTitle: (n: number) => string;
}

export interface UploadPlanResult {
  readonly newRooms: readonly CreateRoomInput[];
  readonly jobs: readonly UploadJob[];
}

const nextOrder = (artworks: readonly ArtworkTeacher[], roomId: string): number =>
  artworks
    .filter(a => a.roomId === roomId && a.deletedAt === null)
    .reduce((m, a) => Math.max(m, a.order), -1) + 1;

export const planUpload = (files: readonly PickedFile[], ctx: UploadPlanContext): UploadPlanResult => {
  const current = ctx.rooms.find(r => r.id === ctx.currentRoomId) ?? ctx.rooms[0] ?? null;
  const plan = groupUpload(files, current?.title ?? null);
  const newRooms: CreateRoomInput[] = [];
  const jobs: UploadJob[] = [];
  let roomOrder = ctx.rooms.reduce((m, r) => Math.max(m, r.order), -1) + 1;
  let roomCount = ctx.rooms.length;

  const makeRoom = (title: string | null): string => {
    roomCount++;
    const id = ctx.newId();
    newRooms.push({
      id,
      order: roomOrder++,
      title: title && title !== '' ? title : ctx.roomTitle(roomCount),
    });
    return id;
  };

  for (const bundle of plan.rooms) {
    const roomId = bundle.source === 'CURRENT' ? (current?.id ?? makeRoom(null)) : makeRoom(bundle.title);
    let order = nextOrder(ctx.artworks, roomId);
    for (const item of bundle.works)
      jobs.push({
        key: ctx.newId(),
        file: item.entry.file,
        name: item.entry.name,
        kind: item.kind,
        target: { type: 'ARTWORK', artworkId: ctx.newId(), roomId, order: order++, title: item.title },
      });
    if (bundle.bgm)
      jobs.push({
        key: ctx.newId(),
        file: bundle.bgm.entry.file,
        name: bundle.bgm.entry.name,
        kind: bundle.bgm.kind,
        target: { type: 'BGM', roomId },
      });
  }
  return { newRooms, jobs };
};
