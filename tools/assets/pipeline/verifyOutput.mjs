// 최적화 뒤 산출물 검사(tools/assets/spec/modules.md §6·§7·§9~§11). 하나라도 어기면 실패(종료 코드 1).
// 사용: node tools/assets/pipeline/verifyOutput.mjs <템플릿 ID> [산출 폴더(기본 apps/web/src/tpl/<템플릿 ID>)]
// 배치 계약(packages/core의 templateGeometry·config·외관 문법)을 Node 24 타입 지우기로 바로 읽어 치수·개수를 맞춘다.
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { config } from '../../../packages/core/src/config.ts';
import { buildExterior } from '../../../packages/core/src/domain/layout/grammar/exterior.ts';
import { templateGeometry } from '../../../packages/core/src/domain/templates/geometry.ts';
import { templateGeometryV4 } from '../../../packages/core/src/domain/templates/geometryV4.ts';
import { decorationBoundsProblems } from './decorationBounds.mjs';

const [templateId, dirArg] = process.argv.slice(2);
if (!templateId) {
  console.error('사용: node tools/assets/pipeline/verifyOutput.mjs <템플릿 ID>');
  process.exit(2);
}
const root = resolve(import.meta.dirname, '../../..');
const dir = dirArg ? resolve(dirArg) : join(root, 'apps/web/src/tpl', templateId);
const selfTest = templateId === '--self-test';
const v4Only = selfTest || process.argv.includes('--v4-only');
const manifest = v4Only ? {} : JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const g = templateGeometry[templateId];
const c = config();
const MM = 0.001;

const BUDGET_BYTES = 2.5 * 1024 * 1024; // 핵심 glb + Basis 변환기(PLAN §2.5)
const TRIANGLE_LIMIT = { wall: 1200, door: 2000, ceiling: 800, corner: 200, floor: 200 };
// R-3(ADR-057): 외관 전체(가장 넓은 정면) · 설비 하나 · 나무 · 재질 칸 · glb 합계 증가
const EXTERIOR_TRIANGLES_MAX = 40_000;
const FIXTURE_TRIANGLES_MAX = 3_000;
const TREE_TRIANGLES_MAX = 2_500;
const SLOTS_MAX = 4;
const R3_INCREASE_MAX_BYTES = 2 * 1024 * 1024;
const R3_BASELINE_CORE_BYTES = 509_544; // R-3 전 core.glb(P1-3 산출물) 크기
const FACADE_H = 6.2; // 날개 벽 높이(R-3 위임서, 땅에서)

const SLOT_NAMES = new Set([
  'M_Plaster',
  'M_Panel',
  'M_Molding',
  'M_Ceiling',
  'M_Brass',
  'M_Floor',
  'M_Marble',
  'M_Stone',
  'M_Ashlar',
  'M_Paving',
  'M_Hedge',
  'M_Bronze',
  'M_Oak',
  'M_Leather',
  'M_Iron',
  'M_Glass',
  'M_SignFace',
  'M_Card',
  'M_Bark',
  'M_Leaf',
  'M_Shadow',
]);

const kindOf = name =>
  name.includes('door') || name.includes('entrance')
    ? 'door'
    : name.includes('wall')
      ? 'wall'
      : name.includes('ceiling')
        ? 'ceiling'
        : name.includes('corner')
          ? 'corner'
          : 'floor';

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const problems = [];

/** glb 하나를 읽어 공통 검사(확장·KTX2) 후 조각(최상위 메시 노드)별 정보를 돌려준다. */
const load = async file => {
  const doc = await io.read(join(dir, file));
  const r = doc.getRoot();
  const used = r.listExtensionsUsed().map(e => e.extensionName);
  for (const ext of ['KHR_texture_basisu', 'EXT_meshopt_compression'])
    if (!used.includes(ext)) problems.push(`${file}: 확장 없음 ${ext}`);
  for (const t of r.listTextures())
    if (t.getMimeType() !== 'image/ktx2')
      problems.push(`${file}: KTX2 아님 ${t.getName()} (${t.getMimeType()})`);
  const nodes = new Map(
    r
      .listNodes()
      .filter(n => n.getMesh())
      .map(n => [n.getMesh().getName(), n]),
  );
  return { doc, nodes };
};

