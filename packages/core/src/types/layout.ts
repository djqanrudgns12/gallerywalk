import { z } from 'zod';
import type { TemplateId } from '../domain/templates/look.ts';
import type { ArtworkForm, ArtworkKind } from './common.ts';
import { TemplateIdSchema, UuidSchema } from './common.ts';

/**
 * 배치 엔진의 계약(PLAN §4.1). `computeLayout(input) → Layout`은 순수 함수이고, 같은 입력이면 같은 출력·같은 해시다(§4.10).
 * 좌표는 three 세계 좌표(m, Y 위). 바닥 평면 값은 `[x, z]`. 모든 수는 1mm로 반올림되어 있다.
 *
 * PLAN §4.1과 다른 점(ADR-052): 정지 지점의 위치 표시는 문자열 대신 `partId`·`index`·`count`로 둔다 —
 * 화면 문구는 `copy/ko.ts`에서만 만들기 때문이다. 같은 이유로 관 이름(`{이름판} · 1관`)도 배치에 넣지 않는다
 * (전시실 이름만 바꿔도 배치 해시가 바뀌지 않음).
 */

export interface LayoutInput {
  /** 시드(꾸밈 난수, §4.10) */
  readonly exhibitionId: string;
  readonly templateId: TemplateId;
  readonly rooms: readonly {
    readonly id: string;
    readonly order: number;
    readonly hasBgm: boolean;
  }[];
  /** 게시된 것만(숨김·삭제·처리 중 제외) */
  readonly artworks: readonly {
    readonly id: string;
    readonly roomId: string;
    readonly order: number;
    readonly kind: ArtworkKind;
    readonly form: ArtworkForm;
    readonly featured: boolean;
    readonly textHeavy: boolean;
    /** 형태 기준 크기를 정하는 원본 화소(글·소리는 0×0) */
    readonly pixel: { readonly w: number; readonly h: number };
    readonly pageCount: number | null;
  }[];
  readonly algoVersion: number;
}

/** 바닥 평면 `[x, z]` */
export const Vec2Schema = z.tuple([z.number(), z.number()]);
export type Vec2 = z.infer<typeof Vec2Schema>;
export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type LayoutVec3 = z.infer<typeof Vec3Schema>;

const SizeSchema = z.object({ w: z.number().positive(), h: z.number().positive() });
const BoundsSchema = z.object({ min: Vec2Schema, max: Vec2Schema });

/** 논리 벽(§4.4): N 들어온 벽 · F 대표 벽 · L 첫 옆벽 · R 둘째 옆벽 */
export const WallSideSchema = z.enum(['N', 'F', 'L', 'R']);
export type WallSide = z.infer<typeof WallSideSchema>;

export const PartSizeSchema = z.enum(['S', 'M', 'L']);
export type PartSize = z.infer<typeof PartSizeSchema>;

export const PartSchema = z.object({
  /** `{roomId}:{partIndex}` */
  partId: z.string().min(1),
  roomId: UuidSchema,
  partIndex: z.number().int().nonnegative(),
  partCount: z.number().int().positive(),
  size: PartSizeSchema,
  /** 논리 치수: 폭 W(L → R), 깊이 D(N → F) */
  width: z.number().positive(),
  depth: z.number().positive(),
  /**
   * 논리 (x, y) → 세계 `[X, Z]` = origin + x·ax + y·ay. 회랑 왼쪽 관은 거울상이라 ax·ay가 왼손 좌표계(§4.6).
   * 템플릿 문법이 달라도(v1.1) 같은 모양으로 낸다.
   */
  frame: z.object({ origin: Vec2Schema, ax: Vec2Schema, ay: Vec2Schema }),
  bounds: BoundsSchema,
  doors: z.array(
    z.object({
      kind: z.enum(['IN', 'OUT']),
      /** 문 열림 한가운데(바닥 높이) */
      center: Vec3Schema,
      /** 방 안쪽을 가리키는 단위 법선 */
      normal: Vec2Schema,
      width: z.number().positive(),
    }),
  ),
  walls: z.array(
    z.object({
      side: WallSideSchema,
      start: Vec2Schema,
      end: Vec2Schema,
      /** 방 안쪽을 가리키는 단위 법선 */
      normal: Vec2Schema,
    }),
  ),
});
export type Part = z.infer<typeof PartSchema>;

