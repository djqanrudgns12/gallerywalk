import { config } from '@gallery/core/config';
import { EpochMsSchema, SessionKindSchema, UuidSchema } from '@gallery/core/types';
import { z } from 'zod';
import type {
  DeviceStore,
  RecentExhibition,
  RememberExhibition,
  TeacherSession,
  VisitorIdentity,
} from '../ports/index.ts';
import { isTokenText, randomUuid } from './tokens.ts';

/**
 * 기기 저장(`localStorage`, PLAN §2.4). 키는 모두 `gw:` 접두사(같은 출처의 다른 앱과 섞이지 않게).
 *
 * - 저장된 값은 바깥 입력이다: 읽을 때 zod로 검사하고, 틀린 값은 없는 것으로 본다(앱이 멈추지 않게).
 * - 저장소가 막혀도 던지지 않는다: `localStorage`를 꺼내기만 해도 던지는 브라우저(쿠키 차단·사생활 모드)와
 *   꽉 참(`QuotaExceededError`)이 있다. 쓰기에 실패한 값은 이 탭의 메모리에 두고, 그 키는 메모리 값을 믿는다.
 *   쓰기가 되는 키는 늘 저장소에서 읽는다(다른 탭이 링크를 열어 넣은 교사 토큰도 보이게).
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DeviceStoreOptions {
  /** 저장소 꺼내기(기본 `localStorage`). 함수인 까닭: 꺼내기만 해도 던지는 브라우저가 있다 */
  readonly storage?: () => KeyValueStorage | null | undefined;
  readonly now?: () => number;
  readonly newDeviceId?: () => string;
}

const KEY = {
  deviceId: 'gw:device-id',
  recent: 'gw:recent-exhibitions',
  sound: 'gw:sound-on',
  startCode: 'gw:start-code-passed',
  teacherCharacter: 'gw:teacher-character',
  manageFrameSize: 'gw:manage-frame-size',
  teacher: (exhibitionId: string) => `gw:teacher:${exhibitionId}`,
  visitor: (exhibitionId: string) => `gw:visitor:${exhibitionId}`,
} as const;

const TokenTextSchema = z.string().refine(isTokenText);

const RecentSchema = z.object({
  exhibitionId: UuidSchema,
  title: z.string(),
  expiresAt: EpochMsSchema.nullable(),
  touchedAt: EpochMsSchema,
});

const TeacherSessionSchema = z.object({
  kind: SessionKindSchema,
  token: TokenTextSchema,
  linkToken: TokenTextSchema.nullable(),
  pendingLinkToken: TokenTextSchema.nullable(),
});

const VisitorSchema = z.object({
  token: TokenTextSchema,
  consentVersion: z.string().nullable(),
  nickname: z.string().nullable(),
});

const defaultStorage = (): KeyValueStorage | null => globalThis.localStorage;

