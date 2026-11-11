import { config } from '../../../config.ts';
import type { Fixture, LayoutModule } from '../../../types/layout.ts';
import type { TemplateGeometry } from '../../templates/geometry.ts';
import { type Frame2, type P2, type Rect, rectOf, rectPolygon, wallRun } from '../geom.ts';
import { cornerIn, cornerOut, fillWall, single, tiles } from '../modules.ts';
import { type DoorPoints, facing, type P3, type StopAnchor } from '../part.ts';

/**
 * 근대 역사관 문법(PLAN §4.6): 입구 홀(z < 0) → 회랑(중심선 x = 0, +Z로) 양옆에 관을 번갈아(짝수 = 오른쪽 +X, 홀수 = 왼쪽 −X)
 * → 회랑 끝 출구 벽. 관의 N 벽 안쪽 면은 회랑 벽 면에서 벽 두께만큼 뒤(문 조각의 두께 면이 맞도록, ADR-053).
 */

export interface PartSlot {
  readonly side: 'RIGHT' | 'LEFT';
  /** 회랑 쪽 시작 z(관의 L 쪽 끝) */
  readonly z0: number;
  readonly frame: Frame2;
}

/** 관 폭(논리 W, 회랑을 따라 놓이는 길이) 목록 → 회랑 쪽 자리와 회랑 길이 */
export const placeParts = (
  widths: readonly number[],
  g: TemplateGeometry,
): { slots: PartSlot[]; corridorLength: number } => {
  const c = config();
  const half = c.CORRIDOR_WIDTH_M / 2;
  const face = half + c.WALL_THICKNESS_M;
  const end = { RIGHT: Number.NEGATIVE_INFINITY, LEFT: Number.NEGATIVE_INFINITY };
  const slots: PartSlot[] = [];
  let prev = Number.NEGATIVE_INFINITY;
  widths.forEach((w, i) => {
    const side = i % 2 === 0 ? 'RIGHT' : 'LEFT';
    const z0 =
      i === 0 ? g.firstPartZ : Math.max(g.firstPartZ, end[side] + c.PART_GAP_M, prev + c.PART_STAGGER_M);
    end[side] = z0 + w;
    prev = z0;
    // 논리 x(L → R) = 회랑 하류(+Z), 논리 y(N → F) = 회랑에서 멀어지는 쪽
    const frame: Frame2 =
      side === 'RIGHT'
        ? { origin: [face, z0], ax: [0, 1], ay: [1, 0] }
        : { origin: [-face, z0], ax: [0, 1], ay: [-1, 0] };
    slots.push({ side, z0, frame });
  });
  const unit = c.MODULE_UNIT_M;
  const far = Math.max(end.RIGHT, end.LEFT, g.firstPartZ);
  const corridorLength = Math.ceil((far + g.exitSpaceM) / unit - 1e-9) * unit;
  return { slots, corridorLength };
};

export interface Shell {
  readonly modules: LayoutModule[];
  readonly fixtures: Fixture[];
  readonly hallRect: Rect;
  readonly corridorRect: Rect;
  readonly hallStop: StopAnchor;
  readonly exitStop: StopAnchor;
  /** 홀 → 회랑 열림(지도·걸을 수 있는 영역) */
  readonly opening: { readonly pos: P2; readonly normal: P2; readonly width: number };
  /** 정문(홀 뒷벽 가운데, ADR-057): 지도·걸을 수 있는 영역과 경로점 */
  readonly entrance: { readonly pos: P2; readonly normal: P2; readonly width: number };
  readonly entranceDoor: DoorPoints;
}

interface DoorCell {
  readonly side: 'RIGHT' | 'LEFT';
  /** 2m 칸의 시작 z */
  readonly z: number;
}

