import { copy, fill } from '@gallery/core/copy';
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExitPanel, type ExitPanelProps, LiveLostBanner } from './index.ts';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = (ui: JSX.Element): void => {
  act(() => root.render(ui));
};

const panelProps = (over: Partial<ExitPanelProps> = {}): ExitPanelProps => ({
  open: true,
  seen: 4,
  reacted: 2,
  onLeave: vi.fn(),
  onRejoin: vi.fn(),
  onStay: vi.fn(),
  ...over,
});

const byTestId = (id: string): HTMLElement => {
  const el = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`없음: ${id}`);
  return el;
};

const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ExitPanel', () => {
  it('닫혀 있으면 아무것도 그리지 않고, 열면 제목·통계·단추 세 개가 있는 모달 대화 상자다', () => {
    render(<ExitPanel {...panelProps({ open: false })} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    render(<ExitPanel {...panelProps()} />);
    const dialog = byTestId('exit-sheet');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe(copy.museumWalk.exitTitle);
    const stats = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(stats?.textContent).toBe(fill(copy.museumWalk.exitStats, { seen: 4, reacted: 2 }));
    expect(byTestId('exit-leave').textContent).toBe(copy.museumWalk.exitLeave);
    expect(byTestId('exit-rejoin').textContent).toBe(copy.museumWalk.exitRejoin);
    expect(byTestId('exit-stay').textContent).toBe(copy.museumWalk.exitStay);
    // 주·보조 단추에는 아이콘(장식), 글자 단추에는 없음
    expect(byTestId('exit-leave').querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(byTestId('exit-rejoin').querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(byTestId('exit-stay').querySelector('svg')).toBeNull();
  });

  it('통계: 본 작품·남긴 반응이 모두 0이면 고마움 한 줄, 하나라도 있으면 수를 채운다', () => {
    render(<ExitPanel {...panelProps({ seen: 0, reacted: 0 })} />);
    expect(byTestId('exit-sheet').textContent).toContain(copy.museumWalk.exitStatsNone);

    render(<ExitPanel {...panelProps({ seen: 3, reacted: 0 })} />);
    const text = byTestId('exit-sheet').textContent ?? '';
    expect(text).toContain(fill(copy.museumWalk.exitStats, { seen: 3, reacted: 0 }));
    expect(text).not.toContain(copy.museumWalk.exitStatsNone);
  });

  it('단추 세 개가 각자의 콜백을 부른다', () => {
    const p = panelProps();
    render(<ExitPanel {...p} />);
    act(() => byTestId('exit-leave').click());
    act(() => byTestId('exit-rejoin').click());
    act(() => byTestId('exit-stay').click());
    expect(p.onLeave).toHaveBeenCalledTimes(1);
    expect(p.onRejoin).toHaveBeenCalledTimes(1);
    expect(p.onStay).toHaveBeenCalledTimes(1);
  });

  it('Esc는 onStay를 부르고, 걷기 입력 같은 다른 창 키 처리에는 넘기지 않는다', () => {
    const p = panelProps();
    const other = vi.fn();
    window.addEventListener('keydown', other);
    try {
      render(<ExitPanel {...p} />);
      const e = press(document.body, 'Escape');
      expect(p.onStay).toHaveBeenCalledTimes(1);
      expect(other).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(true);
      expect(p.onLeave).not.toHaveBeenCalled();

      // 닫히면 Esc를 더 받지 않는다
      render(<ExitPanel {...p} open={false} />);
      press(document.body, 'Escape');
      expect(p.onStay).toHaveBeenCalledTimes(1);
      expect(other).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', other);
    }
  });

  it('열면 첫 단추(나가기)로 초점, 닫으면 연 자리로 되돌린다', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    try {
      opener.focus();
      render(<ExitPanel {...panelProps()} />);
      expect(document.activeElement).toBe(byTestId('exit-leave'));

      render(<ExitPanel {...panelProps({ open: false })} />);
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it('초점은 시트 안에서만 돈다: 끝에서 Tab → 처음, 처음에서 Shift+Tab → 끝, 밖으로 나가면 첫 단추로', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      render(<ExitPanel {...panelProps()} />);
      const first = byTestId('exit-leave');
      const last = byTestId('exit-stay');

      last.focus();
      const tab = press(last, 'Tab');
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);

      const back = press(first, 'Tab', { shiftKey: true });
      expect(back.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);

      // 가운데에서는 브라우저 기본 이동을 막지 않는다
      const rejoin = byTestId('exit-rejoin');
      rejoin.focus();
      expect(press(rejoin, 'Tab').defaultPrevented).toBe(false);

      act(() => outside.focus());
      expect(document.activeElement).toBe(first);
    } finally {
      outside.remove();
    }
  });
});

describe('LiveLostBanner', () => {
  it('보일 때만 "연결이 잠시 끊겼어요"와 재접속하기 단추를 그리고, 단추는 onRejoin을 부른다', () => {
    const onRejoin = vi.fn();
    render(<LiveLostBanner visible={false} onRejoin={onRejoin} />);
    expect(container.querySelector('[data-testid="live-lost"]')).toBeNull();

    render(<LiveLostBanner visible onRejoin={onRejoin} />);
    const banner = byTestId('live-lost');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.textContent).toContain(copy.museumWalk.liveLost);
    const btn = byTestId('live-rejoin');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe(copy.museumWalk.liveRejoin);
    act(() => btn.click());
    expect(onRejoin).toHaveBeenCalledTimes(1);
  });
});
