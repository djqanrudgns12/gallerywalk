import { computeLayout } from '@gallery/core/layout';
import type { LayoutInput } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { mapView } from './mapView.ts';

const input: LayoutInput = {
  exhibitionId: '00000000-0000-4000-8000-000000000001',
  templateId: 'modern-history',
  algoVersion: 1,
  rooms: [0, 1].map(r => ({ id: `00000000-0000-4000-8000-00000000010${r}`, order: r, hasBgm: false })),
  artworks: Array.from({ length: 10 }, (_, k) => ({
    id: `00000000-0000-4000-8000-0000000002${String(k).padStart(2, '0')}`,
    roomId: `00000000-0000-4000-8000-00000000010${k < 5 ? 0 : 1}`,
    order: k % 5,
    kind: 'IMAGE' as const,
    form: 'LANDSCAPE' as const,
    featured: false,
    textHeavy: false,
    pixel: { w: 3000, h: 2000 },
    pageCount: null,
  })),
};

const nums = (points: string): number[] => points.split(/[ ,]/).map(Number);

describe('mapView', () => {
  const layout = computeLayout(input);
  const view = mapView(layout.map, [0, -6]);
  const [, , w, h] = view.viewBox.split(' ').map(Number);

  it('모든 점이 viewBox 안(여백 포함)', () => {
    const all = [...view.outline, ...view.parts.map(p => p.points)].flatMap(nums);
    for (let i = 0; i < all.length; i += 2) {
      expect(all[i]!).toBeGreaterThanOrEqual(0);
      expect(all[i]!).toBeLessThanOrEqual(w!);
      expect(all[i + 1]!).toBeGreaterThanOrEqual(0);
      expect(all[i + 1]!).toBeLessThanOrEqual(h!);
    }
  });

  it('회랑 하류(+Z)가 위: 출구 쪽 관이 입구 홀보다 위에 그려진다', () => {
    const hallYs = nums(view.outline[0]!).filter((_, i) => i % 2 === 1);
    const lastPart = view.parts[view.parts.length - 1]!;
    expect(lastPart.label.y).toBeLessThan(Math.min(...hallYs));
  });

  it('관마다 다각형·이름 자리, 문마다 선 하나, 지금 자리 표시', () => {
    expect(view.parts).toHaveLength(layout.parts.length);
    expect(view.doors).toHaveLength(layout.map.doors.length);
    expect(view.here).not.toBeNull();
  });
});
