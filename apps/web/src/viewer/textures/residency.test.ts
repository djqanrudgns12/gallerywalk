import { config } from '@gallery/core/config';
import { describe, expect, it } from 'vitest';
import {
  budgetBytes,
  estimateBytes,
  Residency,
  type ResidentArt,
  type Variant,
  wantedVariants,
} from './residency.ts';

const art = (id: string, partId: string, order: number): ResidentArt => ({
  id,
  partId,
  order,
  sizes: { thumb: { w: 256, h: 192 }, 'wall-lo': { w: 1024, h: 768 }, wall: { w: 1600, h: 1200 } },
});

// 관 A에 10점, 관 B에 5점
const ARTS = [
  ...Array.from({ length: 10 }, (_, i) => art(`a${i}`, 'A', i)),
  ...Array.from({ length: 5 }, (_, i) => art(`b${i}`, 'B', i)),
];

describe('wantedVariants', () => {
  it('보이는 관은 썸네일, 가장 가까운 작품의 뒤·앞 창은 벽용(단계별), 목적지는 벽용', () => {
    const w = config().RESIDENCY_WINDOW;
    const got = wantedVariants(
      ARTS,
      { visibleParts: new Set(['A', 'B']), partId: 'A', nearestId: 'a4', targetId: 'b3' },
      'HIGH',
      4096,
    );
    for (let i = 0; i < 10; i++) {
      const inWindow = i >= 4 - w.HIGH.behind && i <= 4 + w.HIGH.ahead;
      expect(got.get(`a${i}`), `a${i}`).toBe(inWindow ? 'wall' : 'thumb');
    }
    expect(got.get('b3')).toBe('wall');
    expect(got.get('b0')).toBe('thumb');
  });

  it('낮은 단계·작은 최대 텍스처 기기는 wall-lo, 안 보이는 관은 없음', () => {
    const low = wantedVariants(
      ARTS,
      { visibleParts: new Set(['A']), partId: 'A', nearestId: 'a0', targetId: null },
      'LOW',
      4096,
    );
    expect(low.get('a0')).toBe('wall-lo');
    expect(low.has('b0')).toBe(false);
    const small = wantedVariants(
      ARTS,
      { visibleParts: new Set(['A']), partId: 'A', nearestId: 'a0', targetId: null },
      'HIGH',
      1024,
    );
    expect(small.get('a0')).toBe('wall-lo');
  });
});

describe('Residency', () => {
  interface FakeTex {
    id: string;
    v: Variant;
    disposed: boolean;
    dispose(): void;
  }
  const rig = (budget: number) => {
    const made: FakeTex[] = [];
    const resolves: (() => void)[] = [];
    let t = 0;
    const uploads: string[] = [];
    const r = new Residency<FakeTex>({
      budget,
      now: () => ++t,
      load: (id, v) =>
        new Promise(res => {
          const tex: FakeTex = {
            id,
            v,
            disposed: false,
            dispose() {
              this.disposed = true;
            },
          };
          made.push(tex);
          resolves.push(() => res(tex));
        }),
      upload: tex => uploads.push(`${tex.id}|${tex.v}`),
      onChange: () => {},
    });
    r.setArtworks(ARTS);
    const flush = async () => {
      while (resolves.length) resolves.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    };
    return { r, made, uploads, flush };
  };

  it('벽용을 원하면 썸네일부터 함께 받고, 한 번에 하나씩 올린다. 올라간 가장 좋은 것을 쓴다', async () => {
    const { r, uploads, flush } = rig(budgetBytes('HIGH'));
    r.update(new Map<string, Variant>([['a0', 'wall']]));
    await flush();
    expect(r.pending).toBe(true);
    expect(r.tick()).toBe(true);
    expect(uploads).toEqual(['a0|thumb']);
    expect(r.textureOf('a0')?.variant).toBe('thumb');
    expect(r.tick()).toBe(false);
    expect(r.textureOf('a0')?.variant).toBe('wall');
  });

  it('예산을 넘으면 원하는 집합 밖에서 오래 안 쓴 것부터 내리고(dispose), 원하는 것은 남긴다', async () => {
    const wall = estimateBytes({ w: 1600, h: 1200 });
    const thumb = estimateBytes({ w: 256, h: 192 });
    // 벽용 2장 + 썸네일 조금이 들어가는 예산
    const { r, made, flush } = rig(2 * wall + 2 * thumb);
    r.update(
      new Map<string, Variant>([
        ['a0', 'wall'],
        ['a1', 'wall'],
      ]),
    );
    await flush();
    while (r.tick());
    // 원하는 것이 바뀜: a2·a3 벽용 — a0·a1은 밖이 되어 내려감
    r.update(
      new Map<string, Variant>([
        ['a2', 'wall'],
        ['a3', 'wall'],
      ]),
    );
    await flush();
    while (r.tick());
    expect(r.bytes).toBeLessThanOrEqual(2 * wall + 2 * thumb);
    expect(r.textureOf('a2')?.variant).toBe('wall');
    expect(r.textureOf('a3')?.variant).toBe('wall');
    expect(made.filter(m => m.id === 'a0' && m.v === 'wall')[0]!.disposed).toBe(true);
  });

  it('받는 중에 원하는 집합에서 빠지면 다 받아도 버린다', async () => {
    const { r, made, flush } = rig(budgetBytes('HIGH'));
    r.update(new Map<string, Variant>([['b0', 'thumb']]));
    r.update(new Map<string, Variant>());
    await flush();
    expect(r.pending).toBe(false);
    expect(made[0]!.disposed).toBe(true);
  });

  it('dispose는 모두 해제', async () => {
    const { r, made, flush } = rig(budgetBytes('HIGH'));
    r.update(
      new Map<string, Variant>([
        ['a0', 'thumb'],
        ['a1', 'thumb'],
      ]),
    );
    await flush();
    while (r.tick());
    r.dispose();
    expect(made.every(m => m.disposed)).toBe(true);
    expect(r.textureOf('a0')).toBeNull();
  });
});
