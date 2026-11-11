import type { LayoutModule } from '../../types/layout.ts';
import type { TemplateGeometry } from '../templates/geometry.ts';
import { add, mul, type P2, type Rect, type WallRun, wallRun } from './geom.ts';

/**
 * 조각 놓기(PLAN §6.2): 벽은 4m 조각을 먼저 채우고 남는 2m. 안쪽 모서리 덮개는 벽 줄의 시작점에.
 * 조각 기준점은 벽 시작 쪽 바닥(tools/assets/spec/modules.md §1), `rotY`는 지역 +X를 벽 방향으로.
 */

type Out = LayoutModule[];

const put = (out: Out, type: string, partId: string | null, p: P2, rotY: number): void => {
  out.push({ type, partId, pos: [p[0], 0, p[1]], rotY });
};

/** 벽 줄 하나를 같은 길이 조각들로 채운다(길이는 2m 배수). */
export const fillWall = (out: Out, run: WallRun, g: TemplateGeometry, partId: string | null): void => {
  const unit = g.tileM;
  let along = 0;
  let left = Math.round(run.length / unit) * unit;
  // 배수가 아니면 반올림한 조각이 이웃(문·모서리)을 덮거나 건물 밖으로 나간다 — 조용히 넘기지 않는다
  if (Math.abs(left - run.length) > 1e-6)
    throw new Error(`fillWall: 벽 길이 ${run.length}m가 조각 단위 ${unit}m의 배수가 아님`);
  while (left > 1e-6) {
    const four = left >= 2 * unit - 1e-6;
    put(
      out,
      four ? g.modules.wall4 : g.modules.wall2,
      partId,
      add(run.origin, mul(run.dir, along)),
      run.rotY,
    );
    const len = four ? 2 * unit : unit;
    along += len;
    left -= len;
  }
};

/** 한 조각(문 등)을 줄 시작점에 */
export const single = (out: Out, run: WallRun, type: string, partId: string | null): void =>
  put(out, type, partId, run.origin, run.rotY);

/** 안쪽 모서리 덮개: 벽 줄 시작점, 그 줄의 방향으로 */
export const cornerIn = (out: Out, run: WallRun, g: TemplateGeometry, partId: string | null): void =>
  put(out, g.modules.cornerIn, partId, run.origin, run.rotY);

/**
 * 바깥 모서리 덮개(spec §2 `mh_corner_out`): 지역에서 벽 A가 +X로 와서 모서리에서 끝나고(방 안쪽 +Z),
 * 벽 B가 모서리에서 −Z로 뻗는다(방 안쪽 +X). `arriving`은 모서리로 들어오는 벽 A의 방향과 방 안쪽.
 */
export const cornerOut = (
  out: Out,
  corner: P2,
  arrivingDir: P2,
  arrivingInterior: P2,
  g: TemplateGeometry,
): void => {
  const run = wallRun(add(corner, mul(arrivingDir, -1)), corner, arrivingInterior);
  put(out, g.modules.cornerOut, null, corner, run.rotY);
};

/** 바닥·천장 판을 사각형 위에 한 변 `tileM`로 깐다(판의 지역 바닥 = x·z 모두 0..tile). */
export const tiles = (out: Out, rect: Rect, type: string, partId: string | null, tile: number): void => {
  const nx = Math.round((rect.max[0] - rect.min[0]) / tile);
  const nz = Math.round((rect.max[1] - rect.min[1]) / tile);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) put(out, type, partId, [rect.min[0] + i * tile, rect.min[1] + j * tile], 0);
};
