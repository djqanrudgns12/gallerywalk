import { config } from '@gallery/core/config';

/**
 * 작품 텍스처 상주 관리(PLAN §6.5, ADR-015 — 자유 관람에 맞춤, ADR-057).
 *
 * 원하는 집합:
 * - 보이는 관(붙인 관)의 모든 작품 = `thumb`
 * - 캐릭터가 있는 관에서 가장 가까운 작품의 걷는 순서 기준 뒤·앞 창(단계별 `RESIDENCY_WINDOW`) = `wall`(낮음은 `wall-lo`)
 * - 안내 이동의 목적지 작품 = 창과 같은 벽용(도착했을 때 선명하게)
 * - `MAX_TEXTURE_SIZE < 2048` 기기는 벽용 대신 `wall-lo`
 *
 * 예산(작품 텍스처만, `TEX_BUDGET_MB_*`)을 넘으면 원하는 집합 밖에서 오래 안 쓴 것부터 내린다(`dispose`).
 * 올리기는 한 번에 하나(`tick`) — 부르는 쪽이 프레임마다 하나씩 GPU에 올리고(`renderer.initTexture`) 줄이 비면 멈춘다.
 * 바꿔 끼우기는 썸네일 → 벽용 순(벽용이 오면 썸네일은 다음 예산 정리 때 내림). three에 기대지 않는다(불러오기·올리기 주입).
 */

export type Tier = 'HIGH' | 'MEDIUM' | 'LOW';
export type Variant = 'thumb' | 'wall' | 'wall-lo';

const RANK: Readonly<Record<Variant, number>> = { thumb: 0, 'wall-lo': 1, wall: 2 };

export interface ResidentArt {
  readonly id: string;
  readonly partId: string;
  /** 관 안 걷는 순서(0부터) */
  readonly order: number;
  /** 변형마다 화소 크기(없는 변형은 빠짐) */
  readonly sizes: Partial<Record<Variant, { readonly w: number; readonly h: number }>>;
}

export interface Focus {
  /** 그리는(붙인) 관 */
  readonly visibleParts: ReadonlySet<string>;
  /** 캐릭터가 있는 관과 그 관에서 가장 가까운 작품 */
  readonly partId: string | null;
  readonly nearestId: string | null;
  /** 안내 이동의 목적지 작품 */
  readonly targetId: string | null;
}

export const estimateBytes = (s: { w: number; h: number }): number => Math.round(s.w * s.h * 4 * 1.33);

export const budgetBytes = (tier: Tier): number => {
  const c = config();
  const mb =
    tier === 'HIGH' ? c.TEX_BUDGET_MB_HIGH : tier === 'MEDIUM' ? c.TEX_BUDGET_MB_MEDIUM : c.TEX_BUDGET_MB_LOW;
  return mb * 1024 * 1024;
};

/** 작품마다 원하는 가장 좋은 변형 */
export const wantedVariants = (
  arts: readonly ResidentArt[],
  focus: Focus,
  tier: Tier,
  maxTextureSize: number,
): Map<string, Variant> => {
  const c = config();
  const out = new Map<string, Variant>();
  const sharp: Variant =
    tier === 'LOW' || maxTextureSize < c.RESIDENCY_MIN_TEXTURE_FOR_WALL ? 'wall-lo' : 'wall';
  const pick = (a: ResidentArt, v: Variant): Variant => {
    if (a.sizes[v]) return v;
    if (v === 'wall' && a.sizes['wall-lo']) return 'wall-lo';
    return 'thumb';
  };
  for (const a of arts) if (focus.visibleParts.has(a.partId) && a.sizes.thumb) out.set(a.id, 'thumb');
  const win = c.RESIDENCY_WINDOW[tier];
  const near = arts.find(a => a.id === focus.nearestId);
  if (near && focus.partId === near.partId) {
    for (const a of arts)
      if (a.partId === near.partId && a.order >= near.order - win.behind && a.order <= near.order + win.ahead)
        out.set(a.id, pick(a, sharp));
  }
  const target = arts.find(a => a.id === focus.targetId);
  if (target) out.set(target.id, pick(target, sharp));
  return out;
};

export interface TextureLike {
  dispose(): void;
}

export interface ResidencyDeps<T extends TextureLike> {
  /** 받기·디코드(미디어 캐시 → ImageBitmap → 텍스처). 실패하면 거절 */
  readonly load: (id: string, variant: Variant) => Promise<T>;
  /** GPU에 올리기(`renderer.initTexture`) */
  readonly upload: (tex: T) => void;
  /** 화면에 쓸 텍스처가 바뀜(다시 그리기) */
  readonly onChange: (id: string) => void;
  readonly budget: number;
  readonly now?: () => number;
}

interface Entry<T> {
  readonly id: string;
  readonly variant: Variant;
  readonly bytes: number;
  tex: T | null;
  state: 'loading' | 'ready' | 'uploaded' | 'failed';
  usedAt: number;
  /** 받기 실패한 시각(다시 받기 간격) */
  failedAt: number;
}

const keyOf = (id: string, v: Variant): string => `${id}|${v}`;

export class Residency<T extends TextureLike> {
  private readonly deps: ResidencyDeps<T>;
  private readonly entries = new Map<string, Entry<T>>();
  private readonly arts = new Map<string, ResidentArt>();
  private wanted = new Map<string, Variant>();
  private readonly queue: string[] = [];
  /** 그림마다 받기 실패 수(끊겼다 이어진 뒤 다시 받게, `RESIDENCY_RETRY`) */
  private readonly fails = new Map<string, number>();
  private disposed = false;

