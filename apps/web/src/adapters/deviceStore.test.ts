import { overrideConfig, resetConfig } from '@gallery/core/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TeacherSession, VisitorIdentity } from '../ports/index.ts';
import { createDeviceStore, type KeyValueStorage } from './deviceStore.ts';

const ex = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tok = (c: string) => c.repeat(43);
const DAY = 86_400_000;

/** 메모리 저장소(쓰기 실패를 켤 수 있음) */
const memoryStorage = () => {
  const data = new Map<string, string>();
  const state = { failWrites: false, failReads: false };
  const storage: KeyValueStorage = {
    getItem: k => {
      if (state.failReads) throw new Error('SecurityError');
      return data.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (state.failWrites) throw new DOMException('full', 'QuotaExceededError');
      data.set(k, v);
    },
    removeItem: k => {
      if (state.failWrites) throw new DOMException('full', 'QuotaExceededError');
      data.delete(k);
    },
  };
  return { data, state, storage };
};

const clock = (start = 1_800_000_000_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

const teacher: TeacherSession = {
  kind: 'LINK',
  token: tok('a'),
  linkToken: tok('a'),
  pendingLinkToken: null,
};
const visitor: VisitorIdentity = { token: tok('b'), consentVersion: '2026-11', nickname: '별빛' };

afterEach(() => resetConfig());

describe('기기 ID', () => {
  it('처음 한 번 만들고 같은 저장소면 늘 같다(UUID)', () => {
    const m = memoryStorage();
    const a = createDeviceStore({ storage: () => m.storage });
    const id = a.deviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.deviceId()).toBe(id);
    expect(createDeviceStore({ storage: () => m.storage }).deviceId()).toBe(id);
  });

  it('저장된 값이 UUID가 아니면 새로 만든다', () => {
    const m = memoryStorage();
    m.data.set('gw:device-id', 'not-a-uuid');
    const id = createDeviceStore({ storage: () => m.storage, newDeviceId: () => ex(7) }).deviceId();
    expect(id).toBe(ex(7));
    expect(m.data.get('gw:device-id')).toBe(ex(7));
  });
});

