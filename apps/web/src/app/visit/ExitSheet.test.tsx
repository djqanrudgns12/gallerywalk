import { copy } from '@gallery/core/copy';
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS } from '../routes.ts';
import { ExitSheet, type ExitSheetProps } from './ExitSheet.tsx';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = (ui: JSX.Element): void => {
  act(() => root.render(ui));
};

const find = (id: string): HTMLElement | null =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const byTestId = (id: string): HTMLElement => {
  const el = find(id);
  if (!el) throw new Error(`없음: ${id}`);
  return el;
};

/** 학생 전시 주소에서 연 나가기 창(첫 화면 `/`는 표시만) */
const routed = (props: ExitSheetProps): JSX.Element => (
  <MemoryRouter initialEntries={[PATHS.exhibition('123456')]}>
    <Routes>
      <Route path={PATHS.home} element={<p data-testid="home-screen" />} />
      <Route path="/:code" element={<ExitSheet {...props} />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ExitSheet', () => {
  it('닫혀 있으면 그리지 않고, 열면 본 작품·반응 수로 나가기 창을 띄운다', () => {
    const onClose = vi.fn();
    render(routed({ open: false, seen: 2, reacted: 1, onClose }));
    expect(find('exit-sheet')).toBeNull();

    render(routed({ open: true, seen: 0, reacted: 0, onClose }));
    expect(byTestId('exit-sheet').textContent).toContain(copy.museumWalk.exitStatsNone);
  });

  it('나가기: onLeave가 없으면 라우터로 학생 첫 화면 `/`로 간다', () => {
    const onClose = vi.fn();
    render(routed({ open: true, seen: 2, reacted: 1, onClose }));
    act(() => byTestId('exit-leave').click());
    expect(find('home-screen')).not.toBeNull();
    expect(find('exit-sheet')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('나가기: onLeave를 주면(교사 미리 보기·개발 화면) 그것만 부르고 주소는 그대로', () => {
    const onLeave = vi.fn();
    render(routed({ open: true, seen: 2, reacted: 1, onClose: vi.fn(), onLeave }));
    act(() => byTestId('exit-leave').click());
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(find('home-screen')).toBeNull();
    expect(find('exit-sheet')).not.toBeNull();
  });

  it('계속 둘러보기·Esc는 onClose, 재접속하기는 주어진 onRejoin을 부른다', () => {
    const onClose = vi.fn();
    const onRejoin = vi.fn();
    render(routed({ open: true, seen: 2, reacted: 1, onClose, onRejoin }));
    act(() => byTestId('exit-stay').click());
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    act(() => byTestId('exit-rejoin').click());
    expect(onRejoin).toHaveBeenCalledTimes(1);
  });

  it('라우터 밖(개발 관람 화면)에서도 던지지 않고 그린다', () => {
    render(<ExitSheet open seen={1} reacted={0} onClose={vi.fn()} />);
    expect(byTestId('exit-sheet')).not.toBeNull();
  });
});
