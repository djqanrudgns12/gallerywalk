import type { TemplateId } from './look.ts';

/**
 * 템플릿마다의 공간 치수와 조각 이름(PLAN §4.2·§4.6·§13.1). 배치 엔진(`domain/layout`)이 읽는다.
 * 모든 템플릿이 함께 쓰는 규칙 수치는 `config.ts`, 템플릿마다 다른 것만 여기에.
 */
export interface TemplateGeometry {
  /** 액자 테 폭(m, §4.2 "템플릿마다") */
  readonly frameBorderM: number;
  /** 문 조각의 문틀 폭(맑은 폭 = 문 폭 − 2 × 문틀, tools/assets/spec/modules.md) */
  readonly doorCasingM: number;
  /**
   * 입구 홀(§4.6). PLAN은 10×8m 고정 묶음이지만 묶음 조각(P6)이 생기기 전까지는 2m 조각으로 세우므로
   * 회랑 4m 양옆이 2m 배수가 되게 12m(ADR-053).
   */
  readonly hall: { readonly w: number; readonly d: number };
  /** 첫 관의 회랑 쪽 시작 z(§4.6 z_0) */
  readonly firstPartZ: number;
  /** 회랑 끝 출구 벽 앞 공간(§4.6) */
  readonly exitSpaceM: number;
  /** 바닥·천장 조각 한 변 */
  readonly tileM: number;
  /**
   * 정문 조각 폭(맑은 열림은 문 조각과 같음). 홀 뒷벽에서 정문을 뺀 양옆이 조각 단위 배수여야 벽 조각이 정문을 덮지 않는다
   * (12m 홀에 2m 정문이면 양옆 5m — 2m 조각으로 채우면 6m가 되어 정문 절반을 막았다).
   */
  readonly entranceWidthM: number;
  /** 설비·사인 자리(근대 역사관 꾸밈, U-07 의견으로 맞춤) */
  readonly fixtures: {
    /** 벽에 붙는 글판·이름판·사인이 벽 면에서 떨어지는 거리 */
    readonly wallOffsetM: number;
    /** 빈 면 앞 벤치·화분이 벽에서 안쪽으로 들어온 거리 */
    readonly benchInwardM: number;
    readonly plantInwardM: number;
    /** 대표 벽 이름판: 가장 낮은 높이, 대표 벽 액자 위 끝과의 간격, 천장과의 여유 */
    readonly nameplate: {
      readonly minY: number;
      readonly gapAboveFramesM: number;
      readonly ceilingMarginM: number;
    };
    /** 홀 사인: 천장에서 내려온 거리(한가운데) */
    readonly hallSignDropM: number;
    /** 회랑 이름판 높이 */
    readonly corridorNameplateY: number;
    /** 출구 사인: 눈높이 위 */
    readonly exitSignLiftM: number;
    /** 이젤 명판: 받침 아래로 내린 높이·받침에서 앞으로 나온 거리 */
    readonly easelLabelDropM: number;
    readonly easelLabelOutM: number;
  };
  /** 정지 지점 연출(§4.7): 목표점 높이 보정과 화면 맞춤에 쓰는 바깥 크기 */
  readonly stops: {
    readonly introTargetLiftM: number;
    readonly introOuterHeightRatio: number;
    readonly hallTargetLiftM: number;
    readonly hallOuterHeightRatio: number;
    readonly exitOuterWidthRatio: number;
    readonly exitOuterHeightM: number;
  };
  /**
   * 미술관 외관(ADR-057): 광장(땅 높이 −rise) → 계단 → 기둥 현관(실내 바닥 높이 0) → 정문(홀 뒷벽 가운데).
   * 정면 날개 벽은 현관 양옆에서 관들이 놓인 폭보다 넓게 뻗어 광장에서 건물 뒤쪽이 보이지 않게 가린다.
   */
  readonly exterior: {
    /** 현관(포르티코) 폭·깊이 = 계단 폭 */
    readonly porticoW: number;
    readonly porticoD: number;
    /** 현관 앞 기둥 한가운데 x(대칭, 양수만)·현관 앞 끝에서 안쪽 거리·기둥 지름 */
    readonly columnXs: readonly number[];
    readonly columnInsetM: number;
    readonly columnDiameterM: number;
    /** 계단 단 수·한 단 높이·한 단 깊이 */
    readonly steps: number;
    readonly stepRiseM: number;
    readonly stepRunM: number;
    /** 광장 깊이(계단 아래 끝에서)·정면 반폭 하한·관 바깥 끝보다 더 뻗는 여유 */
    readonly plazaD: number;
    readonly minHalfW: number;
    readonly wingOverhangM: number;
    /** 날개 벽 끝에서 뒤(+Z)로 꺾여 들어가는 길이(옆에서 틈이 보이지 않게) */
    readonly wingReturnM: number;
    /** 현관 천장 높이(실내 바닥 기준) */
    readonly porticoCeilingY: number;
    /** 전시관 이름판 높이(실내 바닥 기준)·현관 앞 끝에서 바깥으로 나온 거리 */
    readonly signY: number;
    readonly signOutM: number;
    /** 처음 서는 자리: 계단 아래 끝에서 광장 쪽으로 */
    readonly spawnFromStairsM: number;
    /** 광장 가로등 간격·옆 끝에서 안쪽 거리, 나무가 광장 밖에 서는 간격·거리 */
    readonly lampSpacingM: number;
    readonly lampInsetM: number;
    readonly treeSpacingM: number;
    readonly treeOutM: number;
    /** 외관 정지 지점: 이름판 아래로 내린 목표점·화면에 맞출 바깥 크기 */
    readonly stopTargetDropM: number;
    readonly stopOuter: { readonly w: number; readonly h: number };
  };
  /** 걸을 때 피해 가는 설비 바닥 넓이(가로 × 깊이, 설비 앞 = 지역 +Z) */
  readonly footprints: Readonly<
    Record<'bench' | 'plant' | 'easel' | 'lamp' | 'tree', { w: number; d: number }>
  >;
  readonly modules: {
    readonly wall4: string;
    readonly wall2: string;
    readonly door: string;
    /** 회랑 쪽 문틀(두께 면 없음 — 방 쪽 문 조각의 두께 면과 겹쳐 깜빡이지 않게) */
    readonly corridorDoor: string;
    readonly cornerIn: string;
    readonly cornerOut: string;
    readonly floor: string;
    readonly ceiling: string;
    /** 정문(홀 뒷벽 가운데, 문 조각과 같은 자리 규칙). 폭은 `entranceWidthM` */
    readonly entrance: string;
    /** 외관: 현관 묶음(기단·기둥·엔타블러처·박공·현관 천장, 기준점 = 현관 앞 끝 가운데 바닥) */
    readonly portico: string;
    /** 계단 묶음(폭 = 현관 폭, 기준점 = 계단 위 끝 가운데) */
    readonly stairs: string;
    /** 정면 날개 벽 2m(기준점 = 땅 높이, 앞 = 광장 쪽) · 날개 끝 꺾임 */
    readonly facadeWall2: string;
    readonly facadeEnd: string;
    readonly plazaTile: string;
    readonly hedge2: string;
  };
}

