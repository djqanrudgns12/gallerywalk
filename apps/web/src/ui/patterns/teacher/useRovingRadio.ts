import { type KeyboardEvent, type RefObject, useCallback, useRef } from 'react';
import { radioKeyStep } from '../radioKeys.ts';

/**
 * 단추로 만든 라디오 묶음의 키보드(V-35와 같은 규칙): Tab에는 고른 칸 하나만 들어가고,
 * 화살표·Home·End로 옮기면서 바로 고르고 초점을 옮긴다. Seg·RoomTiles·FormChips가 함께 쓴다.
 */
export const useRovingRadio = <T>(
  values: readonly T[],
  onChange: (value: T) => void,
): {
  refs: RefObject<Array<HTMLButtonElement | null>>;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
} => {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const to = radioKeyStep(event.key, index, values.length);
      if (to === null) return;
      event.preventDefault();
      const next = values[to];
      if (next === undefined) return;
      onChange(next);
      refs.current[to]?.focus();
    },
    [values, onChange],
  );
  return { refs, onKeyDown };
};

/** 고른 값이 없거나 목록에 없으면 첫 칸이 Tab을 받는다. */
export const rovingIndex = <T>(values: readonly T[], value: T | null | undefined): number => {
  const at = value === null || value === undefined ? -1 : values.indexOf(value);
  return at < 0 ? 0 : at;
};
