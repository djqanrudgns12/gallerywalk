import { config } from '@gallery/core/config';
import { charCount, normalizeLine, type StudentCharacterId, toStudentCharacterId } from '@gallery/core/types';
import { z } from 'zod';

/**
 * 포스터에서 고른 학생 캐릭터와 마지막 별명(PLAN §7.3, P4-1). `DeviceStore` 포트에 아직 칸이 없어(포트는 Claude가 정함)
 * 여기서 `localStorage`를 직접 쓴다 — 기기 저장과 같은 `gw:` 접두사, 읽을 때 zod 검사, 꺼내기·쓰기 실패는 던지지 않고
 * 이 탭 메모리에 둔다(`adapters/deviceStore.ts`와 같은 약속). 포트로 옮기면 이 파일은 지운다.
 * 캐릭터는 새 ID(학생 10명, M4-9)로 쓰고, 예전에 저장한 옛 ID(`student-m`·`student-f`)는 01번으로 읽는다.
 */

export interface VisitorPrefs {
  character(): StudentCharacterId | null;
  setCharacter(character: StudentCharacterId): void;
  /** 한 줄 정규화한 마지막 별명. 없거나 틀린 값이면 null */
  lastNickname(): string | null;
  /** 빈 별명이면 지운다(함께 쓰는 교실 기기에 남지 않게) */
  setLastNickname(nickname: string): void;
}

export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = { character: 'gw:student-character', nickname: 'gw:last-nickname' } as const;

/** 학생 캐릭터 새 ID 또는 옛 별칭(01번으로 읽음) */
const CharacterSchema = z
  .string()
  .transform(toStudentCharacterId)
  .pipe(z.custom<StudentCharacterId>(v => v !== null));

const validNickname = (raw: string | null): string | null => {
  if (raw === null) return null;
  const n = normalizeLine(raw);
  return n !== '' && charCount(n) <= config().NICKNAME_MAX_CHARS ? n : null;
};

const defaultStorage = (): PrefsStorage | null => globalThis.localStorage;

export const createVisitorPrefs = (
  storage: () => PrefsStorage | null | undefined = defaultStorage,
): VisitorPrefs => {
  /** 저장소에 쓰지 못한 값(null = 지움). 이 탭에서는 이것이 맞다 */
  const overrides = new Map<string, string | null>();

  const read = (key: string): string | null => {
    if (overrides.has(key)) return overrides.get(key) ?? null;
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string | null): void => {
    try {
      const s = storage();
      if (!s) throw new Error('no storage');
      if (value === null) s.removeItem(key);
      else s.setItem(key, value);
      overrides.delete(key);
    } catch {
      overrides.set(key, value);
    }
  };

  return {
    character() {
      const parsed = CharacterSchema.safeParse(read(KEY.character));
      return parsed.success ? parsed.data : null;
    },
    setCharacter(character) {
      write(KEY.character, character);
    },
    lastNickname() {
      return validNickname(read(KEY.nickname));
    },
    setLastNickname(nickname) {
      const n = normalizeLine(nickname);
      write(KEY.nickname, n === '' ? null : n);
    },
  };
};
