// 최적화 뒤 산출물 검사(tools/assets/spec/modules.md §6·§7·§9~§11). 하나라도 어기면 실패(종료 코드 1).
// 사용: node tools/assets/pipeline/verifyOutput.mjs <템플릿 ID> [산출 폴더(기본 apps/web/src/tpl/<템플릿 ID>)]
// 배치 계약(packages/core의 templateGeometry·config·외관 문법)을 Node 24 타입 지우기로 바로 읽어 치수·개수를 맞춘다.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { config } from '../../../packages/core/src/config.ts';
import { buildExterior } from '../../../packages/core/src/domain/layout/grammar/exterior.ts';
import { templateGeometry } from '../../../packages/core/src/domain/templates/geometry.ts';
import { decorationBoundsProblems } from './decorationBounds.mjs';

const [templateId, dirArg] = process.argv.slice(2);
if (!templateId) {
  console.error('사용: node tools/assets/pipeline/verifyOutput.mjs <템플릿 ID>');
  process.exit(2);
}
const root = resolve(import.meta.dirname, '../../..');
const dir = dirArg ? resolve(dirArg) : join(root, 'apps/web/src/tpl', templateId);
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
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

if (problems.length > 0) {
  console.error(`[verify] 실패 ${problems.length}건\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `[verify] ${templateId} 통과 (굽기 실내 ${manifest.baked ? '함' : '안 함'} · 외관 ${ext?.baked ? '함' : '안 함'} — 안 함이면 시험 산출물)`,
);
