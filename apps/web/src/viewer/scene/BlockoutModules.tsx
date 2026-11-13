import { config } from '@gallery/core/config';
import { templateGeometryV4, type TemplateLook } from '@gallery/core/templates';
import { useEffect, useMemo } from 'react';
import { BoxGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { ModulePlacement } from './TemplateModules.tsx';

/**
 * 공간 v4(ADR-071) 임시 회색 모형: 배치가 낸 `mh4_*` 조각 가운데 아직 구운 파일이 없는 것을 상자로 세운다(M2-4).
 * 구운 조각(M3, `tools/assets/spec/modules-v4.md`)이 들어오면 그 이름은 `modules`에 있어 여기서 빠진다.
 * 운영 배치 판은 M3 조각이 예산을 통과한 뒤에만 4로 올리므로(ADR-071 결정 1) 운영 화면에는 나오지 않는다.
 * 치수는 `config().LAYOUT_V4`·`geometryV4`에서, 색은 분위기(`look`)에서 온다. 조각 하나 = 상자 몇 개 = 인스턴스 묶음 하나씩.
 */

type Box = readonly [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number];
type Tone = 'room' | 'hall' | 'stone' | 'floor' | 'light';

/** 조각 지역 좌표(기준점·방향은 modules.md §1: 벽은 +X로 뻗고 방 안쪽이 +Z, 판은 x·z 0..2) */
const shapes = (): Readonly<Record<string, { tone: Tone; boxes: readonly Box[] }>> => {
  const c = config();
  const v = c.LAYOUT_V4;
  const g = templateGeometryV4['modern-history'];
  const e = g.base.exterior;
  const t = c.WALL_THICKNESS_M;
  const tile = c.MODULE_UNIT_M;
  const plate = t / 6;
  const wall = (w: number, h: number): Box => [0, 0, -t, w, h, 0];
  // 두께 면이 있는 쪽(방 포털·나가는 문)만 벽 두께를 채우고, 짝(홀 포털·문틀)은 얇게 — 같은 자리에 겹쳐 깜빡이지 않게(modules-v4 §6)
  const opening = (w: number, clear: number, ch: number, h: number, depth = t): Box[] => {
    const j = (w - clear) / 2;
    return [
      [0, 0, -depth, j, h, 0],
      [w - j, 0, -depth, w, h, 0],
      [j, ch, -depth, w - j, h, 0],
    ];
  };
  const steps: Box[] = Array.from({ length: e.steps }, (_, k) => [
    -e.porticoW / 2,
    -e.steps * e.stepRiseM,
    k * e.stepRunM,
    e.porticoW / 2,
    -k * e.stepRiseM,
    (k + 1) * e.stepRunM,
  ]);
  const cols: Box[] = e.columnXs.flatMap(x =>
    [x, -x].map((cx): Box => [
      cx - e.columnDiameterM / 2,
      0,
      -e.columnInsetM - e.columnDiameterM / 2,
      cx + e.columnDiameterM / 2,
      e.porticoCeilingY,
      -e.columnInsetM + e.columnDiameterM / 2,
    ]),
  );
  const facadeH = e.steps * e.stepRiseM + v.hall.h + tile;
  const gw = v.gate.w / 2;
  const post = t * 2;
  return {
    [g.modules.roomWall4]: { tone: 'room', boxes: [wall(2 * tile, v.roomHeight)] },
    [g.modules.roomWall2]: { tone: 'room', boxes: [wall(tile, v.roomHeight)] },
    [g.modules.roomPortal]: {
      tone: 'room',
      boxes: opening(v.portal.w, v.portal.clear, v.portal.h, v.roomHeight),
    },
    [g.modules.enfiladeDoor]: {
      tone: 'room',
      boxes: opening(v.enfilade.w, v.enfilade.clear, v.enfilade.h, v.roomHeight),
    },
    [g.modules.enfiladeFrame]: {
      tone: 'room',
      boxes: opening(v.enfilade.w, v.enfilade.clear, v.enfilade.h, v.roomHeight, plate),
    },
    [g.modules.roomCeiling]: {
      tone: 'room',
      boxes: [[0, v.roomHeight, 0, tile, v.roomHeight + plate, tile]],
    },
    [g.modules.hallWall4]: { tone: 'hall', boxes: [wall(2 * tile, v.hall.h)] },
    [g.modules.hallWall2]: { tone: 'hall', boxes: [wall(tile, v.hall.h)] },
    [g.modules.hallPortal]: {
      tone: 'hall',
      boxes: opening(v.portal.w, v.portal.clear, v.portal.h, v.hall.h, plate),
    },
    [g.modules.hallEntrance]: {
      tone: 'hall',
      boxes: opening(v.hall.entrance, v.portal.clear, v.portal.h, v.hall.h),
    },
    [g.modules.hallPilaster]: { tone: 'hall', boxes: [[-t, 0, 0, t, v.hall.h, t]] },
    [g.modules.hallCeiling]: { tone: 'hall', boxes: [[0, v.hall.h, 0, tile, v.hall.h + plate, tile]] },
    [g.modules.hallSkylight]: { tone: 'light', boxes: [[0, v.hall.h, 0, tile, v.hall.h + plate, tile]] },
    [g.modules.hallFloor]: { tone: 'floor', boxes: [[0, -plate, 0, tile, 0, tile]] },
    [g.base.modules.portico]: {
      tone: 'stone',
      boxes: [
        [-e.porticoW / 2, -plate, -e.porticoD, e.porticoW / 2, 0, 0],
        [-e.porticoW / 2, e.porticoCeilingY, -e.porticoD, e.porticoW / 2, e.porticoCeilingY + tile / 2, 0],
        ...cols,
      ],
    },
    [g.base.modules.stairs]: { tone: 'stone', boxes: steps },
    [g.base.modules.facadeWall2]: { tone: 'stone', boxes: [wall(tile, facadeH)] },
    [g.base.modules.facadeEnd]: { tone: 'stone', boxes: [[-t, 0, -t, t, facadeH, t]] },
    [g.base.modules.hedge2]: { tone: 'stone', boxes: [[0, 0, -t, tile, t * 3, 0]] },
    [g.modules.gate]: {
      tone: 'stone',
      boxes: [
        [-gw - post, 0, -t, -gw, v.portal.h * 0.8, t],
        [gw, 0, -t, gw + post, v.portal.h * 0.8, t],
      ],
    },
  };
};

const toneColor = (look: TemplateLook, tone: Tone): string => {
  switch (tone) {
    case 'room':
      return look.surfaces.Plaster ?? look.mat.dark;
    case 'hall':
      return look.mat.light;
    case 'stone':
      return look.mat.dark;
    case 'floor':
      return look.surfaces.Marble ?? look.mat.dark;
    case 'light':
      return look.dust;
  }
};

export const BlockoutModules = ({
  modules,
  placements,
  look,
}: {
  modules: ReadonlyMap<string, unknown>;
  placements: readonly ModulePlacement[];
  look: TemplateLook;
}) => {
  const meshes = useMemo(() => {
    const table = shapes();
    const byModule = new Map<string, ModulePlacement[]>();
    for (const p of placements)
      if (!modules.has(p.module) && p.module in table)
        byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
    const mats = new Map<Tone, MeshStandardMaterial>();
    const out: InstancedMesh[] = [];
    const place = new Matrix4();
    const local = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    for (const [name, list] of byModule) {
      const shape = table[name]!;
      let mat = mats.get(shape.tone);
      if (!mat) {
        mat = new MeshStandardMaterial({ color: toneColor(look, shape.tone), roughness: 0.9, metalness: 0 });
        mats.set(shape.tone, mat);
      }
      for (const b of shape.boxes) {
        const geo = new BoxGeometry(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
        local.makeTranslation((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
        const inst = new InstancedMesh(geo, mat, list.length);
        list.forEach((p, i) => {
          place.compose(new Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.rotY), one);
          inst.setMatrixAt(i, place.clone().multiply(local));
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        out.push(inst);
      }
    }
    return { out, mats: [...mats.values()] };
  }, [modules, placements, look]);

  useEffect(
    () => () => {
      for (const m of meshes.out) {
        m.geometry.dispose();
        m.dispose();
      }
      for (const m of meshes.mats) m.dispose();
    },
    [meshes],
  );

  return (
    <group>
      {meshes.out.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
};
