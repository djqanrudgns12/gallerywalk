import { useCallback, useEffect, useRef } from 'react';

/** R3F의 재광선 검사/저장된 over·out 대신 실제 좌표가 바뀐 DOM pointermove 한 번을 묶어 처리한다. */
export const useArtworkHover = (invalidate: () => void) => {
  const hovered = useRef<string | null>(null);
  const motion = useRef<{ event: PointerEvent; hit: string | null } | null>(null);
  useEffect(() => {
    let last: { x: number; y: number } | null = null;
    const begin = (event: PointerEvent): void => {
      motion.current = null;
      if (event.pointerType !== 'mouse') return;
      if (last?.x === event.clientX && last.y === event.clientY) return;
      last = { x: event.clientX, y: event.clientY };
      motion.current = { event, hit: null };
    };
    const end = (event: PointerEvent): void => {
      const next = motion.current;
      if (next?.event !== event) return;
      motion.current = null;
      if (hovered.current === next.hit) return;
      hovered.current = next.hit;
      invalidate();
    };
    // 캡처 → R3F 광선 검사 → 버블. 다른 DOM 위로 이동하면 hit=null로 빛을 끈다.
    window.addEventListener('pointermove', begin, true);
    window.addEventListener('pointermove', end);
    return () => {
      window.removeEventListener('pointermove', begin, true);
      window.removeEventListener('pointermove', end);
      motion.current = null;
      hovered.current = null;
    };
  }, [invalidate]);
  const onHover = useCallback((id: string, event: PointerEvent) => {
    const current = motion.current;
    // events.update()는 지난 nativeEvent를 다시 보낸다(eventPhase=NONE).
    if (event.eventPhase === 0 || current?.event !== event || current.hit !== null) return;
    current.hit = id;
  }, []);
  return { hovered: useCallback(() => hovered.current, []), onHover };
};
