import { useEffect } from 'react';

/**
 * 관람 중 화면 꺼짐 막기(P4-11, Screen Wake Lock — PLAN §6.13 투어와 같은 규칙, F-12).
 * - 관람에 들어온 뒤 잡고, 화면을 떠나거나(`active` false·화면을 내림) 숨으면 놓고, 다시 보이면 다시 잡는다.
 * - 지원하지 않거나 거절되면(배터리 절약 등) 조용히 넘어간다 — 학생에게 알리지 않는다.
 * 기기 사정은 주입받아(`navigator`·`document` 대신 가짜) 시험한다.
 */

/** `WakeLockSentinel`에서 쓰는 것만 */
export interface WakeSentinel {
  readonly released: boolean;
  release(): Promise<void>;
}

export interface WakeNavigator {
  readonly wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> } | undefined;
}

export interface WakeDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

/** 이 기기가 화면 꺼짐 막기를 지원하는가 */
export const wakeLockSupported = (nav: WakeNavigator | null | undefined): boolean =>
  typeof nav?.wakeLock?.request === 'function';

/** 지금 잡고 있어야 하는가(관람 중이고 화면이 보일 때만) */
export const shouldHoldWakeLock = (active: boolean, visibility: DocumentVisibilityState): boolean =>
  active && visibility === 'visible';

export interface WakeLockController {
  setActive(active: boolean): void;
  dispose(): void;
}

/** 잡기·놓기 조절기. 지원하지 않으면 아무것도 하지 않는다 */
export const createWakeLock = (env: { nav: WakeNavigator; doc: WakeDocument }): WakeLockController => {
  const { nav, doc } = env;
  if (!wakeLockSupported(nav)) return { setActive: () => undefined, dispose: () => undefined };
  let active = false;
  let disposed = false;
  let held: WakeSentinel | null = null;
  let requesting = false;

  const release = (): void => {
    const s = held;
    held = null;
    if (s && !s.released) void s.release().catch(() => undefined);
  };

  const sync = (): void => {
    const want = !disposed && shouldHoldWakeLock(active, doc.visibilityState);
    if (!want) {
      release();
      return;
    }
    if (requesting || (held !== null && !held.released)) return;
    requesting = true;
    nav
      .wakeLock!.request('screen')
      .then(s => {
        requesting = false;
        // 기다리는 사이 화면을 떠났거나 숨었으면 바로 놓는다
        if (disposed || !shouldHoldWakeLock(active, doc.visibilityState)) {
          void s.release().catch(() => undefined);
          return;
        }
        held = s;
      })
      .catch(() => {
        requesting = false;
      });
  };

  doc.addEventListener('visibilitychange', sync);
  return {
    setActive(next) {
      active = next;
      sync();
    },
    dispose() {
      disposed = true;
      doc.removeEventListener('visibilitychange', sync);
      release();
    },
  };
};

/** 학생 흐름: 관람 중(3D·2D 모두)에 `active`를 켠다 */
export const useWakeLock = (
  active: boolean,
  env: { nav: WakeNavigator; doc: WakeDocument } | null = null,
): void => {
  useEffect(() => {
    if (!active) return;
    const w = createWakeLock(env ?? { nav: navigator, doc: document });
    w.setActive(true);
    return () => w.dispose();
    // 기기 사정은 그때의 것을 쓴다(시험에서만 바꿔 넣음)
  }, [active, env]);
};
