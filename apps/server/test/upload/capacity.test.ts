import { overrideConfig, resetConfig } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { afterEach, describe, expect, it } from 'vitest';
import { ProcessQueue } from '../../src/upload/queue.ts';
import { SpaceReservations } from '../../src/upload/space.ts';

afterEach(resetConfig);

describe('업로드 예약·처리 대기열', () => {
  it('동시 공간 조회는 예약을 이중 사용하지 않고 해제는 멱등이다', async () => {
    overrideConfig({ EXHIBITION_MAX_MB: 1, MEDIA_DISK_MAX_GB: 1, DISK_FREE_MIN_GB: 0 });
    const space = new SpaceReservations(async () => ({
      exhibitionBytes: 0,
      mediaBytes: 0,
      freeBytes: 1024 ** 3,
    }));
    const signal = new AbortController().signal;
    const results = await Promise.allSettled([
      space.reserve('A', 600000, signal),
      space.reserve('A', 600000, signal),
    ]);
    const first = results[0]!;
    expect(first.status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'E_QUOTA' } });
    if (first.status !== 'fulfilled') throw new Error('first reservation failed');
    first.value();
    first.value();
    const release = await space.reserve('A', 1000000, signal);
    release();
  });

  it('서로 다른 전시도 전체 공간 예약을 공유하며 취소된 예약은 다음 요청을 막지 않는다', async () => {
    overrideConfig({ EXHIBITION_MAX_MB: 1000, MEDIA_DISK_MAX_GB: 1, DISK_FREE_MIN_GB: 0 });
    const space = new SpaceReservations(async () => ({
      exhibitionBytes: 0,
      mediaBytes: 0,
      freeBytes: 2 * 1024 ** 3,
    }));
    const controller = new AbortController();
    const release = await space.reserve('A', 600 * 1024 ** 2, controller.signal);
    await expect(space.reserve('B', 600 * 1024 ** 2, controller.signal)).rejects.toMatchObject({
      code: 'E_QUOTA',
    });
    const canceled = new AbortController();
    canceled.abort(new AppError('E_NOT_FOUND'));
    await expect(space.reserve('B', 1, canceled.signal)).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    release();
    (await space.reserve('B', 600 * 1024 ** 2, controller.signal))();
  });

  it('대기는 FIFO이고 취소가 대기 칸을 반환하며 실행 상한을 지킨다', async () => {
    overrideConfig({ PROCESS_CONCURRENCY: 1, PROCESS_QUEUE_MAX: 2 });
    const queue = new ProcessQueue();
    const trail: string[] = [];
    let finish = () => {};
    const gate = new Promise<void>(resolve => {
      finish = resolve;
    });
    const first = queue.run(new AbortController().signal, async () => {
      trail.push('A');
      await gate;
      return 'A';
    });
    const canceled = new AbortController();
    const second = queue.run(canceled.signal, async () => {
      trail.push('B');
      return 'B';
    });
    const third = queue.run(new AbortController().signal, async () => {
      trail.push('C');
      return 'C';
    });
    await expect(queue.run(new AbortController().signal, async () => 'D')).rejects.toMatchObject({
      code: 'E_BUSY',
    });
    expect(queue.length).toBe(2);
    const rejected = expect(second).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    canceled.abort(new AppError('E_NOT_FOUND'));
    await rejected;
    expect(queue.length).toBe(1);
    finish();
    expect(await Promise.all([first, third])).toEqual(['A', 'C']);
    expect(trail).toEqual(['A', 'C']);
    expect(queue.length).toBe(0);
  });
  it('이미 쓴 임시 바이트는 남은 물리 공간에서 이중 예약하지 않는다', async () => {
    overrideConfig({ EXHIBITION_MAX_MB: 100, MEDIA_DISK_MAX_GB: 1, DISK_FREE_MIN_GB: 0 });
    const disk = { exhibitionBytes: 0, mediaBytes: 0, freeBytes: 1000000, pendingBytes: 0 };
    const space = new SpaceReservations(async () => disk);
    const signal = new AbortController().signal;
    const first = await space.reserve('A', 600000, signal);
    disk.freeBytes = 400000;
    disk.pendingBytes = 600000;
    const second = await space.reserve('B', 300000, signal);
    second();
    first();
  });
});
