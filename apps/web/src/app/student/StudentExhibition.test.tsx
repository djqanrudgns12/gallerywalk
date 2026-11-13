import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import { mediaPath } from '@gallery/core/types';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisitScreenProps } from '../visit/contract.ts';
import { formatDay, posterArtworks } from './posterView.ts';
import { buttonByText, click, flush, KAKAO_UA, makeServices, mountAt, typeInto } from './testDom.tsx';
import {
  CODE,
  deferred,
  EX_ID,
  EXPIRES_AT,
  makeView,
  POSTER_ID,
  VIEW_ARTWORKS,
  VIEW_SUBTITLE,
  VIEW_TITLE,
} from '../../dev/studentFixtures.ts';

const visit = vi.hoisted(() => ({ props: null as VisitScreenProps | null, mounts: 0 }));

// 소리 잠금 풀기(iOS는 누름 안에서만): 입장·시작 누름에서 부르는지 본다
const unlockAudio = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../visit/roomMusic.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../visit/roomMusic.ts')>()),
  unlockAudio,
}));

vi.mock('../visit/VisitScreen.tsx', async () => {
  const { createElement, useEffect } = await import('react');
  return {
    VisitScreen: (p: VisitScreenProps) => {
      visit.props = p;
      useEffect(() => {
        visit.mounts++;
      }, []);
      return createElement('div', {
        'data-testid': 'visit-screen',
        'data-entered': p.entered ? '1' : '0',
        'data-character': p.character,
        'data-code': p.code,
      });
    },
  };
});

let mounted: ReturnType<typeof mountAt> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  visit.props = null;
  visit.mounts = 0;
});

const reportReady = (ready: boolean, progress: number) =>
  act(() => {
    visit.props?.onProgress?.({ ready, progress });
  });

const open = async (extra: Parameters<typeof makeServices>[0] = {}, ua?: string) => {
  const t = makeServices(extra, ua);
  mounted = mountAt(`/${CODE}`, t.services);
  await flush();
  return { ...t, m: mounted };
};

const enterButton = () => mounted?.q<HTMLButtonElement>('[data-testid="enter-plaza-btn"]') ?? null;

