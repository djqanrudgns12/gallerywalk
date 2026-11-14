import { config } from '@gallery/core/config';
import { computeLayout } from '@gallery/core/layout';
import { templateGeometry } from '@gallery/core/templates';
import type { Layout, LayoutInput } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { DECOR_KINDS, decorGroups, decorKindsFor, decorShapeOf, decorZonesInView } from './decor.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const layoutOf = (counts: readonly number[], algoVersion: number): Layout => {
  const rooms = counts.map((_, r) => ({ id: uuid(900 + r), order: r, hasBgm: false }));
  let k = 0;
  const artworks = counts.flatMap((n, r) =>
    Array.from({ length: n }, (_, i) => ({
      id: uuid(++k),
      roomId: rooms[r]!.id,
      order: i,
      kind: 'IMAGE' as const,
      form: 'LANDSCAPE' as const,
      featured: false,
      textHeavy: false,
      pixel: { w: 3000, h: 2000 },
      pageCount: null,
    })),
  );
  const input: LayoutInput = {
    exhibitionId: uuid(777),
    templateId: 'modern-history',
    rooms,
    artworks,
    algoVersion,
  };
  return computeLayout(input);
};

const footprints = templateGeometry['modern-history'].footprints;
const none = (): boolean => false;
const only =
  (...names: string[]) =>
  (name: string): boolean =>
    names.includes(name);
/** 열 우선 4×4 행렬의 옮김(x, y, z) */
const at = (m: Float32Array, i: number): number[] => [m[i * 16 + 12]!, m[i * 16 + 13]!, m[i * 16 + 14]!];

describe('decorZonesInView (그릴 장식 구역 — 도슨트 규칙과 같음)', () => {
  const slots = [{ zone: 'plaza' }, { zone: 'portico' }, { zone: 'hall' }, { zone: 'p1' }, { zone: 'p2' }];

  it('바깥(광장·처음)은 광장·현관만', () => {
    expect(decorZonesInView(slots, 'exterior', new Set(['p1']))).toEqual(['plaza', 'portico']);
    expect(decorZonesInView(slots, '', new Set(['p1']))).toEqual(['plaza', 'portico']);
  });

  it('실내는 홀 + 그리는 관(`visibleParts`) 안의 것', () => {
    expect(decorZonesInView(slots, 'spine', new Set())).toEqual(['hall']);
    expect(decorZonesInView(slots, 'p2', new Set(['p2', 'p1']))).toEqual(['hall', 'p1', 'p2']);
    expect(decorZonesInView(slots, 'p1', new Set(['p1']))).toEqual(['hall', 'p1']);
  });
});

describe('decorShapeOf (종류 → 모델)', () => {
  it('같은 이름 모델이 들어오면 그것을 크기 그대로', () => {
    expect(decorShapeOf('planter', only('planter', 'plant'), footprints)).toEqual({
      type: 'model',
      name: 'planter',
      scale: 1,
    });
    expect(decorShapeOf('fountain', only('fountain'), footprints)).toEqual({
      type: 'model',
      name: 'fountain',
      scale: 1,
    });
  });

  it('없으면 있는 설비 모델을 장식 바닥 넓이에 맞게 키워 다시 쓴다(planter·topiary → plant)', () => {
    const fp = config().LAYOUT_V4.decorFootprint;
    expect(decorShapeOf('planter', only('plant'), footprints)).toEqual({
      type: 'model',
      name: 'plant',
      scale: fp.planter.w / footprints.plant.w,
    });
    expect(decorShapeOf('topiary', only('plant'), footprints)).toEqual({
      type: 'model',
      name: 'plant',
      scale: fp.topiary.w / footprints.plant.w,
    });
  });

  it('맞는 모델이 없으면 임시 모형(종류 이름 키)', () => {
    for (const kind of DECOR_KINDS)
      expect(decorShapeOf(kind, none, footprints)).toEqual({ type: 'placeholder', key: kind });
    expect(decorShapeOf('fountain', only('plant', 'lamp'), footprints)).toEqual({
      type: 'placeholder',
      key: 'fountain',
    });
  });
});

