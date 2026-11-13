import { copy, fill } from '@gallery/core/copy';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testExhibitionView } from '../../dev/testView.ts';
import { PublicReactions } from '../../ui/patterns/visitor/PublicReactions.tsx';
import { useWalk, type WalkApi } from '../../viewer/walk/walkStore.ts';
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

  it('그림 쪽 크게 보기는 뒤의 3D 액자를 덮개 한 장으로 가리고, 덮개는 누르기를 막지 않는다(V-57)', () => {
    render();
    const layout = scope();
    const backdrop = layout.querySelector('[data-testid="zoom-backdrop"]');
    expect(backdrop).not.toBeNull();
    // 덮개는 맨 아래(첫 자식) — 닫기·쪽·캡션이 그 위에 온다
    expect(layout.firstElementChild).toBe(backdrop);
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
    act(() => useWalk.setState({ mode: 'view', zoomId: null }));
    expect(host.querySelector('[data-testid="zoom-backdrop"]')).toBeNull();
  });

  it('출구: 패널 제목은 3D 안내판과 다른 말, 단추는 주요 하나 + 글자 단추, `다음 작품으로`는 숨긴다(V-57)', () => {
    const exitIndex = view.layout.stops.findIndex(stop => stop.kind === 'exit');
    expect(exitIndex).toBeGreaterThan(0);
    act(() => useWalk.setState({ mode: 'view', zoomId: null, stopIndex: exitIndex }));
    act(() =>
      root.render(
        <WalkOverlay
          title="합성 전시관"
          layout={view.layout}
          artworks={[]}
          liveCount={0}
          touch
          onHome={() => {}}
          onCollection={() => {}}
        />,
      ),
    );
    const exit = host.querySelector<HTMLElement>('[data-testid="exit-panel"]')!;
    expect(exit.textContent).toContain(copy.viewer.exitPanelTitle);
    expect(exit.textContent).not.toContain(copy.viewer.exitThanks);
    expect(exit.getAttribute('aria-label')).toBe(copy.viewer.exitPanelTitle);
    const buttons = [...exit.querySelectorAll('button')];
    expect(buttons.map(b => b.textContent)).toEqual([
      copy.viewer.restart,
      copy.viewer.collection,
      copy.closed.home,
    ]);
    expect(buttons.map(b => b.getAttribute('data-variant'))).toEqual(['primary', 'text', 'text']);
    const nav = host.querySelector('[data-testid="walk-nav"]')!;
    expect(nav.querySelector('[data-testid="next"]')).toBeNull();
    expect(nav.querySelector('[data-testid="prev"]')).not.toBeNull();
    // 서 있는 동안(view)에는 뛰기·점프를 숨긴다
    expect(host.querySelector('[data-testid="move-buttons"]')).toBeNull();
  });

  it('작품 앞에 서 있을 때(view)는 뛰기·점프를 숨기고, 걷기 시작하면(free) 다시 보인다(V-57)', () => {
    act(() => useWalk.setState({ mode: 'view', zoomId: null }));
    act(() =>
      root.render(<WalkOverlay title="합성 전시관" layout={view.layout} artworks={[]} liveCount={0} touch />),
    );
    expect(host.querySelector('[data-testid="move-buttons"]')).toBeNull();
    expect(host.querySelector('[data-testid="walk-nav"] [data-testid="next"]')).not.toBeNull();
    act(() => useWalk.setState({ mode: 'free' }));
    expect(host.querySelector('[data-testid="move-buttons"]')).not.toBeNull();
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

  const overlay = (touch: boolean) =>
    act(() =>
      root.render(
        <WalkOverlay title="합성 전시관" layout={view.layout} artworks={[]} liveCount={0} touch={touch} />,
      ),
    );
  const pointerDown = (el: Element) =>
    act(() => {
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    });

  it('행동 단추(터치): 같은 단추가 도슨트 앞 `말걸기`·대문 앞 `나가기`로 바뀌고, 누르면 그 일을 한다(W-01)', () => {
    const jump = vi.fn();
    act(() =>
      useWalk.setState({ mode: 'free', zoomId: null, action: 'jump', api: { jump } as unknown as WalkApi }),
    );
    overlay(true);
    const btn = () => host.querySelector<HTMLButtonElement>('[data-testid="jump"]')!;
    const first = btn();
    expect(first.getAttribute('aria-label')).toBe(copy.museumWalk.actionJump);
    pointerDown(first);
    expect(jump).toHaveBeenCalledTimes(1);
    act(() => useWalk.setState({ action: 'talk', actionNpcId: 'docent-1' }));
    // 같은 자리의 같은 단추(키보드 초점이 남게) — 안쪽 아이콘·글자만 바뀜
    expect(btn()).toBe(first);
    expect(first.getAttribute('data-action')).toBe('talk');
    expect(first.getAttribute('aria-label')).toBe(copy.museumWalk.actionTalk);
    expect(first.textContent).toBe(copy.museumWalk.actionTalk);
    pointerDown(first);
    expect(useWalk.getState().talkRequest?.npcId).toBe('docent-1');
    act(() => useWalk.setState({ action: 'exit', actionNpcId: null }));
    expect(first.textContent).toBe(copy.museumWalk.actionExit);
    pointerDown(first);
    expect(useWalk.getState().exitOpen).toBe(true);
    expect(jump).toHaveBeenCalledTimes(1);
    // 터치 기기에는 데스크톱 키 표시가 없다
    expect(host.querySelector('[data-testid="action-key-hint"]')).toBeNull();
  });

  it('데스크톱: 도슨트·대문 가까이에서만 아래 가운데 `스페이스 말걸기`·`스페이스 나가기`를 띄운다(W-01)', () => {
    act(() => useWalk.setState({ mode: 'free', zoomId: null, action: 'jump' }));
    overlay(false);
    const hint = () => host.querySelector('[data-testid="action-key-hint"]');
    expect(hint()).toBeNull();
    expect(host.querySelector('[data-testid="jump"]')).toBeNull();
    act(() => useWalk.setState({ action: 'talk', actionNpcId: 'docent-1' }));
    expect(hint()?.textContent).toBe(fill(copy.museumWalk.keyHint, { action: copy.museumWalk.actionTalk }));
    act(() => useWalk.setState({ action: 'exit', actionNpcId: null }));
    expect(hint()?.textContent).toBe(fill(copy.museumWalk.keyHint, { action: copy.museumWalk.actionExit }));
    // 나가기 창이 열려 있거나 크게 보는 중이면 숨김
    act(() => useWalk.setState({ exitOpen: true }));
    expect(hint()).toBeNull();
    act(() => useWalk.setState({ exitOpen: false, mode: 'zoom' }));
    expect(hint()).toBeNull();
  });

  it('광장 경계·사람끼리 부딪힘 알림은 예절 알림과 같은 도슨트 말풍선으로(W-06·W-07)', () => {
    act(() => useWalk.setState({ mode: 'free', zoomId: null }));
    overlay(false);
    act(() => useWalk.setState({ notice: { kind: 'boundary', at: 1 } }));
    expect(host.querySelector('[data-testid="docent"]')?.textContent).toContain(copy.museumWalk.boundary);
    act(() => useWalk.setState({ notice: { kind: 'bump', at: 2 } }));
    expect(host.querySelector('[data-testid="docent"]')?.textContent).toContain(copy.museumWalk.bump);
  });
});