export const ModulePlacementSchema = z.object({
  /** 템플릿 조각 이름(`mh_wall_4m` 등, tools/assets/spec/modules.md) */
  type: z.string().min(1),
  /** 관에 딸린 조각이면 그 관(그리는 범위 §6.6), 홀·회랑이면 null */
  partId: z.string().nullable(),
  pos: Vec3Schema,
  rotY: z.number(),
  /** 바닥 판처럼 관 크기로 늘리는 조각만(§13.1) */
  scale: Vec3Schema.optional(),
});
export type LayoutModule = z.infer<typeof ModulePlacementSchema>;

export const FramePlacementSchema = z.object({
  artworkId: UuidSchema,
  partId: z.string(),
  /** 벽에 걸림 · 방 가운데 이젤에 놓임(ADR-057) */
  mount: z.enum(['WALL', 'EASEL']),
  /** 걸린 논리 벽(이젤이면 null) */
  wall: WallSideSchema.nullable(),
  /** 액자 바깥 사각형 한가운데(벽 면 위, 이젤이면 이젤 받침 위) */
  center: Vec3Schema,
  normal: Vec2Schema,
  art: SizeSchema,
  mat: z.object({ w: z.number().nonnegative() }),
  outer: SizeSchema,
  featured: z.boolean(),
});
export type FramePlacement = z.infer<typeof FramePlacementSchema>;

export const LabelPlacementSchema = z.object({
  artworkId: UuidSchema,
  pos: Vec3Schema,
  normal: Vec2Schema,
});

export const FixtureSchema = z.object({
  kind: z.enum([
    'nameplate',
    'introPanel',
    'bench',
    'plant',
    'soundPlaque',
    /** 회랑 벽의 다음 전시실 이름판(§4.6) */
    'corridorNameplate',
    'hallSign',
    'exitSign',
    /** 이젤(바닥, 앞 = 액자 앞) · 정면 "{전시명} 전시관" 이름판 · 광장 가로등·나무(ADR-057) */
    'easel',
    'facadeSign',
    'lamp',
    'tree',
  ]),
  partId: z.string().nullable(),
  pos: Vec3Schema,
  rotY: z.number(),
  /** 무엇을 보이는가: 작품 ID(소리 명판) · 관 ID(이름판) */
  ref: z.string().optional(),
});
export type Fixture = z.infer<typeof FixtureSchema>;

export const StopSchema = z.object({
  id: z.string().min(1),
  /** `exterior` = 광장에서 미술관 정면(첫 정지 지점, ADR-057) */
  kind: z.enum(['exterior', 'hall', 'roomIntro', 'artwork', 'exit']),
  partId: z.string().nullable(),
  artworkId: UuidSchema.nullable(),
  /** 작품 정지 지점: 관 안 번호(1부터)·관 작품 수. 그 밖에는 null */
  index: z.number().int().positive().nullable(),
  count: z.number().int().positive().nullable(),
  /** 카메라 위치는 저장하지 않는다 — 기기가 화면 비율로 계산(§4.7 `framing.ts`) */
  anchor: z.object({
    target: Vec3Schema,
    normal: Vec2Schema,
    outer: SizeSchema,
    /** 벽 법선 방향으로 물러설 수 있는 거리(맞은편 벽까지 − 여유) */
    maxDistance: z.number().positive(),
    /** 카메라가 서는 바닥 높이(실내 0, 광장 −계단 높이) */
    floorY: z.number(),
  }),
});
export type Stop = z.infer<typeof StopSchema>;