export const templateGeometry: Readonly<Record<TemplateId, TemplateGeometry>> = {
  'modern-history': {
    frameBorderM: 0.07,
    doorCasingM: 0.1,
    hall: { w: 12, d: 8 },
    firstPartZ: 2,
    exitSpaceM: 4,
    tileM: 2,
    entranceWidthM: 4,
    fixtures: {
      wallOffsetM: 0.03,
      benchInwardM: 1.6,
      plantInwardM: 0.45,
      nameplate: { minY: 2.4, gapAboveFramesM: 0.35, ceilingMarginM: 0.55 },
      hallSignDropM: 0.75,
      corridorNameplateY: 2.2,
      exitSignLiftM: 0.7,
      easelLabelDropM: 0.12,
      easelLabelOutM: 0.14,
    },
    stops: {
      introTargetLiftM: 0.1,
      introOuterHeightRatio: 0.65,
      hallTargetLiftM: 0.5,
      hallOuterHeightRatio: 0.75,
      exitOuterWidthRatio: 0.8,
      exitOuterHeightM: 2.4,
    },
    exterior: {
      porticoW: 12,
      porticoD: 4,
      columnXs: [1.7, 3.6, 5.4],
      columnInsetM: 0.6,
      columnDiameterM: 0.7,
      steps: 8,
      stepRiseM: 0.15,
      stepRunM: 0.4,
      plazaD: 18,
      minHalfW: 14,
      wingOverhangM: 2,
      wingReturnM: 4,
      porticoCeilingY: 5.6,
      signY: 4.7,
      signOutM: 0.05,
      spawnFromStairsM: 9,
      lampSpacingM: 6,
      lampInsetM: 1.2,
      treeSpacingM: 5,
      treeOutM: 2.5,
      stopTargetDropM: 1.2,
      stopOuter: { w: 16, h: 8 },
    },
    footprints: {
      bench: { w: 1.6, d: 0.5 },
      plant: { w: 0.6, d: 0.6 },
      easel: { w: 1.1, d: 0.9 },
      lamp: { w: 0.4, d: 0.4 },
      tree: { w: 1.2, d: 1.2 },
    },
    modules: {
      wall4: 'mh_wall_4m',
      wall2: 'mh_wall_2m',
      door: 'mh_wall_door_2m',
      corridorDoor: 'mh_corridor_door_2m',
      cornerIn: 'mh_corner_in',
      cornerOut: 'mh_corner_out',
      floor: 'mh_floor_2x2',
      ceiling: 'mh_ceiling_2x2',
      entrance: 'mh_entrance_4m',
      portico: 'mh_ext_portico_12m',
      stairs: 'mh_ext_stairs_12m',
      facadeWall2: 'mh_ext_wall_2m',
      facadeEnd: 'mh_ext_wall_end',
      plazaTile: 'mh_ext_plaza_2x2',
      hedge2: 'mh_ext_hedge_2m',
    },
  },
};
