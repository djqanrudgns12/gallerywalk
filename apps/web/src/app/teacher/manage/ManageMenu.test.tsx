import { copy, errorCopy, fill } from '@gallery/core/copy';
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
  teacherView,
} from '../../../dev/teacherShellFixtures.tsx';
import { pngFile } from '../../../dev/teacherFixtures.ts';
import { pickFiles } from '../../../dev/teacherDom.tsx';
import { uuid } from '../../../dev/testView.ts';
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
      <output data-testid="poster">{ex.poster?.assetId ?? 'none'}</output>
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
  it('`반응·투어 설정`은 열린 전시에서도 시트를 열고, 저장하면 바뀐 전시를 넘기고 알린다(V-17)', async () => {
    const start = teacherExhibition({ status: 'OPEN' });
    const saved = teacherExhibition({ status: 'CLOSED', rev: start.rev + 1 });
    const patchExhibition = vi.fn<TeacherApi['patchExhibition']>(async () => saved);
    mount(fakeTeacher({ patchExhibition }), start);
    openMenu();
    expect(item('menu-settings')?.textContent).toBe(copy.teacher.menu.settings);
    click(item('menu-settings'));
    expect(mounted?.q('[data-testid="manage-menu"]')).toBeNull();
    expect(mounted?.q('[data-testid="settings-sheet"]')).not.toBeNull();
    click(item('settings-save'));
    await flush();
    expect(patchExhibition).toHaveBeenCalledWith(T_EX_A, start.rev, { settings: start.settings });
    expect(mounted?.q('[data-testid="settings-sheet"]')).toBeNull();
    expect(mounted?.q('[data-testid="status"]')?.textContent).toBe('CLOSED');
    expect(mounted?.q('[data-testid="teacher-toast"]')).not.toBeNull();
  });

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
  it('포스터 고르기(V-02): 그림 하나를 기기에서 검사한 뒤 `uploadPoster`, 바뀐 전시 행을 넘긴다', async () => {
    const withPoster = teacherExhibition({ poster: POSTER, rev: 4 });
    const uploadPoster = vi.fn<TeacherApi['uploadPoster']>(async () => withPoster);
    mount(fakeTeacher({ uploadPoster }));
    openMenu();
    expect(item('menu-poster')?.textContent).toBe(copy.teacher.menu.posterPick);
    expect(item('menu-poster-remove')).toBeNull();
    click(item('menu-poster'));
    const file = pngFile('가상 포스터.png', 1600, 1000);
    pickFiles(mounted?.q<HTMLInputElement>('[data-testid="poster-input"]') ?? null, [file]);
    await flush();
    expect(uploadPoster).toHaveBeenCalledTimes(1);
    expect(uploadPoster.mock.calls[0]?.[0]).toBe(T_EX_A);
    expect(uploadPoster.mock.calls[0]?.[1]).toEqual({ blob: file, name: file.name });
    expect(mounted?.q('[data-testid="poster"]')?.textContent).toBe(POSTER.assetId);
    expect(document.body.textContent).toContain(copy.teacher.menu.posterSaved);
    openMenu();
    expect(item('menu-poster')?.textContent).toBe(copy.teacher.menu.posterChange);
  });

  it('포스터 고르기: 그림이 아니거나 너무 작으면 보내지 않고 그 이유', async () => {
    const uploadPoster = vi.fn<TeacherApi['uploadPoster']>();
    mount(fakeTeacher({ uploadPoster }));
    openMenu();
    click(item('menu-poster'));
    pickFiles(mounted?.q<HTMLInputElement>('[data-testid="poster-input"]') ?? null, [
      pngFile('작은 포스터.png', 40, 40),
    ]);
    await flush();
    expect(uploadPoster).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(errorCopy.E_FILE_TOO_SMALL);
  });

  it('포스터 빼기: 포스터가 있을 때만, `removePoster` 뒤 전시를 새로 받아 넘긴다', async () => {
    const removePoster = vi.fn<TeacherApi['removePoster']>(async () => undefined);
    const exhibition = vi.fn<TeacherApi['exhibition']>(async () => ({
      ...teacherView(),
      exhibition: teacherExhibition({ poster: null, rev: 5 }),
    }));
    mount(fakeTeacher({ removePoster, exhibition }), teacherExhibition({ poster: POSTER }));
    openMenu();
    click(item('menu-poster-remove'));
    await flush();
    expect(removePoster).toHaveBeenCalledWith(T_EX_A);
    expect(mounted?.q('[data-testid="poster"]')?.textContent).toBe('none');
    expect(document.body.textContent).toContain(copy.teacher.menu.posterRemoved);
  });

  it('선생님 캐릭터(V-04): 대화 상자에서 고르면 이 기기에 기억한다', async () => {
    const t = mount(fakeTeacher());
    expect(t.device.teacherCharacter()).toBe('teacher-m');
    openMenu();
    expect(item('menu-character')?.textContent).toBe(copy.teacher.characterButton);
    click(item('menu-character'));
    const dialog = mounted?.q('[data-testid="teacher-character-dialog"]');
    expect(dialog?.textContent).toContain(copy.teacher.characterTitle);
    expect(item('char-teacher-m')?.getAttribute('aria-checked')).toBe('true');
    click(item('char-teacher-f'));
    click(item('teacher-character-save'));
    await flush();
    expect(t.device.teacherCharacter()).toBe('teacher-f');
    expect(mounted?.q('[data-testid="teacher-character-dialog"]')).toBeNull();
    expect(document.body.textContent).toContain(copy.teacher.characterSaved);
    openMenu();
    click(item('menu-character'));
    expect(item('char-teacher-f')?.getAttribute('aria-checked')).toBe('true');
  });
});

const POSTER: NonNullable<ExhibitionTeacher['poster']> = {
  assetId: uuid(0xc001),
  variants: [{ name: 'thumb', ext: 'webp', w: 512, h: 320, bytes: 30_000 }],
};
