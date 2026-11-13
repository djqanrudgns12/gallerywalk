import { config } from '@gallery/core/config';
import { useEffect } from 'react';
import { useWalk } from './walkStore.ts';

/**
 * 자유 관람 손 입력(ADR-057). 휴대폰·태블릿: 왼쪽 아래 가상 조이스틱 + 끌어 둘러보기 + 바닥 누르기,
 * 데스크톱: WASD·방향키(Shift 뛰기, 스페이스 = 행동 키) + 마우스 끌기·바퀴 + 바닥 누르기. `Q`/`E`(또는 `PageUp`/`PageDown`) = 이전·다음 작품으로,
 * `Enter` = 가까운 작품 크게 보기, `Esc` = 닫기.
 *
 * 스페이스 = 행동 키(PRD_V2 W-01): 도슨트 앞이면 말걸기, 대문 앞이면 나가기, 그 밖은 점프(`useWalk.act`).
 * - 마우스·손가락으로 누른 단추는 누른 뒤 초점을 놓는다 — 그래야 다음 스페이스가 그 단추를 다시 누르지 않고 행동 키가 된다.
 * - 키보드로 옮긴 초점(`:focus-visible`)의 단추·링크에서는 스페이스가 그 단추를 누른다(접근성).
 * - 글 입력 칸에 초점이 있거나 시트·창(`dialog`)이 열려 있으면 스페이스를 건드리지 않는다.
 */

/** 조이스틱 손잡이 자리(중심에서 CSS px, 아래 +) → 앞·옆·뛰기. 죽은 영역 안이면 0 */
export const stickFromOffset = (
  dx: number,
  dy: number,
  radius = config().JOYSTICK_RADIUS_PX,
): { forward: number; strafe: number; run: boolean; knob: { x: number; y: number } } => {
  const c = config();
  const len = Math.hypot(dx, dy);
  const k = len > radius ? radius / len : 1;
  const kx = dx * k;
  const ky = dy * k;
  const m = Math.min(1, len / radius);
  if (m < c.JOYSTICK_DEAD) return { forward: 0, strafe: 0, run: false, knob: { x: kx, y: ky } };
  // 죽은 영역 밖을 0..1로 다시 펴서 살살 밀면 천천히
  const scale = (m - c.JOYSTICK_DEAD) / (1 - c.JOYSTICK_DEAD) / (m || 1);
  return {
    forward: (-ky / radius) * scale,
    strafe: (kx / radius) * scale,
    run: m >= c.JOYSTICK_RUN,
    knob: { x: kx, y: ky },
  };
};

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);

/** 눌린 키(`KeyboardEvent.code`) → 앞·옆·뛰기 */
export const keysFromPressed = (
  pressed: ReadonlySet<string>,
): { forward: number; strafe: number; run: boolean } => {
  const has = (s: ReadonlySet<string>): boolean => [...pressed].some(k => s.has(k));
  return {
    forward: (has(FORWARD) ? 1 : 0) - (has(BACK) ? 1 : 0),
    strafe: (has(RIGHT) ? 1 : 0) - (has(LEFT) ? 1 : 0),
    run: pressed.has('ShiftLeft') || pressed.has('ShiftRight'),
  };
};

const MOVE_KEYS = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, 'ShiftLeft', 'ShiftRight']);

const CONTROL = 'button, a[href], [role="button"], summary';
/** 시트·창: 이것이 열려 있으면 스페이스는 그 안의 것(행동 키 아님) */
const SHEET = '[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]';

const EDITABLE = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/** 글을 쓰는 중인가(입력 칸·글 상자·편집 가능한 곳) */
export const isTyping = (t: EventTarget | null): boolean => {
  const el = t instanceof HTMLElement ? t : null;
  if (!el) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.isContentEditable || el.closest(EDITABLE) !== null;
};

/** 키보드로 옮긴 초점인가. `:focus-visible`을 모르는 옛 브라우저는 키보드 초점으로 본다(단추를 누르는 쪽이 안전) */
const keyboardFocused = (el: Element): boolean => {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
};

/**
 * 스페이스를 행동 키로 써도 되는가: 글을 쓰는 중·시트나 창이 열림·키보드 초점의 단추면 아니다.
 * 마우스로 눌러 초점만 남은 단추면 초점을 놓고 행동 키로 쓴다.
 */
export const spaceIsAction = (e: KeyboardEvent, doc: Document = document): boolean => {
  if (isTyping(e.target)) return false;
  if (doc.querySelector(SHEET)) return false;
  const t = e.target instanceof Element ? e.target.closest(CONTROL) : null;
  if (t) {
    if (keyboardFocused(t)) return false;
    if (t instanceof HTMLElement) t.blur();
  }
  return true;
};

/** 키보드를 걷기 상태에 잇는다. 입력 칸에 글을 쓰는 중이면 무시. 창을 벗어나면 모두 뗀 것으로 */
export const useWalkKeyboard = (enabled = true): void => {
  useEffect(() => {
    if (!enabled) return;
    const pressed = new Set<string>();
    const typing = (e: KeyboardEvent): boolean => isTyping(e.target);
    const push = (): void => useWalk.getState().setKeys(keysFromPressed(pressed));
    const down = (e: KeyboardEvent): void => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const api = useWalk.getState().api;
      if (MOVE_KEYS.has(e.code)) {
        e.preventDefault();
        if (!pressed.has(e.code)) {
          pressed.add(e.code);
          push();
        }
        return;
      }
      if (e.code === 'Space') {
        // 키보드 초점의 단추·시트 안이면 그대로 둔다. 아니면 행동 키(스크롤도 막음)
        if (!spaceIsAction(e)) return;
        e.preventDefault();
        if (!e.repeat) useWalk.getState().act();
        return;
      }
      if (e.repeat) return;
      if (e.code === 'KeyE' || e.code === 'PageDown') api?.next();
      else if (e.code === 'KeyQ' || e.code === 'PageUp') api?.prev();
      else if (e.code === 'Enter') {
        const near = useWalk.getState().nearArtworkId;
        if (near) api?.zoom(near);
      } else if (e.code === 'Escape') api?.close();
    };
    const up = (e: KeyboardEvent): void => {
      if (pressed.delete(e.code)) push();
    };
    const clear = (): void => {
      if (pressed.size === 0) return;
      pressed.clear();
      push();
    };
    // 마우스·손가락으로 누른 단추(`detail` ≥ 1 — 키보드로 누르면 0)는 누른 뒤 초점을 놓는다. 시트·창 안은 그대로(초점 가두기)
    const release = (e: MouseEvent): void => {
      if (e.detail < 1) return;
      const t = e.target instanceof Element ? e.target.closest(CONTROL) : null;
      if (!(t instanceof HTMLElement) || t.closest(SHEET)) return;
      if (document.activeElement === t) t.blur();
    };
    window.addEventListener('click', release);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('click', release);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
      clear();
    };
  }, [enabled]);
};
