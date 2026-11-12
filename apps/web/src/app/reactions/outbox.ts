import { config } from '@gallery/core/config';
import { AppError, type ErrorCode } from '@gallery/core/errors';
import { StickerSchema, UuidSchema, type ReactionView } from '@gallery/core/types';
import { z } from 'zod';
import type { ReactionBodyInput, VisitorRegisterInput } from '../../ports/index.ts';

/**
 * 반응 보내기 줄(ADR-049, PLAN §7.3). 끊김·`E_SERVER`·`E_RATE_LIMITED`로 못 보낸 반응을 기기(IndexedDB)에 두었다가
 * 연결이 돌아오면(`online`·화면 복귀·`CHANGE_POLL_SEC`마다) 다시 보낸다.
 *
 * - 열쇠는 반응 열쇠(전시 ID + 작품 ID). 서버의 반응 ID도 (방문자, 작품)으로 정해지고 PUT 본문에는 ID 칸이 없으므로
 *   (`apps/server/src/application/visitors.ts` `reactionIdOf`) 기기가 정하는 같은 신원이다. 같은 작품을 다시 넣으면 앞의 것을 바꾼다.
 * - 보내기는 한 번에 하나씩 차례로(시트에서 바로 보내기와 줄 보내기가 섞여도 옛 값이 새 값 뒤에 도착하지 않게).
 * - 저장소가 막히면(사생활 모드·IndexedDB 없음·꽉 참) 던지지 않고 이 탭 메모리로만 둔다.
 * - 저장소에서 읽은 값은 바깥 입력이라 zod로 검사하고, 모양이 틀린 줄은 지운다.
 */

/** 줄에 남겨 두면 안 되는(다시 보내도 같은 답인) 실패와 구분: 이 코드들만 줄에 넣는다 */
const QUEUE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['E_OFFLINE', 'E_SERVER', 'E_RATE_LIMITED']);

/** 반응 열쇠: 전시 ID + 작품 ID(기기 1대 = 작품 1개에 반응 1개) */
export const reactionKey = (exhibitionId: string, artworkId: string): string =>
  `${exhibitionId}/${artworkId}`;

const ScoreSchema = z.number().int().min(1).max(3).nullable();

/** 줄의 한 칸(저장소에 그대로 들어가는 모양) */
export const OutboxItemSchema = z.object({
  key: z.string(),
  exhibitionId: UuidSchema,
  code: z.string(),
  artworkId: UuidSchema,
  body: z.object({
    sticker: StickerSchema.nullable(),
    memo: z.string().nullable(),
    scoreFact: ScoreSchema,
    scoreDelivery: ScoreSchema,
  }),
  /** 아직 서버에 등록하지 못한 기기면, 보내기 전에 할 방문자 등록(동의한 판·별명) */
  register: z.object({ consentVersion: z.string(), nickname: z.string().optional() }).nullable(),
  /** 줄에 넣은 시각(UTC ms) — 오래된 것부터 보낸다 */
  queuedAt: z.number(),
  /** 그 전시가 지워지는 시각(UTC ms). 지나면 보내지 않고 기기에서 지운다(옛 줄에는 없음) */
  expiresAt: z.number().optional(),
});

export interface OutboxItem {
  readonly key: string;
  readonly exhibitionId: string;
  readonly code: string;
  readonly artworkId: string;
  readonly body: ReactionBodyInput;
  readonly register: VisitorRegisterInput | null;
  readonly queuedAt: number;
  readonly expiresAt?: number;
}

/** 줄을 남기는 곳(주입: 운영은 IndexedDB, 시험은 가짜) */
export interface OutboxStorage {
  /** 남아 있는 줄 전부(모양 검사 전 값) */
  all(): Promise<readonly unknown[]>;
  put(item: OutboxItem): Promise<void>;
  remove(key: string): Promise<void>;
}

/** 이 탭 메모리(IndexedDB가 없을 때·시험) */
export const memoryOutboxStorage = (): OutboxStorage & { readonly rows: Map<string, OutboxItem> } => {
  const rows = new Map<string, OutboxItem>();
  return {
    rows,
    all: async () => [...rows.values()],
    put: async item => void rows.set(item.key, item),
    remove: async key => void rows.delete(key),
  };
};

const DB_NAME = 'gallery-reactions';
const DB_VERSION = 1;
const STORE_NAME = 'outbox';

