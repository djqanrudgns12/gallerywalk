import { config } from '@gallery/core/config';
import { useEffect } from 'react';
import { useWalk } from './walkStore.ts';

/**
 * 자유 관람 손 입력(ADR-057). 휴대폰·태블릿: 왼쪽 아래 가상 조이스틱 + 끌어 둘러보기 + 바닥 누르기,
 * 데스크톱: WASD·방향키(Shift 뛰기, 스페이스 점프) + 마우스 끌기·바퀴 + 바닥 누르기. `Q`/`E`(또는 `PageUp`/`PageDown`) = 이전·다음 작품으로,
 * `Enter` = 가까운 작품 크게 보기, `Esc` = 닫기.
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

/** 키보드를 걷기 상태에 잇는다. 입력 칸에 글을 쓰는 중이면 무시. 창을 벗어나면 모두 뗀 것으로 */
export const useWalkKeyboard = (enabled = true): void => {
  useEffect(() => {
    if (!enabled) return;
    const pressed = new Set<string>();
    const typing = (e: KeyboardEvent): boolean => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
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
        // 단추에 초점이 있으면 그 단추를 누르는 것으로(스크롤도 막음)
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return;
        e.preventDefault();
        if (!e.repeat) api?.jump();
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
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
      clear();
    };
  }, [enabled]);
};