/** 노드 세계 행렬로 옮긴 점들의 경계(재질 칸을 빼고 잴 수 있게) */
const primBounds = (node, skipSlot) => {
  const m = node.getWorldMatrix();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const v = [0, 0, 0];
  for (const prim of node.getMesh().listPrimitives()) {
    const slot = prim.getMaterial()?.getName().split('__')[0];
    if (slot === skipSlot) continue;
    const pos = prim.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const w = [0, 1, 2].map(k => m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], w[k]);
        max[k] = Math.max(max[k], w[k]);
      }
    }
  }
  return { min, max };
};

const meshInfo = (file, name, node, needLightmap) => {
  let triangles = 0;
  const slots = new Set();
  for (const prim of node.getMesh().listPrimitives()) {
    const idx = prim.getIndices();
    triangles += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    const material = prim.getMaterial();
    const slot = material?.getName().split('__')[0] ?? '(없음)';
    slots.add(slot);
    if (!SLOT_NAMES.has(slot)) problems.push(`${file}/${name}: 재질 칸 이름 ${slot}`);
    if (needLightmap) {
      if (!prim.getAttribute('TEXCOORD_1')) problems.push(`${file}/${name}/${slot}: TEXCOORD_1 없음`);
      if (material?.getOcclusionTextureInfo()?.getTexCoord() !== 1 || !material?.getOcclusionTexture())
        problems.push(`${file}/${name}/${slot}: occlusionTexture texCoord 1 아님`);
    }
  }
  if (slots.size > SLOTS_MAX) problems.push(`${file}/${name}: 재질 칸 ${slots.size} > ${SLOTS_MAX}`);
  return { triangles, slots };
};

const near = (a, b) => Math.abs(a - b) <= MM;
const fmt = v => v.toFixed(3);

/** 최적화·양자화가 끝난 실제 세계 좌표 삼각형. 메타데이터가 맞다고 형상을 통과시키지 않는다. */
const worldTriangles = (node, wantedSlot) => {
  const matrix = node.getWorldMatrix();
  const triangles = [];
  for (const primitive of node.getMesh().listPrimitives()) {
    if (wantedSlot && primitive.getMaterial()?.getName().split('__')[0] !== wantedSlot) continue;
    const position = primitive.getAttribute('POSITION');
    const indices = primitive.getIndices();
    const count = indices?.getCount() ?? position.getCount();
    for (let i = 0; i < count; i += 3) {
      const vertices = [];
      for (let j = 0; j < 3; j++) {
        const p = position.getElement(indices ? indices.getScalar(i + j) : i + j, []);
        vertices.push(
          [0, 1, 2].map(k => matrix[k] * p[0] + matrix[k + 4] * p[1] + matrix[k + 8] * p[2] + matrix[k + 12]),
        );
      }
      triangles.push(vertices);
    }
  }
  return triangles;
};
const polygonArea = points => {
  let area = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i].map((x, k) => x - points[0][k]);
    const b = points[i + 1].map((x, k) => x - points[0][k]);
    area += Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) / 2;
  }
  return area;
};
/** 상자와 삼각형의 교집합. 꼭짓점이 바깥이어도 입구를 가로지르는 큰 면을 잡는다. */
const clipBox = (triangle, min, max) => {
  let poly = triangle;
  for (let axis = 0; axis < 3; axis++)
    for (const [edge, sign] of [
      [min[axis], 1],
      [max[axis], -1],
    ]) {
      const next = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length];
        const da = (a[axis] - edge) * sign,
          db = (b[axis] - edge) * sign;
        if (da >= 0) next.push(a);
        if (da >= 0 !== db >= 0) next.push(a.map((x, k) => x + ((b[k] - x) * da) / (da - db)));
      }
      poly = next;
    }
  return poly;
};

