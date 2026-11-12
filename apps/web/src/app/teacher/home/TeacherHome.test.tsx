import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeacherApi } from '../../../ports/index.ts';
import { buttonByText, click, flush } from '../../student/testDom.tsx';
import {
  fakeTeacher,
  giveSession,
  mountTeacher,
  T_DAY_MS,
  T_EX_A,
  T_EX_B,
  T_EX_C,
  T_NOW,
  T_TITLE_A,
  T_TITLE_B,
  T_TITLE_C,
  teacherExhibition,
  teacherServices,
  teacherView,
} from '../../../dev/teacherShellFixtures.tsx';
import { TeacherHome } from './TeacherHome.tsx';

let mounted: ReturnType<typeof mountTeacher> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

const press = (key: string): void =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

const typePin = (pin: string): void => {
  for (const d of pin) press(d);
};

const cardTitles = (): string[] =>
  mounted?.all('[data-testid="recent-card"]').map(el => el.dataset.id ?? '') ?? [];

describe('선생님 첫 화면 — 최근 전시 카드', () => {
  it('이 기기에 교사 토큰이 있는 전시만, 지난 전시는 빼고 보인다', async () => {
    const exhibition = vi.fn<TeacherApi['exhibition']>(async id =>
      teacherView(teacherExhibition({ id, status: 'OPEN' })),
    );
    const t = teacherServices(fakeTeacher({ exhibition }));
    // C: 토큰은 있지만 지난 전시 · B: 학생으로 본 전시(토큰 없음, ADR-059) · A: 교사 토큰 있음
    t.device.rememberExhibition({ exhibitionId: T_EX_C, title: T_TITLE_C, expiresAt: T_NOW - T_DAY_MS });
    t.device.rememberExhibition({ exhibitionId: T_EX_B, title: T_TITLE_B, expiresAt: T_NOW + T_DAY_MS });
    t.device.rememberExhibition({ exhibitionId: T_EX_A, title: T_TITLE_A, expiresAt: T_NOW + T_DAY_MS });
    giveSession(t.device, t.tokens, T_EX_A);
    giveSession(t.device, t.tokens, T_EX_C);

    mounted = mountTeacher(<TeacherHome />, t.services);
    await flush();

    expect(cardTitles()).toEqual([T_EX_A]);
    expect(mounted.q('[data-testid="recent-card"]')?.textContent).toContain(T_TITLE_A);
    // 상태 점은 교사 보기에서 받은 값
    expect(mounted.q('[data-status="OPEN"]')?.textContent).toBe(copy.teacher.exhibitionStatus.OPEN);
    expect(exhibition).toHaveBeenCalledTimes(1);
    expect(mounted.q('[data-testid="recent-empty"]')).toBeNull();
  });

  it('기억한 전시가 없으면 안내 한 줄', () => {
    const t = teacherServices(fakeTeacher());
    mounted = mountTeacher(<TeacherHome />, t.services);
    expect(mounted.q('[data-testid="recent-empty"]')?.textContent).toBe(copy.teacher.home.empty);
  });

  it('서버에 없는 전시(E_NOT_FOUND)는 카드에서 빠지고 기기에서도 잊는다', async () => {
    const t = teacherServices(
      fakeTeacher({ exhibition: vi.fn(async () => Promise.reject(new AppError('E_NOT_FOUND'))) }),
    );
    t.device.rememberExhibition({ exhibitionId: T_EX_A, title: T_TITLE_A });
    giveSession(t.device, t.tokens, T_EX_A);
    mounted = mountTeacher(<TeacherHome />, t.services);
    await flush();
    expect(cardTitles()).toEqual([]);
    expect(t.device.teacherSession(T_EX_A)).toBeNull();
  });

  it('카드를 누르면 관리 화면', async () => {
    const t = teacherServices(fakeTeacher());
    t.device.rememberExhibition({ exhibitionId: T_EX_A, title: T_TITLE_A });
    giveSession(t.device, t.tokens, T_EX_A);
    mounted = mountTeacher(<TeacherHome />, t.services);
    click(mounted.q('[data-testid="recent-card"]'));
    expect(mounted.location().path).toBe(`/t/e/${T_EX_A}`);
  });
});

