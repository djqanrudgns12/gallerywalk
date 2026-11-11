import { copy, fill } from '@gallery/core/copy';
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Icon, type IconName } from '../../Icon.tsx';
import {
  EntryPoster,
  Joystick,
  LoadingMuseum,
  NearArtworkCard,
  type StickValue,
  TopBar,
  WalkHint,
  WalkNav,
  ZoomCaption,
} from './index.ts';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('ui/Icon 및 ui/patterns/visitor 부품', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (ui: JSX.Element): void => {
    act(() => {
      root.render(ui);
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('Icon: 지정된 13종 선 아이콘을 24px 격자와 접근성 속성으로 그린다', () => {
    const names: readonly IconName[] = [
      'chevron-left',
      'chevron-right',
      'map',
      'sound-on',
      'sound-off',
      'menu',
      'zoom-in',
      'close',
      'user',
      'plus',
      'grid',
      'warning',
      'play',
    ];
    render(
      <div>
        {names.map(n => (
          <Icon key={n} name={n} />
        ))}
        <Icon name="map" label={copy.viewer.map} />
      </div>,
    );

    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(names.length + 1);
    expect(svgs[0]?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svgs[0]?.getAttribute('aria-hidden')).toBe('true');

    const labeled = container.querySelector(`svg[aria-label="${copy.viewer.map}"]`);
    expect(labeled).not.toBeNull();
    expect(labeled?.getAttribute('role')).toBe('img');
  });

  it('TopBar: 전시관 이름·자리·함께 관람 인원(0이면 혼자 둘러보는 중)과 모아 보기 콜백을 처리한다', () => {
    const onCollection = vi.fn();
    render(<TopBar title="근대 역사관" place="제1관" liveCount={0} onCollection={onCollection} />);

    const header = container.querySelector('header');
    expect(header?.getAttribute('aria-label')).toBe('근대 역사관');
    expect(container.querySelector('[data-testid="place"]')?.textContent).toBe('제1관');
    expect(container.querySelector('[data-testid="live-count"]')?.textContent).toBe(copy.live.alone);

    const colBtn = container.querySelector(
      `button[aria-label="${copy.viewer.collection}"]`,
    ) as HTMLButtonElement | null;
    expect(colBtn).not.toBeNull();
    act(() => {
      colBtn?.click();
    });
    expect(onCollection).toHaveBeenCalledTimes(1);

    render(<TopBar title="근대 역사관" place="제1관" liveCount={5} />);
    expect(container.querySelector('[data-testid="live-count"]')?.textContent).toBe(
      fill(copy.viewer.liveCount, { n: 5 }),
    );
  });

  it('WalkNav: 이전(아이콘만)·다음 작품으로 {i}/{n} 버튼 문구와 onPrev·onNext 콜백이 동작한다', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<WalkNav current={3} total={6} onPrev={onPrev} onNext={onNext} />);

    const prevBtn = container.querySelector('[data-testid="prev"]') as HTMLButtonElement | null;
    const nextBtn = container.querySelector('[data-testid="next"]') as HTMLButtonElement | null;

    expect(prevBtn?.getAttribute('aria-label')).toBe(copy.viewer.prevArtwork);
    expect(nextBtn?.textContent).toContain(copy.viewer.nextArtwork);
    expect(nextBtn?.textContent).toContain(fill(copy.viewer.pageOf, { page: 3, total: 6 }));

    act(() => {
      prevBtn?.click();
      nextBtn?.click();
    });
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('NearArtworkCard: 대표작 배지·제목·작가·짧은 설명을 그리고 크게 보기 클릭 시 onZoom을 호출한다', () => {
    const onZoom = vi.fn();
    render(
      <NearArtworkCard
        title="하늘고래의 호외"
        author="하늘고래"
        caption="을사늑약 소식을 전하는 호외"
        featured={true}
        onZoom={onZoom}
      />,
    );

    const card = container.querySelector('[data-testid="near-card"]');
    expect(card?.getAttribute('aria-label')).toBe('하늘고래의 호외');
    expect(card?.textContent).toContain(copy.viewer.featuredBadge);
    expect(card?.textContent).toContain('하늘고래의 호외');
    expect(card?.textContent).toContain('하늘고래');
    expect(card?.textContent).toContain('을사늑약 소식을 전하는 호외');

    const btn = card?.querySelector('button') as HTMLButtonElement | null;
    expect(btn?.textContent).toContain(copy.viewer.zoomIn);
    act(() => {
      btn?.click();
    });
    expect(onZoom).toHaveBeenCalledTimes(1);
  });

  it('Joystick: 누른 자리 기준으로 stickFromOffset 값을 onChange에 넘기고 떼면 0으로 돌려놓는다', () => {
    const history: StickValue[] = [];
    render(<Joystick onChange={v => history.push(v)} radius={56} />);

    const pad = container.querySelector('[data-testid="joystick"]') as HTMLElement | null;
    const knob = container.querySelector('[data-testid="joystick-knob"]') as HTMLElement | null;
    expect(pad).not.toBeNull();
    expect(pad?.getAttribute('aria-label')).toBe(copy.viewer.joystick);

    act(() => {
      pad?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, pointerId: 1 }),
      );
    });
    expect(history.at(-1)).toEqual({ forward: 0, strafe: 0, run: false });

    act(() => {
      pad?.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 100, clientY: 40, pointerId: 1 }),
      );
    });
    const moved = history.at(-1);
    expect(moved?.forward).toBeCloseTo(1, 3);
    expect(moved?.strafe).toBeCloseTo(0, 3);
    expect(moved?.run).toBe(true);
    expect(knob?.style.transform).toBe('translate(0px, -56px)');

    act(() => {
      pad?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    });
    expect(history.at(-1)).toEqual({ forward: 0, strafe: 0, run: false });
    expect(knob?.style.transform).toBe('translate(0px, 0px)');
  });

  it('ZoomCaption: 제목·작가·긴 설명 펼치기/접기와 닫기 버튼이 동작한다', () => {
    const onClose = vi.fn();
    render(
      <ZoomCaption
        title="독립문 목판화"
        author="별바라기"
        caption="짧은 소개"
        description="긴 작품 배경 설명입니다."
        onClose={onClose}
      />,
    );

    const dialog = container.querySelector('[data-testid="zoom-caption"]');
    expect(dialog?.getAttribute('aria-label')).toBe('독립문 목판화');
    expect(container.querySelector('[data-testid="zoom-expanded-desc"]')).toBeNull();

    const toggleBtn = container.querySelector('[data-testid="zoom-toggle-desc"]') as HTMLButtonElement | null;
    expect(toggleBtn?.textContent).toBe(copy.viewer.more);
    expect(toggleBtn?.getAttribute('aria-expanded')).toBe('false');

    act(() => {
      toggleBtn?.click();
    });
    expect(toggleBtn?.textContent).toBe(copy.viewer.collapseMore);
    expect(toggleBtn?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="zoom-expanded-desc"]')?.textContent).toBe(
      '긴 작품 배경 설명입니다.',
    );

    const closeBtn = container.querySelector('[data-testid="zoom-close"]') as HTMLButtonElement | null;
    expect(closeBtn?.getAttribute('aria-label')).toBe(copy.viewer.close);
    act(() => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('WalkHint: 터치/데스크톱 안내 문구를 copy 또는 prop에서 받아 표시한다', () => {
    render(<WalkHint touch={true} />);
    expect(container.querySelector('[data-testid="walk-hint"]')?.textContent).toBe(copy.viewer.walkHintTouch);

    render(<WalkHint touch={false} />);
    expect(container.querySelector('[data-testid="walk-hint"]')?.textContent).toBe(
      copy.viewer.walkHintDesktop,
    );

    render(<WalkHint text="직접 전달한 안내" />);
    expect(container.querySelector('[data-testid="walk-hint"]')?.textContent).toBe('직접 전달한 안내');
  });

  it('LoadingMuseum: 미술관 외관 실루엣과 copy 문구·진행 막대를 그린다', () => {
    render(<LoadingMuseum title="우리 역사" progress={65} />);

    const section = container.querySelector('[data-testid="loading-museum"]');
    expect(section?.getAttribute('aria-label')).toBe(copy.poster.preparing);
    expect(section?.textContent).toContain(fill(copy.viewer.facadeSign, { title: '우리 역사' }));
    expect(section?.textContent).toContain(copy.viewer.loadingDrawing);
    expect(section?.textContent).toContain(copy.viewer.loadingSubhint);

    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('65');
  });

  it('EntryPoster: 별명 입력·학생 캐릭터 2종 고르기(실루엣/이미지)·함께 관람 안내·입장 버튼이 동작한다', () => {
    const onNicknameChange = vi.fn();
    const onCharacterChange = vi.fn();
    const onEnter = vi.fn();

    render(
      <EntryPoster
        title="연대기"
        nickname="하늘고래"
        onNicknameChange={onNicknameChange}
        character="student-m"
        onCharacterChange={onCharacterChange}
        onEnter={onEnter}
      />,
    );

    expect(container.textContent).toContain(copy.poster.nicknameLabel);
    expect(container.textContent).toContain(copy.poster.characterLabel);
    expect(container.textContent).toContain(copy.poster.togetherNotice);
    expect(container.querySelector('[data-testid="silhouette-student-m"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="silhouette-student-f"]')).not.toBeNull();

    const femaleRadio = container.querySelector('[data-testid="char-student-f"]') as HTMLButtonElement | null;
    expect(femaleRadio?.getAttribute('aria-label')).toBe(copy.poster.studentFemale);
    expect(femaleRadio?.getAttribute('aria-checked')).toBe('false');

    act(() => {
      femaleRadio?.click();
    });
    expect(onCharacterChange).toHaveBeenCalledWith('student-f');

    const enterBtn = container.querySelector('[data-testid="enter-plaza-btn"]') as HTMLButtonElement | null;
    expect(enterBtn?.textContent).toContain(copy.poster.enterPlaza);
    act(() => {
      enterBtn?.click();
    });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