// 가벼운 회귀 검사: node tools/assets/pipeline/verifyOutput.mjs --self-test
if (selfTest) {
  const spanning = [
    [-10, -10, 0],
    [10, -10, 0],
    [0, 10, 0],
  ];
  assert.ok(Math.abs(polygonArea(clipBox(spanning, [-1, -1, -0.1], [1, 1, 0.1])) - 4) < 1e-10);
  console.log('[자체 검사] 꼭짓점이 모두 바깥인 가림 면 검출 통과');
  assert.equal(
    polygonArea(
      clipBox(
        [
          [0, 0, 2],
          [1, 0, 2],
          [0, 1, 2],
        ],
        [-1, -1, -0.1],
        [1, 1, 0.1],
      ),
    ),
    0,
  );
  assert.equal(
    polygonArea(
      clipBox(
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        [1, 0, -0.1],
        [2, 1, 0.1],
      ),
    ),
    0,
  );
  console.log('[자체 검사] 떨어진 면·경계 접촉의 오검출 방지 통과');
  const jamb = [
    [
      [0.2, 0, 0],
      [0.2, 4.2, 0],
      [0.2, 4.2, -0.3],
    ],
    [
      [0.2, 0, 0],
      [0.2, 4.2, -0.3],
      [0.2, 0, -0.3],
    ],
  ];
  assert.ok(Math.abs(jamb.reduce((sum, tri) => sum + polygonArea(tri), 0) - 1.26) < 1e-10);
  console.log('[자체 검사] 수직 통로 면적 통과');
  const doc = new Document(),
    buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setBuffer(buffer)
    .setType('VEC3')
    .setArray(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]))
    .setNormalized(true);
  const node = doc
    .createNode()
    .setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position)))
    .setTranslation([1, 2, 3])
    .setScale([2, 3, 4]);
  doc.createScene().addChild(node);
  assert.deepEqual(worldTriangles(node), [
    [
      [1, 2, 3],
      [3, 2, 3],
      [1, 5, 3],
    ],
  ]);
  assert.equal(polygonArea(worldTriangles(node)[0]), 3);
  console.log('[자체 검사] 양자화 정규화·노드 이동·축척 반영 통과');
  process.exit(0);
}

