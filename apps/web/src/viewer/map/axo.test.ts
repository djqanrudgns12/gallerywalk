import { config } from '@gallery/core/config';
import { computeLayout } from '@gallery/core/layout';
import type { Layout, LayoutInput } from '@gallery/core/types';
import { describe, expect, it } from 'vitest';
import {
  axoDots,
  axoPin,
  axoRoomAt,
  buildAxo,
  buildSlabs,
  cutSegment,
  facesViewer,
  project,
  unproject,
  type AxoSource,
} from './axo.ts';

const uuid = (prefix: string, n: number): string =>
  `00000000-0000-4000-8000-${prefix}${String(n).padStart(12 - prefix.length, '0')}`;
const FORMS = ['LANDSCAPE', 'PORTRAIT', 'SQUARE'] as const;

/** 전시실마다 작품 수를 받아 배치를 계산한다(합성 값) */
const layoutFor = (perRoom: readonly number[], algoVersion: number): { layout: Layout; rooms: string[] } => {
  const rooms = perRoom.map((_, r) => uuid('1', r));
  let k = 0;
  const input: LayoutInput = {
    exhibitionId: uuid('9', 1),
    templateId: 'modern-history',
    algoVersion,
    rooms: rooms.map((id, order) => ({ id, order, hasBgm: false })),
    artworks: perRoom.flatMap((count, r) =>
      Array.from({ length: count }, (_, order) => {
        k += 1;
        return {
          id: uuid('2', k),
          roomId: rooms[r] ?? '',
          order,
          kind: 'IMAGE' as const,
          form: FORMS[k % FORMS.length] ?? 'LANDSCAPE',
          featured: order === 0,
          textHeavy: false,
          pixel: { w: 3000, h: 2000 },
          pageCount: null,
        };
      }),
    ),
  };
  return { layout: computeLayout(input), rooms };
};

const sourceOf = (layout: Layout, roomOrder: readonly string[]): AxoSource => ({
  map: layout.map,
  parts: layout.parts,
  frames: layout.frames,
  facadeZ: layout.exterior.facadeZ,
  roomOrder,
});

const nums = (points: string): number[] => points.split(/[ ,]/).map(Number);

describe('투영', () => {
  it('바닥(h = 0)에서 거꾸로 풀면 제자리', () => {
    for (const [x, z] of [
      [0, 0],
      [3.2, -7.5],
      [-12, 30.25],
    ] as const) {
      const [u, w] = project(x, z);
      const [bx, bz] = unproject(u, w);
      expect(bx).toBeCloseTo(x, 9);
      expect(bz).toBeCloseTo(z, 9);
    }
  });

  it('높이가 있으면 화면 위로 올라간다', () => {
    expect(project(1, 1, config().AXO.wallHeightM)[1]).toBeLessThan(project(1, 1)[1]);
  });

  it('상자의 네 옆면 중 보는 쪽 둘만 보인다', () => {
    const visible = (
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const
    ).filter(([fx, fz]) => facesViewer(fx, fz));
    expect(visible).toEqual([
      [-1, 0],
      [0, -1],
    ]);
  });
});

describe('벽 조각', () => {
  const door: Layout['map']['doors'][number] = { pos: [5, 0], normal: [0, 1], width: 2 };

  it('같은 방향 벽의 문 폭만큼 잘라 두 조각', () => {
    const pieces = cutSegment([0, 0], [10, 0], [door]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.[1][0]).toBeCloseTo(4, 9);
    expect(pieces[1]?.[0][0]).toBeCloseTo(6, 9);
  });

  it('방향이 다르거나 먼 문은 자르지 않는다', () => {
    expect(cutSegment([0, 0], [0, 10], [door])).toHaveLength(1);
    expect(cutSegment([0, 3], [10, 3], [door])).toHaveLength(1);
  });

  it('이웃이 같은 벽을 내면 한 번만', () => {
    const square = (x0: number): [number, number][] => [
      [x0, 0],
      [x0 + 4, 0],
      [x0 + 4, 4],
      [x0, 4],
    ];
    const map: Layout['map'] = {
      outline: [],
      parts: [
        { partId: 'a:0', polygon: square(0), labelPos: [2, 2] },
        { partId: 'b:0', polygon: square(4), labelPos: [6, 2] },
      ],
      doors: [],
      bounds: { min: [0, 0], max: [8, 4] },
    };
    expect(buildSlabs(map)).toHaveLength(7);
  });
});

