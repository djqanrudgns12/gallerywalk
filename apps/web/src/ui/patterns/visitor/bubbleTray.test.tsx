import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BubbleTray, type BubbleTrayProps, bubbleShortcut } from './index.ts';

// 거름 목록은 진짜 낱말을 시험에 쓰지 않는다 — 가짜 낱말 하나만 막히게 하고 나머지는 진짜 다듬기
vi.mock('@gallery/core/live', async importOriginal => {
  const real = await importOriginal<typeof import('@gallery/core/live')>();
  return {
    ...real,
    prepareBubbleText: (raw: string) =>
      raw.includes('가짜욕') ? { error: 'blocked' } : real.prepareBubbleText(raw),
  };
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = (ui: JSX.Element): void => {
  act(() => root.render(ui));
};

const props = (over: Partial<BubbleTrayProps> = {}): BubbleTrayProps => ({
  open: true,
  onOpenChange: vi.fn(),
  onSend: vi.fn(),
  allowText: false,
  waitMs: 0,
  device: 'phone',
  ...over,
});

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  container.querySelector<T>(`[data-testid="${id}"]`);
const byTestId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = q<T>(id);
  if (!el) throw new Error(`없음: ${id}`);
  return el;
};
const click = (el: HTMLElement): void => act(() => el.click());
const typeInto = (el: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const submit = (): void =>
  act(() => {
    byTestId<HTMLFormElement>('bubble-write').requestSubmit();
  });

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('BubbleTray', () => {
  it('닫혀 있으면 단추만, 단추를 누르면 열기를 부탁한다', () => {
    const onOpenChange = vi.fn();
    render(<BubbleTray {...props({ open: false, onOpenChange })} />);
    expect(q('bubble-tray')).toBeNull();
    const button = byTestId('bubble-button');
    expect(button.textContent).toBe(copy.bubble.button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    click(button);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('열면 이름 있는 대화 상자: 스티커 12개(이름은 copy)·짧은 말 12개, 첫 스티커에 초점', () => {
    render(<BubbleTray {...props()} />);
    const tray = byTestId('bubble-tray');
    expect(tray.getAttribute('role')).toBe('dialog');
    expect(document.getElementById(tray.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      copy.bubble.trayTitle,
    );
    expect(tray.querySelectorAll('[data-testid^="bubble-sticker-"]')).toHaveLength(config().BUBBLE_STICKERS);
    expect(tray.querySelectorAll('[data-testid^="bubble-phrase-"]')).toHaveLength(config().BUBBLE_PHRASES);
    expect(byTestId('bubble-sticker-2').getAttribute('aria-label')).toBe(copy.bubble.stickers[2]);
    expect(byTestId('bubble-phrase-5').textContent).toBe(copy.bubble.phrases[5]);
    expect(document.activeElement).toBe(byTestId('bubble-sticker-0'));
  });

  it('휴대폰은 아래 시트, 태블릿·데스크톱은 팝오버', () => {
    render(<BubbleTray {...props({ device: 'phone' })} />);
    const phoneClass = byTestId('bubble-tray').className;
    render(<BubbleTray {...props({ device: 'desktop' })} />);
    expect(byTestId('bubble-tray').className).not.toBe(phoneClass);
    render(<BubbleTray {...props({ device: 'tablet' })} />);
    expect(byTestId('bubble-tray').className).not.toBe(phoneClass);
  });

  it('스티커·짧은 말을 고르면 그 내용으로 보내고 닫는다', () => {
    const onSend = vi.fn();
    const onOpenChange = vi.fn();
    render(<BubbleTray {...props({ onSend, onOpenChange })} />);
    click(byTestId('bubble-sticker-7'));
    expect(onSend).toHaveBeenLastCalledWith({ k: 's', i: 7 });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    click(byTestId('bubble-phrase-11'));
    expect(onSend).toHaveBeenLastCalledWith({ k: 'p', i: 11 });
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('스티커 그림 주소가 있으면 그림, 없으면 이름 글자', () => {
    render(<BubbleTray {...props({ stickerSrc: i => (i === 0 ? '/assets/g/stk-1/0.webp' : null) })} />);
    expect(byTestId('bubble-sticker-0').querySelector('img')?.getAttribute('src')).toBe(
      '/assets/g/stk-1/0.webp',
    );
    expect(byTestId('bubble-sticker-0').querySelector('img')?.getAttribute('alt')).toBe('');
    expect(byTestId('bubble-sticker-1').querySelector('img')).toBeNull();
    expect(byTestId('bubble-sticker-1').textContent).toBe(copy.bubble.stickers[1]);
  });

  it('짧은 글 칸은 교사가 켰을 때만', () => {
    render(<BubbleTray {...props({ allowText: false })} />);
    expect(q('bubble-text')).toBeNull();
    render(<BubbleTray {...props({ allowText: true })} />);
    expect(byTestId('bubble-text')).not.toBeNull();
  });

  it('짧은 글: 다듬어 보내고, 21자·거름은 문구를 보이고 보내지 않는다, 고치면 문구가 사라진다', () => {
    const onSend = vi.fn();
    render(<BubbleTray {...props({ allowText: true, onSend })} />);
    const input = byTestId<HTMLInputElement>('bubble-text');

    typeInto(input, '가'.repeat(config().BUBBLE_TEXT_MAX + 1));
    submit();
    expect(onSend).not.toHaveBeenCalled();
    expect(byTestId('bubble-error').textContent).toBe(
      fill(copy.bubble.tooLong, { n: config().BUBBLE_TEXT_MAX }),
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');

    typeInto(input, '앞에 가짜욕');
    expect(q('bubble-error')).toBeNull();
    submit();
    expect(onSend).not.toHaveBeenCalled();
    expect(byTestId('bubble-error').textContent).toBe(copy.bubble.blocked);

    typeInto(input, '   ');
    submit();
    expect(onSend).not.toHaveBeenCalled();

    typeInto(input, '  같이   보자 ');
    submit();
    expect(onSend).toHaveBeenCalledWith({ k: 'x', text: '같이 보자' });
  });

  it('속도 제한으로 기다리는 중이면 고르기·보내기가 막히고 기다림 문구', () => {
    const onSend = vi.fn();
    render(<BubbleTray {...props({ allowText: true, waitMs: 800, onSend })} />);
    expect(byTestId('bubble-wait').textContent).toBe(copy.bubble.wait);
    expect(byTestId<HTMLButtonElement>('bubble-sticker-0').disabled).toBe(true);
    expect(byTestId<HTMLButtonElement>('bubble-phrase-0').disabled).toBe(true);
    expect(byTestId<HTMLButtonElement>('bubble-text-send').disabled).toBe(true);
    click(byTestId('bubble-sticker-0'));
    typeInto(byTestId<HTMLInputElement>('bubble-text'), '안녕');
    submit();
    expect(onSend).not.toHaveBeenCalled();
    render(<BubbleTray {...props({ waitMs: 0 })} />);
    expect(q('bubble-wait')).toBeNull();
  });

  it('Esc·닫기로 닫고, 닫히면 말풍선 단추로 초점을 되돌린다', () => {
    const onOpenChange = vi.fn();
    render(<BubbleTray {...props({ onOpenChange })} />);
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    click(byTestId('bubble-close'));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(byTestId('bubble-close').getAttribute('aria-label')).toBe(copy.bubble.close);
    render(<BubbleTray {...props({ open: false, onOpenChange })} />);
    expect(document.activeElement).toBe(byTestId('bubble-button'));
  });
});

describe('bubbleShortcut', () => {
  it.each([
    ['t', 'open'],
    ['T', 'open'],
    ['ㅅ', 'open'],
    ['1', { k: 's', i: 0 }],
    ['8', { k: 's', i: 7 }],
    ['9', null],
    ['0', null],
    ['Enter', null],
    ['a', null],
  ] as const)('%s → %j', (key, want) => {
    expect(bubbleShortcut(key)).toEqual(want);
  });
});
