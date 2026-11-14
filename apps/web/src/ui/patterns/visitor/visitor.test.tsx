import { copy, fill } from '@gallery/core/copy';
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Icon, type IconName } from '../../Icon.tsx';
import {
  EntryPoster,
  Joystick,
  LoadingMuseum,
  MoveButtons,
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
    // 혼자일 때는 인원 표시를 두지 않는다(안내판 줄이기, V-54)
    expect(container.querySelector('[data-testid="live-count"]')).toBeNull();

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

  it('ZoomCaption: 보내지 못한 반응이 있으면 반응 단추에 작은 점(이름 있음), 없으면 없음(V-21)', () => {
    render(<ZoomCaption title="합성 작품" onClose={() => {}} onReact={() => {}} reactPending />);
    const btn = container.querySelector('[data-testid="zoom-react"]');
    expect(btn?.getAttribute('data-pending')).toBe('1');
    expect(btn?.querySelector(`[aria-label="${copy.viewer.reactPending}"]`)).not.toBeNull();
    render(<ZoomCaption title="합성 작품" onClose={() => {}} onReact={() => {}} />);
    expect(container.querySelector('[data-testid="zoom-react"]')?.getAttribute('data-pending')).toBeNull();
  });

  it('WalkNav: 작품 앞이 아니면(total 0) 숫자를 숨긴다', () => {
    render(<WalkNav current={0} total={0} onPrev={() => {}} onNext={() => {}} />);
    const nextBtn = container.querySelector('[data-testid="next"]');
    expect(nextBtn?.textContent).toBe(copy.viewer.nextArtwork);
  });

  it('WalkNav: 출구처럼 다음이 없는 자리는 `다음 작품으로`를 숨기고 이전만 둔다(V-57)', () => {
    render(<WalkNav current={0} total={0} onPrev={() => {}} onNext={() => {}} nextHidden />);
    expect(container.querySelector('[data-testid="next"]')).toBeNull();
    expect(container.querySelector('[data-testid="prev"]')).not.toBeNull();
  });

  it('EntryPoster: 제목은 전시 이름 그대로(이름판 규칙의 "전시관"을 덧붙이지 않음, V-57)', () => {
    render(
      <EntryPoster
        title="합성 근대사 전시"
        nickname=""
        onNicknameChange={() => {}}
        character="student-m-01"
        onCharacterChange={() => {}}
        onEnter={() => {}}
      />,
    );
    expect(container.querySelector('h1')?.textContent).toBe('합성 근대사 전시');
    expect(container.querySelector('[data-testid="entry-poster"]')?.getAttribute('aria-label')).toBe(
      '합성 근대사 전시',
    );
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

  it('EntryPoster: 별명 입력·학생 캐릭터 10명 고르기(두 줄 × 5칸, 실루엣 + 번호)·함께 관람 안내·입장 버튼이 동작한다', () => {
    const onNicknameChange = vi.fn();
    const onCharacterChange = vi.fn();
    const onEnter = vi.fn();

    render(
      <EntryPoster
        title="연대기"
        nickname="하늘고래"
        onNicknameChange={onNicknameChange}
        character="student-m-01"
        onCharacterChange={onCharacterChange}
        onEnter={onEnter}
      />,
    );

    expect(container.textContent).toContain(copy.poster.nicknameLabel);
    expect(container.textContent).toContain(copy.poster.characterLabel);
    expect(container.textContent).toContain(copy.poster.togetherNotice);
    // 라디오 묶음 하나에 열 칸: 이름은 줄 이름 + 번호(학생 A 1~5번 · 학생 B 6~10번), 고른 칸 하나만 선택됨
    const group = container.querySelector('[role="radiogroup"]');
    const radios = [...(group?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
    expect(radios.map(r => r.getAttribute('aria-label'))).toEqual([
      ...[1, 2, 3, 4, 5].map(n => fill(copy.poster.characterNumber, { group: copy.poster.studentMale, n })),
      ...[6, 7, 8, 9, 10].map(n =>
        fill(copy.poster.characterNumber, { group: copy.poster.studentFemale, n }),
      ),
    ]);
    expect(radios.map(r => r.dataset['testid'])).toEqual([
      'char-student-m-01',
      'char-student-m-02',
      'char-student-m-03',
      'char-student-m-04',
      'char-student-m-05',
      'char-student-f-01',
      'char-student-f-02',
      'char-student-f-03',
      'char-student-f-04',
      'char-student-f-05',
    ]);
    expect(radios.filter(r => r.getAttribute('aria-checked') === 'true')).toEqual([radios[0]]);
    // 두 줄 × 5칸, 칸마다 몸 틀 실루엣(얼굴 그림이 없을 때)
    expect(group?.children).toHaveLength(2);
    for (const row of group?.children ?? []) expect(row.children).toHaveLength(5);
    expect(radios[0]?.querySelector('[data-testid="silhouette-student-m"]')).not.toBeNull();
    expect(radios[7]?.querySelector('[data-testid="silhouette-student-f"]')).not.toBeNull();

    const femaleRadio = container.querySelector(
      '[data-testid="char-student-f-03"]',
    ) as HTMLButtonElement | null;
    expect(femaleRadio?.getAttribute('aria-label')).toBe(
      fill(copy.poster.characterNumber, { group: copy.poster.studentFemale, n: 8 }),
    );
    expect(femaleRadio?.getAttribute('aria-checked')).toBe('false');

    act(() => {
      femaleRadio?.click();
    });
    expect(onCharacterChange).toHaveBeenCalledWith('student-f-03');

    const enterBtn = container.querySelector('[data-testid="enter-plaza-btn"]') as HTMLButtonElement | null;
    // PRD 6.1·11장: 주요 단추는 `입장하기` 하나
    expect(enterBtn?.textContent).toBe(copy.poster.enter);
    act(() => {
      enterBtn?.click();
    });
    expect(onEnter).toHaveBeenCalledTimes(1);
    // 작품도 포스터 그림도 없으면 위 절반은 단색 판, 준비 막대는 값이 없으면 없음
    expect(container.querySelector('[data-testid="poster-artworks"] img')).toBeNull();
    expect(container.querySelector('[data-testid="prepare-progress"]')).toBeNull();
  });

  it('EntryPoster: 위 절반에 조명 아래 걸린 작품(최대 3장)·포스터 그림, 준비 막대는 입장 단추 바로 위', () => {
    const art = (n: number) => ({ url: `/m/a${n}.webp`, w: 512, h: 341 });
    const base = {
      title: '연대기',
      nickname: '',
      onNicknameChange: () => {},
      character: 'student-m-01' as const,
      onCharacterChange: () => {},
      onEnter: () => {},
    };
    render(
      <EntryPoster {...base} artworks={[art(1), art(2), art(3), art(4)]} prepare={0.42} enterDisabled />,
    );
    const imgs = [...container.querySelectorAll<HTMLImageElement>('[data-testid="poster-artworks"] img')];
    expect(imgs.map(i => i.getAttribute('src')).sort()).toEqual(['/m/a1.webp', '/m/a2.webp', '/m/a3.webp']);
    // 장식 그림: 읽기 도구는 제목(h1)만 읽는다
    expect(imgs.every(i => i.getAttribute('alt') === '')).toBe(true);
    const bar = container.querySelector('[data-testid="prepare-progress"] [role="progressbar"]');
    expect(bar?.getAttribute('aria-label')).toBe(copy.poster.preparing);
    expect(bar?.getAttribute('aria-valuenow')).toBe('42');
    // 준비 막대 바로 다음이 입장 단추
    expect(
      container
        .querySelector('[data-testid="prepare-progress"]')
        ?.nextElementSibling?.getAttribute('data-testid'),
    ).toBe('enter-plaza-btn');

    render(<EntryPoster {...base} artworks={[art(1)]} posterImageUrl="/m/poster.webp" />);
    const poster = container.querySelectorAll<HTMLImageElement>('[data-testid="poster-artworks"] img');
    expect([...poster].map(i => i.getAttribute('src'))).toEqual(['/m/poster.webp']);
  });

  it('ZoomCaption: 휴대폰 세로의 한 줄 접기 → 펼치기(PRD 9.5 "접힘 1줄 → 펼침", V-15)', () => {
    const onReact = vi.fn();
    render(
      <ZoomCaption
        title="독립문 목판화"
        author="별바라기"
        caption="짧은 소개"
        onClose={() => {}}
        onReact={onReact}
        hideClose
      />,
    );
    const dialog = container.querySelector('[data-testid="zoom-caption"]');
    // 처음에는 접힘. 접힘 줄은 CSS가 휴대폰 세로에서만 보인다(넓은 화면은 늘 펼친 카드)
    expect(dialog?.getAttribute('data-folded')).toBe('1');
    const fold = container.querySelector('[data-testid="zoom-fold"]') as HTMLButtonElement | null;
    expect(fold?.getAttribute('aria-expanded')).toBe('false');
    expect(fold?.textContent).toContain('독립문 목판화');
    expect(fold?.textContent).toContain('별바라기');
    expect(fold?.textContent).toContain(copy.viewer.captionUnfold);
    const card = container.querySelector('[data-testid="zoom-card"]');
    expect(card?.textContent).toContain('짧은 소개');
    expect(fold?.getAttribute('aria-controls')).toBe(card?.getAttribute('id'));
    expect(card?.getAttribute('id')?.length).toBeGreaterThan(0);

    // 접힌 줄에서도 반응 단추는 바로 누를 수 있다
    const foldReact = container.querySelector('[data-testid="zoom-fold-react"]') as HTMLButtonElement | null;
    expect(foldReact?.textContent).toContain(copy.viewer.react);
    act(() => {
      foldReact?.click();
    });
    expect(onReact).toHaveBeenCalledTimes(1);

    act(() => {
      fold?.click();
    });
    expect(dialog?.getAttribute('data-folded')).toBe('0');
    expect(fold?.getAttribute('aria-expanded')).toBe('true');
    expect(fold?.textContent).toContain(copy.viewer.captionFold);
    // 펼치면 접힌 줄의 반응 단추는 없고 카드의 반응 단추 하나만
    expect(container.querySelector('[data-testid="zoom-fold-react"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="zoom-react"]').length).toBe(1);

    act(() => {
      fold?.click();
    });
    expect(dialog?.getAttribute('data-folded')).toBe('1');

    // 접지 않는 곳(2D 화면 — 자기 접기가 따로 있음)
    render(<ZoomCaption title="독립문 목판화" onClose={() => {}} foldable={false} />);
    expect(container.querySelector('[data-testid="zoom-fold"]')).toBeNull();
    expect(container.querySelector('[data-testid="zoom-caption"]')?.getAttribute('data-folded')).toBeNull();
  });

  it('EntryPoster: 캐릭터 고르기는 한 칸만 Tab에 들어가고 화살표로 옮긴다(라디오 묶음 키보드, V-35)', () => {
    const onCharacterChange = vi.fn();
    render(
      <EntryPoster
        title="연대기"
        nickname=""
        onNicknameChange={() => {}}
        character="student-m-01"
        onCharacterChange={onCharacterChange}
        onEnter={() => {}}
      />,
    );
    const q = (id: string) => container.querySelector(`[data-testid="char-${id}"]`) as HTMLButtonElement;
    const m = q('student-m-01');
    const m2 = q('student-m-02');
    const f5 = q('student-f-05');
    expect(m.tabIndex).toBe(0);
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].filter(r => r.tabIndex === 0),
    ).toEqual([m]);
    act(() => {
      m.focus();
      m.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(onCharacterChange).toHaveBeenLastCalledWith('student-m-02');
    expect(document.activeElement).toBe(m2);
    act(() => {
      m2.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(onCharacterChange).toHaveBeenLastCalledWith('student-m-01');
    expect(document.activeElement).toBe(m);
    // 첫 칸에서 앞으로 가면 마지막 칸(여 5번 = 10)으로 돈다 — 줄을 넘어 한 묶음
    act(() => {
      m.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(onCharacterChange).toHaveBeenLastCalledWith('student-f-05');
    expect(document.activeElement).toBe(f5);
    act(() => {
      f5.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(onCharacterChange).toHaveBeenLastCalledWith('student-m-01');
  });

  it('EntryPoster: 얼굴 그림이 온 캐릭터만 그림, 나머지는 실루엣(M4-9)', () => {
    render(
      <EntryPoster
        title="연대기"
        nickname=""
        onNicknameChange={() => {}}
        character="student-f-02"
        onCharacterChange={() => {}}
        characterImage={{ 'student-f-02': '/face/student-f-02.png' }}
        onEnter={() => {}}
      />,
    );
    const f2 = container.querySelector('[data-testid="char-student-f-02"]');
    expect(f2?.querySelector('img')?.getAttribute('src')).toBe('/face/student-f-02.png');
    expect(f2?.querySelector('svg[data-testid^="silhouette"]')).toBeNull();
    expect(f2?.getAttribute('aria-checked')).toBe('true');
    expect((f2 as HTMLButtonElement | null)?.tabIndex).toBe(0);
    expect(container.querySelectorAll('[role="radio"] img')).toHaveLength(1);
    expect(container.querySelectorAll('[role="radio"] svg[data-testid^="silhouette"]')).toHaveLength(9);
  });

  it('EntryPoster: 함께 관람 인원은 위 줄과 같은 말(V-37)', () => {
    render(
      <EntryPoster
        title="연대기"
        nickname=""
        onNicknameChange={() => {}}
        character="student-m-01"
        onCharacterChange={() => {}}
        onEnter={() => {}}
        togetherCount={3}
      />,
    );
    expect(container.textContent).toContain(fill(copy.viewer.liveCount, { n: 3 }));
  });

  it('WalkNav: 묶음 이름은 단추 이름과 겹치지 않는다(화면 읽기, V-35)', () => {
    render(<WalkNav current={1} total={2} onPrev={() => {}} onNext={() => {}} />);
    const nav = container.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe(copy.viewer.walkNav);
    expect(copy.viewer.walkNav).not.toBe(copy.viewer.nextArtwork);
  });

  it('MoveButtons: 뛰기 잠김의 설명을 연결하고 잠금이 풀리면 지운다', () => {
    const onRunToggle = vi.fn();
    const props = { running: false, onRunToggle, onJump: vi.fn() };
    render(<MoveButtons {...props} runLocked />);
    const run = container.querySelector<HTMLButtonElement>('[data-testid="run-toggle"]')!;
    const descriptionId = run.getAttribute('aria-describedby');
    expect(descriptionId).not.toBeNull();
    const description = document.getElementById(descriptionId!);
    expect(description?.textContent).toBe('잠깐 뛰기를 쉬고 있어요. 천천히 걸어 주세요');
    expect(run.hasAttribute('data-locked')).toBe(true);
    expect(run.disabled).toBe(false);
    act(() => {
      run.click();
    });
    expect(onRunToggle).toHaveBeenCalledTimes(1);

    render(<MoveButtons {...props} />);
    expect(run.getAttribute('aria-describedby')).toBeNull();
    expect(run.hasAttribute('data-locked')).toBe(false);
    expect(document.getElementById(descriptionId!)).toBeNull();
  });

  it('EntryPoster: 함께 관람하는 사람이 없으면 안내 줄을 숨기고 한 명부터 인원을 보인다', () => {
    const props = {
      title: '연대기',
      nickname: '',
      onNicknameChange: vi.fn(),
      character: 'student-m-01' as const,
      onCharacterChange: vi.fn(),
      onEnter: vi.fn(),
    };
    render(<EntryPoster {...props} togetherCount={0} />);
    const nicknameField = container.querySelector('input')!.closest('div')!.parentElement!;
    expect(nicknameField.querySelector('p')).toBeNull();
    expect(container.textContent).not.toContain(copy.live.alone);

    render(<EntryPoster {...props} togetherCount={1} />);
    expect(nicknameField.querySelector('p')?.textContent).toBe(fill(copy.viewer.liveCount, { n: 1 }));
    render(<EntryPoster {...props} />);
    expect(nicknameField.querySelector('p')?.textContent).toBe(copy.poster.togetherNotice);
  });
});
