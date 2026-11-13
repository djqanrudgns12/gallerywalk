import { copy } from '@gallery/core/copy';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropZone, type FilePickers, PHONE_UPLOAD_QUERY } from './DropZone.tsx';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
});

const pickers: FilePickers = { inputs: null, pickFiles: () => undefined, pickFolder: () => undefined };

/** `matchMedia`를 휴대폰(검사 식이 맞음) 또는 데스크톱으로 */
const device = (phone: boolean): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query === PHONE_UPLOAD_QUERY,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
};

const render = (empty: boolean): HTMLElement => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<DropZone empty={empty} pickers={pickers} onPasteText={() => undefined} />));
  cleanup = () => {
    act(() => root.unmount());
    el.remove();
  };
  return el;
};
const buttons = (el: HTMLElement): string[] =>
  Array.from(el.querySelectorAll('button')).map(b => b.textContent?.trim() ?? '');

describe('휴대폰에서는 파일 고르기만(V-19, PRD G-10 [추천])', () => {
  it('휴대폰: 큰 놓기 영역에 폴더 고르기·끌어 놓기 안내가 없다', () => {
    device(true);
    const el = render(true);
    const u = copy.teacher.upload;
    expect(buttons(el)).toContain(copy.teacher.manage.upload);
    expect(buttons(el)).not.toContain(u.pickFolder);
    expect(el.textContent).not.toContain(u.dropTitle);
    expect(el.textContent).not.toContain(u.dropHint);
    expect(el.textContent).toContain(u.dropTitlePhone);
  });

  it('휴대폰: 얇은 띠에 "화면 어디에 놓아도" 안내와 폴더 고르기가 없다', () => {
    device(true);
    const el = render(false);
    const u = copy.teacher.upload;
    expect(buttons(el)).toContain(u.pickFiles);
    expect(buttons(el)).not.toContain(u.pickFolder);
    expect(el.textContent).not.toContain(u.dropStrip);
  });

  it('데스크톱·태블릿: 폴더 고르기와 놓기 안내가 그대로', () => {
    device(false);
    const u = copy.teacher.upload;
    const big = render(true);
    expect(buttons(big)).toContain(u.pickFolder);
    expect(big.textContent).toContain(u.dropTitle);
    expect(big.textContent).toContain(u.dropHint);
    cleanup?.();
    cleanup = null;
    const strip = render(false);
    expect(buttons(strip)).toContain(u.pickFolder);
    expect(strip.textContent).toContain(u.dropStrip);
  });
});
