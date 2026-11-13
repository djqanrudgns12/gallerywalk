import { copy, fill } from '@gallery/core/copy';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import { PublicReactions } from '../../ui/patterns/visitor/PublicReactions.tsx';
import { useWalk } from '../../viewer/walk/walkStore.ts';
import { WalkOverlay, type ReactionHooks } from './walkUi.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('관람 화면의 안내판 배치', () => {
  const view = testExhibitionView([2]);
  const artwork = view.artworks[0]!;
  const stopIndex = view.layout.stops.findIndex(stop => stop.artworkId === artwork.id);
  let host: HTMLDivElement;
  let root: Root;
  let width: number;
  let height: number;
  let summaryHeight: number;
  const observers: { elements: Set<Element>; resize: () => void; disconnect: () => void }[] = [];

  const render = (reactions?: ReactionHooks) => {
    act(() =>
      root.render(
        <WalkOverlay
          title="합성 전시관"
          layout={view.layout}
          artworks={[{ id: artwork.id, title: '합성 작품', author: '가상 작가', caption: '작품 소개' }]}
          liveCount={0}
          touch={false}
          pages={new Map([[artwork.id, () => []]])}
          reactions={reactions}
        />,
      ),
    );
  };
  const caption = () => host.querySelector<HTMLElement>('[data-testid="zoom-caption"]')!.parentElement!;
  const scope = () => host.querySelector<HTMLElement>('[data-testid="page-zoom"]')!.parentElement!;
  const resizeCaption = () => {
    const observer = observers.findLast(observer => observer.elements.has(caption()));
    expect(observer).toBeDefined();
    act(() => observer!.resize());
    return observer!;
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    width = 360;
    height = 120;
    summaryHeight = 44;
    observers.length = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        record: (typeof observers)[number];
        constructor(resize: () => void) {
          this.record = { elements: new Set(), resize, disconnect: vi.fn() };
          observers.push(this.record);
        }
        observe(element: Element) {
          this.record.elements.add(element);
        }
        unobserve(element: Element) {
          this.record.elements.delete(element);
        }
        disconnect() {
          this.record.disconnect();
        }
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect({
        width: this.hidden ? 0 : width,
        height: this.hidden ? 0 : this.hasAttribute('data-caption-summary') ? summaryHeight : height,
      });
    });
    useWalk.setState({ mode: 'zoom', zoomId: artwork.id, stopIndex, stopCount: view.layout.stops.length });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useWalk.setState(useWalk.getInitialState());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('캡션의 실제 크기를 작품과 공유하고, 메모 펼침·화면 회전 때 DOM 여백만 갱신한다', () => {
    const memos = Array.from({ length: 8 }, (_, i) => ({ nickname: null, memo: `가상 메모 ${i}` }));
    render({ below: () => <PublicReactions stickers={{}} score={null} memos={memos} /> });
    const layout = scope();
    expect(layout.style.getPropertyValue('--zoom-caption-height')).toBe('120px');
    expect(layout.style.getPropertyValue('--zoom-caption-width')).toBe('360px');
    const changed = vi.fn();
    const unsubscribe = useWalk.subscribe(changed);
    try {
      act(() => host.querySelector<HTMLButtonElement>('[data-testid="public-memos-toggle"]')!.click());
      height = 280;
      resizeCaption();
      expect(layout.style.getPropertyValue('--zoom-caption-height')).toBe('280px');
      act(() => host.querySelector<HTMLButtonElement>('[data-testid="public-memos-more"]')!.click());
      expect(host.querySelectorAll('[data-testid="public-reactions"] li')).toHaveLength(8);
      width = 320;
      height = 200;
      resizeCaption();
      expect(layout.style.getPropertyValue('--zoom-caption-width')).toBe('320px');
      expect(layout.style.getPropertyValue('--zoom-caption-height')).toBe('200px');
      expect(changed).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('반응 창이 열려 캡션이 숨으면 여백을 비우고, 다시 보이면 재측정하며 닫을 때 관찰을 정리한다', () => {
    render();
    const layout = scope();
    const observer = resizeCaption();
    render({ openFor: artwork.id });
    expect(caption().hidden).toBe(true);
    expect(layout.style.getPropertyValue('--zoom-caption-height')).toBe('0px');
    expect(layout.style.getPropertyValue('--zoom-caption-width')).toBe('0px');
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    height = 160;
    render({ openFor: null });
    expect(caption().hidden).toBe(false);
    expect(layout.style.getPropertyValue('--zoom-caption-height')).toBe('160px');
    const reopened = resizeCaption();
    act(() => useWalk.setState({ mode: 'view', zoomId: null }));
    expect(reopened.disconnect).toHaveBeenCalledTimes(1);
    expect(layout.style.getPropertyValue('--zoom-caption-height')).toBe('');
  });

  it('공개 반응 요약 줄의 높이도 따로 관찰해 줄바꿈할 때 캡션의 가용 높이를 갱신한다', () => {
    render({ below: () => <PublicReactions stickers={{ GREAT: 3 }} score={null} memos={[]} /> });
    const layout = scope();
    expect(layout.style.getPropertyValue('--zoom-reactions-height')).toBe('44px');
    const summary = host.querySelector('[data-caption-summary]')!;
    const observer = observers.find(observer => observer.elements.has(summary));
    expect(observer).toBeDefined();
    summaryHeight = 88;
    act(() => observer!.resize());
    expect(layout.style.getPropertyValue('--zoom-reactions-height')).toBe('88px');
    render({ openFor: artwork.id });
    expect(layout.style.getPropertyValue('--zoom-reactions-height')).toBe('0px');
  });

  it('현재 장소를 먼저 보이고 그 아래 작품 순번을 붙이며, 장소가 없으면 전시관 이름을 쓴다', () => {
    act(() => useWalk.setState({ mode: 'view', zoomId: null, place: '가상 전시실' }));
    render();
    const place = host.querySelector('[data-testid="place"]')!;
    const stop = view.layout.stops[stopIndex]!;
    expect(place.parentElement!.firstElementChild).toBe(place);
    expect(place.nextElementSibling?.textContent).toBe(
      fill(copy.viewer.pageOf, { page: stop.index!, total: stop.count! }),
    );
    expect(place.parentElement!.textContent).not.toContain('합성 전시관');
    expect(host.querySelector('header')?.getAttribute('aria-label')).toBe('합성 전시관');
    act(() => useWalk.setState({ mode: 'free', place: '' }));
    expect(host.querySelector('header')?.textContent).toContain('합성 전시관');
    expect(host.querySelector('[data-testid="place"]')).toBeNull();
  });
});
