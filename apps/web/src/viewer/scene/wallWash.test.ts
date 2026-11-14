import { config } from '@gallery/core/config';
import { computeLayout } from '@gallery/core/layout';
import type { Layout, LayoutInput } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { washGeometryData, washStrips } from './wallWash.ts';

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

const style = { heightM: 2.6 };

describe('washStrips (전시실 벽 와시, W-12)', () => {
  const layout = layoutOf([5, 9, 4], 4);
  const all = new Set(layout.parts.map(p => p.partId));

  it('스키마 2(옛 공간)는 그리지 않는다', () => {
    const old = layoutOf([5, 9], config().ALGO_VERSION);
    expect(washStrips(old, new Set(old.parts.map(p => p.partId)), style)).toEqual([]);
  });

  it('보이는 관만, 관마다 네 벽에 띠가 있고 위 끝은 코브 바로 아래', () => {
    const one = new Set([layout.parts[0]!.partId]);
    const strips = washStrips(layout, one, style);
    expect(strips.length).toBeGreaterThanOrEqual(4);
    const top = config().LAYOUT_V4.roomHeight - config().WALL_WASH.topGapM;
    for (const s of strips) {
      expect(s.top).toBeCloseTo(top, 6);
      expect(s.bottom).toBeGreaterThanOrEqual(top - style.heightM - 1e-9);
      expect(s.bottom).toBeLessThan(s.top);
    }
    expect(washStrips(layout, all, style).length).toBeGreaterThan(strips.length);
  });

  it('문 열림 앞에는 문 위 벽 높이보다 낮은 띠가 없다(허공에 빛 판이 뜨지 않음)', () => {
    const c = config();
    let doorsChecked = 0;
    const strips = washStrips(layout, all, style);
    for (const part of layout.parts)
      for (const d of part.doors) {
        const doorTop = d.width >= c.LAYOUT_V4.portal.clear ? c.LAYOUT_V4.portal.h : c.LAYOUT_V4.enfilade.h;
        for (const s of strips) {
          // 문 한가운데가 띠 선분 앞(벽 두께 안)에 있으면 그 띠는 문 위 벽에만
          const ax = s.b[0] - s.a[0];
          const az = s.b[1] - s.a[1];
          const len = Math.hypot(ax, az);
          const t = ((d.center[0] - s.a[0]) * ax + (d.center[2] - s.a[1]) * az) / (len * len);
          const off = Math.abs(((d.center[0] - s.a[0]) * az - (d.center[2] - s.a[1]) * ax) / len);
          if (t > 0 && t < 1 && off < c.WALL_WASH.doorSnapM) {
            expect(s.bottom).toBeGreaterThan(doorTop);
            doorsChecked++;
          }
        }
      }
    expect(doorsChecked).toBeGreaterThan(2);
  });

  it('한 기하: 띠마다 (칸+1)×2 꼭짓점, 밝기는 아래 0 → 위 1', () => {
    const strips = washStrips(layout, all, style);
    const g = washGeometryData(strips, style);
    const rows = config().WALL_WASH.rows;
    expect(g.positions.length / 3).toBe(strips.length * (rows + 1) * 2);
    expect(g.index.length).toBe(strips.length * rows * 6);
    const full = strips.findIndex(s => s.top - s.bottom > style.heightM - 1e-6);
    const base = full * (rows + 1) * 2;
    expect(g.shade[base]).toBeCloseTo(0, 6);
    expect(g.shade[base + rows * 2]).toBeCloseTo(1, 6);
    expect(Math.max(...g.shade)).toBeLessThanOrEqual(1);
  });

  it('품질 낮음(LOW)은 칸 수 `WALL_WASH.lowRows`(띠·밝기 양 끝은 그대로)', () => {
    const strips = washStrips(layout, all, style);
    const w = config().WALL_WASH;
    expect(w.lowRows).toBeLessThan(w.rows);
    expect(washGeometryData(strips, style, 'HIGH')).toEqual(washGeometryData(strips, style));
    expect(washGeometryData(strips, style, 'MEDIUM')).toEqual(washGeometryData(strips, style));
    const g = washGeometryData(strips, style, 'LOW');
    const rows = w.lowRows;
    expect(g.positions.length / 3).toBe(strips.length * (rows + 1) * 2);
    expect(g.index.length).toBe(strips.length * rows * 6);
    const full = strips.findIndex(s => s.top - s.bottom > style.heightM - 1e-6);
    const base = full * (rows + 1) * 2;
    expect(g.shade[base]).toBeCloseTo(0, 6);
    expect(g.shade[base + rows * 2]).toBeCloseTo(1, 6);
  });
});
