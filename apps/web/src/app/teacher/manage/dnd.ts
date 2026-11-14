import { config } from '@gallery/core/config';

/**
 * 관리 화면 v3 끌어 놓기의 키와 센서(ADR-032·ADR-074, FIELD_PLAN §5.5). 배열 규칙은 `arrange.ts`, 화면 연결은 `ManageDnd.tsx`.
 *
 * - `card:{작품 ID}`: 판 안의 액자(정렬 항목). 같은 판 안·다른 판 n번째로 옮긴다.
 * - `room:{전시실 ID}`: 판의 작품 자리 전체. 빈 판·판의 빈 곳에 놓으면 그 판 끝.
 * - `board:{전시실 ID}`: 판 머리 손잡이. 판(전시실) 순서를 바꾼다.
 * - 마우스·펜: `DRAG_START_PX`만큼 움직이면 시작. 그 전에 떼면 누르기다.
 * - 터치: `LONG_PRESS_MS` 길게 누르면 시작(그 전에 `DRAG_START_PX`보다 움직이면 스크롤로 넘김).
 *   길게 누른 뒤 움직이지 않고 떼면 "길게 누르기 = 여러 장 고르기"(PLAN §7.4)로 본다.
 * - 키보드: 액자·손잡이에 초점을 두고 `M`으로 집고, 화살표로 옮긴 뒤 Space·Enter로 놓는다. Esc는 그만두기.
 *   키는 자판 위치(`code`)라 한글 입력 중에도 같다.
 */

export type DragKind = 'card' | 'room' | 'board';

export const cardKey = (id: string): string => `card:${id}`;
export const roomKey = (id: string): string => `room:${id}`;
export const boardKey = (id: string): string => `board:${id}`;

export const parseKey = (key: string | number | null | undefined): { kind: DragKind; id: string } | null => {
  if (typeof key !== 'string') return null;
  const at = key.indexOf(':');
  const kind = key.slice(0, at);
  if (kind !== 'card' && kind !== 'room' && kind !== 'board') return null;
  return { kind, id: key.slice(at + 1) };
};

/** 키보드 끌기 키(`KeyboardEvent.code`) */
export const KEYBOARD_CODES = {
  start: ['KeyM'],
  cancel: ['Escape'],
  end: ['Space', 'Enter'],
};

/** 센서 설정. `@dnd-kit`의 `useSensor(…, options)`에 그대로 넣는다 */
export const dragSensorOptions = () => {
  const cfg = config();
  return {
    mouse: { activationConstraint: { distance: cfg.DRAG_START_PX } },
    touch: { activationConstraint: { delay: cfg.LONG_PRESS_MS, tolerance: cfg.DRAG_START_PX } },
    keyboard: { keyboardCodes: KEYBOARD_CODES },
  };
};

/** 끄는 손끝이 놓일 액자 앞인가 뒤인가: 같은 줄이면 가로 가운데, 다른 줄이면 세로 가운데 기준 */
export const isAfter = (
  point: { readonly x: number; readonly y: number },
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
): boolean => {
  const sameRow = point.y >= rect.top && point.y <= rect.top + rect.height;
  return sameRow ? point.x > rect.left + rect.width / 2 : point.y > rect.top + rect.height / 2;
};
