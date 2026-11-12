import { copy, fill } from '@gallery/core/copy';
import type { ExhibitionTeacher } from '@gallery/core/types';
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeacherApi } from '../../../ports/index.ts';
import { click, flush } from '../../student/testDom.tsx';
import {
  fakeTeacher,
  giveSession,
  mountTeacher,
  T_EX_A,
  T_TITLE_A,
  teacherExhibition,
  teacherServices,
} from '../../../dev/teacherShellFixtures.tsx';
import { DELETE_CONFIRM_SEC, ManageMenu } from './ManageMenu.tsx';

let mounted: ReturnType<typeof mountTeacher> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const Harness = ({
  start,
  onDeleted,
  onOpenSheet,
}: {
  readonly start: ExhibitionTeacher;
  readonly onDeleted: () => void;
  readonly onOpenSheet: () => void;
}) => {
  const [ex, setEx] = useState(start);
  return (
    <>
      <output data-testid="status">{ex.status}</output>
      <ManageMenu exhibition={ex} onChanged={setEx} onDeleted={onDeleted} onOpenSheet={onOpenSheet} />
    </>
  );
};

const mount = (teacher: TeacherApi, start = teacherExhibition(), session: 'LINK' | 'PIN' | null = 'LINK') => {
  const t = teacherServices(teacher);
  const token = session ? giveSession(t.device, t.tokens, T_EX_A, session) : null;
  t.device.rememberExhibition({ exhibitionId: T_EX_A, title: T_TITLE_A });
  const onDeleted = vi.fn();
  const onOpenSheet = vi.fn();
  mounted = mountTeacher(
    <Harness start={start} onDeleted={onDeleted} onOpenSheet={onOpenSheet} />,
    t.services,
    `/t/e/${T_EX_A}`,
    '/t/e/:id',
  );
  return { ...t, token, onDeleted, onOpenSheet };
};

const openMenu = (): void => click(mounted?.q('[data-testid="manage-menu-trigger"]') ?? null);
const item = (id: string) => mounted?.q<HTMLButtonElement>(`[data-testid="${id}"]`) ?? null;

describe('`···` 메뉴', () => {
  it('자동 투어로 가고, 미리 불러오기는 열려 있다(시트는 PreloadSheet.test)', () => {
    mount(fakeTeacher());
    openMenu();
    expect(item('menu-preload')?.disabled).toBe(false);
    expect(item('menu-preload')?.textContent).toBe(copy.teacher.menu.preload);
    click(item('menu-tour'));
    expect(mounted?.location().path).toBe(`/t/e/${T_EX_A}/tour`);
  });

  it('선생님 링크 복사는 이 기기가 링크 토큰을 가질 때만, 경고 문구와 함께', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const t = mount(fakeTeacher());
    openMenu();
    expect(item('menu-copy-link')?.textContent).toContain(copy.teacher.menu.copyLinkWarn);
    click(item('menu-copy-link'));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/t#${t.token ?? ''}`);
    expect(mounted?.q('[data-testid="teacher-toast"]')?.textContent).toBe(copy.teacher.menu.copied);

    mounted?.unmount();
    mount(fakeTeacher(), teacherExhibition(), 'PIN');
    openMenu();
    expect(item('menu-copy-link')).toBeNull();
    expect(item('menu-rotate')).not.toBeNull();
  });

  it('PIN 기기도 링크를 새로 만들면 복사 항목이 생긴다', async () => {
    const holder: { t?: ReturnType<typeof mount> } = {};
    const rotateLink = vi.fn<TeacherApi['rotateLink']>(async id => {
      const t = holder.t;
      const s = t?.device.teacherSession(id);
      if (t && s) t.device.setTeacherSession(id, { ...s, linkToken: t.tokens.newToken() });
    });
    const t = mount(fakeTeacher({ rotateLink }), teacherExhibition(), 'PIN');
    holder.t = t;
    openMenu();
    click(item('menu-rotate'));
    expect(mounted?.q('[data-testid="rotate-sheet"]')?.textContent).toContain(copy.teacher.menu.rotateBody);
    click(item('rotate-confirm'));
    await flush();
    expect(rotateLink).toHaveBeenCalledWith(T_EX_A);
    openMenu();
    expect(item('menu-copy-link')).not.toBeNull();
  });

  it('열린 전시는 `전시 닫기`, 닫힌 전시는 `다시 열기`', async () => {
    const changeStatus = vi.fn<TeacherApi['changeStatus']>(async (_id, action) =>
      teacherExhibition({ status: action === 'close' ? 'CLOSED' : 'OPEN' }),
    );
    mount(fakeTeacher({ changeStatus }), teacherExhibition({ status: 'OPEN' }));
    openMenu();
    expect(item('menu-reopen')).toBeNull();
    click(item('menu-close'));
    await flush();
    expect(changeStatus).toHaveBeenLastCalledWith(T_EX_A, 'close');
    expect(mounted?.q('[data-testid="status"]')?.textContent).toBe('CLOSED');

    openMenu();
    expect(item('menu-close')).toBeNull();
    click(item('menu-reopen'));
    await flush();
    expect(changeStatus).toHaveBeenLastCalledWith(T_EX_A, 'reopen');
    expect(mounted?.q('[data-testid="status"]')?.textContent).toBe('OPEN');
  });

  it('열린 전시는 QR·주소 다시 보기로 열기 시트를 부른다', () => {
    const t = mount(fakeTeacher(), teacherExhibition({ status: 'OPEN' }));
    openMenu();
    click(item('menu-show-qr'));
    expect(t.onOpenSheet).toHaveBeenCalledTimes(1);
    expect(mounted?.q('[data-testid="manage-menu"]')).toBeNull();
  });

  it('지금 삭제: 확인 시트의 단추는 정한 초 동안 잠기고, 누르면 지운 뒤 기기에서도 잊는다', async () => {
    vi.useFakeTimers();
    const start = teacherExhibition();
    const deleteExhibition = vi.fn<TeacherApi['deleteExhibition']>(async () => undefined);
    const t = mount(fakeTeacher({ deleteExhibition }), start);
    openMenu();
    click(item('menu-delete'));
    const confirm = item('delete-confirm');
    expect(confirm?.disabled).toBe(true);
    expect(confirm?.textContent).toBe(fill(copy.teacher.menu.deleteWait, { n: DELETE_CONFIRM_SEC }));
    for (let i = 1; i < DELETE_CONFIRM_SEC; i++) {
      act(() => vi.advanceTimersByTime(1000));
      expect(item('delete-confirm')?.disabled).toBe(true);
    }
    click(item('delete-confirm'));
    expect(deleteExhibition).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(item('delete-confirm')?.disabled).toBe(false);
    click(item('delete-confirm'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(deleteExhibition).toHaveBeenCalledWith(T_EX_A, start.rev);
    expect(t.onDeleted).toHaveBeenCalledTimes(1);
    expect(t.device.teacherSession(T_EX_A)).toBeNull();
    expect(t.device.recentExhibitions()).toEqual([]);
  });
});
