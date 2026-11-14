/**
 * 다른 관람객이 움직일 때의 다시 그리기 상한(G-25 HS-06): 내가 멈춰 있고 다른 사람만 움직이면 매 프레임(60회/초) 그리던 것을
 * 초당 `fps`번으로 묶는다. 저가 태블릿이 쉬지 않고 그려 뜨거워지고 누름 반응이 늦어지던 것을 줄인다.
 * 내가 걸을 때는 걷기 쪽이 매 프레임 깨우므로 상한과 상관없이 매 프레임 그려진다(이 묶음은 사람 쪽 깨우기만 늦춘다).
 */

export interface RedrawClock {
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (id: unknown) => void;
}

export interface RedrawLimiter {
  /** 다음 그림이 필요함(여러 번 불러도 상한 안에서 한 번) */
  request(): void;
  /** 기다리는 깨우기를 버림(떼어 낼 때) */
  cancel(): void;
}

const browserClock: RedrawClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export const createRedrawLimiter = (
  fps: number,
  wake: () => void,
  clock: RedrawClock = browserClock,
): RedrawLimiter => {
  const interval = fps > 0 ? 1000 / fps : 0;
  let last = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  const fire = (): void => {
    timer = null;
    last = clock.now();
    wake();
  };
  return {
    request() {
      if (timer !== null) return;
      const wait = interval - (clock.now() - last);
      if (wait <= 0) fire();
      else timer = clock.setTimeout(fire, wait);
    },
    cancel() {
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
    },
  };
};
