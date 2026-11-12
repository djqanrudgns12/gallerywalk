import { copy, errorCopy, fill } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { TeacherApi } from '../../../ports/index.ts';
import { newId, toastMs } from '../manage/useManage.ts';
import { useTeacherStore } from '../manage/teacherStore.ts';
import { planUpload, type PickedFile } from './planUpload.ts';
import { createUploadQueue, type UploadQueue, type UploadTask } from './uploadQueue.ts';

/**
 * 관리 화면의 올리기(P5-3): 받은 파일 → 폴더 규칙으로 전시실·순서 → 새 전시실 만들기 → 올리기 줄.
 * 끝난 작품은 바로 격자에 들어간다(`upsertArtwork`). 화면을 떠나면 보내던 것을 멈춘다.
 */
export interface Uploads {
  readonly tasks: readonly UploadTask[];
  start(files: readonly PickedFile[]): Promise<void>;
  clearFinished(): void;
}

export const useUploads = (
  api: TeacherApi,
  exhibitionId: string,
  makeQueue: typeof createUploadQueue = createUploadQueue,
): Uploads => {
  const queue: UploadQueue = useMemo(
    () =>
      makeQueue({
        api,
        exhibitionId,
        onArtwork: art => useTeacherStore.getState().upsertArtwork(art),
        onRoom: room => useTeacherStore.getState().upsertRoom(room),
      }),
    [api, exhibitionId, makeQueue],
  );
  useEffect(() => {
    queue.resume();
    return () => queue.stop();
  }, [queue]);
  const tasks = useSyncExternalStore(queue.subscribe, queue.tasks, queue.tasks);

  return {
    tasks,
    clearFinished: () => queue.clearFinished(),
    async start(files) {
      const store = useTeacherStore.getState();
      const view = store.view;
      if (!view || files.length === 0) return;
      const plan = planUpload(files, {
        rooms: view.rooms,
        artworks: view.artworks,
        currentRoomId: store.roomId,
        newId,
        roomTitle: n => fill(copy.teacher.manage.roomDefault, { n }),
      });
      const failedRooms = new Set<string>();
      for (const room of plan.newRooms) {
        try {
          useTeacherStore.getState().upsertRoom(await api.createRoom(exhibitionId, room));
        } catch (err) {
          failedRooms.add(room.id);
          const code = err instanceof AppError ? err.code : 'E_SERVER';
          useTeacherStore.getState().showToast({ text: errorCopy[code], ms: toastMs() });
        }
      }
      const first = plan.newRooms.find(r => !failedRooms.has(r.id));
      if (store.roomId === null && first) useTeacherStore.getState().setRoom(first.id);
      queue.add(plan.jobs.filter(j => !failedRooms.has(j.target.roomId)));
    },
  };
};
