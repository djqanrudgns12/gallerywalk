import type { TemplateGeometry } from './geometry.ts';
import type { TemplateId } from './look.ts';
import { templateGeometry } from './geometry.ts';

/**
 * 공간 v4(ADR-071)의 템플릿 치수·조각 이름. 배치 엔진 v4(`domain/layout/v4`)만 읽는다.
 * 높이가 다른 조각(전시실 6m·홀 10m)과 큰 외관(현관 24m·계단 16단)은 새 조각 묶음 `mh4_*`이다
 * (규격 `tools/assets/spec/modules-v4.md`, M3에서 굽는다). 높이와 상관없는 조각(바닥 판·광장 판·산울타리)은 v3 것을 그대로 쓴다.
 */
export interface TemplateGeometryV4 {
  /** v3 외관 함수(`buildExterior`)에 그대로 넘기는 v4 외관 치수와 조각 이름 */
  readonly base: TemplateGeometry;
  readonly modules: {
    /** 전시실(높이 `LAYOUT_V4.roomHeight`) */
    readonly roomWall4: string;
    readonly roomWall2: string;
    readonly roomCornerIn: string;
    readonly roomCeiling: string;
    readonly roomFloor: string;
    /** 관 N 벽 가운데 포털(방 쪽 — 벽 두께 면 있음) */
    readonly roomPortal: string;
    /** 방 사이 문: 나가는 쪽 R 벽(통로 두께 면 있음) · 들어오는 쪽 L 벽(문틀만) */
    readonly enfiladeDoor: string;
    readonly enfiladeFrame: string;
    /** 메인홀(높이 `LAYOUT_V4.hall.h`) */
    readonly hallWall4: string;
    readonly hallWall2: string;
    readonly hallCornerIn: string;
    readonly hallCeiling: string;
    /** 홀 축 가운데 줄 천장(천창) */
    readonly hallSkylight: string;
    readonly hallFloor: string;
    /** 홀 벽의 포털 자리(문틀 + 위 벽, 두께 면 없음) */
    readonly hallPortal: string;
    /** 홀 앞 벽의 정문(안쪽에서 본 모습) */
    readonly hallEntrance: string;
    /** 홀 벽기둥(베이 리듬, 벽 면에 붙음) */
    readonly hallPilaster: string;
    /** 대문(석재 문기둥 + 주철 문) */
    readonly gate: string;
  };
}

export const templateGeometryV4: Readonly<Record<TemplateId, TemplateGeometryV4>> = {
  'modern-history': {
    base: {
      ...templateGeometry['modern-history'],
      exterior: {
        ...templateGeometry['modern-history'].exterior,
        porticoW: 24,
        porticoD: 6,
        columnXs: [2.8, 5.8, 8.8, 11.4],
        columnInsetM: 0.8,
        columnDiameterM: 1,
        steps: 16,
        stepRiseM: 0.15,
        stepRunM: 0.42,
        plazaD: 16,
        minHalfW: 16,
        wingOverhangM: 2,
        wingReturnM: 6,
        porticoCeilingY: 9,
        signY: 7.6,
        signOutM: 0.05,
        spawnFromStairsM: 9,
        lampSpacingM: 6,
        lampInsetM: 1.6,
        treeSpacingM: 5,
        treeOutM: 3,
        stopTargetDropM: 2.4,
        stopOuter: { w: 26, h: 12 },
      },
      modules: {
        ...templateGeometry['modern-history'].modules,
        portico: 'mh4_ext_portico_24m',
        stairs: 'mh4_ext_stairs_24m',
        facadeWall2: 'mh4_ext_wall_2m',
        facadeEnd: 'mh4_ext_wall_end',
        hedge2: 'mh4_ext_balustrade_2m',
      },
    },
    modules: {
      roomWall4: 'mh4_room_wall_4m',
      roomWall2: 'mh4_room_wall_2m',
      roomCornerIn: 'mh4_room_corner_in',
      roomCeiling: 'mh4_room_ceiling_2x2',
      roomFloor: 'mh_floor_2x2',
      roomPortal: 'mh4_room_portal_4m',
      enfiladeDoor: 'mh4_room_door_4m',
      enfiladeFrame: 'mh4_room_doorframe_4m',
      hallWall4: 'mh4_hall_wall_4m',
      hallWall2: 'mh4_hall_wall_2m',
      hallCornerIn: 'mh4_hall_corner_in',
      hallCeiling: 'mh4_hall_ceiling_2x2',
      hallSkylight: 'mh4_hall_skylight_2x2',
      hallFloor: 'mh4_hall_floor_2x2',
      hallPortal: 'mh4_hall_portal_4m',
      hallEntrance: 'mh4_hall_entrance_4m',
      hallPilaster: 'mh4_hall_pilaster',
      gate: 'mh4_ext_gate',
    },
  },
};