/** 던지지 않는 키-값 층(실패하면 이 탭 메모리) */
const safeKeyValue = (storage: () => KeyValueStorage | null | undefined) => {
  /** 저장소에 쓰지 못한 값. 이 탭에서는 이것이 맞다(null = 지움) */
  const overrides = new Map<string, string | null>();

  const tryWrite = (key: string, value: string | null): boolean => {
    try {
      const s = storage();
      if (!s) return false;
      if (value === null) s.removeItem(key);
      else s.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  return {
    read(key: string): string | null {
      if (overrides.has(key)) return overrides.get(key) ?? null;
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write(key: string, value: string | null): void {
      if (tryWrite(key, value)) overrides.delete(key);
      else overrides.set(key, value);
    },
  };
};

export const createDeviceStore = (opts: DeviceStoreOptions = {}): DeviceStore => {
  const kv = safeKeyValue(opts.storage ?? defaultStorage);
  const now = opts.now ?? Date.now;
  const newDeviceId = opts.newDeviceId ?? (() => randomUuid());

  const readJson = <S extends z.ZodType>(key: string, schema: S): z.output<S> | null => {
    const raw = kv.read(key);
    if (raw === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
  const writeJson = (key: string, value: unknown): void => kv.write(key, JSON.stringify(value));

  /**
   * 저장된 목록을 다듬어 읽기: 틀린 칸은 버리고, 같은 전시는 앞의 것만, 지난 전시 제외, 최신 순, 상한.
   * 지난 전시는 목록에서 빼면서 그 전시의 방문자 토큰·별명과 교사 세션도 기기에서 지운다(PLAN §9.6 "기기 사본은 다음에 열 때").
   */
  const readRecent = (): RecentExhibition[] => {
    const list = readJson(KEY.recent, z.array(z.unknown())) ?? [];
    const seen = new Set<string>();
    const t = now();
    const out: RecentExhibition[] = [];
    const gone: string[] = [];
    for (const item of list) {
      const r = RecentSchema.safeParse(item);
      if (!r.success || seen.has(r.data.exhibitionId)) continue;
      seen.add(r.data.exhibitionId);
      if (r.data.expiresAt !== null && r.data.expiresAt <= t) {
        gone.push(r.data.exhibitionId);
        continue;
      }
      out.push(r.data);
    }
    out.sort((a, b) => b.touchedAt - a.touchedAt);
    const kept = out.slice(0, config().RECENT_EXHIBITIONS_MAX);
    if (gone.length > 0) {
      for (const id of gone) {
        kv.write(KEY.visitor(id), null);
        kv.write(KEY.teacher(id), null);
      }
      writeJson(KEY.recent, kept);
    }
    return kept;
  };

  return {
    deviceId() {
      const raw = kv.read(KEY.deviceId);
      if (raw !== null && UuidSchema.safeParse(raw).success) return raw;
      const id = newDeviceId();
      kv.write(KEY.deviceId, id);
      return id;
    },

    recentExhibitions: () => readRecent(),

    rememberExhibition(entry: RememberExhibition) {
      const list = readRecent();
      const prev = list.find(r => r.exhibitionId === entry.exhibitionId);
      const newest = list[0];
      const next: RecentExhibition = {
        exhibitionId: entry.exhibitionId,
        title: entry.title,
        expiresAt: entry.expiresAt === undefined ? (prev?.expiresAt ?? null) : entry.expiresAt,
        // 같은 밀리초에 둘을 기억하거나 시계가 뒤로 가도 나중 것이 앞에 오게
        touchedAt: newest === undefined ? now() : Math.max(now(), newest.touchedAt + 1),
      };
      const rest = list.filter(r => r.exhibitionId !== entry.exhibitionId);
      writeJson(KEY.recent, [next, ...rest].slice(0, config().RECENT_EXHIBITIONS_MAX));
    },

    forgetExhibition(exhibitionId) {
      writeJson(
        KEY.recent,
        readRecent().filter(r => r.exhibitionId !== exhibitionId),
      );
      kv.write(KEY.teacher(exhibitionId), null);
    },

    teacherSession: exhibitionId => readJson(KEY.teacher(exhibitionId), TeacherSessionSchema),
    setTeacherSession: (exhibitionId, session: TeacherSession) =>
      writeJson(KEY.teacher(exhibitionId), session),
    clearTeacherSession: exhibitionId => kv.write(KEY.teacher(exhibitionId), null),

    visitor: exhibitionId => readJson(KEY.visitor(exhibitionId), VisitorSchema),
    setVisitor: (exhibitionId, visitor: VisitorIdentity) => writeJson(KEY.visitor(exhibitionId), visitor),
    clearVisitor: exhibitionId => kv.write(KEY.visitor(exhibitionId), null),

    soundOn: () => readJson(KEY.sound, z.boolean()) ?? true,
    setSoundOn: on => writeJson(KEY.sound, on),

    startCodePassed: () => readJson(KEY.startCode, z.boolean()) ?? false,
    setStartCodePassed: passed => writeJson(KEY.startCode, passed),

    teacherCharacter: () => readJson(KEY.teacherCharacter, z.enum(['teacher-m', 'teacher-f'])) ?? 'teacher-m',
    setTeacherCharacter: character => writeJson(KEY.teacherCharacter, character),

    manageFrameSize: () => readJson(KEY.manageFrameSize, z.enum(['big', 'small'])) ?? 'big',
    setManageFrameSize: size => writeJson(KEY.manageFrameSize, size),
  };
};