describe('최근 전시', () => {
  let m: ReturnType<typeof memoryStorage>;
  let c: ReturnType<typeof clock>;
  beforeEach(() => {
    m = memoryStorage();
    c = clock();
  });
  const store = () => createDeviceStore({ storage: () => m.storage, now: c.now });

  it('최신 순, 같은 전시는 하나만(다시 기억하면 맨 앞으로)', () => {
    const s = store();
    s.rememberExhibition({ exhibitionId: ex(1), title: '하나' });
    c.advance(10);
    s.rememberExhibition({ exhibitionId: ex(2), title: '둘' });
    c.advance(10);
    s.rememberExhibition({ exhibitionId: ex(1), title: '하나(고친 이름)' });
    expect(s.recentExhibitions().map(r => [r.exhibitionId, r.title])).toEqual([
      [ex(1), '하나(고친 이름)'],
      [ex(2), '둘'],
    ]);
  });

  it('같은 밀리초에 여럿을 기억해도 나중 것이 앞', () => {
    const s = store();
    for (let i = 1; i <= 3; i++) s.rememberExhibition({ exhibitionId: ex(i), title: `${i}` });
    expect(s.recentExhibitions().map(r => r.exhibitionId)).toEqual([ex(3), ex(2), ex(1)]);
  });

  it(`상한은 RECENT_EXHIBITIONS_MAX(기본 5) — 넘치면 가장 오래된 것이 빠진다`, () => {
    const s = store();
    for (let i = 1; i <= 7; i++) {
      s.rememberExhibition({ exhibitionId: ex(i), title: `${i}` });
      c.advance(1);
    }
    expect(s.recentExhibitions().map(r => r.exhibitionId)).toEqual([ex(7), ex(6), ex(5), ex(4), ex(3)]);
    overrideConfig({ RECENT_EXHIBITIONS_MAX: 2 });
    expect(s.recentExhibitions().map(r => r.exhibitionId)).toEqual([ex(7), ex(6)]);
  });

  it('지난 전시는 빠지고, 만료 시각을 주지 않고 다시 기억하면 앞의 값을 지킨다', () => {
    const s = store();
    s.rememberExhibition({ exhibitionId: ex(1), title: '곧 끝남', expiresAt: c.now() + DAY });
    s.rememberExhibition({ exhibitionId: ex(2), title: '모름' });
    s.rememberExhibition({ exhibitionId: ex(1), title: '곧 끝남' });
    expect(s.recentExhibitions().find(r => r.exhibitionId === ex(1))?.expiresAt).toBe(c.now() + DAY);
    c.advance(DAY);
    expect(s.recentExhibitions().map(r => r.exhibitionId)).toEqual([ex(2)]);
  });

  it('지난 전시는 목록에서 빠질 때 그 전시의 방문자 토큰·별명과 교사 세션도 기기에서 지운다(다른 전시는 그대로)', () => {
    const s = store();
    s.rememberExhibition({ exhibitionId: ex(1), title: '곧 끝남', expiresAt: c.now() + DAY });
    s.rememberExhibition({ exhibitionId: ex(2), title: '오래 감', expiresAt: c.now() + 10 * DAY });
    s.setVisitor(ex(1), visitor);
    s.setTeacherSession(ex(1), teacher);
    s.setVisitor(ex(2), visitor);
    c.advance(DAY);
    expect(s.recentExhibitions().map(r => r.exhibitionId)).toEqual([ex(2)]);
    expect(s.visitor(ex(1))).toBeNull();
    expect(s.teacherSession(ex(1))).toBeNull();
    expect(m.data.has('gw:visitor:' + ex(1))).toBe(false);
    expect(s.visitor(ex(2))).toEqual(visitor);
  });

  it('잊기: 최근 목록과 교사 토큰을 함께', () => {
    const s = store();
    s.rememberExhibition({ exhibitionId: ex(1), title: '하나' });
    s.setTeacherSession(ex(1), teacher);
    s.forgetExhibition(ex(1));
    expect(s.recentExhibitions()).toEqual([]);
    expect(s.teacherSession(ex(1))).toBeNull();
  });

  it('저장된 목록이 깨졌으면 맞는 칸만 읽는다(중복은 앞의 것)', () => {
    m.data.set(
      'gw:recent-exhibitions',
      JSON.stringify([
        { exhibitionId: ex(1), title: '맞음', expiresAt: null, touchedAt: 5 },
        { exhibitionId: 'x', title: '틀린 ID', expiresAt: null, touchedAt: 9 },
        { exhibitionId: ex(1), title: '중복', expiresAt: null, touchedAt: 7 },
        'garbage',
        { exhibitionId: ex(2), title: '맞음2', expiresAt: null, touchedAt: 6 },
      ]),
    );
    expect(
      store()
        .recentExhibitions()
        .map(r => r.title),
    ).toEqual(['맞음2', '맞음']);
    m.data.set('gw:recent-exhibitions', '{not json');
    expect(store().recentExhibitions()).toEqual([]);
  });
});

describe('교사 토큰·방문자·소리·시작 코드', () => {
  it('저장·읽기·지우기, 키는 gw: 접두사', () => {
    const m = memoryStorage();
    const s = createDeviceStore({ storage: () => m.storage });
    expect(s.teacherSession(ex(1))).toBeNull();
    s.setTeacherSession(ex(1), teacher);
    s.setVisitor(ex(1), visitor);
    s.setSoundOn(false);
    s.setStartCodePassed(true);
    s.deviceId();
    s.rememberExhibition({ exhibitionId: ex(1), title: '하나' });

    const again = createDeviceStore({ storage: () => m.storage });
    expect(again.teacherSession(ex(1))).toEqual(teacher);
    expect(again.teacherSession(ex(2))).toBeNull();
    expect(again.visitor(ex(1))).toEqual(visitor);
    expect(again.soundOn()).toBe(false);
    expect(again.startCodePassed()).toBe(true);
    expect([...m.data.keys()].every(k => k.startsWith('gw:'))).toBe(true);

    again.clearTeacherSession(ex(1));
    again.clearVisitor(ex(1));
    expect(again.teacherSession(ex(1))).toBeNull();
    expect(again.visitor(ex(1))).toBeNull();
  });

  it('선생님 캐릭터: 기본 teacher-m, 고른 값은 기억하고 틀린 값은 기본으로', () => {
    const m = memoryStorage();
    const s = createDeviceStore({ storage: () => m.storage });
    expect(s.teacherCharacter()).toBe('teacher-m');
    s.setTeacherCharacter('teacher-f');
    expect(createDeviceStore({ storage: () => m.storage }).teacherCharacter()).toBe('teacher-f');
    m.data.set('gw:teacher-character', JSON.stringify('student-m'));
    expect(s.teacherCharacter()).toBe('teacher-m');
  });

  it('기억한 값이 없으면 소리 켬, 시작 코드 아직', () => {
    const s = createDeviceStore({ storage: () => memoryStorage().storage });
    expect(s.soundOn()).toBe(true);
    expect(s.startCodePassed()).toBe(false);
  });

  it('저장된 토큰 모양이 틀리면 없는 것으로', () => {
    const m = memoryStorage();
    m.data.set(`gw:teacher:${ex(1)}`, JSON.stringify({ ...teacher, token: 'short' }));
    m.data.set(`gw:visitor:${ex(1)}`, JSON.stringify({ ...visitor, token: 42 }));
    m.data.set('gw:sound-on', '"yes"');
    const s = createDeviceStore({ storage: () => m.storage });
    expect(s.teacherSession(ex(1))).toBeNull();
    expect(s.visitor(ex(1))).toBeNull();
    expect(s.soundOn()).toBe(true);
  });
});

