/**
 * 보드 액자의 데스크톱 키(G-32, FIELD_PLAN HT-09). 순수 판정만 — 실행은 `RoomBoard.tsx`가 한다.
 * - Enter 살펴보기 · Space 고르기 · ←/→ 이웃 액자(보드 읽는 차례) · Alt+←/→ 한 칸 옮기기
 * - H 숨기기·게시 · Delete·Backspace 삭제(되살리기 토스트) · M 집기(끌기 센서가 맡음) · ? 도움말
 * 키는 자판 위치(`code`)로도 본다 — 한글 입력 중에도 같다. Ctrl·⌘가 붙으면 브라우저·되돌리기 몫이라 보지 않는다.
 */

export type CellKeyAction =
  'open' | 'select' | 'prev' | 'next' | 'nudgePrev' | 'nudgeNext' | 'toggleHidden' | 'delete' | 'help';

export interface KeyLike {
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export const cellKeyAction = (e: KeyLike): CellKeyAction | null => {
  if (e.ctrlKey || e.metaKey) return null;
  if (e.key === 'ArrowLeft') return e.altKey ? 'nudgePrev' : 'prev';
  if (e.key === 'ArrowRight') return e.altKey ? 'nudgeNext' : 'next';
  if (e.altKey) return null;
  if (e.key === 'Enter') return 'open';
  if (e.key === ' ') return 'select';
  if (e.key === 'Delete' || e.key === 'Backspace') return 'delete';
  if (e.code === 'KeyH' && !e.shiftKey) return 'toggleHidden';
  if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) return 'help';
  return null;
};

/** 도움말에 보일 키 목록(차례대로). 이름은 `copy.teacher.keys`에서 */
export const HELP_KEYS = [
  'open',
  'select',
  'prevNext',
  'nudge',
  'pick',
  'hide',
  'delete',
  'undo',
  'help',
] as const;
export type HelpKey = (typeof HELP_KEYS)[number];
