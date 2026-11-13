import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtworkFrame } from './ArtworkFrame.tsx';

// R3F가 넘기는 사건을 직접 호출한다. WebGL 없이 실제 액자의 사건 처리만 확인한다.
const handlers = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('react/jsx-dev-runtime', async importOriginal => {
  const original = await importOriginal<typeof import('react/jsx-dev-runtime')>();
  const capture = (type: unknown, props: Record<string, unknown>, key?: string) => {
    if (typeof type === 'string') {
      if (props['onClick']) handlers.push(props);
      return original.jsxDEV('div', { children: props['children'] }, key, false, undefined, undefined);
    }
    return original.jsxDEV(
      type as Parameters<typeof original.jsxDEV>[0],
      props,
      key,
      false,
      undefined,
      undefined,
    );
  };
  return { ...original, jsxDEV: capture };
});

afterEach(() => {
  handlers.length = 0;
});

it('R3F가 보관한 mouse 사건의 over/out 재전달은 실제 마우스 이동으로 취급하지 않는다', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement('div'));
  const hover = vi.fn();
  act(() =>
    root.render(
      <ArtworkFrame
        artwork={{
          id: 'art',
          center: { x: 0, y: 1, z: 0 },
          normal: { x: 0, y: 0, z: 1 },
          title: '',
          author: '',
          caption: '',
          texture: null,
          imageSrc: null,
          maxDistance: 4,
          mount: 'WALL',
          art: { w: 1, h: 1 },
          frame: 0.1,
          mat: 0.1,
          matColor: '#ffffff',
        }}
        holder={{ value: 1 }}
        onTap={() => {}}
        onHover={hover}
      />,
    ),
  );
  const nativeEvent = new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 30 });
  const replay = { pointerType: 'mouse', nativeEvent };
  try {
    expect(handlers).toHaveLength(3);
    for (const props of handlers) {
      (props['onPointerOver'] as ((event: unknown) => void) | undefined)?.(replay);
      (props['onPointerOut'] as ((event: unknown) => void) | undefined)?.(replay);
    }
    expect(hover).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
  }
});
