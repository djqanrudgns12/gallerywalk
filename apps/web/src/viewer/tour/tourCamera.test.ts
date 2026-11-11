import { config } from '@gallery/core/config';
import { computeLayout, pathClear, walkableRects } from '@gallery/core/layout';
import { planTour } from '@gallery/core/tour';
import { ExhibitionSettingsSchema, type LayoutInput } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import { buildTourCamera, tourInputOf } from './tourCamera.ts';

const room = (r: number) => `00000000-0000-4000-8000-0000000001${String(r).padStart(2, '0')}`;
const art = (k: number) => `00000000-0000-4000-8000-000000000${String(200 + k).padStart(3, '0')}`;

const layout = computeLayout({
  exhibitionId: '00000000-0000-4000-8000-000000000001',
  templateId: 'modern-history',
  algoVersion: config().ALGO_VERSION,
  rooms: [0, 1, 2].map(r => ({ id: room(r), order: r, hasBgm: r !== 1 })),
  // 전시실 1은 13점이라 두 관으로 나뉜다
  artworks: [4, 13, 2].flatMap((n, r) =>
    Array.from({ length: n }, (_, i) => ({
      id: art(r * 20 + i),
      roomId: room(r),
      order: i,
      kind: 'IMAGE' as const,
      form: (['LANDSCAPE', 'PORTRAIT', 'SQUARE'] as const)[i % 3]!,
      featured: false,
      textHeavy: false,
      pixel: { w: 3000, h: 2000 },
      pageCount: null,
    })),
  ),
} satisfies LayoutInput);

const settings = ExhibitionSettingsSchema.parse({}).tour;
const song = (sec: number) => ({
  durationMs: sec * 1000,
  audibleStartMs: 1200,
  audibleEndMs: sec * 1000 - 800,
  loudnessDb: -18,
});
const plan = planTour(
  tourInputOf(layout, id => (id === room(1) ? null : song(id === room(0) ? 150 : 180)), settings),
);

describe('tourInputOf', () => {
  it('전시실 순서·관마다 작품 수(나뉜 전시실은 관 둘)', () => {
    const input = tourInputOf(layout, () => null, settings);
    expect(input.rooms.map(r => r.parts)).toEqual([[4], [7, 6], [2]]);
  });
});

describe.each([16 / 10, 390 / 844])('buildTourCamera (화면 비율 %f)', aspect => {
  const cam = buildTourCamera(layout, plan, aspect);
  const step = 0.05;
  const samples = Array.from({ length: Math.floor(cam.totalSec / step) + 1 }, (_, i) => cam.at(i * step));

  it('전체 길이는 시간표와 같다', () => {
    expect(cam.totalSec).toBeCloseTo(plan.totalSec, 6);
  });

  it('카메라가 튀지 않는다(구간 경계 포함)', () => {
    let worst = 0;
    let where = '';
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!.pose.position;
      const b = samples[i]!.pose.position;
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (d > worst) {
        worst = d;
        const t = i * step;
        const seg = plan.segments.find(x => t < x.endSec);
        where = `t=${t.toFixed(2)} ${seg?.kind} ${seg?.startSec.toFixed(2)}~${seg?.endSec.toFixed(2)}`;
      }
    }
    // 0.05초에 0.75m = 초속 15m 미만(경로 이동 최대 2.2초에 30m 안쪽)
    expect(worst, where).toBeLessThan(0.75);
    for (const seg of plan.segments) {
      const before = cam.at(seg.startSec - 1e-4).pose.position;
      const after = cam.at(seg.startSec + 1e-4).pose.position;
      expect(Math.hypot(after.x - before.x, after.z - before.z), `${seg.kind} 시작`).toBeLessThan(0.02);
    }
  });

  it('늘 걸을 수 있는 영역 안(벽을 뚫지 않음)', () => {
    const rects = walkableRects(layout);
    const bad = samples.find(s => !pathClear([[s.pose.position.x, s.pose.position.z]], rects));
    expect(bad?.pose.position).toBeUndefined();
  });

  it('이젤·화분 같은 키 큰 설비를 지나가지 않는다(ADR-057)', () => {
    const m = config().WALKABLE_WALL_MARGIN_M;
    const tall = layout.walk.obstacles.filter(o => o.tall);
    expect(layout.fixtures.some(f => f.kind === 'easel')).toBe(true);
    const hit = samples.find(s =>
      tall.some(
        o =>
          s.pose.position.x > o.min[0] + m &&
          s.pose.position.x < o.max[0] - m &&
          s.pose.position.z > o.min[1] + m &&
          s.pose.position.z < o.max[1] - m,
      ),
    );
    expect(hit?.pose.position).toBeUndefined();
  });

  it('밝기: 검게 시작 → 밝아짐 → 문 지날 때 살짝 어두워짐 → 검게 끝', () => {
    const hall = plan.segments[0]!;
    expect(hall.kind).toBe('HALL');
    expect(cam.at(0).dim).toBeCloseTo(0, 6);
    if (hall.kind === 'HALL') expect(cam.at(hall.fadeInEndSec).dim).toBeCloseTo(1, 6);
    const door = plan.segments.find(s => s.kind === 'DOOR')!;
    const mid = cam.at((door.startSec + door.endSec) / 2).dim;
    expect(mid).toBeCloseTo(1 - config().TOUR_VISUAL_DIP, 2);
    expect(cam.at(cam.totalSec).dim).toBeCloseTo(0, 6);
  });

  it('작품 구간: 다가가기가 끝나면 그 작품을 보고 있다', () => {
    for (const seg of plan.segments) {
      if (seg.kind !== 'ARTWORK') continue;
      const { pose } = cam.at(seg.approachEndSec + 1e-3);
      const partId = layout.parts.find(
        p => p.roomId === plan.rooms[seg.roomIndex]!.roomId && p.partIndex === seg.partIndex,
      )!.partId;
      const stop = layout.stops.filter(s => s.kind === 'artwork' && s.partId === partId)[seg.artworkIndex]!;
      expect(
        Math.hypot(pose.target.x - stop.anchor.target[0], pose.target.z - stop.anchor.target[2]),
      ).toBeLessThan(0.2);
    }
  });
});
