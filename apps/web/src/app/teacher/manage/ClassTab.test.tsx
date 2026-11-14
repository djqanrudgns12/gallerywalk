import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import type { LiveStats } from '@gallery/core/types';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeTeacher,
  mountTeacher,
  T_ENTRY,
  teacherExhibition,
  teacherServices,
} from '../../../dev/teacherShellFixtures.tsx';
import { testExhibitionView, testRoomId } from '../../../dev/testView.ts';
import type { TeacherApi } from '../../../ports/index.ts';
import { formatDay } from '../../student/posterView.ts';
import { click } from '../../student/testDom.tsx';
import { shortStudentUrl, studentUrl } from '../shared/links.ts';
import { ClassTab, liveSplit, type ClassTabProps } from './ClassTab.tsx';

const view = testExhibitionView([4, 3, 5]);
const rooms = [0, 1, 2].map(testRoomId);
const [R0 = '', R1 = '', R2 = ''] = rooms;
const POLL_MS = config().LIVE_TEACHER_POLL_SEC * 1000;

/** 전시실 안 7(4·0·3) · 홀·광장·복도 1 · 위치 없음 1 = 9명, 선생님 1, 가벼운 화면 3 */
const stats = (over: Partial<LiveStats> = {}): LiveStats => ({
  visitors: 9,
  teachers: 1,
  light: 3,
  reasons: {},
  rooms: [
    { roomId: R0, count: 4 },
    { roomId: R1, count: 0 },
    { roomId: R2, count: 3 },
  ],
  elsewhere: 1,
  noPose: 1,
  ...over,
});

type Handlers = Pick<
  ClassTabProps,
  | 'onShowQr'
  | 'onStartTour'
  | 'onOpenReactions'
  | 'onCheckNetwork'
  | 'onPreload'
  | 'onOpen'
  | 'onCloseExhibition'
>;