describe('학생 전시 화면', () => {
  it('불러오는 동안 박물관 그리기 → 포스터, 관람 화면은 뒤에서 미리 준비', async () => {
    const d = deferred<ReturnType<typeof makeView>>();
    const t = makeServices({ exhibition: () => d.promise });
    mounted = mountAt(`/${CODE}`, t.services);
    expect(mounted.q('[data-testid="loading-museum"]')).not.toBeNull();
    expect(mounted.q('[data-testid="visit-screen"]')).toBeNull();
    d.resolve(makeView());
    await flush();
    expect(mounted.q('[data-testid="loading-museum"]')).toBeNull();
    expect(mounted.q('[data-testid="entry-poster"]')).not.toBeNull();
    expect(mounted.text()).toContain(VIEW_TITLE);
    expect(mounted.text()).toContain(VIEW_SUBTITLE);
    expect(mounted.text()).toContain(fill(copy.poster.openUntil, { date: formatDay(EXPIRES_AT) }));
    expect(mounted.text()).toContain(fill(copy.viewer.exitCount, { n: VIEW_ARTWORKS }));
    const screen = mounted.q('[data-testid="visit-screen"]');
    expect(screen?.getAttribute('data-entered')).toBe('0');
    expect(screen?.getAttribute('data-code')).toBe(CODE);
    expect(visit.props?.view.exhibition.id).toBe(EX_ID);
    expect(visit.props?.liveToken).toBeNull();
  });

  it('준비 전에는 입장 단추가 잠기고 "준비하고 있어요" + 진행 막대', async () => {
    await open();
    expect(enterButton()?.disabled).toBe(true);
    expect(mounted!.text()).toContain(copy.poster.preparing);
    reportReady(false, 0.42);
    const bar = mounted!.q('[data-testid="prepare-progress"] [role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('42');
    reportReady(true, 1);
    expect(enterButton()?.disabled).toBe(false);
    expect(mounted!.q('[data-testid="prepare-progress"]')).toBeNull();
  });

  it('별명이 비면 동의 없이 바로 관람(관람 화면을 다시 만들지 않음)', async () => {
    const t = await open();
    reportReady(true, 1);
    unlockAudio.mockClear();
    click(enterButton());
    expect(unlockAudio).toHaveBeenCalledTimes(1);
    expect(t.m.q('[role="dialog"]')).toBeNull();
    expect(t.m.q('[data-testid="visit-screen"]')?.getAttribute('data-entered')).toBe('1');
    expect(visit.props?.liveToken).toBe(t.device.visitor(EX_ID)?.token);
    expect(t.registerVisitor).not.toHaveBeenCalled();
    expect(visit.mounts).toBe(1);
  });

  it('animationend가 오지 않아도 T_ENTER 뒤 포스터를 내린다', async () => {
    const t = await open();
    reportReady(true, 1);
    vi.useFakeTimers();
    try {
      click(enterButton());
      expect(t.m.q('[data-phase="entering"]')).not.toBeNull();
      act(() => vi.advanceTimersByTime(config().T_ENTER * 1000 - 1));
      expect(t.m.q('[data-testid="entry-poster"]')).not.toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(t.m.q('[data-testid="entry-poster"]')).toBeNull();
      expect(t.m.q('[data-phase="viewing"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('별명을 적고 입장 → 동의 시트("모두에게" 판·지워지는 날) → 알겠어요 → 시작하기 → 관람', async () => {
    const t = await open();
    reportReady(true, 1);
    typeInto(t.m.q<HTMLInputElement>('[data-testid="entry-poster"] input')!, '하늘고래');
    click(t.m.q('[data-testid="char-student-f"]'));
    click(enterButton());
    const dialog = t.m.q('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(copy.consent.titleEnter);
    expect(dialog?.textContent).toContain(copy.consent.everyone);
    expect(dialog?.textContent).not.toContain(copy.consent.teacherOnly);
    expect(dialog?.textContent).toContain(
      fill(copy.consent.deletes, { date: formatDay(EXPIRES_AT), days: config().EXHIBITION_TTL_DAYS }),
    );
    expect(dialog?.textContent).toContain(copy.consent.noRealInfo);
    // 처리방침 링크는 시트 안 하나만(뒤 포스터의 링크는 시트가 덮는 동안 숨김, V-57)
    expect(document.querySelectorAll('[data-testid="privacy-link"]')).toHaveLength(1);
    expect(dialog?.querySelector('[data-testid="privacy-link"]')).not.toBeNull();
    expect(t.m.q<HTMLInputElement>('[role="dialog"] input[type="text"]')?.value).toBe('하늘고래');
    const start = buttonByText(dialog!, copy.consent.start);
    expect(start?.disabled).toBe(true);
    click(t.m.q('[role="dialog"] input[type="checkbox"]'));
    expect(start?.disabled).toBe(false);
    unlockAudio.mockClear();
    click(start);
    expect(unlockAudio).toHaveBeenCalledTimes(1);
    await flush();
    expect(t.registerVisitor).toHaveBeenCalledWith(
      { code: CODE, exhibitionId: EX_ID },
      { nickname: '하늘고래', consentVersion: config().CONSENT_VERSION },
    );
    expect(t.m.q('[role="dialog"]')).toBeNull();
    const screen = t.m.q('[data-testid="visit-screen"]');
    expect(screen?.getAttribute('data-entered')).toBe('1');
    expect(screen?.getAttribute('data-character')).toBe('student-f');
  });

  it('걸러진 별명이면 시트 칸 아래 문구', async () => {
    const t = await open({ register: { fail: new AppError('E_MEMO_BLOCKED') } });
    reportReady(true, 1);
    typeInto(t.m.q<HTMLInputElement>('[data-testid="entry-poster"] input')!, '하늘고래');
    click(enterButton());
    click(t.m.q('[role="dialog"] input[type="checkbox"]'));
    click(buttonByText(t.m.q('[role="dialog"]')!, copy.consent.start));
    await flush();
    const alert = t.m.q('[role="dialog"] [role="alert"]');
    expect(alert?.textContent).toBe(errorCopy.E_MEMO_BLOCKED);
    expect(t.m.q('[data-testid="visit-screen"]')?.getAttribute('data-entered')).toBe('0');
    expect(buttonByText(t.m.q('[role="dialog"]')!, copy.consent.skipNickname)).toBeNull();
  });

  it('끊겨서 등록하지 못하면 문구 + 별명 없이 들어가기', async () => {
    const t = await open({ register: { fail: new AppError('E_OFFLINE') } });
    reportReady(true, 1);
    typeInto(t.m.q<HTMLInputElement>('[data-testid="entry-poster"] input')!, '하늘고래');
    click(enterButton());
    click(t.m.q('[role="dialog"] input[type="checkbox"]'));
    click(buttonByText(t.m.q('[role="dialog"]')!, copy.consent.start));
    await flush();
    expect(t.m.q('[role="dialog"]')?.textContent).toContain(copy.consent.offline);
    click(buttonByText(t.m.q('[role="dialog"]')!, copy.consent.skipNickname));
    expect(t.m.q('[role="dialog"]')).toBeNull();
    expect(t.m.q('[data-testid="visit-screen"]')?.getAttribute('data-entered')).toBe('1');
  });

  it('막 내림 → 처음으로', async () => {
    const t = await open({ exhibition: () => Promise.reject(new AppError('E_EXHIBITION_CLOSED')) });
    expect(t.m.text()).toContain(copy.closed.title);
    expect(t.m.q('[data-testid="visit-screen"]')).toBeNull();
    click(buttonByText(t.m.container, copy.closed.home));
    expect(t.m.q('[data-testid="entry-home"]')).not.toBeNull();
  });

  it('없는 코드도 막 내림', async () => {
    const t = await open({ exhibition: () => Promise.reject(new AppError('E_NOT_FOUND')) });
    expect(t.m.text()).toContain(copy.closed.title);
  });

  it('준비 중 → "아직 준비 중인 전시예요" + 처음으로', async () => {
    const t = await open({ exhibition: () => Promise.reject(new AppError('E_EXHIBITION_DRAFT')) });
    expect(t.m.text()).toContain(copy.closed.draft);
    expect(buttonByText(t.m.container, copy.closed.home)).not.toBeNull();
  });

  it('끊김 → 다시 해 보기 화면, 누르면 다시 불러온다', async () => {
    let calls = 0;
    const t = await open({
      exhibition: () =>
        ++calls === 1 ? Promise.reject(new AppError('E_OFFLINE')) : Promise.resolve(makeView()),
    });
    expect(t.m.text()).toContain(errorCopy.E_OFFLINE);
    click(buttonByText(t.m.container, copy.entry.retry));
    await flush();
    expect(t.exhibition).toHaveBeenCalledTimes(2);
    expect(t.m.q('[data-testid="entry-poster"]')).not.toBeNull();
  });

  it('잠시 문제(E_SERVER)도 다시 해 보기', async () => {
    const t = await open({ exhibition: () => Promise.reject(new AppError('E_SERVER')) });
    expect(t.m.text()).toContain(errorCopy.E_SERVER);
    expect(buttonByText(t.m.container, copy.entry.retry)).not.toBeNull();
  });

  it('앱 안 창(카카오톡 등)이면 포스터 아래 안내 한 줄', async () => {
    const inApp = await open({}, KAKAO_UA);
    expect(inApp.m.text()).toContain(copy.poster.inAppBrowserHint);
    mounted?.unmount();
    const normal = await open();
    expect(normal.m.text()).not.toContain(copy.poster.inAppBrowserHint);
  });

  it('포스터 그림이 있으면 그 주소, 학교·학급은 있을 때', async () => {
    const t = await open({
      view: makeView({ poster: true, school: { schoolName: '가상초등학교', className: '5학년 2반' } }),
    });
    const img = t.m.q<HTMLImageElement>('[data-testid="entry-poster"] img');
    expect(img?.getAttribute('src')).toBe(mediaPath(EX_ID, POSTER_ID, { name: 'wall', ext: 'webp' }));
    expect(t.m.text()).toContain('가상초등학교 5학년 2반');
  });

  it('포스터 그림이 없으면 위 절반에 첫 전시실 작품 썸네일(미리 받는 주소)이 걸린다', async () => {
    const t = await open();
    const srcs = [...t.m.container.querySelectorAll('[data-testid="poster-artworks"] img')].map(i =>
      i.getAttribute('src'),
    );
    expect(srcs.sort()).toEqual(
      posterArtworks(makeView())
        .map(a => a.url)
        .sort(),
    );
    expect(srcs).toHaveLength(VIEW_ARTWORKS);
  });

  it('관람 중 2D로 바꾸라는 알림 → 3D 관람 화면을 내리고 그 자리에 2D 화면(같은 전시)', async () => {
    const t = await open();
    reportReady(true, 1);
    click(enterButton());
    expect(t.m.q('[data-testid="visit-screen"]')).not.toBeNull();
    act(() => visit.props?.onFallback2d?.('context'));
    await flush();
    expect(t.m.q('[data-testid="visit-screen"]')).toBeNull();
    const flat = t.m.q('[data-testid="visit-2d"]');
    expect(flat).not.toBeNull();
    expect(flat?.textContent).toContain(VIEW_TITLE);
    expect(t.m.text()).toContain(copy.view2d.notice);
  });

  it('포스터에서 WebGL2를 못 만듦 → 3D 준비를 기다리지 않고 입장 단추가 열리고, 들어가면 2D 화면', async () => {
    const t = await open();
    expect(enterButton()?.disabled).toBe(true);
    act(() => visit.props?.onFallback2d?.('webgl'));
    expect(enterButton()?.disabled).toBe(false);
    expect(t.m.q('[data-testid="prepare-progress"]')).toBeNull();
    expect(t.m.q('[data-testid="visit-screen"]')).toBeNull();
    click(enterButton());
    await flush();
    expect(t.m.q('[data-testid="visit-2d"]')).not.toBeNull();
    expect(t.m.q('[data-testid="visit-screen"]')).toBeNull();
  });

  it('2D 화면의 소리 단추는 기기에 기억하고, 출구의 처음으로는 첫 화면', async () => {
    const t = await open();
    act(() => visit.props?.onFallback2d?.('fps'));
    click(enterButton());
    await flush();
    expect(t.device.soundOn()).toBe(true);
    click(t.m.q('[data-testid="visit-2d"] [data-testid="sound-toggle"]'));
    expect(t.device.soundOn()).toBe(false);
    expect(t.m.q('[data-testid="sound-toggle"]')?.getAttribute('aria-pressed')).toBe('false');
    const next = t.m.q<HTMLButtonElement>('[data-testid="visit2d-next"]')!;
    for (let i = 0; i < VIEW_ARTWORKS; i++) click(next);
    expect(t.m.q('[data-testid="visit2d-exit"]')).not.toBeNull();
    click(buttonByText(t.m.q('[data-testid="visit2d-exit"]')!, copy.closed.home));
    expect(t.m.q('[data-testid="entry-home"]')).not.toBeNull();
  });

  it('관람 중(3D·2D)에는 화면 꺼짐을 막고, 화면을 떠나면 놓는다', async () => {
    const held: { released: boolean }[] = [];
    const request = vi.fn(async () => {
      const s = {
        released: false,
        release: async () => {
          s.released = true;
        },
      };
      held.push(s);
      return s;
    });
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    try {
      await open();
      expect(request).not.toHaveBeenCalled(); // 포스터에서는 잡지 않음
      reportReady(true, 1);
      click(enterButton());
      await flush();
      expect(request).toHaveBeenCalledTimes(1);
      expect(held.filter(s => !s.released)).toHaveLength(1);
      act(() => visit.props?.onFallback2d?.('fps'));
      await flush();
      expect(held.filter(s => !s.released)).toHaveLength(1); // 2D로 바뀌어도 그대로 잡고 있다
      mounted?.unmount();
      mounted = null;
      expect(held.filter(s => !s.released)).toHaveLength(0);
    } finally {
      Reflect.deleteProperty(navigator, 'wakeLock');
    }
  });

  it('출구의 처음으로(onHome) → 첫 화면', async () => {
    const t = await open();
    reportReady(true, 1);
    click(enterButton());
    act(() => visit.props?.onHome());
    expect(t.m.q('[data-testid="entry-home"]')).not.toBeNull();
  });
});
