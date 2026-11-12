import type {
  ArtworkRecord,
  AssetRecord,
  DeletedRows,
  Deps,
  EventLog,
  EventLogFields,
  ExhibitionRecord,
  LayoutRecord,
  MediaFiles,
  PageRecord,
  ReactionRecord,
  RoomRecord,
  Store,
  TeacherSessionRecord,
  UploadDrain,
  VisitorRecord,
} from '../../src/ports/index.ts';

/**
 * 메모리 저장소(시험용 참조 구현). SQLite 저장소(`store/**`)가 지켜야 할 동작을 그대로 흉내 낸다:
 * 트랜잭션 안에서 던지면 모두 되돌림, 고치기에서 `undefined` 칸은 건너뜀, 없는 행 고치기는 오류.
 */

const skipUndefined = <T extends object>(patch: T): Partial<T> =>
  Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

interface Tables {
  exhibitions: Map<string, ExhibitionRecord>;
  rooms: Map<string, RoomRecord>;
  artworks: Map<string, ArtworkRecord>;
  assets: Map<string, AssetRecord>;
  pages: Map<string, PageRecord>;
  layouts: LayoutRecord[];
  sessions: Map<string, TeacherSessionRecord>;
  visitors: Map<string, VisitorRecord>;
  reactions: Map<string, ReactionRecord>;
  devices: Set<string>;
}

const empty = (): Tables => ({
  exhibitions: new Map(),
  rooms: new Map(),
  artworks: new Map(),
  assets: new Map(),
  pages: new Map(),
  layouts: [],
  sessions: new Map(),
  visitors: new Map(),
  reactions: new Map(),
  devices: new Set(),
});

const insertNew = <T>(map: Map<string, T>, key: string, rec: T): void => {
  if (map.has(key)) throw new Error(`이미 있는 행: ${key}`);
  map.set(key, rec);
};

const updateIn = <T extends object>(map: Map<string, T>, id: string, patch: object): T => {
  const row = map.get(id);
  if (!row) throw new Error(`없는 행 고치기: ${id}`);
  const next = { ...row, ...skipUndefined(patch) } as T;
  map.set(id, next);
  return next;
};

/** 조건에 맞는 행을 지우고 지운 수(외래키 연쇄 흉내) */
const deleteWhere = <T>(map: Map<string, T>, match: (row: T) => boolean): number => {
  let n = 0;
  for (const [key, row] of map)
    if (match(row)) {
      map.delete(key);
      n += 1;
    }
  return n;
};

/** 전시 행 지우기 — SQLite의 `ON DELETE CASCADE`처럼 딸린 행을 모두 함께(0001_init.sql) */
const cascadeDelete = (t: Tables, id: string): DeletedRows => {
  const artworkIds = new Set([...t.artworks.values()].filter(a => a.exhibitionId === id).map(a => a.id));
  const layoutsBefore = t.layouts.length;
  t.layouts = t.layouts.filter(l => l.exhibitionId !== id);
  const mine = (row: { readonly exhibitionId: string }) => row.exhibitionId === id;
  return {
    reactions: deleteWhere(t.reactions, mine),
    visitors: deleteWhere(t.visitors, mine),
    sessions: deleteWhere(t.sessions, mine),
    pages: deleteWhere(t.pages, p => artworkIds.has(p.artworkId)),
    artworks: deleteWhere(t.artworks, mine),
    rooms: deleteWhere(t.rooms, mine),
    assets: deleteWhere(t.assets, mine),
    layouts: layoutsBefore - t.layouts.length,
    exhibitions: t.exhibitions.delete(id) ? 1 : 0,
  };
};