const verifyV4 = async () => {
  const v = templateGeometryV4[templateId];
  if (!v) {
    problems.push(`v4 템플릿 계약 없음: ${templateId}`);
    return;
  }
  const l = c.LAYOUT_V4,
    e = v.base.exterior,
    u = c.MODULE_UNIT_M,
    t = v.base.tileM;
  const rise = e.steps * e.stepRiseM;
  const groups = {
    'core-v4': {
      names: [
        'roomWall4',
        'roomWall2',
        'roomCornerIn',
        'roomCeiling',
        'roomPortal',
        'enfiladeDoor',
        'enfiladeFrame',
      ].map(k => v.modules[k]),
      bytes: 1.6 * 1024 * 1024,
      triangles: 6000,
    },
    'hall-v4': {
      names: [
        'hallWall4',
        'hallWall2',
        'hallCornerIn',
        'hallPortal',
        'hallEntrance',
        'hallPilaster',
        'hallCeiling',
        'hallSkylight',
        'hallFloor',
      ].map(k => v.modules[k]),
      bytes: 1.8 * 1024 * 1024,
      triangles: 8000,
    },
    'exterior-v4': {
      names: [
        ...['portico', 'stairs', 'facadeWall2', 'facadeEnd', 'hedge2'].map(k => v.base.modules[k]),
        v.modules.gate,
      ],
      bytes: 2.4 * 1024 * 1024,
      triangles: 6000,
    },
  };
  const all = new Map();
  for (const [part, spec] of Object.entries(groups)) {
    const file = `${part}.glb`;
    if (!existsSync(join(dir, file))) {
      problems.push(`${file}: 필수 묶음 없음`);
      continue;
    }
    const { nodes, doc } = await load(file);
    if (nodes.size !== spec.names.length)
      problems.push(`${file}: 조각 수 ${nodes.size} ≠ ${spec.names.length}`);
    for (const name of nodes.keys())
      if (!spec.names.includes(name)) problems.push(`${file}: 계약 밖 이름 ${name}`);
    for (const texture of doc.getRoot().listTextures()) {
      // 기본색은 1024². KTX2 머리말의 pixelWidth·pixelHeight를 직접 읽는다.
      if (
        !doc
          .getRoot()
          .listMaterials()
          .some(m => m.getBaseColorTexture() === texture)
      )
        continue;
      const bytes = texture.getImage();
      if (!bytes || bytes.byteLength < 28) {
        problems.push(`${file}: KTX2 머리말 없음`);
        continue;
      }
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (header.getUint32(20, true) !== 1024 || header.getUint32(24, true) !== 1024)
        problems.push(`${file}: 기본색 질감 1024² 아님 ${texture.getName()}`);
    }
    let total = 0,
      maxSlots = 0;
    console.log(`[${file}]`);
    for (const name of spec.names) {
      const node = nodes.get(name);
      if (!node) {
        problems.push(`${file}: 조각 없음 ${name}`);
        continue;
      }
      const info = meshInfo(file, name, node, name !== v.modules.hallFloor);
      if (node.getMesh().listPrimitives().length > SLOTS_MAX)
        problems.push(`${name}: 실제 그리기 재질 칸이 ${SLOTS_MAX}개 초과`);
      if (
        name === v.modules.hallFloor &&
        node
          .getMesh()
          .listPrimitives()
          .some(p => p.getMaterial()?.getOcclusionTexture())
      )
        problems.push(`${name}: 바닥에 구운 빛이 있음`);
      total += info.triangles;
      maxSlots = Math.max(maxSlots, info.slots.size);
      const limit = name === v.base.modules.portico ? 40000 : spec.triangles;
      if (info.triangles > limit) problems.push(`${name}: 삼각형 ${info.triangles} > ${limit}`);
      const extras = node.getExtras();
      if (extras.v4_baked !== true || !(extras.v4_gain > 0) || extras.v4_bundle !== part)
        problems.push(`${name}: 실제 굽기·공통 노출 기록 없음`);
      // meshopt 양자화는 노드에 보정 이동·축척을 넣는다. 행렬 자체가 아니라
      // 보정 후 실제 표면의 범위로 배치 기준점(벽 시작·바닥·천장 모서리)을 확인한다.
      const bounds = getBounds(node);
      const range = (axis, min, max, label) => {
        if (!near(bounds.min[axis], min) || !near(bounds.max[axis], max))
          problems.push(
            `${name}: ${label} ${fmt(bounds.min[axis])}..${fmt(bounds.max[axis])} ≠ ${min}..${max}`,
          );
      };
      if (part === 'core-v4' || part === 'hall-v4') {
        const h = part === 'core-v4' ? l.roomHeight : l.hall.h;
        const ceiling = [v.modules.roomCeiling, v.modules.hallCeiling, v.modules.hallSkylight].includes(name);
        if (ceiling) {
          range(0, 0, t, '천장 폭');
          range(2, 0, t, '천장 깊이');
          range(1, h, h + (part === 'core-v4' ? 0.12 : 0.3), '천장 높이');
        } else if (name === v.modules.hallFloor) {
          range(0, 0, t, '바닥 폭');
          range(2, 0, t, '바닥 깊이');
          range(1, 0, 0, '바닥 높이');
        } else {
          range(1, 0, h, '벽 높이');
          if (name.endsWith('_4m')) range(0, 0, u * 2, '벽 폭');
          if (name.endsWith('_2m')) range(0, 0, u, '벽 폭');
          if (name === v.modules.roomCornerIn) {
            range(0, 0, 0.08, '모서리 폭');
            range(2, 0, 0.08, '모서리 깊이');
          }
          if (name === v.modules.hallCornerIn) {
            range(0, 0, 0.12, '모서리 폭');
            range(2, 0, 0.12, '모서리 깊이');
          }
          if (name === v.modules.hallPilaster) {
            range(0, -0.3, 0.3, '기둥 폭');
            range(2, 0, 0.25, '기둥 돌출');
          }
        }
      }
      if (name === v.base.modules.stairs) {
        range(0, -e.porticoW / 2, e.porticoW / 2, '계단 폭');
        range(1, -rise, 1.2, '계단·돌 볼 높이');
        if (Math.abs(bounds.max[2] - e.steps * e.stepRunM) > 0.003)
          problems.push(`${name}: 계단 깊이 불일치`);
      }
      if (name === v.base.modules.portico) {
        if (!near(bounds.min[2], -e.porticoD) || !near(bounds.min[1], -rise))
          problems.push(`${name}: 현관 깊이·기단 기준점 불일치`);
        // 지붕 몰딩의 돌출과 별개로 현관 바닥의 기준점·폭·깊이는 계약 그대로다.
        const floor = worldTriangles(node, 'M_Paving').flat();
        for (const [axis, min, max] of [
          [0, -e.porticoW / 2, e.porticoW / 2],
          [1, 0, 0],
          [2, -e.porticoD, 0],
        ])
          if (
            !floor.length ||
            !near(Math.min(...floor.map(p => p[axis])), min) ||
            !near(Math.max(...floor.map(p => p[axis])), max)
          )
            problems.push(`${name}: 현관 바닥 축 ${axis} 범위 불일치`);
      }
      if ([v.base.modules.facadeWall2, v.base.modules.facadeEnd].includes(name))
        range(1, 0, rise + l.hall.h + u, '날개 벽 높이');
      if ([v.base.modules.facadeWall2, v.base.modules.hedge2].includes(name)) range(0, 0, u, '외관 칸 폭');
      if (name === v.modules.gate) {
        range(0, -l.gate.w / 2, l.gate.w / 2, '대문 폭');
        if (!near(bounds.min[1], 0)) problems.push(`${name}: 대문 바닥 기준점 불일치`);
      }
      all.set(name, { node, triangles: worldTriangles(node), bounds });
      console.log(
        `  ${name}: 삼각형 ${info.triangles}/${limit}, 재질 ${info.slots.size}/4, 높이 ${fmt(bounds.min[1])}..${fmt(bounds.max[1])}`,
      );
    }
    const bytes = statSync(join(dir, file)).size;
    if (bytes > spec.bytes) problems.push(`${file}: ${bytes}바이트 > ${spec.bytes}바이트`);
    console.log(
      `  합계 ${total}삼각형 · 재질 최대 ${maxSlots}칸 · ${bytes}바이트 / ${Math.floor(spec.bytes)}바이트`,
    );
  }
  const interiorGains = [...all.entries()]
    .filter(([name]) => name.startsWith('mh4_room_') || name.startsWith('mh4_hall_'))
    .map(([, item]) => item.node.getExtras().v4_gain);
  if (interiorGains.some(gain => Math.abs(gain - interiorGains[0]) > 1e-8))
    problems.push('v4 실내 조각의 공통 노출이 서로 다름');
  for (const key of ['hallPortal', 'hallEntrance']) {
    const item = all.get(v.modules[key]);
    if (!item) continue;
    const signFront = v.base.fixtures.wallOffsetM;
    if (
      item.triangles.some(
        tri =>
          polygonArea(
            clipBox(
              tri,
              [0.2, l.portalLetteringY - 0.2, signFront],
              [l.portal.w - 0.2, l.portalLetteringY + 0.2, signFront + 0.5],
            ),
          ) >
          MM * MM,
      )
    )
      problems.push(`${v.modules[key]}: 레터링 앞을 가리는 받이 면 있음`);
  }
  // 문 열림 및 네 통로 면의 면적·깊이: 두께가 없는 짝은 벽 뒤 정점 자체를 금지한다.
  for (const [key, opening, depth] of [
    ['roomPortal', l.portal, c.WALL_THICKNESS_M],
    ['hallPortal', l.portal, 0],
    ['hallEntrance', l.portal, c.WALL_THICKNESS_M],
    ['enfiladeDoor', l.enfilade, c.WALL_THICKNESS_M + l.roomGap],
    ['enfiladeFrame', l.enfilade, 0],
  ]) {
    const name = v.modules[key],
      item = all.get(name);
    if (!item) continue;
    const a = (opening.w - opening.clear) / 2,
      b = opening.w - a;
    if (!near(item.bounds.min[2], -depth))
      problems.push(`${name}: 두께 깊이 ${fmt(-item.bounds.min[2])} ≠ ${depth}`);
    const clipped = item.triangles.some(
      tri =>
        polygonArea(clipBox(tri, [a + MM * 2, MM * 2, -depth - MM], [b - MM * 2, opening.h - MM * 2, 0.3])) >
        MM * MM,
    );
    if (clipped) problems.push(`${name}: 맑은 문 열림을 막는 면 있음`);
    if (depth > 0)
      for (const [axis, value, expected] of [
        [0, a, opening.h * depth],
        [0, b, opening.h * depth],
        [1, 0, opening.clear * depth],
        [1, opening.h, opening.clear * depth],
      ]) {
        const area = item.triangles
          .filter(tri => tri.every(p => near(p[axis], value) && p[2] <= MM && p[2] >= -depth - MM))
          .reduce((sum, tri) => sum + polygonArea(tri), 0);
        if (Math.abs(area - expected) > Math.max(0.01, expected * 0.005))
          problems.push(`${name}: 통로 ${axis}/${value} 면적 ${area.toFixed(4)} ≠ ${expected}`);
      }
  }
  // 모든 디딤판은 배치 엔진 발 높이와 같은 평면이어야 한다.
  const stairs = all.get(v.base.modules.stairs);
  if (stairs)
    for (let k = 0; k < e.steps; k++) {
      const y = -k * e.stepRiseM,
        z = (k + 0.5) * e.stepRunM;
      const hit = stairs.triangles.some(
        tri =>
          tri.every(p => near(p[1], y)) &&
          polygonArea(clipBox(tri, [-0.1, y - MM, z - 0.01], [0.1, y + MM, z + 0.01])) > MM * MM,
      );
      if (!hit) problems.push(`계단 ${k + 1}단: 중앙 디딤판 높이 ${y} 없음`);
    }
  console.log('[v4] 이름·높이·기준점·문 열림·두께 면 짝·16단 디딤판 검사 완료');
};

