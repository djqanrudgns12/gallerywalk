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
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finishRuntime } from './finishRuntime.mjs';

// v3 마무리 실행기를 건드리지 않는 v4 전용 진입점. 모든 후보를 검사한 뒤 새 glb 세 개만 반영한다.
// resource-guard run --profile build -- node tools/assets/pipeline/build.mjs --v4
if (process.argv[2] === '--v4') {
  const { blender } = finishRuntime();
  const root = resolve(import.meta.dirname, '../../..');
  const parent = join(root, '.local/art/build');
  mkdirSync(parent, { recursive: true });
  const run = mkdtempSync(join(parent, 'm3-v4-'));
  const raw = join(run, 'raw');
  const candidate = join(run, 'candidate');
  const before = join(run, 'before');
  const published = join(root, 'apps/web/src/tpl/modern-history');
  const review = join(root, '.local/art/m3/review', run.split('/').at(-1));
  for (const path of [raw, candidate, before]) mkdirSync(path, { recursive: true });
  const resumeAt = process.argv.indexOf('--resume');
  const onlyAt = process.argv.indexOf('--only');
  const selected = onlyAt === -1 ? 'core-v4,hall-v4,exterior-v4' : process.argv[onlyAt + 1];
  if (!selected || selected.split(',').some(part => !['core-v4', 'hall-v4', 'exterior-v4'].includes(part)))
    throw new Error('v4 묶음 이름을 확인하세요');
  if (resumeAt !== -1) {
    const source = process.argv[resumeAt + 1];
    if (!source) throw new Error('--resume에 이전 실행 폴더가 필요합니다');
    // 이전 원본·후보·실패 증거를 그대로 두고 새 실행 폴더에서 필요한 묶음만 다시 만든다.
    cpSync(join(resolve(source), 'raw'), raw, { recursive: true });
    cpSync(join(resolve(source), 'candidate'), candidate, { recursive: true });
  } else if (selected !== 'core-v4,hall-v4,exterior-v4') {
    throw new Error('부분 굽기는 --resume으로 원본을 지정해야 합니다');
  }
  const call = (bin, args) => execFileSync(bin, args, { cwd: root, stdio: 'inherit' });
  console.log(`[v4] 원본·후보·보존: ${run}`);
  call(process.execPath, ['tools/assets/pipeline/contract.mjs', raw]);
  call(blender, [
    '-b',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '-P',
    'tools/assets/blender/room_v4.py',
    '--',
    '--out',
    raw,
    '--review',
    review,
    '--only',
    selected,
    ...(resumeAt === -1 ? [] : ['--skip-review']),
  ]);
  call(process.execPath, ['tools/assets/pipeline/build.mjs', raw, 'modern-history', candidate, selected]);
  call(process.execPath, [
    'tools/assets/pipeline/verifyOutput.mjs',
    'modern-history',
    candidate,
    '--v4-only',
  ]);
  if (resumeAt !== -1)
    call(blender, [
      '-b',
      '--factory-startup',
      '--python-exit-code',
      '1',
      '-P',
      'tools/assets/blender/room_v4.py',
      '--',
      '--out',
      raw,
      '--review',
      review,
      '--review-only',
    ]);
  for (const part of ['core-v4', 'hall-v4', 'exterior-v4']) {
    const file = `${part}.glb`;
    if (existsSync(join(published, file))) copyFileSync(join(published, file), join(before, file));
  }
  for (const part of ['core-v4', 'hall-v4', 'exterior-v4'])
    copyFileSync(join(candidate, `${part}.glb`), join(published, `${part}.glb`));
  console.log(`[v4] 예산 통과 뒤 반영: ${published}`);
  console.log(`[v4] 검수 그림: ${review}`);
  process.exit(0);
}

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

const allowed = ['core', 'exterior', 'fixtures', 'core-v4', 'hall-v4', 'exterior-v4'];
const FILES = onlyArg ? onlyArg.split(',') : allowed;
if (FILES.some(part => !allowed.includes(part)))
  throw new Error(`산출물 종류는 ${allowed.join(',')}만 허용됩니다`);
try {
  for (const part of FILES) {
    const input = resolve(srcDir, `${templateId}-${part}.glb`);
    if (!existsSync(input)) {
      if (onlyArg) throw new Error(`요청한 산출물 없음: ${input}`);
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
  for (const file of ['manifest.json', 'manifest-v4.json']) {
    if (!existsSync(resolve(srcDir, file))) continue;
    const manifest = JSON.parse(readFileSync(resolve(srcDir, file), 'utf8'));
    writeFileSync(join(outDir, file), `${JSON.stringify(manifest, null, 2)}\n`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
