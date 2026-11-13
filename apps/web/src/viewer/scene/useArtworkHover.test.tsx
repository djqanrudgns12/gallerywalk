import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useArtworkHover } from './useArtworkHover.ts';

it('실제 마우스 이동만 한 번 반영하며 재전달·같은 좌표·터치는 빛을 깨우지 않는다', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const invalidate = vi.fn();
  let hover!: ReturnType<typeof useArtworkHover>;
  const Probe = () => {
    hover = useArtworkHover(invalidate);
    return null;
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<Probe />));
  const hit = (event: Event) => {
    hover.onHover('front', event as PointerEvent);
    hover.onHover('back', event as PointerEvent);
  };
  host.addEventListener('pointermove', hit);
  const move = (x: number, pointerType = 'mouse') =>
    new PointerEvent('pointermove', {
      bubbles: true,
      clientX: x,
      clientY: 20,
      pointerType,
    });
  try {
    const event = move(10);
    host.dispatchEvent(event);
    expect(hover.hovered()).toBe('front');
    expect(invalidate).toHaveBeenCalledTimes(1);
    hover.onHover('back', event); // R3F events.update(): 저장된 nativeEvent
    host.dispatchEvent(move(10)); // 레이아웃 변화 뒤 같은 좌표
    host.dispatchEvent(move(30, 'touch'));
    expect(hover.hovered()).toBe('front');
    expect(invalidate).toHaveBeenCalledTimes(1);
    document.body.dispatchEvent(move(40)); // 액자 밖 DOM으로 실제 이동
    expect(hover.hovered()).toBeNull();
    expect(invalidate).toHaveBeenCalledTimes(2);
    document.body.dispatchEvent(move(50));
    expect(invalidate).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
