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
  /**
   * 글 붙여넣기(V-01): 본문을 `text/plain` 파일(`{제목}.txt`)로 만들어 같은 올리기 줄에 넣는다(지금 전시실 끝).
   * 제목은 파일 이름 규칙(앞번호 지우기 등)을 거치지 않고 적은 그대로 쓴다.
   */
  startText(title: string, body: string): Promise<void>;
  clearFinished(): void;
}

/** 붙여넣은 글의 파일 이름: 경로 구분자는 띄어쓰기로, 앞 `.`(숨김 파일로 걸러짐)은 뗀다 */
const textFileName = (title: string): string =>
  `${title.replace(/[\\/]/g, ' ').replace(/^\.+/, '').trim() || copy.teacher.forms.TEXTCARD}.txt`;

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

  const run = async (files: readonly PickedFile[], title?: string): Promise<void> => {
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
    const jobs = plan.jobs.filter(j => !failedRooms.has(j.target.roomId));
    queue.add(
      title === undefined
        ? jobs
        : jobs.map(j => (j.target.type === 'ARTWORK' ? { ...j, target: { ...j.target, title } } : j)),
    );
  };

  return {
    tasks,
    clearFinished: () => queue.clearFinished(),
    start: files => run(files),
    startText(title, body) {
      const name = textFileName(title);
      const file = new Blob([body], { type: 'text/plain' });
      return run([{ file, name, path: name, size: file.size }], title.trim());
    },
  };
};