describe('저장소가 막혀도 멈추지 않는다', () => {
  it('localStorage를 꺼내기만 해도 던지면: 이 탭 메모리로 모두 동작', () => {
    const s = createDeviceStore({
      storage: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    const id = s.deviceId();
    expect(s.deviceId()).toBe(id);
    s.setTeacherSession(ex(1), teacher);
    expect(s.teacherSession(ex(1))).toEqual(teacher);
    s.setSoundOn(false);
    expect(s.soundOn()).toBe(false);
    s.rememberExhibition({ exhibitionId: ex(1), title: '하나' });
    expect(s.recentExhibitions().map(r => r.exhibitionId)).toEqual([ex(1)]);
    s.clearTeacherSession(ex(1));
    expect(s.teacherSession(ex(1))).toBeNull();
  });

  it('저장소가 없으면(null) 메모리로', () => {
    const s = createDeviceStore({ storage: () => null });
    s.setVisitor(ex(1), visitor);
    expect(s.visitor(ex(1))).toEqual(visitor);
  });

  it('꽉 차서 쓰기가 실패하면: 그 키는 새 값을 기억하고 저장소의 옛 값을 믿지 않는다', () => {
    const m = memoryStorage();
    const s = createDeviceStore({ storage: () => m.storage });
    s.setSoundOn(true);
    s.setTeacherSession(ex(1), teacher);
    m.state.failWrites = true;
    s.setSoundOn(false);
    expect(s.soundOn()).toBe(false);
    expect(m.data.get('gw:sound-on')).toBe('true');
    s.clearTeacherSession(ex(1));
    expect(s.teacherSession(ex(1))).toBeNull();
    // 저장소가 다시 되면 다음 쓰기부터 저장소로
    m.state.failWrites = false;
    s.setSoundOn(false);
    expect(m.data.get('gw:sound-on')).toBe('false');
  });

  it('읽기가 던지면 기본값', () => {
    const m = memoryStorage();
    m.data.set('gw:sound-on', 'false');
    m.state.failReads = true;
    const s = createDeviceStore({ storage: () => m.storage });
    expect(s.soundOn()).toBe(true);
    expect(s.recentExhibitions()).toEqual([]);
    expect(s.teacherSession(ex(1))).toBeNull();
  });

  it('다른 탭이 저장소에 쓴 값도 보인다(쓰기가 되는 키는 늘 저장소에서 읽음)', () => {
    const m = memoryStorage();
    const tabA = createDeviceStore({ storage: () => m.storage });
    const tabB = createDeviceStore({ storage: () => m.storage });
    expect(tabA.teacherSession(ex(1))).toBeNull();
    tabB.setTeacherSession(ex(1), teacher);
    expect(tabA.teacherSession(ex(1))).toEqual(teacher);
  });

  it('기본 저장소는 localStorage(gw: 키)', () => {
    globalThis.localStorage.clear();
    const s = createDeviceStore();
    s.setSoundOn(false);
    expect(globalThis.localStorage.getItem('gw:sound-on')).toBe('false');
    globalThis.localStorage.clear();
  });
});
