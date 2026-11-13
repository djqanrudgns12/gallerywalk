// 템플릿 glb 최적화(PLAN §13.5): 중복 제거 → 정리(UV·꼭짓점 색 유지) → 정점 합치기 → 재질 고치기 → KTX2(ETC1S) → meshopt.
// 사용: node tools/assets/pipeline/build.mjs <Blender 산출 폴더> <템플릿 ID> [출력 폴더]
//   예: node tools/assets/pipeline/build.mjs .local/art/build/modern-history modern-history
//   출력 폴더를 주면 apps/web/src/tpl 대신 거기에(시험 빌드가 쓰는 중인 산출물을 덮지 않게)
// 결과: apps/web/src/tpl/<템플릿 ID>/{core,exterior,fixtures}.glb, manifest.json → 이어서 verifyOutput.mjs가 검사한다.
//   core = 실내 조각(P1-3), exterior = 미술관 외관 조각(R-3), fixtures = 설비 모델(R-3). Blender 산출이 없는 파일은 건너뛴다.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [srcDir, templateId, outArg, onlyArg] = process.argv.slice(2);
if (!srcDir || !templateId) {
  console.error('사용: node tools/assets/pipeline/build.mjs <Blender 산출 폴더> <템플릿 ID>');
  process.exit(2);
}
const root = resolve(import.meta.dirname, '../../..');
const cli = join(root, 'node_modules/.bin/gltf-transform');
// gltf-transform의 etc1s는 PATH의 `ktx`(KTX-Software 4.4+)를 부른다.
const env = { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` };
const outDir = outArg ? resolve(outArg) : join(root, 'apps/web/src/tpl', templateId);
mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'gw-assets-'));

/**
 * glTF 재질 모드를 이름으로 정한다(Blender 내보내기가 판마다 알파 모드를 다르게 정하므로 여기서 못 박음).
 * - `M_Leaf*`: 잎 카드 — 알파 잘라내기(0.5) + 양면
 * - `M_Shadow*`: 바닥 그림자 판 — 알파 섞기
 * - `M_Glass*`: 등 유리 — 양면
 * - 그 밖: 불투명
 */
const fixMaterials = async (input, output) => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  for (const m of doc.getRoot().listMaterials()) {
    const slot = m.getName().split('__')[0];
    if (slot === 'M_Leaf') m.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
    else if (slot === 'M_Shadow') m.setAlphaMode('BLEND').setDoubleSided(false);
    else if (slot === 'M_Glass') m.setAlphaMode('OPAQUE').setDoubleSided(true);
    else m.setAlphaMode('OPAQUE');
  }
  await io.write(output, doc);
};

const steps = [
  ['dedup'],
  ['prune', '--keep-attributes', 'true', '--keep-leaves', 'false'],
  ['weld'],
  ['@fix'],
  ['etc1s', '--quality', '200', '--compression', '2'],
  ['meshopt', '--level', 'medium'],
];

const FILES = onlyArg ? onlyArg.split(',') : ['core', 'exterior', 'fixtures'];
if (FILES.some(part => !['core', 'exterior', 'fixtures'].includes(part)))
  throw new Error('산출물 종류는 core,exterior,fixtures만 허용됩니다');
try {
  for (const part of FILES) {
    const input = resolve(srcDir, `${templateId}-${part}.glb`);
    if (!existsSync(input)) {
      console.log(`[assets] ${templateId}: ${part} 없음 — 건너뜀`);
      continue;
    }
    let current = input;
    for (const [i, step] of steps.entries()) {
      const next = join(work, `${part}-step-${i}.glb`);
      const [command, ...options] = step;
      if (command === '@fix') await fixMaterials(current, next);
      else
        execFileSync(cli, [command, current, next, ...options], {
          env,
          stdio: ['ignore', 'ignore', 'inherit'],
        });
      current = next;
    }
    copyFileSync(current, join(outDir, `${part}.glb`));
    console.log(`[assets] ${templateId}: ${join(outDir, `${part}.glb`)}`);
  }
  const manifest = JSON.parse(readFileSync(resolve(srcDir, 'manifest.json'), 'utf8'));
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
