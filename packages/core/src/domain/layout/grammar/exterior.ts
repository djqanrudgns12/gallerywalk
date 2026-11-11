import { config } from '../../../config.ts';
import type { Exterior, Fixture, LayoutModule, WalkArea } from '../../../types/layout.ts';
import type { TemplateGeometry } from '../../templates/geometry.ts';
import type { P2, Rect } from '../geom.ts';
import { rectOf } from '../geom.ts';
import { facing, type P3, type StopAnchor } from '../part.ts';

/**
 * 미술관 외관(ADR-057): 광장 → 계단 → 기둥 현관 → 정문(홀 뒷벽 가운데). 실내 바닥은 y = 0, 광장 땅은 y = −(계단 높이).
 *
 * ```
 *   z ↑ (+Z = 건물 안쪽)
 *   zf ─────────── 홀 뒷벽 바깥 면 = 정면 날개 벽 앞면 ───────────
 *        날개 벽 │ 현관(y 0) │ 날개 벽          광장 옆 띠(y −rise)
 *   zPF ─────────┼───────────┼─────────
 *               │ 계단(경사) │
 *   zSB ─────────┴───────────┴───────── 광장(y −rise), 처음 서는 자리
 * ```
 * 날개 벽은 관들이 놓인 x 범위보다 넓게 뻗고 높이가 실내 벽보다 높아, 광장에서 건물 뒤쪽(관 바깥 면 — 조각이 없는 면)이
 * 보이지 않는다. 광장 둘레는 산울타리(뒤 가운데만 트임 — 꾸밈, 걸을 수 없음).
 */

export interface ExteriorBuilt {
  readonly modules: LayoutModule[];
  readonly fixtures: Fixture[];
  readonly areas: WalkArea[];
  /** 기둥(설비 바닥은 computeLayout이 설비에서 함께 만든다) */
  readonly obstacles: Rect[];
  readonly spawn: { readonly pos: P3; readonly yaw: number };
  readonly stop: StopAnchor;
  /** 광장 → 현관 경로점(바닥 높이 + 카메라 높이). 정문 경로점은 홀 쪽에서 붙인다 */
  readonly approach: P3[];
  readonly exterior: Exterior;
}

const ceilTo = (v: number, u: number): number => Math.ceil(v / u - 1e-9) * u;