describe('선생님 첫 화면 — PIN으로 들어가기', () => {
  const open = () => click(mounted?.q('[data-testid="pin-open"]') ?? null);

  it('최소 자리 전에는 잠기고, 맞으면 관리 화면으로 가며 카드에 기억한다', async () => {
    const pinLogin = vi.fn<TeacherApi['pinLogin']>(async () => ({ exhibitionId: T_EX_A }));
    const me = vi.fn<TeacherApi['me']>(async () => ({
      exhibitionId: T_EX_A,
      title: T_TITLE_A,
      sessionKind: 'PIN' as const,
    }));
    const t = teacherServices(fakeTeacher({ pinLogin, me }));
    mounted = mountTeacher(<TeacherHome />, t.services);
    open();
    const submit = mounted.q<HTMLButtonElement>('[data-testid="pin-submit"]');
    typePin('12345'.slice(0, config().PIN_MIN_LENGTH - 1));
    expect(submit?.disabled).toBe(true);
    // 화면 키패드 단추로도 넣는다
    click(buttonByText(document.body, '9'));
    expect(submit?.disabled).toBe(false);
    click(submit);
    await flush();

    expect(pinLogin).toHaveBeenCalledWith(`${'12345'.slice(0, config().PIN_MIN_LENGTH - 1)}9`);
    expect(mounted.location().path).toBe(`/t/e/${T_EX_A}`);
    expect(t.device.recentExhibitions().map(r => r.title)).toEqual([T_TITLE_A]);
  });

  it('틀리면 "PIN이 맞지 않아요"를 보이고 칸을 비운다', async () => {
    const t = teacherServices(
      fakeTeacher({ pinLogin: vi.fn(async () => Promise.reject(new AppError('E_PIN_INVALID'))) }),
    );
    mounted = mountTeacher(<TeacherHome />, t.services);
    open();
    typePin('123987');
    press('Enter');
    await flush();
    expect(mounted.q('[data-testid="pin-error"]')?.textContent).toBe(errorCopy.E_PIN_INVALID);
    expect(mounted.all('[data-testid="number-pad-cells"] [data-filled="1"]')).toHaveLength(0);
    expect(mounted.location().path).toBe('/t');
  });

  it('잠기면 서버가 준 분을 채운다', async () => {
    const t = teacherServices(
      fakeTeacher({
        pinLogin: vi.fn(async () =>
          Promise.reject(new AppError('E_PIN_LOCKED', { fields: { retryAfterMin: '7' } })),
        ),
      }),
    );
    mounted = mountTeacher(<TeacherHome />, t.services);
    open();
    typePin('123987');
    press('Enter');
    await flush();
    expect(mounted.q('[data-testid="pin-error"]')?.textContent).toBe(fill(errorCopy.E_PIN_LOCKED, { n: 7 }));
  });
});

describe('선생님 링크 /t#{토큰}', () => {
  it('토큰으로 전시를 찾아 관리 화면으로 가고, 조각을 지운다', async () => {
    const t0 = teacherServices(fakeTeacher());
    const token = t0.tokens.newToken();
    const openLink = vi.fn<TeacherApi['openLink']>(async () => ({
      exhibitionId: T_EX_A,
      title: T_TITLE_A,
      sessionKind: 'LINK' as const,
    }));
    const t = teacherServices(fakeTeacher({ openLink }));
    mounted = mountTeacher(<TeacherHome />, t.services, `/t#${token}`);
    // 서버 답을 기다리는 동안에도 조각은 이미 지워졌다
    expect(mounted.location().hash).toBe('');
    await flush();
    expect(openLink).toHaveBeenCalledWith(token);
    expect(mounted.location()).toMatchObject({ path: `/t/e/${T_EX_A}`, hash: '' });
    expect(t.device.recentExhibitions().map(r => r.exhibitionId)).toEqual([T_EX_A]);
  });

  it('통하지 않는 토큰이면 "다시 들어와 주세요", 조각은 지운다', async () => {
    const t0 = teacherServices(fakeTeacher());
    const token = t0.tokens.newToken();
    const t = teacherServices(
      fakeTeacher({ openLink: vi.fn(async () => Promise.reject(new AppError('E_AUTH'))) }),
    );
    mounted = mountTeacher(<TeacherHome />, t.services, `/t#${token}`);
    await flush();
    expect(mounted.location()).toMatchObject({ path: '/t', hash: '' });
    expect(mounted.q('[data-testid="link-failed"]')?.textContent).toBe(errorCopy.E_AUTH);
  });

  it('형식이 틀린 조각은 요청 없이 거절한다', async () => {
    const openLink = vi.fn<TeacherApi['openLink']>();
    const t = teacherServices(fakeTeacher({ openLink }));
    mounted = mountTeacher(<TeacherHome />, t.services, '/t#not-a-token');
    await flush();
    expect(openLink).not.toHaveBeenCalled();
    expect(mounted.location().hash).toBe('');
    expect(mounted.q('[data-testid="link-failed"]')?.textContent).toBe(errorCopy.E_AUTH);
  });
});
