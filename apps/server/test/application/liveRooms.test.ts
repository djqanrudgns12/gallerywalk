import { describe, expect, it } from 'vitest';
import { countLiveRooms, insidePolygon, type FloorLayout } from '../../src/application/liveRooms.ts';

/** 수업 지도 전시실별 수(HT-16): 점-다각형 판정과 관 → 전시실 합치기. 전시실 ID는 합성 UUID */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(1);
const B = id(2);
const C = id(3);

const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

/** A는 관 하나, B는 관 둘(B:0·B:1), C는 아무도 없는 관 하나. 복도는 z 20 위 */
const layout: FloorLayout = {
  parts: [
    { partId: `${A}:0`, roomId: A },
    { partId: `${B}:0`, roomId: B },
    { partId: `${B}:1`, roomId: B },
    { partId: `${C}:0`, roomId: C },
  ],
  map: {
    parts: [
      { partId: `${A}:0`, polygon: rect(0, 0, 10, 10) },
      { partId: `${B}:0`, polygon: rect(20, 0, 30, 10) },
      { partId: `${B}:1`, polygon: rect(30, 0, 40, 10) },
      { partId: `${C}:0`, polygon: rect(50, 0, 60, 10) },
    ],
  },
};

describe('insidePolygon', () => {
  const square = rect(0, 0, 10, 10);

  it('안·밖', () => {
    expect(insidePolygon({ x: 5, z: 5 }, square)).toBe(true);
    expect(insidePolygon({ x: -0.001, z: 5 }, square)).toBe(false);
    expect(insidePolygon({ x: 5, z: 10.001 }, square)).toBe(false);
  });

  it('경계(변 위·꼭짓점)는 안으로 친다', () => {
    for (const p of [
      { x: 0, z: 5 },
      { x: 10, z: 5 },
      { x: 5, z: 0 },
      { x: 5, z: 10 },
      { x: 0, z: 0 },
      { x: 10, z: 10 },
    ])
      expect(insidePolygon(p, square)).toBe(true);
  });

  it('비스듬한 변·오목한 다각형', () => {
    const diamond: [number, number][] = [
      [0, -5],
      [5, 0],
      [0, 5],
      [-5, 0],
    ];
    expect(insidePolygon({ x: 2.5, z: 2.5 }, diamond)).toBe(true); // 변 위
    expect(insidePolygon({ x: 3, z: 3 }, diamond)).toBe(false);
    // ㄷ자: 가운데 홈은 밖
    const notch: [number, number][] = [
      [0, 0],
      [9, 0],
      [9, 3],
      [3, 3],
      [3, 6],
      [9, 6],
      [9, 9],
      [0, 9],
    ];
    expect(insidePolygon({ x: 6, z: 4.5 }, notch)).toBe(false);
    expect(insidePolygon({ x: 1.5, z: 4.5 }, notch)).toBe(true);
    expect(insidePolygon({ x: 6, z: 1.5 }, notch)).toBe(true);
  });
});

describe('countLiveRooms', () => {
  it('두 전시실 1·2명(관 둘로 나뉜 전시실은 합침), 복도 1명, 위치 없음 1명, 빈 전시실은 0', () => {
    const got = countLiveRooms(layout, {
      positions: [
        { x: 5, z: 5 },
        { x: 25, z: 5 },
        { x: 35, z: 5 },
        { x: 30, z: 25 },
      ],
      noPose: 1,
    });
    expect(got).toEqual({
      rooms: [
        { roomId: A, count: 1 },
        { roomId: B, count: 2 },
        { roomId: C, count: 0 },
      ],
      elsewhere: 1,
      noPose: 1,
    });
  });

  it('두 관이 맞닿은 벽 위는 한 번만 센다', () => {
    const got = countLiveRooms(layout, { positions: [{ x: 30, z: 5 }], noPose: 0 });
    expect(got.rooms.find(r => r.roomId === B)?.count).toBe(1);
    expect(got.rooms.reduce((n, r) => n + r.count, 0) + got.elsewhere).toBe(1);
  });

  it('배치가 없으면 rooms는 비고 위치는 모두 전시실 밖', () => {
    expect(countLiveRooms(null, { positions: [{ x: 5, z: 5 }], noPose: 2 })).toEqual({
      rooms: [],
      elsewhere: 1,
      noPose: 2,
    });
  });
});
