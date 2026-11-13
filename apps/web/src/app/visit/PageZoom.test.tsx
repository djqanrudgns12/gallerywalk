import { copy } from '@gallery/core/copy';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZoomPage } from '../../viewer/zoom/zoomPages.ts';
import { PageZoom } from './PageZoom.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page = (n: number): ZoomPage => ({
  w: 300,
  h: 400,
  source: n,
  plan: { fit: 'split', axis: 'y', scale: 0.5, readable: true, rotateHint: false },
  pieces: [{ url: `/p${n}.webp`, sx: 0, sy: n * 800, sw: 600, sh: 800, dx: 0, dy: 0, dw: 300, dh: 400 }],
});

describe('여러 쪽 크게 보기', () => {
  let root: ReturnType<typeof createRoot> | null = null;
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 320 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 420 });
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it('상자 크기로 쪽을 계산해 조각을 제자리·배율로 놓고, 좌우 키로 넘기며 걷기 키로 새지 않는다', () => {
    const asked: { w: number; h: number }[] = [];
    const pagesFor = (vp: { w: number; h: number }) => {
      asked.push(vp);
      return [page(0), page(1), page(2)];
    };
    const seen: [number, number][] = [];
    const walkKeys = vi.fn();
    window.addEventListener('keydown', walkKeys);
    const host = document.createElement('div');
    root = createRoot(host);
    act(() => root!.render(<PageZoom pagesFor={pagesFor} onPage={(p, t) => seen.push([p, t])} />));
    expect(asked[0]).toEqual({ w: 320, h: 420 });
    const sec = host.querySelector('[data-testid="page-zoom"]')!;
    expect(sec.getAttribute('data-total')).toBe('3');
    const img = host.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/p0.webp');
    expect(img.style.transform).toBe('scale(0.5, 0.5)');
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true, cancelable: true }),
      );
    });
    expect(sec.getAttribute('data-page')).toBe('2');
    expect(host.querySelector('img')!.style.objectPosition).toBe('0px -800px');
    expect(walkKeys).not.toHaveBeenCalled();
    expect(seen.at(-1)).toEqual([2, 3]);
    window.removeEventListener('keydown', walkKeys);
  });

  it('마지막 쪽에서 `›`(오른쪽 키)를 누르면 다음 작품으로(onPastEnd), 없으면 잠김(PRD G-03)', () => {
    const pastEnd = vi.fn();
    const host = document.createElement('div');
    root = createRoot(host);
    act(() => root!.render(<PageZoom pagesFor={() => [page(0), page(1)]} onPastEnd={pastEnd} />));
    const next = () => host.querySelector<HTMLButtonElement>(`button[aria-label="${copy.viewer.next}"]`)!;
    act(() => next().click());
    expect(host.querySelector('[data-testid="page-zoom"]')?.getAttribute('data-page')).toBe('2');
    expect(pastEnd).not.toHaveBeenCalled();
    expect(next().disabled).toBe(false);
    act(() => next().click());
    expect(pastEnd).toHaveBeenCalledTimes(1);
    act(() => root!.render(<PageZoom pagesFor={() => [page(0), page(1)]} />));
    act(() => next().click());
    expect(next().disabled).toBe(true);
  });

  it('두 번 누르면 2배로 커지고 다시 누르면 1배, 휴대폰 세로 한 장 쪽에는 돌리기 안내를 처음 한 번(ADR-047)', () => {
    const host = document.createElement('div');
    root = createRoot(host);
    const one = { ...page(0), plan: { ...page(0).plan, rotateHint: true } };
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    act(() => root!.render(<PageZoom pagesFor={() => [one]} />));
    const sec = host.querySelector('[data-testid="page-zoom"]')!;
    expect(host.querySelector('[data-rotate-hint="1"]')?.textContent).toBe(copy.viewer.rotateHint);
    act(() => {
      sec.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(sec.getAttribute('data-scale')).toBe('2');
    act(() => {
      sec.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(sec.getAttribute('data-scale')).toBe('1');
  });
});