/** IndexedDB 저장소. 열기가 실패하면 그 뒤 모든 호출이 거절된다(줄이 메모리로 이어 간다) */
export const indexedDbOutboxStorage = (factory: IDBFactory): OutboxStorage => {
  let opening: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME))
          req.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('idb_open'));
      req.onblocked = () => reject(new Error('idb_blocked'));
    }));
  const run = async <T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const req = op(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error ?? new Error('idb_tx'));
      tx.onabort = () => reject(tx.error ?? new Error('idb_abort'));
    });
  };
  return {
    all: () => run('readonly', s => s.getAll() as IDBRequest<unknown[]>),
    put: async item => void (await run('readwrite', s => s.put(item))),
    remove: async key => void (await run('readwrite', s => s.delete(key))),
  };
};

/** 이 기기의 기본 저장소: IndexedDB가 있으면 그것, 없으면 탭 메모리 */
export const defaultOutboxStorage = (): OutboxStorage => {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  return factory ? indexedDbOutboxStorage(factory) : memoryOutboxStorage();
};

export type SubmitResult =
  | { readonly ok: true; readonly view: ReactionView }
  | { readonly ok: false; readonly code: ErrorCode; readonly queued: boolean; readonly error: unknown };

export type OutboxEvent =
  | { readonly type: 'change' }
  | { readonly type: 'sent'; readonly item: OutboxItem; readonly view: ReactionView }
  | {
      readonly type: 'dropped';
      readonly item: OutboxItem;
      readonly code: ErrorCode;
      readonly error: unknown;
    };

export interface ReactionOutbox {
  /** 저장소에 남은 줄을 읽어 왔다(처음 한 번) */
  ready(): Promise<void>;
  /** 지금 줄에 있는 그 반응(없으면 null) */
  get(key: string): OutboxItem | null;
  /** 줄에 남은 것이 있는가(전시 ID를 주면 그 전시만) — 반응 단추의 작은 점 */
  hasPending(exhibitionId?: string): boolean;
  /** 시트에서 바로 보내기: 성공하면 줄의 옛 판도 뺀다. 끊김류면 줄에 넣는다 */
  submit(item: OutboxItem): Promise<SubmitResult>;
  /** 줄을 오래된 것부터 다시 보낸다. 끊김류에서 멈추고, 다시 보내도 안 되는 실패는 줄에서 뺀다 */
  flush(): Promise<void>;
  subscribe(listener: (event: OutboxEvent) => void): () => void;
}

export interface OutboxDeps {
  readonly storage: OutboxStorage;
  /** 등록(필요하면) + PUT */
  readonly send: (item: OutboxItem) => Promise<ReactionView>;
  readonly now?: () => number;
}

export const errorCodeOf = (err: unknown): ErrorCode => (err instanceof AppError ? err.code : 'E_SERVER');

/** 줄에 넣어 다시 보낼 실패인가 */
export const isQueueable = (code: ErrorCode): boolean => QUEUE_CODES.has(code);

