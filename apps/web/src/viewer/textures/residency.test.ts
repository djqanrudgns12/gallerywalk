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

  it('첫 화면 준비는 받기와 GPU 올리기가 끝나야 끝나고, 새로 원하는 그림은 다시 기다린다', async () => {
    const { r, flush } = rig(budgetBytes('HIGH'));
    const want = new Map<string, Variant>([['a0', 'thumb']]);
    expect(r.settled(want)).toBe(false);
    r.update(want);
    expect(r.settled(want)).toBe(false);
    await flush();
    expect(r.settled(want)).toBe(false);
    r.tick();
    expect(r.settled(want)).toBe(true);
    expect(r.settled(new Map<string, Variant>([['a1', 'thumb']]))).toBe(false);
  });

  it('첫 그림 받기에 실패하면 준비 상태 변경을 알리고 빈 액자로 입장을 이어 간다', async () => {
    const changed: string[] = [];
    const r = new Residency({
      budget: budgetBytes('HIGH'),
      load: async () => {
        throw new Error('offline');
      },
      upload: () => {},
      onChange: id => changed.push(id),
    });
    r.setArtworks(ARTS);
    const want = new Map<string, Variant>([['a0', 'thumb']]);
    r.update(want);
    expect(r.settled(want)).toBe(false);
    await Promise.resolve();
    expect(r.settled(want)).toBe(true);
    expect(changed).toEqual(['a0']);
    r.dispose();
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

  it('받지 못한 그림은 간격이 지나면 다시 받고(실패마다 배로), 정한 횟수를 넘으면 더 받지 않는다', async () => {
    let clock = 0;
    let failing = true;
    const loads: string[] = [];
    const r = new Residency<FakeTex>({
      budget: budgetBytes('HIGH'),
      now: () => clock,
      load: async (id, v) => {
        loads.push(`${id}|${v}`);
        if (failing) throw new Error('offline');
        return { id, v, disposed: false, dispose() {} };
      },
      upload: () => {},
      onChange: () => {},
    });
    r.setArtworks(ARTS);
    const want = new Map<string, Variant>([['b0', 'thumb']]);
    const settle = async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    };
    const { max, delayMs } = config().RESIDENCY_RETRY;
    r.update(want);
    await settle();
    expect(loads).toHaveLength(1);
    // 간격 전에는 다시 받지 않는다
    clock += delayMs - 1;
    r.update(want);
    await settle();
    expect(loads).toHaveLength(1);
    // 간격이 지나면 다시(아직 끊김), 다음 간격은 두 배
    clock += 1;
    r.update(want);
    await settle();
    expect(loads).toHaveLength(2);
    clock += delayMs;
    r.update(want);
    await settle();
    expect(loads).toHaveLength(2);
    clock += delayMs;
    // 이어진 뒤: 받아서 올린다
    failing = false;
    r.update(want);
    await settle();
    expect(loads).toHaveLength(3);
    while (r.tick());
    expect(r.textureOf('b0')?.variant).toBe('thumb');
    // 끝내 받지 못하는 그림은 `max`번 다시 받은 뒤 멈춘다
    failing = true;
    const other = new Map<string, Variant>([['b1', 'thumb']]);
    for (let i = 0; i < max + 3; i++) {
      r.update(other);
      await settle();
      clock += delayMs * 2 ** (max + 1);
    }
    expect(loads.filter(l => l === 'b1|thumb')).toHaveLength(1 + max);
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