let mounted: ReturnType<typeof mountTeacher> | null = null;
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  // jsdom은 칸 크기를 재지 않는다: 지도 칸이 640×360이라고 친다
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(360);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 가짜 시계를 돌리고 그사이 끝난 약속을 React에 반영한다 */
const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const setVisibility = (next: DocumentVisibilityState): void => {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

const mount = (
  getLive: TeacherApi['getLive'],
  over: Partial<Omit<ClassTabProps, keyof Handlers>> = {},
): Handlers & { readonly getLive: TeacherApi['getLive'] } => {
  const handlers: Handlers = {
    onShowQr: vi.fn(),
    onStartTour: vi.fn(),
    onOpenReactions: vi.fn(),
    onCheckNetwork: vi.fn(),
    onPreload: vi.fn(),
    onOpen: vi.fn(),
    onCloseExhibition: vi.fn(),
  };
  const t = teacherServices(fakeTeacher({ getLive }));
  mounted = mountTeacher(
    <ClassTab
      exhibition={teacherExhibition({ status: 'OPEN', openedAt: 1 })}
      layout={view.layout}
      roomOrder={rooms}
      reactionCount={14}
      showBubbles={false}
      {...handlers}
      {...over}
    />,
    t.services,
  );
  return { ...handlers, getLive };
};

const q = (sel: string): HTMLElement | null => mounted?.q(sel) ?? null;
const bigNumber = (): string | null | undefined =>
  q('[data-testid="class-stats"] [data-stat] b')?.textContent;
const legend = (key: string): string | null | undefined =>
  q(`[data-testid="class-stats"] [data-legend="${key}"] b`)?.textContent;
const dotsIn = (roomId: string): number =>
  mounted?.all(`[data-testid="class-map"] circle[data-room-id="${roomId}"]`).length ?? 0;

describe('수업 탭(HT-07)', () => {
  it('큰 숫자 = 지금 관람 중, 쌓은 막대 세 칸(전시실 안 · 홀·광장·복도 · 위치 없음), 선생님은 막대 밖', async () => {
    mount(vi.fn(async () => stats()));
    await advance(0);
    expect(bigNumber()).toBe('9');
    expect(q('[data-testid="class-stats"] [data-stat]')?.textContent).toContain(
      copy.teacher.classTab.watching,
    );
    expect(legend('rooms')).toBe('7');
    expect(legend('elsewhere')).toBe('1');
    expect(legend('noPose')).toBe('1');
    expect(q('[data-part="rooms"]')?.style.flexGrow).toBe('7');
    expect(q('[data-part="elsewhere"]')?.style.flexGrow).toBe('1');
    expect(q('[data-part="noPose"]')?.style.flexGrow).toBe('1');
    // 선생님은 막대 칸이 아니라 따로 적는다
    expect(q('[data-part="teachers"]')).toBeNull();
    expect(q('[data-testid="class-teachers"]')?.dataset.count).toBe('1');
    expect(q('[data-testid="class-light"]')?.textContent).toBe(fill(copy.teacher.classTab.light, { n: 3 }));
  });

  it('지도 점: 전시실마다 그 수만큼, 점 합 = 전시실 안 수', async () => {
    mount(vi.fn(async () => stats()));
    await advance(0);
    expect(dotsIn(R0)).toBe(4);
    expect(dotsIn(R1)).toBe(0);
    expect(dotsIn(R2)).toBe(3);
    expect(mounted?.all('[data-testid="class-map"] circle[data-room-id]')).toHaveLength(7);
    expect(q('[data-testid="class-map"]')?.textContent).toContain(
      fill(copy.teacher.manage.mapPeople, { n: 4 }),
    );
  });

  it('가벼운 화면 수가 0이면 그 줄을 숨긴다', async () => {
    mount(vi.fn(async () => stats({ light: 0 })));
    await advance(0);
    expect(bigNumber()).toBe('9');
    expect(q('[data-testid="class-light"]')).toBeNull();
  });

  it('정한 초마다 다시 부르고, 화면이 숨으면 멈췄다가 보이면 곧바로 부른 뒤 이어 간다', async () => {
    const { getLive } = mount(vi.fn(async () => stats()));
    await advance(0);
    expect(getLive).toHaveBeenCalledTimes(1);
    await advance(POLL_MS - 1);
    expect(getLive).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(getLive).toHaveBeenCalledTimes(2);

    setVisibility('hidden');
    await advance(POLL_MS * 3);
    expect(getLive).toHaveBeenCalledTimes(2);

    setVisibility('visible');
    await advance(0);
    expect(getLive).toHaveBeenCalledTimes(3);
    await advance(POLL_MS);
    expect(getLive).toHaveBeenCalledTimes(4);
  });

  it('탭을 떠나면(내려가면) 더 부르지 않는다', async () => {
    const { getLive } = mount(vi.fn(async () => stats()));
    await advance(0);
    mounted?.unmount();
    mounted = null;
    await advance(POLL_MS * 3);
    expect(getLive).toHaveBeenCalledTimes(1);
  });

  it('실패하면 마지막 값을 두고 다음 차례에 다시 부른다', async () => {
    const getLive = vi
      .fn<TeacherApi['getLive']>()
      .mockResolvedValueOnce(stats())
      .mockRejectedValueOnce(new AppError('E_OFFLINE'))
      .mockResolvedValueOnce(
        stats({ visitors: 5, rooms: [{ roomId: R0, count: 5 }], elsewhere: 0, noPose: 0 }),
      );
    mount(getLive);
    await advance(0);
    expect(bigNumber()).toBe('9');
    await advance(POLL_MS);
    expect(getLive).toHaveBeenCalledTimes(2);
    expect(bigNumber()).toBe('9');
    expect(dotsIn(R0)).toBe(4);
    await advance(POLL_MS);
    expect(getLive).toHaveBeenCalledTimes(3);
    expect(bigNumber()).toBe('5');
    expect(dotsIn(R0)).toBe(5);
    expect(dotsIn(R2)).toBe(0);
  });

  it('처음 받기 전에는 숫자 자리만 두고 막대·점을 그리지 않는다', async () => {
    mount(vi.fn(() => new Promise<LiveStats>(() => undefined)));
    await advance(0);
    expect(bigNumber()).not.toBe('0');
    expect(q('[data-testid="class-stats"] [data-legend]')).toBeNull();
    expect(mounted?.all('[data-testid="class-map"] circle[data-room-id]')).toHaveLength(0);
  });

  it('말풍선 타일은 `showBubbles`가 거짓이면 그리지 않는다', async () => {
    mount(vi.fn(async () => stats()));
    await advance(0);
    expect(q('[data-tile="bubbles"]')).toBeNull();
    expect(mounted?.all('[data-tile]').map(el => el.dataset.tile)).toEqual(['tour', 'reactions', 'network']);
    mounted?.unmount();
    mount(
      vi.fn(async () => stats()),
      { showBubbles: true },
    );
    await advance(0);
    expect(q('[data-tile="bubbles"]')?.textContent).toContain(copy.teacher.classTab.bubbles);
  });

  it('말풍선 타일 스위치: 지금 설정을 보이고, 바꾸면 나머지 칸을 지킨 채 알린다 · 꺼지면 짧은 글 스위치를 막는다', async () => {
    const onBubblesChange = vi.fn();
    const base = teacherExhibition({ status: 'OPEN', openedAt: 1 });
    const withBubbles = (enabled: boolean, text: boolean) =>
      teacherExhibition({
        status: 'OPEN',
        openedAt: 1,
        settings: { ...base.settings, bubbles: { enabled, text } },
      });
    const t = copy.teacher.classTab;
    const switches = (): HTMLButtonElement[] =>
      (mounted?.all('[data-tile="bubbles"] [role="switch"]') ?? []) as HTMLButtonElement[];

    mount(
      vi.fn(async () => stats()),
      { showBubbles: true, onBubblesChange, exhibition: withBubbles(true, false) },
    );
    await advance(0);
    const [on, text] = switches();
    expect(on?.getAttribute('aria-label')).toBe(t.bubblesOn);
    expect(on?.getAttribute('aria-checked')).toBe('true');
    expect(text?.getAttribute('aria-label')).toBe(t.bubblesText);
    expect(text?.getAttribute('aria-checked')).toBe('false');
    expect(q('[data-testid="class-bubbles-hint"]')?.textContent).toBe(t.bubblesHint);
    click(text ?? null);
    expect(onBubblesChange).toHaveBeenLastCalledWith({ enabled: true, text: true });
    click(on ?? null);
    expect(onBubblesChange).toHaveBeenLastCalledWith({ enabled: false, text: false });

    mounted?.unmount();
    mount(
      vi.fn(async () => stats()),
      { showBubbles: true, onBubblesChange, exhibition: withBubbles(false, true) },
    );
    await advance(0);
    expect(switches()[1]?.disabled).toBe(true);
    expect(q('[data-testid="class-bubbles-hint"]')?.textContent).toBe(t.bubblesOffHint);

    mounted?.unmount();
    mount(
      vi.fn(async () => stats()),
      {
        showBubbles: true,
        onBubblesChange,
        bubblesBusy: true,
        exhibition: withBubbles(true, true),
      },
    );
    await advance(0);
    expect(q('[data-testid="class-bubbles-hint"]')?.textContent).toBe(t.bubblesTextHint);
    expect(switches().every(sw => sw.disabled)).toBe(true);
    const calls = onBubblesChange.mock.calls.length;
    click(switches()[0] ?? null);
    expect(onBubblesChange).toHaveBeenCalledTimes(calls);
  });

  it('입장: QR은 학생 주소, 입장 코드는 세 자리씩, 짧은 주소 · 삭제일', async () => {
    mount(vi.fn(async () => stats()));
    await advance(0);
    expect(q('[data-testid="class-qr"]')?.getAttribute('data-value')).toBe(studentUrl(T_ENTRY));
    const code = q('[data-testid="class-entry-code"]');
    expect(code?.dataset.code).toBe(T_ENTRY);
    expect(code?.textContent).toBe(`${T_ENTRY.slice(0, 3)} ${T_ENTRY.slice(3)}`);
    expect(q('[data-testid="class-short-url"]')?.textContent).toBe(shortStudentUrl(T_ENTRY));
    const ex = teacherExhibition();
    expect(q('[data-testid="class-tab"]')?.textContent).toContain(
      fill(copy.teacher.manage.deletesOn, { date: formatDay(ex.expiresAt) }),
    );
  });

  it('단추마다 부르는 쪽 콜백: QR 크게 · 자동 투어 · 반응 · 학교망 점검 · 미리 불러오기 · 전시 닫기', async () => {
    const h = mount(vi.fn(async () => stats()));
    await advance(0);
    expect(q('[data-testid="class-reaction-count"]')?.textContent).toBe('14');
    const pairs: [string, () => void][] = [
      ['class-show-qr', h.onShowQr],
      ['class-tour', h.onStartTour],
      ['class-reactions', h.onOpenReactions],
      ['class-network', h.onCheckNetwork],
      ['class-preload', h.onPreload],
      ['class-close', h.onCloseExhibition],
    ];
    for (const [id, fn] of pairs) {
      click(q(`[data-testid="${id}"]`));
      expect(fn, id).toHaveBeenCalledTimes(1);
    }
    expect(q('[data-testid="class-tour"]')?.getAttribute('aria-label')).toBe(
      copy.teacher.classTab.tourStartLabel,
    );
    expect(q('[data-testid="class-show-qr"]')?.textContent).toBe(copy.teacher.open.bigQr);
    expect(q('[data-testid="class-close"]')?.textContent).toBe(copy.teacher.menu.close);
    expect(h.onOpen).not.toHaveBeenCalled();
  });

  it('준비 중 전시: 큰 숫자 대신 안내와 `전시 열기`, 수를 부르지 않고 점·닫기·QR 크게도 없다', async () => {
    const h = mount(
      vi.fn(async () => stats()),
      { exhibition: teacherExhibition({ status: 'DRAFT' }) },
    );
    await advance(POLL_MS * 2);
    expect(h.getLive).not.toHaveBeenCalled();
    expect(q('[data-testid="class-stats"] [data-stat]')).toBeNull();
    expect(q('[data-testid="class-notice"]')?.textContent).toBe(copy.teacher.classTab.draftNotice);
    const open = q('[data-testid="class-open"]');
    expect(open?.textContent).toBe(copy.teacher.manage.open);
    click(open);
    expect(h.onOpen).toHaveBeenCalledTimes(1);
    expect(q('[data-testid="class-show-qr"]')).toBeNull();
    expect(q('[data-testid="class-close"]')).toBeNull();
    expect(mounted?.all('[data-testid="class-map"] circle[data-room-id]')).toHaveLength(0);
    // 지도는 그대로 보인다(수 없이)
    expect(q('[data-testid="floor-plan"]')?.getAttribute('data-state')).toBe('ready');
  });

  it('닫힌 전시: 닫힘 안내와 `다시 열기`', async () => {
    const h = mount(
      vi.fn(async () => stats()),
      {
        exhibition: teacherExhibition({ status: 'CLOSED', openedAt: 1, closedAt: 2 }),
      },
    );
    await advance(0);
    expect(h.getLive).not.toHaveBeenCalled();
    expect(q('[data-testid="class-notice"]')?.textContent).toBe(copy.teacher.classTab.closedNotice);
    expect(q('[data-testid="class-open"]')?.textContent).toBe(copy.teacher.menu.reopen);
  });
});

describe('liveSplit', () => {
  it('세 칸 합 = visitors, 전시실별 수 표', () => {
    const split = liveSplit(stats());
    expect(split.inRooms + split.elsewhere + split.noPose).toBe(split.visitors);
    expect([...split.counts]).toEqual([
      [R0, 4],
      [R1, 0],
      [R2, 3],
    ]);
  });

  it('나눔 칸이 없는 응답이면 남는 수를 `위치 없음`에', () => {
    const split = liveSplit({ visitors: 6, teachers: 0, light: 0, reasons: {} });
    expect(split).toMatchObject({ inRooms: 0, elsewhere: 0, noPose: 6 });
    expect(split.counts.size).toBe(0);
  });
});