if (v4Only) {
  await verifyV4();
  if (problems.length) {
    console.error(`[verify] 실패 ${problems.length}건\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`[verify] ${templateId} v4 통과 (3묶음·22조각)`);
  process.exit(0);
}

// ── core.glb(실내) ─────────────────────────────────────────────
const REQUIRED_CORE = {
  'modern-history': [
    'mh_wall_4m',
    'mh_wall_2m',
    'mh_wall_door_2m',
    'mh_corridor_door_2m',
    'mh_corner_in',
    'mh_corner_out',
    'mh_ceiling_2x2',
    'mh_floor_2x2',
    'mh_entrance_4m',
  ],
};
console.log('[core.glb]');
const core = await load('core.glb');
for (const name of REQUIRED_CORE[templateId] ?? [])
  if (!manifest.modules[name]) problems.push(`필수 조각이 manifest에 없음: ${name}`);
// 굽기는 모든 조각이 노출 하나를 쓴다(ADR-051) — 조각마다 맞추면 종류가 다른 조각 사이에 이음새가 생긴다.
if (manifest.baked && !(manifest.exposure?.gain > 0)) problems.push('공통 노출(exposure.gain) 기록 없음');
for (const [name, info] of Object.entries(manifest.modules)) {
  const node = core.nodes.get(name);
  if (!node) {
    problems.push(`core.glb: 조각 없음 ${name}`);
    continue;
  }
  const { triangles } = meshInfo('core.glb', name, node, info.lightmap);
  const b = getBounds(node);
  if (name === 'mh_corridor_door_2m' && b.min[2] < -MM)
    problems.push(`${name}: 반대편 문과 겹치는 벽 두께 면이 남았습니다`);
  const limit = TRIANGLE_LIMIT[kindOf(name)];
  if (triangles > limit) problems.push(`${name}: 삼각형 ${triangles} > ${limit}`);
  const m = /_(\d)m$/.exec(name);
  if (m && (name.includes('wall') || name.includes('entrance'))) {
    const length = Number(m[1]);
    if (!near(b.min[0], 0) || !near(b.max[0], length))
      problems.push(`${name}: 길이 ${fmt(b.min[0])}..${fmt(b.max[0])} ≠ 0..${length}`);
  }
  console.log(
    `  ${name.padEnd(22)} 삼각형 ${String(triangles).padStart(6)}  x ${fmt(b.min[0])}..${fmt(b.max[0])}`,
  );
}
const basis = join(root, 'node_modules/three/examples/jsm/libs/basis');
const transcoderBytes = ['basis_transcoder.js', 'basis_transcoder.wasm']
  .map(f => gzipSync(readFileSync(join(basis, f))).length)
  .reduce((a, b) => a + b, 0);
const coreBytes = statSync(join(dir, 'core.glb')).size;
console.log(
  `  core.glb ${(coreBytes / 1024).toFixed(0)}KB + 변환기(gzip) ${(transcoderBytes / 1024).toFixed(0)}KB = ${((coreBytes + transcoderBytes) / 1024 / 1024).toFixed(2)}MB / 예산 2.50MB`,
);
if (coreBytes + transcoderBytes > BUDGET_BYTES)
  problems.push(`예산 초과: ${((coreBytes + transcoderBytes) / 1024 / 1024).toFixed(2)}MB`);

// ── exterior.glb(외관) ─────────────────────────────────────────
const ext = manifest.exterior;
let extBytes = 0;
if (!ext) problems.push('manifest에 exterior 없음(외관 조각)');
else {
  console.log('[exterior.glb]');
  const file = ext.file ?? 'exterior.glb';
  if (!existsSync(join(dir, file))) problems.push(`${file} 없음`);
  else {
    const ex = await load(file);
    extBytes = statSync(join(dir, file)).size;
    const e = g.exterior;
    const rise = e.steps * e.stepRiseM;
    const required = [
      g.modules.portico,
      g.modules.stairs,
      g.modules.facadeWall2,
      g.modules.facadeEnd,
      g.modules.plazaTile,
      g.modules.hedge2,
    ];
    for (const name of required)
      if (!ext.modules?.[name]) problems.push(`필수 외관 조각이 manifest에 없음: ${name}`);
    if (ext.baked && !(ext.exposure?.gain > 0))
      problems.push('외관 공통 노출(exterior.exposure.gain) 기록 없음');
    const tri = {};
    for (const [name, info] of Object.entries(ext.modules ?? {})) {
      const node = ex.nodes.get(name);
      if (!node) {
        problems.push(`${file}: 조각 없음 ${name}`);
        continue;
      }
      const { triangles } = meshInfo(file, name, node, info.lightmap);
      tri[name] = triangles;
      const b = getBounds(node);
      console.log(
        `  ${name.padEnd(22)} 삼각형 ${String(triangles).padStart(6)}  x ${fmt(b.min[0])}..${fmt(b.max[0])}  y ${fmt(b.min[1])}..${fmt(b.max[1])}  z ${fmt(b.min[2])}..${fmt(b.max[2])}`,
      );
      // 치수: 기준점·길이(glTF: +Z = 앞)
      if (name === g.modules.stairs) {
        if (!near(b.min[0], -e.porticoW / 2) || !near(b.max[0], e.porticoW / 2))
          problems.push(`${name}: 폭 ≠ ${e.porticoW}`);
        if (!near(b.min[1], -rise)) problems.push(`${name}: 아래 끝 ${fmt(b.min[1])} ≠ ${-rise}`);
        if (Math.abs(b.max[2] - e.steps * e.stepRunM) > 0.03)
          problems.push(`${name}: 깊이 ${fmt(b.max[2])} ≠ ${e.steps * e.stepRunM}(+코 3cm)`);
      }
      if (name === g.modules.portico) {
        if (!near(b.min[2], -e.porticoD)) problems.push(`${name}: 뒷벽 ${fmt(b.min[2])} ≠ ${-e.porticoD}`);
        if (!near(b.min[1], -rise)) problems.push(`${name}: 기단 아래 ${fmt(b.min[1])} ≠ ${-rise}`);
      }
      if (name === g.modules.facadeWall2) {
        if (!near(b.min[0], 0) || !near(b.max[0], c.MODULE_UNIT_M))
          problems.push(`${name}: 길이 ≠ ${c.MODULE_UNIT_M}`);
        if (!near(b.min[1], 0) || !near(b.max[1], FACADE_H))
          problems.push(`${name}: 높이 ${fmt(b.min[1])}..${fmt(b.max[1])} ≠ 0..${FACADE_H}`);
      }
      if (name === g.modules.plazaTile || name === g.modules.hedge2)
        if (!near(b.min[0], 0) || !near(b.max[0], g.tileM)) problems.push(`${name}: 길이 ≠ ${g.tileM}`);
      if (name === g.modules.plazaTile && (!near(b.min[2], 0) || !near(b.max[2], g.tileM)))
        problems.push(`${name}: 깊이 ≠ ${g.tileM}`);
    }
    // 가장 넓은 정면(관 깊이 상한)에서 조각 수 × 삼각형
    const widestHalfX = c.CORRIDOR_WIDTH_M / 2 + c.WALL_THICKNESS_M + c.WALL_MAX_LEN_M;
    const built = buildExterior(g, -g.hall.d, widestHalfX);
    const counts = {};
    for (const m of built.modules) counts[m.type] = (counts[m.type] ?? 0) + 1;
    const total = Object.entries(counts).reduce((s, [t, n]) => s + n * (tri[t] ?? 0), 0);
    console.log(
      `  가장 넓은 정면(반폭 ${built.exterior.halfWidth}m): ${Object.entries(counts)
        .map(([t, n]) => `${t}×${n}`)
        .join(' ')} → 삼각형 ${total} / ${EXTERIOR_TRIANGLES_MAX}`,
    );
    if (total > EXTERIOR_TRIANGLES_MAX) problems.push(`외관 삼각형 ${total} > ${EXTERIOR_TRIANGLES_MAX}`);
  }
}

// ── fixtures.glb(설비) ─────────────────────────────────────────
const fx = manifest.fixtures;
let fixBytes = 0;
if (!fx) problems.push('manifest에 fixtures 없음(설비 모델)');
else {
  console.log('[fixtures.glb]');
  const file = fx.file ?? 'fixtures.glb';
  if (!existsSync(join(dir, file))) problems.push(`${file} 없음`);
  else {
    const fdoc = await load(file);
    fixBytes = statSync(join(dir, file)).size;
    const floorKinds = ['easel', 'bench', 'plant', 'lamp', 'tree'];
    const required = [
      ...floorKinds,
      'nameplate',
      'introPanel',
      'hallSign',
      'exitSign',
      'corridorNameplate',
      'soundPlaque',
      ...Object.keys(g.decorations),
    ];
    for (const name of required)
      if (!fx.models?.[name]) problems.push(`필수 설비가 manifest에 없음: ${name}`);
    for (const name of Object.keys(fx.models ?? {})) {
      const node = fdoc.nodes.get(name);
      if (!node) {
        problems.push(`${file}: 설비 없음 ${name}`);
        continue;
      }
      const { triangles } = meshInfo(file, name, node, false);
      const limit = name === 'tree' ? TREE_TRIANGLES_MAX : FIXTURE_TRIANGLES_MAX;
      if (triangles > limit) problems.push(`${name}: 삼각형 ${triangles} > ${limit}`);
      const b = primBounds(node, 'M_Shadow');
      if (g.decorations[name]) {
        problems.push(...decorationBoundsProblems(name, b, g.decorations[name], c.WALKABLE_WALL_MARGIN_M));
        if (!fx.models[name].vertexAO) problems.push(`${name}: 구운 꼭짓점 그늘 없음`);
      }
      console.log(
        `  ${name.padEnd(18)} 삼각형 ${String(triangles).padStart(6)}  x ${fmt(b.min[0])}..${fmt(b.max[0])}  y ${fmt(b.min[1])}..${fmt(b.max[1])}  z ${fmt(b.min[2])}..${fmt(b.max[2])}`,
      );
      // 바닥 설비: 기준점 = 바닥 한가운데, 배치 계약 바닥 넓이 안(나무는 수관이 넓어 줄기만 — 줄기는 넓이 안이라고 가정하지 않고 바닥 높이만)
      if (floorKinds.includes(name)) {
        if (Math.abs(b.min[1]) > 0.005) problems.push(`${name}: 바닥 ${fmt(b.min[1])} ≠ 0`);
        const fp = g.footprints[name];
        if (
          name !== 'tree' &&
          (Math.max(-b.min[0], b.max[0]) > fp.w / 2 + MM || Math.max(-b.min[2], b.max[2]) > fp.d / 2 + MM)
        )
          problems.push(
            `${name}: 바닥 넓이 ${fmt(b.max[0] - b.min[0])}×${fmt(b.max[2] - b.min[2])}가 계약 ${fp.w}×${fp.d} 밖`,
          );
      }
    }
    if (fx.models?.easel && !near(fx.models.easel.ledgeY, c.EASEL_LEDGE_Y_M))
      problems.push(`easel: 받침 높이 ${fx.models.easel.ledgeY} ≠ EASEL_LEDGE_Y_M ${c.EASEL_LEDGE_Y_M}`);
  }
}

const increase = extBytes + fixBytes + Math.max(0, coreBytes - R3_BASELINE_CORE_BYTES);
console.log(
  `[크기] exterior ${(extBytes / 1024).toFixed(0)}KB + fixtures ${(fixBytes / 1024).toFixed(0)}KB + core 증가 ${(Math.max(0, coreBytes - R3_BASELINE_CORE_BYTES) / 1024).toFixed(0)}KB = ${(increase / 1024 / 1024).toFixed(2)}MB / 증가 예산 2.00MB`,
);
if (increase > R3_INCREASE_MAX_BYTES)
  problems.push(`glb 합계 증가 ${(increase / 1024 / 1024).toFixed(2)}MB > 2MB`);

if (['core-v4', 'hall-v4', 'exterior-v4'].some(part => existsSync(join(dir, `${part}.glb`))))
  await verifyV4();

if (problems.length > 0) {
  console.error(`[verify] 실패 ${problems.length}건\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `[verify] ${templateId} 통과 (굽기 실내 ${manifest.baked ? '함' : '안 함'} · 외관 ${ext?.baked ? '함' : '안 함'} — 안 함이면 시험 산출물)`,
);