export const memoryStore = (): Store & { readonly tables: () => Tables } => {
  let t = empty();
  const batch = <T extends { readonly id: string }>(rows: T[], limit: number, afterId = ''): T[] =>
    rows
      .filter(row => row.id > afterId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit);
  const assetReferenced = (id: string): boolean =>
    [...t.artworks.values()].some(a => a.sourceAssetId === id) ||
    [...t.pages.values()].some(p => p.assetId === id) ||
    [...t.exhibitions.values()].some(e => e.posterAssetId === id) ||
    [...t.rooms.values()].some(r => r.bgmAssetId === id);
  const store: Store & { readonly tables: () => Tables } = {
    tables: () => t,
    transaction<T>(fn: () => T): T {
      const snapshot = structuredClone(t);
      try {
        return fn();
      } catch (error) {
        t = snapshot;
        throw error;
      }
    },
    exhibitions: {
      get: id => t.exhibitions.get(id) ?? null,
      listForCleanup: (now, limit, afterId) =>
        batch(
          [...t.exhibitions.values()].filter(e => e.deleting || e.expiresAt <= now),
          limit,
          afterId,
        ),
      // insert는 덮어쓰지 않는다(SQLite 기본 키와 같게 — 다른 전시의 행을 덮어 옮기는 길을 막음, P3-store)
      getByEntryCode: code => [...t.exhibitions.values()].find(e => e.entryCode === code) ?? null,
      getByPinHmac: pinHmac => [...t.exhibitions.values()].find(e => e.pinHmac === pinHmac) ?? null,
      pinTaken: (pinHmac, exceptId) =>
        [...t.exhibitions.values()].some(e => e.pinHmac === pinHmac && e.id !== exceptId),
      entryCodeTaken: code => [...t.exhibitions.values()].some(e => e.entryCode === code),
      insert: rec => void insertNew(t.exhibitions, rec.id, rec),
      update: (id, patch) => updateIn(t.exhibitions, id, patch),
      delete: id => cascadeDelete(t, id),
    },
    rooms: {
      get: id => t.rooms.get(id) ?? null,
      listByExhibition: ex => [...t.rooms.values()].filter(r => r.exhibitionId === ex),
      insert: rec => void insertNew(t.rooms, rec.id, rec),
      update: (id, patch) => updateIn(t.rooms, id, patch),
      delete: id => void t.rooms.delete(id),
    },
    artworks: {
      get: id => t.artworks.get(id) ?? null,
      listDeletedBefore: (cutoff, limit, afterId) =>
        batch(
          [...t.artworks.values()].filter(a => a.deletedAt !== null && a.deletedAt <= cutoff),
          limit,
          afterId,
        ),
      listIncompletePdfBefore: (cutoff, limit, afterId) =>
        batch(
          [...t.artworks.values()].filter(
            a =>
              a.kind === 'PDF' && a.status === 'PROCESSING' && a.deletedAt === null && a.updatedAt <= cutoff,
          ),
          limit,
          afterId,
        ),
      deleteDeletedBefore: (id, cutoff) => {
        const a = t.artworks.get(id);
        if (!a || a.deletedAt === null || a.deletedAt > cutoff) return false;
        deleteWhere(t.pages, p => p.artworkId === id);
        deleteWhere(t.reactions, r => r.artworkId === id);
        return t.artworks.delete(id);
      },
      listByExhibition: (ex, options) =>
        [...t.artworks.values()].filter(
          a => a.exhibitionId === ex && (options?.includeDeleted || a.deletedAt === null),
        ),
      insert: rec => void insertNew(t.artworks, rec.id, rec),
      update: (id, patch) => updateIn(t.artworks, id, patch),
    },
    assets: {
      get: id => t.assets.get(id) ?? null,
      listUnreferencedBefore: (cutoff, limit, afterId) =>
        batch(
          [...t.assets.values()].filter(a => a.createdAt <= cutoff && !assetReferenced(a.id)),
          limit,
          afterId,
        ),
      isReferenced: assetReferenced,
      deleteUnreferenced: id => !assetReferenced(id) && t.assets.delete(id),
      listByIds: ids => ids.flatMap(id => (t.assets.has(id) ? [t.assets.get(id)!] : [])),
      insert: rec => void insertNew(t.assets, rec.id, rec),
    },
    pages: {
      listByArtworks: ids => [...t.pages.values()].filter(p => ids.includes(p.artworkId)),
      put: rec => void t.pages.set(`${rec.artworkId}:${rec.idx}`, rec),
    },
    layouts: {
      latest: ex =>
        t.layouts.filter(l => l.exhibitionId === ex).sort((a, b) => b.version - a.version)[0] ?? null,
      insert: rec => void t.layouts.push(rec),
      prune: (ex, keep) => {
        const mine = t.layouts.filter(l => l.exhibitionId === ex).sort((a, b) => b.version - a.version);
        const drop = new Set(mine.slice(keep));
        t.layouts = t.layouts.filter(l => !drop.has(l));
      },
    },
    sessions: {
      get: h => t.sessions.get(h) ?? null,
      insert: rec => void insertNew(t.sessions, rec.tokenHash, rec),
      touch: (h, at) => void updateIn(t.sessions, h, { lastUsedAt: at }),
      deleteKind: (ex, kind) => {
        for (const [h, s] of t.sessions) if (s.exhibitionId === ex && s.kind === kind) t.sessions.delete(h);
      },
    },
    visitors: {
      get: (h, ex) => {
        const v = t.visitors.get(h);
        return v && v.exhibitionId === ex ? v : null;
      },
      insert: rec => void insertNew(t.visitors, rec.tokenHash, rec),
      update: (h, ex, patch) => {
        // 다른 전시의 방문자는 "없는 행"(SQLite 구현과 같게)
        if (t.visitors.get(h)?.exhibitionId !== ex) throw new Error(`없는 행 고치기: ${h}`);
        return updateIn(t.visitors, h, patch);
      },
    },
    reactions: {
      listByExhibition: ex => [...t.reactions.values()].filter(r => r.exhibitionId === ex),
      getByVisitor: (art, h) =>
        [...t.reactions.values()].find(r => r.artworkId === art && r.visitorTokenHash === h) ?? null,
      upsert: rec => void t.reactions.set(rec.id, rec),
      update: (id, patch) => updateIn(t.reactions, id, patch),
    },
    // WAL이 없다
    checkpoint: () => true,
  };
  return store;
};