export const buildExterior = (
  g: TemplateGeometry,
  /** 홀 뒷벽 안쪽 면 z(= −홀 깊이) */
  hallBackZ: number,
  /** 관·회랑·홀이 차지하는 |x| 최대 */
  buildingHalfX: number,
): ExteriorBuilt => {
  const c = config();
  const e = g.exterior;
  const unit = c.MODULE_UNIT_M;
  const m = c.WALKABLE_WALL_MARGIN_M;
  const cam = c.CAMERA_HEIGHT_M;
  const modules: LayoutModule[] = [];
  const fixtures: Fixture[] = [];
  const put = (type: string, x: number, y: number, z: number, rotY: number): void => {
    modules.push({ type, partId: null, pos: [x, y, z], rotY });
  };

  const zf = hallBackZ - c.WALL_THICKNESS_M;
  const ph = e.porticoW / 2;
  const zPF = zf - e.porticoD;
  const rise = e.steps * e.stepRiseM;
  const run = e.steps * e.stepRunM;
  const zSB = zPF - run;
  const groundY = -rise;
  const halfW = Math.max(e.minHalfW, ceilTo(buildingHalfX + e.wingOverhangM, unit));
  // 광장 뒤 끝: 정면에서 바닥 판 배수가 되게(판 줄이 정면과 맞물림)
  const zBack = zf - ceilTo(zf - (zSB - e.plazaD), g.tileM);
  const toPlaza = facing([0, -1]);

  // ── 현관·계단 묶음(한가운데) ─────────────────────────────────
  put(g.modules.portico, 0, 0, zPF, toPlaza);
  put(g.modules.stairs, 0, 0, zPF, toPlaza);

  // ── 정면 날개 벽: 현관 양옆 → 반폭까지 2m 조각, 끝에서 뒤로 꺾임 ──────
  // 벽 조각 기준점 = 벽 시작 쪽 바닥, 지역 +X = 벽 방향, 지역 +Z = 앞(광장). 앞이 −Z이면 지역 +X = 세계 −X.
  for (let x = halfW; x > ph + 1e-6; x -= unit) put(g.modules.facadeWall2, x, groundY, zf, toPlaza);
  for (let x = -ph; x > -halfW + 1e-6; x -= unit) put(g.modules.facadeWall2, x, groundY, zf, toPlaza);
  for (const side of [1, -1] as const) {
    const out: P2 = [side, 0];
    put(g.modules.facadeEnd, side * halfW, groundY, zf, facing(out));
    // 꺾인 벽: 앞 = 바깥(±X). 앞이 +X이면 지역 +X = 세계 −Z, 앞이 −X이면 지역 +X = 세계 +Z
    for (let d = 0; d < e.wingReturnM - 1e-6; d += unit) {
      const z = side === 1 ? zf + d + unit : zf + d;
      put(g.modules.facadeWall2, side * halfW, groundY, z, facing(out));
    }
  }

  // ── 광장 바닥·산울타리 ───────────────────────────────────────
  const plaza = rectOf([-halfW, zBack], [halfW, zf]);
  for (let x = -halfW; x < halfW - 1e-6; x += g.tileM)
    for (let z = zBack; z < zf - 1e-6; z += g.tileM) put(g.modules.plazaTile, x, groundY, z, 0);
  // 옆: 앞 = 광장 안쪽(앞이 −X이면 지역 +X = 세계 +Z, 앞이 +X이면 세계 −Z). 뒤: 가운데 4m만 트임
  for (let z = zBack; z < zf - 1e-6; z += unit) {
    put(g.modules.hedge2, halfW, groundY, z, facing([-1, 0]));
    put(g.modules.hedge2, -halfW, groundY, z + unit, facing([1, 0]));
  }
  const gap = unit;
  for (let x = halfW; x > gap + 1e-6; x -= unit)
    put(g.modules.hedge2, x - unit, groundY, zBack, facing([0, 1]));
  for (let x = -gap; x > -halfW + 1e-6; x -= unit)
    put(g.modules.hedge2, x - unit, groundY, zBack, facing([0, 1]));

  // ── 이름판·가로등·나무 ──────────────────────────────────────
  fixtures.push({ kind: 'facadeSign', partId: null, pos: [0, e.signY, zPF - e.signOutM], rotY: toPlaza });
  const lampX = halfW - e.lampInsetM;
  for (let z = zSB - e.lampSpacingM / 2; z > zBack + e.lampInsetM; z -= e.lampSpacingM)
    for (const x of [lampX, -lampX])
      fixtures.push({ kind: 'lamp', partId: null, pos: [x, groundY, z], rotY: 0 });
  const treeX = halfW + e.treeOutM;
  for (let z = zf - e.treeSpacingM / 2; z > zBack - e.treeOutM; z -= e.treeSpacingM)
    for (const x of [treeX, -treeX])
      fixtures.push({ kind: 'tree', partId: null, pos: [x, groundY, z], rotY: 0 });
  for (let x = -halfW + e.treeSpacingM / 2; x < halfW; x += e.treeSpacingM)
    if (Math.abs(x) > gap + e.treeOutM)
      fixtures.push({ kind: 'tree', partId: null, pos: [x, groundY, zBack - e.treeOutM], rotY: 0 });

  // ── 걸을 수 있는 곳(캐릭터 한가운데) ─────────────────────────────
  const overlap = 0.05;
  const areas: WalkArea[] = [
    // 광장(계단 아래 끝까지 전체 폭)
    { min: [-halfW + m, zBack + m], max: [halfW - m, zSB + overlap], y: groundY },
    // 광장 옆 띠(현관·계단 기단 옆)
    { min: [ph + m, zSB - overlap], max: [halfW - m, zf - m], y: groundY },
    { min: [-halfW + m, zSB - overlap], max: [-ph - m, zf - m], y: groundY },
    // 계단: z가 zSB → zPF로 갈 때 y가 −rise → 0(카메라는 경사, 발은 디딤판 — 계단 조각과 같은 단 수·깊이)
    {
      min: [-ph + m, zSB - overlap],
      max: [ph - m, zPF + overlap],
      y: groundY,
      slope: { axis: 'z', from: zSB, to: zPF, y0: groundY, y1: 0, steps: e.steps },
    },
    // 현관(정문 앞까지)
    { min: [-ph + m, zPF - overlap], max: [ph - m, zf - m], y: 0, ceiling: e.porticoCeilingY },
  ];
  const r = e.columnDiameterM / 2 + m;
  const cz = zPF + e.columnInsetM;
  const obstacles: Rect[] = e.columnXs.flatMap(x => [
    rectOf([x - r, cz - r], [x + r, cz + r]),
    rectOf([-x - r, cz - r], [-x + r, cz + r]),
  ]);

  // ── 처음 서는 자리·외관 정지 지점·현관까지 경로 ──────────────────────
  const spawnZ = zSB - e.spawnFromStairsM;
  const spawn = { pos: [0, groundY, spawnZ] as P3, yaw: 0 };
  const stop: StopAnchor = {
    target: [0, e.signY - e.stopTargetDropM, zPF],
    normal: [0, -1],
    outer: e.stopOuter,
    maxDistance: zPF - (zBack + m) - c.CAMERA_WALL_CLEARANCE_M,
    floorY: groundY,
  };
  const approach: P3[] = [
    [0, groundY + cam, zSB - c.DOOR_PATH_OFFSET_M],
    [0, groundY + cam, zSB],
    [0, cam, zPF],
    [0, cam, zPF + e.columnInsetM + r],
  ];
  return {
    modules,
    fixtures,
    areas,
    obstacles,
    spawn,
    stop,
    approach,
    exterior: { groundY, plaza: { min: plaza.min, max: plaza.max }, facadeZ: zf, halfWidth: halfW },
  };
};
