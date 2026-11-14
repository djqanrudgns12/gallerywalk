/**
 * 파일 하나 받기의 멈춤 상한(G-24, FIELD_PLAN HW-01): 받는 진행이 `stallMs` 동안 오지 않으면 기다림을 멈추고 `null`.
 * 학교망 필터·HTTPS 검사 장비가 응답을 붙잡아 두면 `loadAsync`가 끝나지 않아 다음 조각을 받지 못하던 고리를 끊는다.
 *
 * - 느려도 바이트가 오는 동안은 멈춤이 아니다(한 반이 와이파이 하나를 함께 쓸 때 수십 초가 걸려도 그대로 기다림).
 * - 다 받은 뒤 해석(KTX2·meshopt 풀기)에는 진행 소식이 없으므로, 진행이 전체 크기에 닿으면 상한을 끈다.
 * - 멈춰서 `null`을 돌려준 뒤에도 받기는 이어 간다. 늦게 오면 `late`로 넘긴다(부른 쪽이 그때 합친다).
 */

export interface StallTimers {
  readonly set: (fn: () => void, ms: number) => unknown;
  readonly clear: (id: unknown) => void;
}

/** 진행 소식: 받은 바이트·전체 바이트(모르면 0) */
export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
}

const realTimers: StallTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: id => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export const loadWithStall = <T>(
  start: (onProgress: (p: LoadProgress) => void) => Promise<T | null>,
  stallMs: number,
  late: (value: T) => void,
  timers: StallTimers = realTimers,
): Promise<T | null> =>
  new Promise<T | null>(resolve => {
    let settled = false;
    let timer: unknown = null;
    const giveUp = (): void => {
      timer = null;
      if (settled) return;
      settled = true;
      resolve(null);
    };
    const arm = (): void => {
      if (timer !== null) timers.clear(timer);
      timer = timers.set(giveUp, stallMs);
    };
    const disarm = (): void => {
      if (timer !== null) timers.clear(timer);
      timer = null;
    };
    arm();
    start(p => {
      if (settled) return;
      if (p.total > 0 && p.loaded >= p.total) disarm();
      else arm();
    }).then(
      value => {
        disarm();
        if (!settled) {
          settled = true;
          resolve(value);
        } else if (value !== null) late(value);
      },
      () => {
        disarm();
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    );
  });
