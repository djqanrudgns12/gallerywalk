// 배치 계약 → Blender 입력(R-3). 조각 치수를 Blender 스크립트에 다시 적지 않으려고, 배치 엔진이 쓰는 값을 그대로 JSON으로 뽑는다.
// 사용: node tools/assets/pipeline/contract.mjs <출력 폴더>   → <출력 폴더>/contract.json
//   - geometry: packages/core/src/domain/templates/geometry.ts의 근대 역사관 값(외관·설비 바닥·조각 이름)
//   - config: 조각이 따라야 하는 공용 수치(벽 높이·두께·문·이젤 받침 높이 …)
//   - samples: 외관 배치 예(가장 좁은 정면·가장 넓은 정면) — 예산 계산과 미리 보기 렌더가 쓴다
// Node 24의 타입 지우기로 TS 원본을 바로 읽는다(빌드 산출물 없이).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../../../packages/core/src/config.ts';
import { buildExterior } from '../../../packages/core/src/domain/layout/grammar/exterior.ts';
import { templateGeometry } from '../../../packages/core/src/domain/templates/geometry.ts';
import { templateGeometryV4 } from '../../../packages/core/src/domain/templates/geometryV4.ts';
import { templateLooks } from '../../../packages/core/src/domain/templates/look.ts';
import { decorationsFor } from '../../../packages/core/src/domain/layout/grammar/modernHistory.ts';

const outDir = process.argv[2] ?? '.local/art/build/modern-history-v4';

/** 관 깊이 상한(벽 한 면 최대 길이)으로 건물이 가장 넓을 때의 반폭 — 회랑 반폭 + 벽 두께 + 관 깊이 */
const widestBuildingHalfX = () => {
  const c = config();
  return c.CORRIDOR_WIDTH_M / 2 + c.WALL_THICKNESS_M + c.WALL_MAX_LEN_M;
};

const contract = () => {
  const c = config();
  const g = templateGeometry['modern-history'];
  const sample = halfX => {
    const e = buildExterior(g, -g.hall.d, halfX);
    return {
      buildingHalfX: halfX,
      exterior: e.exterior,
      modules: e.modules.map(m => ({ type: m.type, pos: m.pos, rotY: m.rotY })),
      fixtures: e.fixtures.map(f => ({ kind: f.kind, pos: f.pos, rotY: f.rotY })),
    };
  };
  return {
    template: 'modern-history',
    geometry: g,
    v4: {
      geometry: templateGeometryV4['modern-history'],
      layout: c.LAYOUT_V4,
      bundles: {
        'core-v4': [
          'roomWall4',
          'roomWall2',
          'roomCornerIn',
          'roomCeiling',
          'roomPortal',
          'enfiladeDoor',
          'enfiladeFrame',
        ],
        'hall-v4': [
          'hallWall4',
          'hallWall2',
          'hallCornerIn',
          'hallPortal',
          'hallEntrance',
          'hallPilaster',
          'hallCeiling',
          'hallSkylight',
          'hallFloor',
        ],
        'exterior-v4': ['portico', 'stairs', 'facadeWall2', 'facadeEnd', 'hedge2', 'gate'],
      },
    },
    look: templateLooks['modern-history'],
    // render.py의 합성 관람 장면에서 쓰는 사인과 같은 자리. 배치 수식은 제품과 공유한다.
    decorations: decorationsFor(
      [
        {
          kind: 'nameplate',
          partId: '합성관',
          pos: [-g.hall.w / 2 + g.fixtures.wallOffsetM, g.fixtures.nameplate.minY, -6],
          rotY: Math.PI / 2,
        },
        {
          kind: 'introPanel',
          partId: '합성관',
          pos: [-g.hall.w / 2 + g.fixtures.wallOffsetM, c.EYE_HEIGHT_M, -2.4],
          rotY: Math.PI / 2,
        },
        {
          kind: 'exitSign',
          partId: null,
          pos: [0, c.EYE_HEIGHT_M + g.fixtures.exitSignLiftM, -g.fixtures.wallOffsetM],
          rotY: Math.PI,
        },
      ],
      g,
    ),
    config: {
      WALL_HEIGHT_M: c.WALL_HEIGHT_M,
      WALL_THICKNESS_M: c.WALL_THICKNESS_M,
      DOOR_WIDTH_M: c.DOOR_WIDTH_M,
      DOOR_HEIGHT_M: c.DOOR_HEIGHT_M,
      MODULE_UNIT_M: c.MODULE_UNIT_M,
      EASEL_LEDGE_Y_M: c.EASEL_LEDGE_Y_M,
      EASEL_MAX_OUTER_M: c.EASEL_MAX_OUTER_M,
      WALKABLE_WALL_MARGIN_M: c.WALKABLE_WALL_MARGIN_M,
      EYE_HEIGHT_M: c.EYE_HEIGHT_M,
      CAMERA_HEIGHT_M: c.CAMERA_HEIGHT_M,
      SOUND_PLAQUE: c.FORM_BASE_M.SOUND,
    },
    samples: {
      narrow: sample(g.hall.w / 2),
      widest: sample(widestBuildingHalfX()),
    },
  };
};

const out = resolve(outDir);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'contract.json'), `${JSON.stringify(contract(), null, 2)}\n`);
console.log(`[contract] ${join(out, 'contract.json')}`);
