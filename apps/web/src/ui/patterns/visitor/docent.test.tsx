import { copy } from '@gallery/core/copy';
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocentCard } from './index.ts';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('도슨트 대사 카드 DocentCard(W-10, M4-8)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (ui: JSX.Element): void => {
    act(() => {
      root.render(ui);
    });
  };
  const line = copy.museumDocent.lines[1] ?? '';

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

  it('초점을 가져가지 않는 알림(role=status)이고 이름·대사를 보인다', () => {
    render(<DocentCard text={line} onClose={() => {}} />);
    const card = container.querySelector('[data-testid="docent-card"]');
    expect(card?.getAttribute('role')).toBe('status');
    expect(card?.getAttribute('aria-label')).toBe(copy.museumDocent.talkCard);
    expect(card?.textContent).toContain(copy.museumDocent.name);
    expect(card?.textContent).toContain(line);
    expect(document.activeElement).toBe(document.body);
  });

  it('얼굴 그림이 없으면 말하기 아이콘 동그라미, 있으면 그 그림(장식이라 대체 글 없음)', () => {
    render(<DocentCard text={line} onClose={() => {}} />);
    expect(container.querySelector('img')).toBeNull();
    const face = container.querySelector('[aria-hidden="true"]');
    expect(face?.querySelector('svg')).not.toBeNull();
    render(<DocentCard text={line} src="/assets/g/chr-npc-1/face.webp" name="안내" onClose={() => {}} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/assets/g/chr-npc-1/face.webp');
    expect(img?.getAttribute('alt')).toBe('');
    expect(container.textContent).toContain('안내');
  });

  it('닫기 단추(글자 이름 있음, 누를 자리 충분)를 누르면 onClose', () => {
    const onClose = vi.fn();
    render(<DocentCard text={line} onClose={onClose} />);
    const btn = container.querySelector('button');
    expect(btn?.getAttribute('type')).toBe('button');
    expect(btn?.getAttribute('aria-label')).toBe(copy.museumDocent.close);
    act(() => {
      btn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
