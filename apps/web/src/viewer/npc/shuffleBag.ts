/**
 * 섞은 주머니(PRD_V2 W-10 "1번씩 랜덤"): 목록을 섞어 한 바퀴 다 꺼낼 때까지 같은 것이 다시 나오지 않는다.
 * 새 바퀴의 첫 것은 지난 바퀴의 마지막 것과 다르다(바퀴 경계에서도 연달아 같은 줄 없음). 난수 함수는 주입받는다.
 */

/** [0, 1) 난수 */
export type Rng = () => number;

export class ShuffleBag<T> {
  private readonly items: readonly T[];
  private readonly rng: Rng;
  /** 이번 바퀴에 남은 것(끝에서 꺼냄) */
  private order: T[] = [];
  private last: { readonly value: T } | null = null;

  constructor(items: readonly T[], rng: Rng = Math.random) {
    // 같은 것이 두 번 들어 있으면 한 바퀴 안 겹침 규칙이 깨지므로 하나로 줄인다(처음 나온 순서 유지)
    this.items = [...new Set(items)];
    if (this.items.length === 0) throw new Error('ShuffleBag: 빈 목록');
    this.rng = rng;
  }

  /** 이번 바퀴에 아직 꺼내지 않은 수 */
  get remaining(): number {
    return this.order.length;
  }

  /** 다음 것. 바퀴가 비었으면 새로 섞는다 */
  next(): T {
    if (this.order.length === 0) this.refill();
    const value = this.order.pop() as T;
    this.last = { value };
    return value;
  }

  /** `0..n-1` 정수 하나(난수가 1이나 그 밖을 내도 범위 안) */
  private pick(n: number): number {
    const r = this.rng();
    const k = Math.floor((Number.isFinite(r) ? r : 0) * n);
    return Math.min(n - 1, Math.max(0, k));
  }

  private refill(): void {
    const a = [...this.items];
    // 피셔-예이츠 섞기
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.pick(i + 1);
      const t = a[i] as T;
      a[i] = a[j] as T;
      a[j] = t;
    }
    // 끝에서 꺼내므로 새 바퀴의 첫 것은 맨 끝. 지난 마지막과 같으면 남은 자리 중 하나와 바꾼다
    const end = a.length - 1;
    if (end > 0 && this.last && a[end] === this.last.value) {
      const j = this.pick(end);
      const t = a[end] as T;
      a[end] = a[j] as T;
      a[j] = t;
    }
    this.order = a;
  }
}
