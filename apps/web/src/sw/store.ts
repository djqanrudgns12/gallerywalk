import { EpochMsSchema, EntryCodeSchema, UuidSchema } from '@gallery/core/types';
import { z } from 'zod';

/** 입장 코드는 재사용될 수 있으므로 사본의 소유 키는 항상 전시 ID다. */
export const ExhibitionRecordSchema = z.object({
  exhibitionId: UuidSchema,
  expiresAt: EpochMsSchema,
  codes: z.array(EntryCodeSchema),
});
export type ExhibitionRecord = z.infer<typeof ExhibitionRecordSchema>;
export interface ExhibitionStore {
  list(): Promise<readonly ExhibitionRecord[]>;
  put(record: ExhibitionRecord): Promise<void>;
  delete(exhibitionId: string): Promise<void>;
}

const DB_NAME = 'gallery-media-cache';
const DB_VERSION = 1;
const RECORDS = 'exhibitions';

/** 시험에서는 이 포트 대신 메모리 저장소를 주입한다. 성공은 요청 완료가 아닌 transaction commit이다. */
export const createExhibitionStore = (factory: IDBFactory): ExhibitionStore => {
  let opening: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> =>
    (opening ??= new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(RECORDS))
          req.result.createObjectStore(RECORDS, { keyPath: 'exhibitionId' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        resolve(db);
      };
      req.onerror = () => {
        opening = undefined;
        reject(req.error);
      };
      req.onblocked = () => {
        opening = undefined;
        reject(new Error('indexeddb blocked'));
      };
    }));
  const transaction = async (
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORDS, mode);
      const req = action(tx.objectStore(RECORDS));
      tx.oncomplete = () => {
        const result: unknown = req.result;
        resolve(result);
      };
      tx.onabort = () => reject(tx.error ?? req.error);
      tx.onerror = () => reject(tx.error ?? req.error);
    });
  };
  return {
    list: async () =>
      z.array(ExhibitionRecordSchema).parse(await transaction('readonly', store => store.getAll())),
    put: async record => {
      await transaction('readwrite', store => store.put(ExhibitionRecordSchema.parse(record)));
    },
    delete: async id => {
      await transaction('readwrite', store => store.delete(UuidSchema.parse(id)));
    },
  };
};