describe.each([
  ['algo 3', 3, [8, 8, 8, 8, 8]],
  ['공간 v4(큰 전시실이 관으로 나뉨)', 4, [8, 14, 8, 6, 4]],
] as const)('지도 %s', (_name, algo, perRoom) => {
  const { layout, rooms } = layoutFor(perRoom, algo);
  const model = buildAxo(sourceOf(layout, rooms), { width: 400, height: 230 });

  it('모든 점이 상자 안', () => {
    const all = [
      ...model.corridor,
      ...model.rooms.flatMap(r => r.floors),
      ...model.shapes.map(s => s.points),
    ].flatMap(nums);
    for (let i = 0; i < all.length; i += 2) {
      expect(all[i]!).toBeGreaterThanOrEqual(0);
      expect(all[i]!).toBeLessThanOrEqual(model.width);
      expect(all[i + 1]!).toBeGreaterThanOrEqual(0);
      expect(all[i + 1]!).toBeLessThanOrEqual(model.height);
    }
  });

  it('관을 전시실로 합쳐 번호는 전시실마다 하나, 차례는 보드와 같다', () => {
    expect(model.rooms.map(r => r.roomId)).toEqual(rooms);
    expect(model.rooms.map(r => r.index)).toEqual(rooms.map((_, i) => i));
    const partsPerRoom = rooms.map(id => layout.parts.filter(p => p.roomId === id).length);
    expect(model.rooms.map(r => r.floors.length)).toEqual(partsPerRoom);
    if (algo === 4) expect(Math.max(...partsPerRoom)).toBeGreaterThan(1);
  });

  it('작품 자리는 작품마다 한 번(벽 막대 또는 이젤)', () => {
    const marks = model.shapes.flatMap(s => (s.kind === 'wall' ? [] : [s.artworkId]));
    expect(marks.sort()).toEqual(layout.frames.map(f => f.artworkId).sort());
    expect(model.shapes.filter(s => s.kind === 'easel')).toHaveLength(
      layout.frames.filter(f => f.mount === 'EASEL').length,
    );
    const featured = model.shapes.filter(s => s.kind !== 'wall' && s.featured).length;
    expect(featured).toBe(layout.frames.filter(f => f.featured).length);
  });

  it('번호 자리를 거꾸로 풀면 그 전시실', () => {
    for (const room of model.rooms) {
      const part = layout.map.parts.find(
        p => layout.parts.find(q => q.partId === p.partId)?.roomId === room.roomId,
      );
      const [x, z] = part?.labelPos ?? [0, 0];
      const [u, w] = project(x, z);
      const sx = model.internal.ox + u * model.scale;
      const sy = model.internal.oy + w * model.scale;
      expect(axoRoomAt(model, sx, sy)).toBe(room.roomId);
    }
    expect(axoRoomAt(model, 0, 0)).toBeNull();
  });

  it('고른 작품 핀은 바닥에서 위로 서고, 배치에 없는 작품은 null', () => {
    const frame = layout.frames.find(f => f.mount === 'WALL');
    const pin = frame ? axoPin(model, frame.artworkId) : null;
    expect(pin).not.toBeNull();
    expect(pin!.stem.y2).toBeLessThan(pin!.stem.y1);
    expect(pin!.head.y).toBeGreaterThanOrEqual(0);
    expect(nums(pin!.ring)).toHaveLength(config().AXO.pinRingSegments * 2);
    expect(axoPin(model, uuid('3', 1))).toBeNull();
  });

  it('학생 점: 수가 맞고, 같은 입력이면 같은 자리, 번호 글자와 겹치지 않는다', () => {
    const counts = new Map(rooms.map((id, i) => [id, [4, 7, 3, 2, 3][i] ?? 0] as const));
    const dots = axoDots(model, counts);
    for (const [id, n] of counts) expect(dots.filter(d => d.roomId === id)).toHaveLength(n);
    expect(axoDots(model, counts)).toEqual(dots);
    const a = config().AXO;
    for (const dot of dots) {
      const room = model.rooms.find(r => r.roomId === dot.roomId)!;
      const clearW = room.label.size * a.labelHalfW + dot.r;
      const clearH = room.label.size * a.labelHalfH + dot.r;
      const overlaps = Math.abs(dot.x - room.label.x) < clearW && Math.abs(dot.y - room.label.y) < clearH;
      expect(overlaps).toBe(false);
    }
  });

  it('SVG 요소 수 ≤ 400(바닥·벽·작품·번호·점 23개·핀 4개)', () => {
    const count =
      model.corridor.length +
      model.rooms.reduce((n, r) => n + r.floors.length + 1, 0) +
      model.shapes.length +
      23 +
      4 +
      2;
    expect(count).toBeLessThanOrEqual(400);
  });

  it('작은 지도는 입구 글자·핀 위 여백이 없다', () => {
    const mini = buildAxo(sourceOf(layout, rooms), { width: 380, height: 150, mini: true });
    expect(mini.entry).toBeNull();
    expect(model.entry).not.toBeNull();
  });
});
