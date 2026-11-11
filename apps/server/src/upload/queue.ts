import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';

interface Waiting {
  readonly start: () => void;
  readonly cancel: () => void;
}

/** 처리 전체(파생 생성부터 DB 쓰기까지)를 제한한다. 대기 중 취소는 칸을 즉시 돌려준다. */
export class ProcessQueue {
  private running = 0;
  private readonly waiting: Waiting[] = [];

  get length(): number {
    return this.waiting.length;
  }

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.running >= config().PROCESS_CONCURRENCY) {
      if (this.waiting.length >= config().PROCESS_QUEUE_MAX) throw new AppError('E_BUSY');
      await new Promise<void>((resolve, reject) => {
        const entry: Waiting = {
          start: () => {
            signal.removeEventListener('abort', entry.cancel);
            this.running++;
            resolve();
          },
          cancel: () => {
            const index = this.waiting.indexOf(entry);
            if (index !== -1) this.waiting.splice(index, 1);
            reject(signal.reason);
          },
        };
        this.waiting.push(entry);
        signal.addEventListener('abort', entry.cancel, { once: true });
      });
    } else this.running++;
    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      this.running--;
      this.waiting.shift()?.start();
    }
  }
}