  constructor(deps: ResidencyDeps<T>) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** 지금 올라가 있는 것의 추정 바이트 합 */
  get bytes(): number {
    let sum = 0;
    for (const e of this.entries.values()) if (e.state === 'uploaded' || e.state === 'ready') sum += e.bytes;
    return sum;
  }

  /** 올릴 것이 남았는가 */
  get pending(): boolean {
    return this.queue.length > 0;
  }

  setArtworks(arts: readonly ResidentArt[]): void {
    this.arts.clear();
    for (const a of arts) this.arts.set(a.id, a);
  }

  /** 원하는 집합을 바꾼다: 없는 것은 받기 시작, 예산을 넘으면 원하는 집합 밖부터 내림 */
  update(wanted: Map<string, Variant>): void {
    this.wanted = wanted;
    const t = this.now();
    // 벽용을 원하면 받는 동안 보일 썸네일도 함께(썸네일 → 벽용 순, PRD 10.3)
    const pairs: [string, Variant][] = [];
    for (const [id, v] of wanted) {
      if (v !== 'thumb' && this.arts.get(id)?.sizes.thumb) pairs.push([id, 'thumb']);
      pairs.push([id, v]);
    }
    for (const [id, v] of pairs) {
      const art = this.arts.get(id);
      const size = art?.sizes[v];
      if (!art || !size) continue;
      const k = keyOf(id, v);
      const e = this.entries.get(k);
      if (e && e.state === 'failed') {
        // 받지 못한 것: 간격(실패마다 배로)이 지났고 횟수가 남았으면 새로 받는다, 아니면 그대로 둔다
        const n = this.fails.get(k) ?? 1;
        const retry = config().RESIDENCY_RETRY;
        if (n > retry.max || t - e.failedAt < retry.delayMs * 2 ** (n - 1)) continue;
        this.entries.delete(k);
      } else if (e) {
        e.usedAt = t;
        continue;
      }
      const entry: Entry<T> = {
        id,
        variant: v,
        bytes: estimateBytes(size),
        tex: null,
        state: 'loading',
        usedAt: t,
        failedAt: 0,
      };
      this.entries.set(k, entry);
      this.deps.load(id, v).then(
        tex => {
          if (this.disposed || this.entries.get(k) !== entry) {
            tex.dispose();
            return;
          }
          entry.tex = tex;
          entry.state = 'ready';
          this.fails.delete(k);
          this.queue.push(k);
          this.deps.onChange(id);
        },
        () => {
          entry.state = 'failed';
          entry.failedAt = this.now();
          this.fails.set(k, (this.fails.get(k) ?? 0) + 1);
        },
      );
    }
    this.evict();
  }

  /** 한 프레임에 하나 올린다. 더 남았으면 true(부르는 쪽이 다시 그리기를 이어 감) */
  tick(): boolean {
    const k = this.queue.shift();
    if (k) {
      const e = this.entries.get(k);
      if (e?.tex && e.state === 'ready') {
        this.deps.upload(e.tex);
        e.state = 'uploaded';
        this.deps.onChange(e.id);
        this.evict();
      }
    }
    return this.queue.length > 0;
  }

  /** 그 작품에 지금 쓸 수 있는 가장 좋은 텍스처(올라간 것만) */
  textureOf(id: string): { tex: T; variant: Variant } | null {
    let best: Entry<T> | null = null;
    for (const v of ['wall', 'wall-lo', 'thumb'] as const) {
      const e = this.entries.get(keyOf(id, v));
      if (e?.state === 'uploaded' && e.tex && (!best || RANK[v] > RANK[best.variant])) best = e;
    }
    if (!best?.tex) return null;
    best.usedAt = this.now();
    return { tex: best.tex, variant: best.variant };
  }

  private drop(k: string, e: Entry<T>): void {
    e.tex?.dispose();
    this.entries.delete(k);
    const qi = this.queue.indexOf(k);
    if (qi >= 0) this.queue.splice(qi, 1);
  }

  /** 예산 정리: 원하는 집합 밖 → 오래 안 쓴 것부터. 원하는 것보다 좋은 것이 올라가 있는 썸네일도 정리 대상 */
  private evict(): void {
    const isWanted = (e: Entry<T>): boolean => {
      const w = this.wanted.get(e.id);
      if (w === undefined) return false;
      if (e.variant === w) return true;
      // 썸네일은 원하는 벽용이 아직 안 올라왔을 때만 필요
      if (e.variant === 'thumb') return this.entries.get(keyOf(e.id, w))?.state !== 'uploaded';
      return false;
    };
    // 원하는 집합 밖의 받는 중인 것은 바로 버린다(다 받아도 쓰지 않음)
    for (const [k, e] of [...this.entries]) if (e.state === 'loading' && !isWanted(e)) this.drop(k, e);
    if (this.bytes <= this.deps.budget) return;
    const victims = [...this.entries]
      .filter(
        ([, e]) => (e.state === 'uploaded' || e.state === 'ready' || e.state === 'failed') && !isWanted(e),
      )
      .sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [k, e] of victims) {
      if (this.bytes <= this.deps.budget) break;
      this.drop(k, e);
      this.deps.onChange(e.id);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const [k, e] of [...this.entries]) this.drop(k, e);
    this.queue.length = 0;
  }
}
