import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import formChipsCss from './FormChips.module.css';
import frameCss from './Frame.module.css';
import orderCss from './OrderStepper.module.css';
import roomTilesCss from './RoomTiles.module.css';
import segCss from './Seg.module.css';
import statusPillCss from './StatusPill.module.css';
import toggleCss from './ToggleTile.module.css';
import {
  FormChips,
  Frame,
  OrderStepper,
  RoomTiles,
  Seg,
  StackBar,
  StatNumber,
  StatusPill,
  ToggleTile,
} from './index.ts';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/* ── CSS 원문 읽기: jsdom은 CSS 모듈을 계산하지 않으므로 누름 영역·끌기 막기는 원문 선언으로 확인한다 ── */
const here = dirname(fileURLToPath(import.meta.url));
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const readCss = (name: string): string => stripComments(readFileSync(join(here, name), 'utf8'));
const tokensCss = stripComments(readFileSync(join(here, '../../tokens.css'), 'utf8'));
/** `@media` 묶음을 걷어 낸 바깥 규칙만(기본값 확인용) */
const tokensTop = tokensCss.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

/** 선택자 하나(쉼표 목록 중 하나와 정확히 같음)의 선언을 모은다. 같은 선택자가 여러 번이면 뒤가 이긴다. */
const decls = (css: string, selector: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map(x => x.trim());
    if (!selectors.includes(selector)) continue;
    for (const d of (m[2] ?? '').split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  return out;
};

const pxOf = (value: string | undefined): number => {
  const m = value?.match(/^(\d+(?:\.\d+)?)px$/);
  return m ? Number(m[1]) : Number.NaN;
};

/** `:root`의 --touch-min(px) */
const TOUCH_MIN = pxOf(decls(tokensTop, ':root')['--touch-min']);

/**
 * 선언 값이 보장하는 가장 작은 px. `var(--manage-touch, …)`·`var(--touch-min)`은 --touch-min 이상이고,
 * `max(48px, var(--manage-touch…))`는 둘 중 큰 값이다.
 */
const minTouchPx = (value: string | undefined): number => {
  if (!value) return 0;
  const usesTouchToken = /var\(--(?:manage-touch|touch-min)\b/.test(value);
  const maxPx = value.match(/max\((\d+(?:\.\d+)?)px/);
  const literal = pxOf(value);
  if (usesTouchToken) return Math.max(TOUCH_MIN, maxPx ? Number(maxPx[1]) : 0);
  return Number.isNaN(literal) ? 0 : literal;
};

/** 요소에 CSS 모듈 클래스가 붙었는지 */
const hasModuleClass = (el: Element | null, css: Record<string, string>, name: string): boolean => {
  const cls = css[name];
  return Boolean(el && cls && el.classList.contains(cls));
};

describe('교사 관리 화면 v3 토큰(HT-13)', () => {
  it('[data-surface=manage] 묶음에 시안 색·그림자 3단·액자 높이가 있다', () => {
    const manage = decls(tokensTop, "[data-surface='manage']");
    const expected: Record<string, string> = {
      '--manage-ground': '#e2dcd2',
      '--manage-surface': '#f3f0ea',
      '--manage-raised': '#fbf9f5',
      '--manage-viewing': '#35312c',
      '--manage-rule': '#d0c8bb',
      '--manage-rule-soft': '#e6e0d6',
      '--manage-ink': '#1f1c19',
      '--manage-ink-2': '#4b443e',
      '--manage-ink-3': '#5e564d',
      '--manage-frame': '#463d35',
      '--manage-gilt': '#8c6d3c',
      '--manage-warn': '#a24f17',
      '--frame-h-big': '92px',
      '--frame-h-small': '56px',
      '--frame-h-tablet': '72px',
      '--frame-featured-scale': '1.2',
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(manage[name], name).toBe(value);
    }
    for (const shadow of ['--elev-1', '--elev-2', '--hang']) {
      expect(manage[shadow], shadow).toMatch(/rgba\(/);
    }
  });

  it('누름 영역 토큰: 데스크톱 44px, 터치 기기 48px', () => {
    expect(TOUCH_MIN).toBe(44);
    expect(decls(tokensTop, "[data-surface='manage']")['--manage-touch']).toBe('var(--touch-min)');
    const coarse = tokensCss.match(
      /@media \(pointer: coarse\)\s*\{\s*\[data-surface='manage'\]\s*\{([^}]*)\}/,
    );
    expect(coarse?.[1]).toMatch(/--manage-touch:\s*48px/);
  });

  it('부품 CSS에는 색 값·그라데이션이 없다(색은 tokens.css에서만)', () => {
    const files = [
      'Frame.module.css',
      'StatNumber.module.css',
      'StatusPill.module.css',
      'Seg.module.css',
      'RoomTiles.module.css',
      'OrderStepper.module.css',
      'FormChips.module.css',
      'ToggleTile.module.css',
      'StackBar.module.css',
    ];
    for (const file of files) {
      const css = readCss(file);
      expect(css, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, file).not.toMatch(/\brgba?\(|\bhsla?\(/);
      expect(css, file).not.toMatch(/gradient\(/);
      expect(css, file).not.toMatch(/backdrop-filter/);
    }
  });
});

describe('교사 관리 화면 v3 부품(HT-13)', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (ui: JSX.Element): void => {
    act(() => {
      root.render(ui);
    });
  };
  const q = <T extends Element = HTMLElement>(sel: string): T | null => container.querySelector<T>(sel);
  const qa = <T extends Element = HTMLElement>(sel: string): T[] =>
    Array.from(container.querySelectorAll<T>(sel));
  const press = (el: Element | null, key: string): void => {
    act(() => {
      el?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
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

  describe('Frame', () => {
    it('그림은 draggable=false이고 CSS로 길게 누르기 메뉴·고르기·끌기를 막는다', () => {
      render(<Frame src="/a.webp" alt="독립선언서 낭독" />);
      const img = q<HTMLImageElement>('img');
      expect(img?.getAttribute('draggable')).toBe('false');
      expect(img?.draggable).toBe(false);
      expect(img?.getAttribute('alt')).toBe('독립선언서 낭독');
      expect(hasModuleClass(img, frameCss, 'img')).toBe(true);

      const css = readCss('Frame.module.css');
      for (const sel of ['.img', '.frame']) {
        const d = decls(css, sel);
        expect(d['-webkit-touch-callout'], sel).toBe('none');
        expect(d['user-select'], sel).toBe('none');
        expect(d['-webkit-user-select'], sel).toBe('none');
      }
      expect(decls(css, '.img')['-webkit-user-drag']).toBe('none');
    });

    it('크기 3단은 tokens.css 액자 높이를, 대표작은 1.2배 배율과 황동 테를 쓴다', () => {
      const css = readCss('Frame.module.css');
      expect(decls(css, '.big')['--fh']).toBe('var(--frame-h-big)');
      expect(decls(css, '.small')['--fh']).toBe('var(--frame-h-small)');
      expect(decls(css, '.tablet')['--fh']).toBe('var(--frame-h-tablet)');
      expect(decls(css, '.frame')['height']).toBe('var(--fh)');
      expect(decls(css, '.featured')['height']).toBe('calc(var(--fh) * var(--frame-featured-scale))');
      expect(decls(css, '.featured')['background-color']).toBe('var(--manage-gilt)');
      expect(decls(css, '.frame')['box-shadow']).toBe('var(--hang)');

      render(
        <div>
          <Frame src="/a.webp" alt="가" size="small" featured />
          <Frame src="/b.webp" alt="나" size="tablet" shape="portrait" />
        </div>,
      );
      const [a, b] = qa('[data-frame]');
      expect(a?.getAttribute('data-size')).toBe('small');
      expect(a?.getAttribute('data-featured')).toBe('true');
      expect(hasModuleClass(a ?? null, frameCss, 'small')).toBe(true);
      expect(hasModuleClass(a ?? null, frameCss, 'featured')).toBe(true);
      expect(b?.getAttribute('data-size')).toBe('tablet');
      expect(hasModuleClass(b ?? null, frameCss, 'portrait')).toBe(true);
    });

    it('확인할 것 점·고름·끄는 중 빈자리·흐림 상태와 실제 비율을 그린다', () => {
      render(<Frame src="/a.webp" alt="가" flag flagLabel="확인할 것" selected lifted blurred ratio={1.5} />);
      const frame = q('[data-frame]');
      expect(frame?.getAttribute('data-flag')).toBe('true');
      expect(frame?.getAttribute('data-selected')).toBe('true');
      expect(frame?.getAttribute('data-lifted')).toBe('true');
      expect(frame?.getAttribute('data-blurred')).toBe('true');
      // jsdom은 `1.5`를 `1.5 / 1`로 바꿔 적는다
      expect(frame?.style.aspectRatio).toMatch(/^1\.5(?: \/ 1)?$/);
      expect(q('[data-frame-flag]')?.getAttribute('aria-hidden')).toBe('true');
      expect(frame?.textContent).toContain('확인할 것');

      const css = readCss('Frame.module.css');
      expect(decls(css, '.selected')['outline']).toBe('2px solid var(--accent)');
      expect(decls(css, '.lifted')['outline']).toBe('2px dashed var(--accent)');
      expect(decls(css, '.lifted .mat')['visibility']).toBe('hidden');
    });

    it('그림이 없으면 role=img와 이름을 갖고 children을 그린다', () => {
      render(
        <Frame alt="소리 작품">
          <span data-testid="sound-mark" />
        </Frame>,
      );
      const frame = q('[data-frame]');
      expect(frame?.getAttribute('role')).toBe('img');
      expect(frame?.getAttribute('aria-label')).toBe('소리 작품');
      expect(q('img')).toBeNull();
      expect(q('[data-testid="sound-mark"]')).not.toBeNull();
    });
  });

  it('StatNumber: 큰 숫자와 이름을 그리고 크기를 표시한다', () => {
    render(
      <div>
        <StatNumber value={40} label="작품" />
        <StatNumber value="23" label="명이 관람 중" size="xl" />
      </div>,
    );
    const stats = qa('[data-stat]');
    expect(stats).toHaveLength(2);
    expect(stats[0]?.querySelector('b')?.textContent).toBe('40');
    expect(stats[0]?.textContent).toBe('40작품');
    expect(stats[0]?.getAttribute('data-size')).toBe('md');
    expect(stats[1]?.getAttribute('data-size')).toBe('xl');
  });

  describe('StatusPill', () => {
    it('누름 처리가 없으면 단추가 아닌 알약만 그린다', () => {
      render(<StatusPill status="draft" label="준비 중" />);
      expect(q('button')).toBeNull();
      expect(q('[data-status]')?.getAttribute('data-status')).toBe('draft');
      expect(container.textContent).toBe('준비 중');
    });

    it('누름 처리가 있으면 차림표 단추(aria-haspopup·aria-expanded)이고 누름 영역이 44px 이상', () => {
      const onClick = vi.fn();
      render(<StatusPill status="open" label="열림" onClick={onClick} expanded={false} />);
      const btn = q<HTMLButtonElement>('button');
      expect(btn?.getAttribute('aria-haspopup')).toBe('menu');
      expect(btn?.getAttribute('aria-expanded')).toBe('false');
      expect(btn?.getAttribute('data-status')).toBe('open');
      expect(hasModuleClass(btn, statusPillCss, 'button')).toBe(true);
      act(() => {
        btn?.click();
      });
      expect(onClick).toHaveBeenCalledTimes(1);

      const d = decls(readCss('StatusPill.module.css'), '.button');
      expect(minTouchPx(d['min-height'])).toBeGreaterThanOrEqual(44);
      expect(minTouchPx(d['min-width'])).toBeGreaterThanOrEqual(44);
    });
  });

  describe('Seg', () => {
    const options = [
      { value: 'big', label: '크게' },
      { value: 'small', label: '작게' },
    ] as const;

    it('라디오 묶음: 고른 칸만 aria-checked·Tab, 누르면 onChange', () => {
      const onChange = vi.fn();
      render(<Seg options={options} value="big" onChange={onChange} label="액자 크기" />);
      const group = q('[role="radiogroup"]');
      expect(group?.getAttribute('aria-label')).toBe('액자 크기');
      const radios = qa<HTMLButtonElement>('[role="radio"]');
      expect(radios.map(r => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
      expect(radios.map(r => r.tabIndex)).toEqual([0, -1]);
      expect(hasModuleClass(radios[0] ?? null, segCss, 'on')).toBe(true);
      act(() => {
        radios[1]?.click();
      });
      expect(onChange).toHaveBeenLastCalledWith('small');
    });

    it('화살표로 옮기면 바로 고르고 초점이 따라간다', () => {
      const onChange = vi.fn();
      render(<Seg options={options} value="big" onChange={onChange} label="액자 크기" />);
      const radios = qa<HTMLButtonElement>('[role="radio"]');
      radios[0]?.focus();
      press(radios[0] ?? null, 'ArrowRight');
      expect(onChange).toHaveBeenLastCalledWith('small');
      expect(document.activeElement).toBe(radios[1]);
    });

    it('칸 누름 영역이 44px 이상이고 초점 링이 보인다', () => {
      const css = readCss('Seg.module.css');
      expect(minTouchPx(decls(css, '.option')['min-height'])).toBeGreaterThanOrEqual(44);
      expect(decls(css, '.option:focus-visible')['outline']).toMatch(/2px solid var\(--accent\)/);
    });
  });

  describe('RoomTiles', () => {
    const rooms = [
      { id: 'r1', no: '01', caption: '8점', label: '01 을사늑약과 의병, 8점' },
      { id: 'r2', no: '02', caption: '12점', label: '02 3·1 운동, 12점' },
      { id: 'r3', no: '03', caption: '6점' },
    ];

    it('번호 타일 라디오 묶음: 고른 타일은 aria-checked이고 남색 클래스, 타일마다 이름', () => {
      const onChange = vi.fn();
      render(<RoomTiles rooms={rooms} value="r2" onChange={onChange} label="전시실" />);
      expect(q('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('전시실');
      const tiles = qa<HTMLButtonElement>('[role="radio"]');
      expect(tiles).toHaveLength(3);
      expect(tiles[1]?.getAttribute('aria-checked')).toBe('true');
      expect(tiles[1]?.getAttribute('aria-label')).toBe('02 3·1 운동, 12점');
      expect(tiles[1]?.tabIndex).toBe(0);
      expect(tiles[0]?.tabIndex).toBe(-1);
      expect(hasModuleClass(tiles[1] ?? null, roomTilesCss, 'on')).toBe(true);
      expect(tiles[2]?.textContent).toBe('036점');
      act(() => {
        tiles[2]?.click();
      });
      expect(onChange).toHaveBeenLastCalledWith('r3');
    });

    it('고른 것이 없으면 첫 타일이 Tab을 받고, End로 마지막을 고른다', () => {
      const onChange = vi.fn();
      render(<RoomTiles rooms={rooms} value={null} onChange={onChange} label="전시실" />);
      const tiles = qa<HTMLButtonElement>('[role="radio"]');
      expect(tiles.map(t => t.tabIndex)).toEqual([0, -1, -1]);
      expect(tiles.every(t => t.getAttribute('aria-checked') === 'false')).toBe(true);
      tiles[0]?.focus();
      press(tiles[0] ?? null, 'End');
      expect(onChange).toHaveBeenLastCalledWith('r3');
      expect(document.activeElement).toBe(tiles[2]);
    });

    it('타일 높이 48px 이상', () => {
      const d = decls(readCss('RoomTiles.module.css'), '.tile');
      expect(minTouchPx(d['min-height'])).toBeGreaterThanOrEqual(48);
      expect(minTouchPx(d['min-width'])).toBeGreaterThanOrEqual(44);
    });
  });

  describe('OrderStepper', () => {
    it('큰 숫자 3 / 12와 12칸 눈금(3번째만 켜짐), 낭독 글', () => {
      render(
        <OrderStepper
          index={3}
          total={12}
          onPrev={() => {}}
          onNext={() => {}}
          prevLabel="앞으로"
          nextLabel="뒤로"
          label="순서"
          valueText="12점 중 3번째"
        />,
      );
      expect(q('[role="group"]')?.getAttribute('aria-label')).toBe('순서');
      expect(container.textContent).toContain('12점 중 3번째');
      expect(q('b')?.textContent).toBe('3');
      const ticks = q('[data-ticks]');
      expect(ticks?.getAttribute('aria-hidden')).toBe('true');
      expect(ticks?.children).toHaveLength(12);
      const on = qa('[data-ticks] > [data-on]');
      expect(on).toHaveLength(1);
      expect(Array.from(ticks?.children ?? []).indexOf(on[0] as Element)).toBe(2);
      expect(q('[aria-live="polite"]')).not.toBeNull();
    });

    it('앞뒤 단추: 이름이 있고, 처음·끝에서 꺼지며, 누르면 부른다', () => {
      const onPrev = vi.fn();
      const onNext = vi.fn();
      const ui = (index: number) => (
        <OrderStepper
          index={index}
          total={3}
          onPrev={onPrev}
          onNext={onNext}
          prevLabel="앞으로"
          nextLabel="뒤로"
          label="순서"
        />
      );
      render(ui(1));
      const prev = q<HTMLButtonElement>('[data-step="prev"]');
      const next = q<HTMLButtonElement>('[data-step="next"]');
      expect(prev?.getAttribute('aria-label')).toBe('앞으로');
      expect(next?.getAttribute('aria-label')).toBe('뒤로');
      expect(prev?.disabled).toBe(true);
      expect(next?.disabled).toBe(false);
      expect(hasModuleClass(prev, orderCss, 'step')).toBe(true);
      act(() => {
        next?.click();
      });
      expect(onNext).toHaveBeenCalledTimes(1);

      render(ui(3));
      expect(q<HTMLButtonElement>('[data-step="next"]')?.disabled).toBe(true);
      act(() => {
        q<HTMLButtonElement>('[data-step="prev"]')?.click();
      });
      expect(onPrev).toHaveBeenCalledTimes(1);
    });

    it('앞뒤 단추 누름 영역 44px 이상', () => {
      const d = decls(readCss('OrderStepper.module.css'), '.step');
      expect(minTouchPx(d['width'])).toBeGreaterThanOrEqual(44);
      expect(minTouchPx(d['height'])).toBeGreaterThanOrEqual(44);
    });
  });

  describe('FormChips', () => {
    const options = [
      { value: 'PORTRAIT', label: '세로', glyph: 'portrait' },
      { value: 'LANDSCAPE', label: '가로', glyph: 'landscape' },
      { value: 'EASEL', label: '이젤', glyph: 'easel' },
    ] as const;

    it('그림 칩 3개 라디오 묶음: 머리글이 묶음 이름, 자동 표시는 설명으로 읽힌다', () => {
      const onChange = vi.fn();
      render(
        <FormChips options={options} value="PORTRAIT" onChange={onChange} label="형태" autoLabel="자동" />,
      );
      const group = q('[role="radiogroup"]');
      const headingId = group?.getAttribute('aria-labelledby') ?? '';
      expect(document.getElementById(headingId)?.textContent).toBe('형태');
      const autoId = group?.getAttribute('aria-describedby') ?? '';
      expect(document.getElementById(autoId)?.textContent).toBe('자동');
      const chips = qa<HTMLButtonElement>('[role="radio"]');
      expect(chips).toHaveLength(3);
      expect(chips[0]?.getAttribute('aria-checked')).toBe('true');
      expect(hasModuleClass(chips[0] ?? null, formChipsCss, 'on')).toBe(true);
      expect(chips.every(c => c.querySelector('svg')?.getAttribute('aria-hidden') === 'true')).toBe(true);
      act(() => {
        chips[2]?.click();
      });
      expect(onChange).toHaveBeenLastCalledWith('EASEL');
    });

    it('자동이 아니면 자동 표시를 감추고, 화살표로 고른다', () => {
      const onChange = vi.fn();
      render(<FormChips options={options} value="LANDSCAPE" onChange={onChange} label="형태" />);
      expect(q('[data-auto]')).toBeNull();
      expect(q('[role="radiogroup"]')?.hasAttribute('aria-describedby')).toBe(false);
      const chips = qa<HTMLButtonElement>('[role="radio"]');
      chips[1]?.focus();
      press(chips[1] ?? null, 'ArrowLeft');
      expect(onChange).toHaveBeenLastCalledWith('PORTRAIT');
      expect(document.activeElement).toBe(chips[0]);
    });

    it('칩 높이 52px·폭 44px 이상', () => {
      const d = decls(readCss('FormChips.module.css'), '.chip');
      expect(minTouchPx(d['min-height'])).toBeGreaterThanOrEqual(52);
      expect(minTouchPx(d['min-width'])).toBeGreaterThanOrEqual(44);
    });
  });

  describe('ToggleTile', () => {
    it('칸 전체가 switch: aria-checked, 누르면 반대 값, 자동 알약은 설명', () => {
      const onChange = vi.fn();
      render(<ToggleTile label="대표작" checked badge="자동" mark="featured" onChange={onChange} />);
      const sw = q<HTMLButtonElement>('[role="switch"]');
      expect(sw?.getAttribute('aria-checked')).toBe('true');
      expect(sw?.getAttribute('aria-label')).toBe('대표작');
      expect(hasModuleClass(sw, toggleCss, 'on')).toBe(true);
      const badgeId = sw?.getAttribute('aria-describedby') ?? '';
      expect(document.getElementById(badgeId)?.textContent).toBe('자동');
      expect(q('[data-mark="featured"]')?.getAttribute('aria-hidden')).toBe('true');
      act(() => {
        sw?.click();
      });
      expect(onChange).toHaveBeenLastCalledWith(false);
    });

    it('꺼진 상태와 꺼진 단추', () => {
      const onChange = vi.fn();
      render(<ToggleTile label="게시" checked={false} disabled onChange={onChange} />);
      const sw = q<HTMLButtonElement>('[role="switch"]');
      expect(sw?.getAttribute('aria-checked')).toBe('false');
      expect(sw?.hasAttribute('aria-describedby')).toBe(false);
      expect(sw?.disabled).toBe(true);
      act(() => {
        sw?.click();
      });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('칸 높이 48px 이상, 초점 링', () => {
      const css = readCss('ToggleTile.module.css');
      expect(minTouchPx(decls(css, '.tile')['min-height'])).toBeGreaterThanOrEqual(48);
      expect(decls(css, '.tile:focus-visible')['outline']).toMatch(/2px solid var\(--accent\)/);
    });
  });

  it('StackBar: 막대는 aria-hidden, 0인 칸은 막대에서 빠지고 범례에는 수가 남는다', () => {
    render(
      <StackBar
        label="관람 중인 학생"
        parts={[
          { key: 'room', value: 19, label: '전시실 안', tone: 'accent' },
          { key: 'hall', value: 3, label: '홀·광장·복도', tone: 'soft' },
          { key: 'none', value: 0, label: '위치 없음', tone: 'quiet' },
          { key: 'teacher', value: 1, label: '선생님', tone: 'plum' },
        ]}
      />,
    );
    expect(q('[role="group"]')?.getAttribute('aria-label')).toBe('관람 중인 학생');
    const parts = qa<HTMLElement>('[data-part]');
    expect(parts.map(p => p.getAttribute('data-part'))).toEqual(['room', 'hall', 'teacher']);
    expect(parts[0]?.style.flexGrow).toBe('19');
    expect(parts[0]?.parentElement?.getAttribute('aria-hidden')).toBe('true');
    const legend = qa('[data-legend]');
    expect(legend).toHaveLength(4);
    expect(legend[2]?.textContent).toBe('위치 없음0');
    expect(legend[0]?.querySelector('b')?.textContent).toBe('19');

    render(<StackBar label="관람 중인 학생" legend={false} parts={[]} />);
    expect(q('ul')).toBeNull();
  });
});