export const LegSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** 관 사이 꺾은선(§4.8). 같은 관 안은 빈 배열 = 직선 */
  waypoints: z.array(Vec3Schema),
});

export const LayoutMapSchema = z.object({
  /** 홀·회랑 윤곽(다각형 여러 개) */
  outline: z.array(z.array(Vec2Schema).min(3)),
  parts: z.array(z.object({ partId: z.string(), polygon: z.array(Vec2Schema).min(3), labelPos: Vec2Schema })),
  doors: z.array(z.object({ pos: Vec2Schema, normal: Vec2Schema, width: z.number().positive() })),
  bounds: BoundsSchema,
});

/**
 * 걸을 수 있는 곳(ADR-057 자유 관람): 캐릭터 한가운데가 있을 수 있는 사각형들(벽에서 `WALKABLE_WALL_MARGIN_M` 안쪽)과
 * 피해 갈 설비 바닥(같은 여유만큼 넓힘). 계단은 축 방향으로 높이가 변하는 사각형. 겹친 곳의 바닥은 가장 높은 값.
 */
export const WalkAreaSchema = z.object({
  min: Vec2Schema,
  max: Vec2Schema,
  y: z.number(),
  /** 천장 높이(실내·현관). 광장·계단은 하늘(없음) — 따라가는 카메라가 천장을 뚫지 않게 */
  ceiling: z.number().optional(),
  /** 축을 따라 `from`(y0) → `to`(y1)로 높이가 변함. `steps`면 계단: 위 끝(`to`)에서부터 같은 깊이의 디딤판 `steps`개(발 높이 `footFloorAt`) */
  slope: z
    .object({
      axis: z.enum(['x', 'z']),
      from: z.number(),
      to: z.number(),
      y0: z.number(),
      y1: z.number(),
      steps: z.number().int().positive().optional(),
    })
    .optional(),
});
export type WalkArea = z.infer<typeof WalkAreaSchema>;

export const WalkSchema = z.object({
  areas: z.array(WalkAreaSchema).min(1),
  /** `tall` = 카메라도 피해야 하는 키 큰 설비(이젤·화분·기둥·가로등·나무). 벤치는 낮음 */
  obstacles: z.array(z.object({ min: Vec2Schema, max: Vec2Schema, tall: z.boolean() })),
  /** 처음 서는 자리(광장)와 바라보는 방향(0 = +Z) */
  spawn: z.object({ pos: Vec3Schema, yaw: z.number() }),
});
export type Walk = z.infer<typeof WalkSchema>;

/** 외관 바닥·하늘을 그리는 데 필요한 것만(조각은 `modules`) */
export const ExteriorSchema = z.object({
  groundY: z.number(),
  plaza: BoundsSchema,
  /** 정면 날개 벽 바깥 면 z·반폭 */
  facadeZ: z.number(),
  halfWidth: z.number().positive(),
});
export type Exterior = z.infer<typeof ExteriorSchema>;

export const LayoutSchema = z.object({
  /** 2 = 이젤·외관·걷기 영역(ADR-057) */
  schemaVersion: z.literal(2),
  algoVersion: z.number().int().positive(),
  templateId: TemplateIdSchema,
  /** 정규 JSON의 SHA-256 앞 16자(§4.10) */
  hash: z.string().regex(/^[0-9a-f]{16}$/),
  units: z.literal('m'),
  parts: z.array(PartSchema),
  modules: z.array(ModulePlacementSchema),
  frames: z.array(FramePlacementSchema),
  labels: z.array(LabelPlacementSchema),
  fixtures: z.array(FixtureSchema),
  stops: z.array(StopSchema).min(2),
  legs: z.array(LegSchema),
  map: LayoutMapSchema,
  walk: WalkSchema,
  exterior: ExteriorSchema,
});
export type Layout = z.infer<typeof LayoutSchema>;