/** 가짜 미디어 폴더: 폴더가 있는 전시 ID 집합. 시험이 지우기 실패를 정한다 */
export interface FakeMedia extends MediaFiles {
  readonly folders: Set<string>;
  readonly assetFolders: Set<string>;
  /** 다음 지우기 n번은 던진다(권한 없음 같은 실패) */
  failNext(n?: number): void;
  /** 다음 지우기 n번은 성공이라 답하지만 폴더가 남는다(지운 뒤 확인이 잡아야 함) */
  stickNext(n?: number): void;
}

/** 가짜 업로드 기다리기: 기다리는 동안 시험이 할 일(`during`) — 지우는 중에 들어온 요청 흉내 */
export interface FakeUploads extends UploadDrain {
  during: ((exhibitionId: string) => Promise<void> | void) | undefined;
}

export interface LogLine {
  readonly level: 'info' | 'warn';
  readonly msg: string;
  readonly fields: EventLogFields | undefined;
}

/**
 * 지우기 단계 가짜들. 부른 차례는 `trail`에 `"drain {id} {ms}"`·`"remove {id}"`·`"exists {id}"`로 남는다
 * (체크포인트는 `sqliteDeps.ts`가 저장소를 감싸 `"checkpoint"`로 남긴다).
 */
export const fakeDeletionPorts = (trail: string[]) => {
  let failures = 0;
  let sticks = 0;
  const folders = new Set<string>();
  const assetFolders = new Set<string>();
  const media: FakeMedia = {
    folders,
    assetFolders,
    assetExists: async (exhibitionId, assetId) => assetFolders.has(`${exhibitionId}/${assetId}`),
    removeAsset: async (exhibitionId, assetId) => {
      assetFolders.delete(`${exhibitionId}/${assetId}`);
    },
    failNext: (n = 1) => void (failures += n),
    stickNext: (n = 1) => void (sticks += n),
    exists: async id => {
      trail.push(`exists ${id}`);
      return folders.has(id);
    },
    removeExhibition: async id => {
      trail.push(`remove ${id}`);
      if (failures > 0) {
        failures -= 1;
        throw Object.assign(new Error('EACCES: 가짜 지우기 실패'), { code: 'EACCES' });
      }
      if (sticks > 0) {
        sticks -= 1;
        return;
      }
      folders.delete(id);
    },
  };
  const uploads: FakeUploads = {
    during: undefined,
    async drain(id, timeoutMs) {
      trail.push(`drain ${id} ${timeoutMs}`);
      await uploads.during?.(id);
    },
  };
  const logs: LogLine[] = [];
  const log: EventLog = {
    info: (msg, fields) => void logs.push({ level: 'info', msg, fields }),
    warn: (msg, fields) => void logs.push({ level: 'warn', msg, fields }),
  };
  return { media, uploads, log, logs };
};

/** 시험용 의존성: 고정 시계(앞으로 돌릴 수 있음)·순서대로 나오는 난수·가짜 보안·가짜 미디어/업로드·기록 모으기 */
export const testDeps = (start = Date.UTC(2026, 10, 11, 1, 0, 0)) => {
  let now = start;
  let seq = 0;
  const store = memoryStore();
  const trail: string[] = [];
  const { media, uploads, log, logs } = fakeDeletionPorts(trail);
  const deps: Deps = {
    store,
    clock: { now: () => now },
    random: { int: (lo, hi) => lo + ((seq++ * 7919) % (hi - lo + 1)) },
    security: {
      pinHmac: pin => `hmac:${pin}`,
      isWeakPin: pin => /^(\d)\1+$/.test(pin) || pin === '123456',
      startCodeOk: code => code === 'start-ok',
    },
    media,
    uploads,
    log,
  };
  return {
    deps,
    store,
    media,
    uploads,
    logs,
    trail,
    advance: (ms: number) => void (now += ms),
    at: () => now,
  };
};