export const createReactionOutbox = ({ storage, send, now = Date.now }: OutboxDeps): ReactionOutbox => {
  /** 전시가 지워질 때가 지난 칸(보낼 곳이 없다 — 메모가 기기에 남지 않게 지운다, PLAN §9.6) */
  const expired = (item: { readonly expiresAt?: number | undefined }): boolean =>
    item.expiresAt !== undefined && item.expiresAt <= now();
  const pending = new Map<string, OutboxItem>();
  const listeners = new Set<(event: OutboxEvent) => void>();
  let chain: Promise<unknown> = Promise.resolve();
  let flushing: Promise<void> | null = null;

  const emit = (event: OutboxEvent): void => {
    for (const l of [...listeners]) l(event);
  };

  /** 저장소 실패는 삼킨다(줄은 메모리에서 이어 간다) */
  const quietly = async (op: () => Promise<void>): Promise<void> => {
    try {
      await op();
    } catch {
      // 사생활 모드·꽉 참 — 이 탭이 열려 있는 동안은 메모리 줄로 보낸다
    }
  };

  const loading: Promise<void> = (async () => {
    let rows: readonly unknown[] = [];
    try {
      rows = await storage.all();
    } catch {
      return;
    }
    for (const row of rows) {
      const parsed = OutboxItemSchema.safeParse(row);
      if (!parsed.success) {
        const key = (row as { key?: unknown } | null)?.key;
        if (typeof key === 'string') await quietly(() => storage.remove(key));
        continue;
      }
      if (expired(parsed.data)) {
        const key = parsed.data.key;
        await quietly(() => storage.remove(key));
        continue;
      }
      const { register, expiresAt, ...rest } = parsed.data;
      const item: OutboxItem = {
        ...rest,
        ...(expiresAt === undefined ? {} : { expiresAt }),
        register:
          register === null
            ? null
            : register.nickname === undefined
              ? { consentVersion: register.consentVersion }
              : { consentVersion: register.consentVersion, nickname: register.nickname },
      };
      const mine = pending.get(item.key);
      // 이 탭에서 이미 새로 넣은 판이 있으면 그것이 이긴다
      if (!mine || mine.queuedAt < item.queuedAt) pending.set(item.key, item);
    }
    if (pending.size > 0) emit({ type: 'change' });
  })();

  /** 차례로 하나씩 */
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const put = async (item: OutboxItem): Promise<void> => {
    pending.set(item.key, item);
    // 넘치면 가장 오래된 것부터 뺀다
    const max = config().REACTION_OUTBOX_MAX;
    if (pending.size > max) {
      const oldest = [...pending.values()]
        .sort((a, b) => a.queuedAt - b.queuedAt)
        .slice(0, pending.size - max);
      for (const o of oldest) {
        pending.delete(o.key);
        await quietly(() => storage.remove(o.key));
      }
    }
    await quietly(() => storage.put(item));
    emit({ type: 'change' });
  };

  /** 그 판이 아직 줄에 있을 때만 뺀다(보내는 사이 새 판이 들어왔으면 남긴다) */
  const removeIf = async (item: OutboxItem): Promise<void> => {
    if (pending.get(item.key) !== item) return;
    pending.delete(item.key);
    await quietly(() => storage.remove(item.key));
    emit({ type: 'change' });
  };

  const removeKey = async (key: string): Promise<void> => {
    const item = pending.get(key);
    if (item) await removeIf(item);
  };

  return {
    ready: () => loading,

    get: key => pending.get(key) ?? null,

    hasPending: exhibitionId =>
      exhibitionId === undefined
        ? pending.size > 0
        : [...pending.values()].some(i => i.exhibitionId === exhibitionId),

    submit: item =>
      exclusive(async (): Promise<SubmitResult> => {
        await loading;
        try {
          const view = await send(item);
          await removeKey(item.key);
          emit({ type: 'sent', item, view });
          return { ok: true, view };
        } catch (error) {
          const code = errorCodeOf(error);
          if (isQueueable(code)) {
            await put(item);
            return { ok: false, code, queued: true, error };
          }
          return { ok: false, code, queued: false, error };
        }
      }),

    flush() {
      if (flushing) return flushing;
      flushing = exclusive(async () => {
        await loading;
        const queue = [...pending.values()].sort((a, b) => a.queuedAt - b.queuedAt);
        for (const item of queue) {
          if (pending.get(item.key) !== item) continue;
          if (expired(item)) {
            await removeIf(item);
            continue;
          }
          try {
            const view = await send(item);
            await removeIf(item);
            emit({ type: 'sent', item, view });
          } catch (error) {
            const code = errorCodeOf(error);
            if (isQueueable(code)) break;
            await removeIf(item);
            emit({ type: 'dropped', item, code, error });
          }
        }
      }).finally(() => {
        flushing = null;
      });
      return flushing;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
};

/** 다시 보낼 때: `online`·화면 복귀·`CHANGE_POLL_SEC`마다. 멈추는 함수를 돌려준다 */
export const startOutboxTriggers = (
  outbox: Pick<ReactionOutbox, 'flush' | 'hasPending'>,
  env: {
    readonly win?: Pick<Window, 'addEventListener' | 'removeEventListener'> | undefined;
    readonly doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | undefined;
  } = {},
): (() => void) => {
  const win = env.win ?? (typeof window === 'undefined' ? undefined : window);
  const doc = env.doc ?? (typeof document === 'undefined' ? undefined : document);
  const kick = (): void => {
    if (outbox.hasPending()) void outbox.flush();
  };
  const onVisible = (): void => {
    if (doc?.visibilityState === 'visible') kick();
  };
  win?.addEventListener('online', kick);
  doc?.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(kick, config().CHANGE_POLL_SEC * 1000);
  return () => {
    win?.removeEventListener('online', kick);
    doc?.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
};
