import type { LiveRoomCount } from '@gallery/core/types';

/**
 * 수업 지도의 전시실별 학생 수(HT-16, ADR-074, PRD 18장 G-32 "수업 지도"): 허브가 낸 학생 바닥 위치를 지금 배치의
 * 관 바닥 다각형(`layout.map.parts`)에 넣어 보고, 관(`{roomId}:{n}`)은 전시실로 합쳐 센다. 어느 관에도 들지 않으면
 * 전시실 밖(홀·광장·복도). 수만 내고 위치는 버린다 — 응답·기록에 개인 위치를 남기지 않는다.
 * 학생 기기의 배치 판이 최신과 다를 수 있어 근사치다.
 */

/** 바닥 위치(m, 세계 x·z) */
export interface FloorPoint {
  readonly x: number;
  readonly z: number;
}

/** 다각형 꼭짓점(세계 `[X, Z]`, 배치 `Vec2`) */
type Ring = readonly (readonly [number, number])[];

/** 배치에서 쓰는 칸만(`Layout`을 그대로 넘길 수 있다) */
export interface FloorLayout {
  readonly parts: readonly { readonly partId: string; readonly roomId: string }[];
  readonly map: { readonly parts: readonly { readonly partId: string; readonly polygon: Ring }[] };
}

export interface LiveRooms {
  /** 배치의 전시실 차례대로, 아무도 없는 전시실도 0으로 */
  readonly rooms: LiveRoomCount[];
  readonly elsewhere: number;
  readonly noPose: number;
}

/** 선분 a–b 위(끝점 포함)인가. 좌표는 mm로 반올림된 값이라 같은 직선 위 판정은 정확한 비교로 한다 */
const onSegment = (p: FloorPoint, a: readonly [number, number], b: readonly [number, number]): boolean =>
  (b[0] - a[0]) * (p.z - a[1]) === (b[1] - a[1]) * (p.x - a[0]) &&
  Math.min(a[0], b[0]) <= p.x &&
  p.x <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= p.z &&
  p.z <= Math.max(a[1], b[1]);

/** 점이 다각형 안인가(짝홀 규칙, 오목해도 된다). 경계 위는 안으로 친다 */
export const insidePolygon = (p: FloorPoint, ring: Ring): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (onSegment(p, a, b)) return true;
    if (a[1] > p.z !== b[1] > p.z && p.x < ((b[0] - a[0]) * (p.z - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
};

/** 위치 목록 + 배치 → 전시실별 수·전시실 밖·위치 없음. 배치가 없으면 `rooms`는 비고 위치는 모두 전시실 밖 */
export const countLiveRooms = (
  layout: FloorLayout | null,
  floor: { readonly positions: readonly FloorPoint[]; readonly noPose: number },
): LiveRooms => {
  if (!layout) return { rooms: [], elsewhere: floor.positions.length, noPose: floor.noPose };
  const roomOfPart = new Map(layout.parts.map(p => [p.partId, p.roomId]));
  const counts = new Map<string, number>();
  for (const p of layout.parts) if (!counts.has(p.roomId)) counts.set(p.roomId, 0);
  const areas = layout.map.parts.flatMap(mp => {
    const roomId = roomOfPart.get(mp.partId);
    return roomId === undefined ? [] : [{ roomId, polygon: mp.polygon }];
  });
  let elsewhere = 0;
  for (const pos of floor.positions) {
    const hit = areas.find(a => insidePolygon(pos, a.polygon));
    if (hit) counts.set(hit.roomId, (counts.get(hit.roomId) ?? 0) + 1);
    else elsewhere += 1;
  }
  return {
    rooms: [...counts].map(([roomId, count]) => ({ roomId, count })),
    elsewhere,
    noPose: floor.noPose,
  };
};