/** 홀·회랑·출구 벽·회랑 쪽 문틀·관 이름판(회랑) */
export const buildShell = (
  slots: readonly { slot: PartSlot; width: number; partId: string }[],
  corridorLength: number,
  g: TemplateGeometry,
): Shell => {
  const c = config();
  const modules: LayoutModule[] = [];
  const fixtures: Fixture[] = [];
  const half = c.CORRIDOR_WIDTH_M / 2;
  const unit = c.MODULE_UNIT_M;
  const len = corridorLength;
  const hw = g.hall.w / 2;
  const hd = g.hall.d;

  // ── 입구 홀 ────────────────────────────────────────────────
  const hallRect = rectOf([-hw, -hd], [hw, 0]);
  const back = wallRun([-hw, -hd], [hw, -hd], [0, 1]);
  const right = wallRun([hw, -hd], [hw, 0], [-1, 0]);
  const front = wallRun([hw, 0], [-hw, 0], [0, -1]);
  const left = wallRun([-hw, 0], [-hw, -hd], [1, 0]);
  for (const run of [back, right, front, left]) cornerIn(modules, run, g, null);
  for (const run of [right, left]) fillWall(modules, run, g, null);
  // 뒷벽 가운데 = 정문(바깥 = 미술관 현관, ADR-057)
  const door = g.entranceWidthM / 2;
  fillWall(modules, wallRun([-hw, -hd], [-door, -hd], [0, 1]), g, null);
  single(modules, wallRun([-door, -hd], [door, -hd], [0, 1]), g.modules.entrance, null);
  fillWall(modules, wallRun([door, -hd], [hw, -hd], [0, 1]), g, null);
  // 앞벽은 회랑 폭만큼 열려 있다
  fillWall(modules, wallRun([hw, 0], [half, 0], [0, -1]), g, null);
  fillWall(modules, wallRun([-half, 0], [-hw, 0], [0, -1]), g, null);
  // 홀 앞벽과 회랑 벽이 만나는 볼록 모서리
  cornerOut(modules, [half, 0], [-1, 0], [0, -1], g);
  cornerOut(modules, [-half, 0], [0, -1], [1, 0], g);
  tiles(modules, hallRect, g.modules.floor, null, g.tileM);
  tiles(modules, hallRect, g.modules.ceiling, null, g.tileM);
  fixtures.push({
    kind: 'hallSign',
    partId: null,
    pos: [0, c.WALL_HEIGHT_M - g.fixtures.hallSignDropM, 0],
    rotY: facing([0, -1]),
  });

  // ── 회랑 벽(2m 칸): 관 문 자리는 회랑 쪽 문틀, 나머지는 벽 ─────────
  const corridorRect = rectOf([-half, 0], [half, len]);
  tiles(modules, corridorRect, g.modules.floor, null, g.tileM);
  tiles(modules, corridorRect, g.modules.ceiling, null, g.tileM);
  const doorCells: DoorCell[] = [];
  for (const { slot, width } of slots) {
    doorCells.push({ side: slot.side, z: slot.z0 });
    doorCells.push({ side: slot.side, z: slot.z0 + width - c.DOOR_WIDTH_M });
  }
  for (const side of ['RIGHT', 'LEFT'] as const) {
    const x = side === 'RIGHT' ? half : -half;
    const interior: P2 = side === 'RIGHT' ? [-1, 0] : [1, 0];
    const isDoor = (z: number): boolean => doorCells.some(d => d.side === side && Math.abs(d.z - z) < 1e-6);
    let runStart: number | null = null;
    const flush = (zEnd: number): void => {
      if (runStart !== null && zEnd > runStart)
        fillWall(modules, wallRun([x, runStart], [x, zEnd], interior), g, null);
      runStart = null;
    };
    for (let z = 0; z < len - 1e-6; z += unit) {
      if (isDoor(z)) {
        flush(z);
        single(modules, wallRun([x, z], [x, z + unit], interior), g.modules.corridorDoor, null);
      } else if (runStart === null) runStart = z;
    }
    flush(len);
  }
  // 관 이름판: 들어가는 문 바로 하류의 회랑 벽(멀리서도 다음 전시실이 보이게, §4.6)
  for (const { slot, partId } of slots) {
    const off = g.fixtures.wallOffsetM;
    const x = slot.side === 'RIGHT' ? half - off : -half + off;
    const n: P2 = slot.side === 'RIGHT' ? [-1, 0] : [1, 0];
    fixtures.push({
      kind: 'corridorNameplate',
      partId,
      pos: [x, g.fixtures.corridorNameplateY, slot.z0 + c.DOOR_WIDTH_M + 1],
      rotY: facing(n),
      ref: partId,
    });
  }

  // ── 출구 벽 ────────────────────────────────────────────────
  const exit = wallRun([half, len], [-half, len], [0, -1]);
  cornerIn(modules, exit, g, null);
  cornerIn(modules, wallRun([-half, len], [-half, 0], [1, 0]), g, null);
  fillWall(modules, exit, g, null);
  const exitSignY = c.EYE_HEIGHT_M + g.fixtures.exitSignLiftM;
  fixtures.push({
    kind: 'exitSign',
    partId: null,
    pos: [0, exitSignY, len - g.fixtures.wallOffsetM],
    rotY: facing([0, -1]),
  });

  // ── 정지 지점(홀·출구) ─────────────────────────────────────
  const hallCamZ = -hd + c.HALL_STOP_INSIDE_M;
  const hallTarget: P3 = [0, c.EYE_HEIGHT_M + g.stops.hallTargetLiftM, 0];
  const hallStop: StopAnchor = {
    target: hallTarget,
    normal: [0, -1],
    outer: { w: c.CORRIDOR_WIDTH_M, h: c.WALL_HEIGHT_M * g.stops.hallOuterHeightRatio },
    maxDistance: -hallCamZ,
    floorY: 0,
  };
  const exitStop: StopAnchor = {
    target: [0, exitSignY, len],
    normal: [0, -1],
    outer: { w: c.CORRIDOR_WIDTH_M * g.stops.exitOuterWidthRatio, h: g.stops.exitOuterHeightM },
    maxDistance: Math.min(len, g.exitSpaceM + unit) - c.CAMERA_WALL_CLEARANCE_M,
    floorY: 0,
  };

  return {
    modules,
    fixtures,
    hallRect,
    corridorRect,
    hallStop,
    exitStop,
    opening: { pos: [0, 0], normal: [0, 1], width: c.CORRIDOR_WIDTH_M },
    entrance: {
      pos: [0, -hd - c.WALL_THICKNESS_M / 2],
      normal: [0, 1],
      width: c.DOOR_WIDTH_M - 2 * g.doorCasingM,
    },
    entranceDoor: {
      inner: [0, -hd + c.DOOR_PATH_OFFSET_M],
      center: [0, -hd - c.WALL_THICKNESS_M / 2],
      outer: [0, -hd - c.WALL_THICKNESS_M - c.DOOR_PATH_OFFSET_M],
    },
  };
};

export const outlineOf = (shell: Shell): P2[][] => [
  rectPolygon(shell.hallRect),
  rectPolygon(shell.corridorRect),
];
