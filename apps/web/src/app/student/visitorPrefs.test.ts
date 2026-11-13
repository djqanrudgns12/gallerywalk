import { config } from '@gallery/core/config';
import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../../dev/studentFixtures.ts';
import { createVisitorPrefs } from './visitorPrefs.ts';

describe('visitorPrefs(고른 캐릭터·마지막 별명)', () => {
  it('저장하고 다시 읽는다', () => {
    const storage = memoryStorage();
    const a = createVisitorPrefs(() => storage);
    expect(a.character()).toBeNull();
    expect(a.lastNickname()).toBeNull();
    a.setCharacter('student-f-03');
    a.setLastNickname('  하늘   고래 ');
    const b = createVisitorPrefs(() => storage);
    expect(b.character()).toBe('student-f-03');
    expect(b.lastNickname()).toBe('하늘 고래');
  });

  it('빈 별명은 지운다', () => {
    const storage = memoryStorage();
    const p = createVisitorPrefs(() => storage);
    p.setLastNickname('하늘고래');
    p.setLastNickname('   ');
    expect(p.lastNickname()).toBeNull();
    expect(storage.size()).toBe(0);
  });

  it('예전에 저장한 옛 캐릭터 ID는 01번으로 읽고, 새로 고르면 새 ID로 쓴다(M4-9)', () => {
    for (const [old, now] of [
      ['student-m', 'student-m-01'],
      ['student-f', 'student-f-01'],
    ] as const) {
      const storage = memoryStorage();
      storage.setItem('gw:student-character', old);
      const p = createVisitorPrefs(() => storage);
      expect(p.character()).toBe(now);
      p.setCharacter('student-m-05');
      expect(storage.getItem('gw:student-character')).toBe('student-m-05');
    }
  });

  it('틀린 저장 값은 없는 것으로 본다', () => {
    const storage = memoryStorage();
    storage.setItem('gw:student-character', 'teacher-m');
    storage.setItem('gw:last-nickname', '별'.repeat(config().NICKNAME_MAX_CHARS + 1));
    const p = createVisitorPrefs(() => storage);
    expect(p.character()).toBeNull();
    expect(p.lastNickname()).toBeNull();
    for (const bad of ['docent-1', 'student-m-06', 'teacher-f']) {
      storage.setItem('gw:student-character', bad);
      expect(createVisitorPrefs(() => storage).character()).toBeNull();
    }
  });

  it('저장소가 던져도 멈추지 않고 이 탭 안에서 기억한다', () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('quota');
      },
      removeItem: (): void => {
        throw new Error('blocked');
      },
    };
    const p = createVisitorPrefs(() => throwing);
    expect(p.character()).toBeNull();
    p.setCharacter('student-m-02');
    p.setLastNickname('하늘고래');
    expect(p.character()).toBe('student-m-02');
    expect(p.lastNickname()).toBe('하늘고래');

    const none = createVisitorPrefs(() => {
      throw new Error('SecurityError');
    });
    none.setCharacter('student-f-05');
    expect(none.character()).toBe('student-f-05');
  });
});