describe('decorGroups (레이아웃 → 종류별 인스턴스 행렬)', () => {
  const v4 = layoutOf([5, 9, 4], 4);
  const slots = v4.decorSlots ?? [];
  const everything = new Set(slots.map(s => s.zone));

  it('공간 v4 배치에는 장식 자리가 있다(광장 분수·홀 펜던트·안내 데스크)', () => {
    const kinds = new Set(slots.map(s => s.kind));
    for (const k of ['fountain', 'planter', 'sculpture', 'pendant', 'desk'] as const)
      expect(kinds.has(k)).toBe(true);
  });

  it('스키마 2 배치면 빈 결과', () => {
    const v3 = layoutOf([5, 9, 4], 3);
    expect(v3.schemaVersion).toBe(2);
    expect(decorGroups(v3, new Set(['plaza', 'hall']), none, footprints, 'HIGH')).toEqual([]);
    // 스키마 2인데 장식 칸이 남아 있어도 그리지 않는다
    expect(decorGroups({ ...v3, decorSlots: slots }, everything, none, footprints, 'HIGH')).toEqual([]);
  });

  it('종류마다 묶음 하나(정해진 종류 순서), 인스턴스 = 그 종류 자리 수, 행렬의 옮김 = 자리', () => {
    const groups = decorGroups(v4, everything, none, footprints, 'HIGH');
    const kinds = groups.map(g => g.kind);
    expect(kinds).toEqual(DECOR_KINDS.filter(k => slots.some(s => s.kind === k)));
    for (const g of groups) {
      const mine = slots.filter(s => s.kind === g.kind);
      expect(g.count).toBe(mine.length);
      expect(g.matrices.length).toBe(16 * mine.length);
      mine.forEach((s, i) => {
        const p = at(g.matrices, i);
        for (let a = 0; a < 3; a++) expect(p[a]).toBeCloseTo(s.pos[a]!, 4);
      });
    }
  });

  it('보이는 구역의 장식만 — 광장이면 분수·화분만, 홀이면 홀 장식만', () => {
    const plaza = decorGroups(v4, new Set(['plaza', 'portico']), none, footprints, 'HIGH');
    const plazaKinds = new Set(slots.filter(s => s.zone === 'plaza').map(s => s.kind));
    expect(new Set(plaza.map(g => g.kind))).toEqual(plazaKinds);
    expect(plaza.find(g => g.kind === 'pendant')).toBeUndefined();
    expect(plaza.reduce((n, g) => n + g.count, 0)).toBe(slots.filter(s => s.zone === 'plaza').length);

    const hall = decorGroups(v4, new Set(['hall']), none, footprints, 'HIGH');
    expect(hall.find(g => g.kind === 'fountain')).toBeUndefined();
    expect(hall.reduce((n, g) => n + g.count, 0)).toBe(slots.filter(s => s.zone === 'hall').length);

    expect(decorGroups(v4, new Set(), none, footprints, 'HIGH')).toEqual([]);
  });

  it('다시 쓰는 모델은 크기를 행렬에 넣는다(planter → plant ×배율)', () => {
    const [planter] = decorGroups(v4, new Set(['plaza']), only('plant'), footprints, 'HIGH').filter(
      g => g.kind === 'planter',
    );
    expect(planter?.shape).toEqual(decorShapeOf('planter', only('plant'), footprints));
    const s = planter!.shape.type === 'model' ? planter!.shape.scale : 1;
    // 회전 0인 화분: 대각 성분 = 배율
    expect(planter!.matrices[0]).toBeCloseTo(s, 5);
    expect(planter!.matrices[5]).toBeCloseTo(s, 5);
    expect(planter!.matrices[10]).toBeCloseTo(s, 5);
  });

  it('결정적: 같은 입력(다시 계산한 배치 포함)이면 같은 출력', () => {
    const a = decorGroups(v4, everything, only('plant'), footprints, 'HIGH');
    const b = decorGroups(
      layoutOf([5, 9, 4], 4),
      new Set([...everything].reverse()),
      only('plant'),
      footprints,
      'HIGH',
    );
    expect(b).toEqual(a);
  });

  it('품질 낮음(LOW)이면 `DECOR.lowTierKinds`의 종류만, 높음·보통은 모두', () => {
    const low = new Set(config().DECOR.lowTierKinds);
    expect(decorKindsFor('LOW')).toEqual(low);
    expect(decorKindsFor('HIGH')).toEqual(new Set(DECOR_KINDS));
    expect(decorKindsFor('MEDIUM')).toEqual(new Set(DECOR_KINDS));
    const high = decorGroups(v4, everything, none, footprints, 'HIGH');
    expect(decorGroups(v4, everything, none, footprints, 'MEDIUM')).toEqual(high);
    const lowGroups = decorGroups(v4, everything, none, footprints, 'LOW');
    expect(lowGroups).toEqual(high.filter(g => low.has(g.kind)));
    // 이 배치의 흉상·화분은 LOW에서 빠진다(기본안)
    expect(high.some(g => g.kind === 'bust' || g.kind === 'planter')).toBe(true);
    expect(lowGroups.some(g => g.kind === 'bust' || g.kind === 'planter')).toBe(false);
  });
});
