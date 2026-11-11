import { SW_MESSAGE_TIMEOUT_MS, SW_READY_TIMEOUT_MS } from '../../sw/constants.ts';
import { WorkerReplySchema, type WorkerMessage, type WorkerReply } from '../../sw/protocol.ts';

export interface WorkerConnection {
  register(): Promise<boolean>;
  send(message: WorkerMessage): Promise<WorkerReply>;
}

/** 요청마다 채널을 닫는다. 등록·기기 메시지는 유한 시간만 기다린다. */
export const browserWorkerConnection = (container: ServiceWorkerContainer): WorkerConnection => ({
  register: async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onChange: (() => void) | undefined;
    let finished = false;
    try {
      const ready = (async () => {
        await container.register('/sw.js', { scope: '/', type: 'module', updateViaCache: 'none' });
        await container.ready;
        if (finished) return false;
        if (container.controller) return true;
        return new Promise<boolean>(resolve => {
          onChange = () => {
            if (container.controller) resolve(true);
          };
          container.addEventListener('controllerchange', onChange);
          onChange();
        });
      })();
      return await Promise.race([
        ready,
        new Promise<boolean>(resolve => {
          timer = setTimeout(() => resolve(false), SW_READY_TIMEOUT_MS);
        }),
      ]);
    } catch {
      return false;
    } finally {
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      if (onChange) container.removeEventListener('controllerchange', onChange);
    }
  },
  send: message =>
    new Promise(resolve => {
      const controller = container.controller;
      if (!controller) {
        resolve({ kind: 'FAILED' });
        return;
      }
      const channel = new MessageChannel();
      const finish = (reply: WorkerReply): void => {
        clearTimeout(timer);
        channel.port1.close();
        channel.port2.close();
        resolve(reply);
      };
      const timer = setTimeout(() => finish({ kind: 'FAILED' }), SW_MESSAGE_TIMEOUT_MS);
      channel.port1.onmessage = event => {
        const data: unknown = event.data;
        const parsed = WorkerReplySchema.safeParse(data);
        finish(parsed.success ? parsed.data : { kind: 'FAILED' });
      };
      channel.port1.onmessageerror = () => finish({ kind: 'FAILED' });
      try {
        controller.postMessage(message, [channel.port2]);
      } catch {
        finish({ kind: 'FAILED' });
      }
    }),
});
