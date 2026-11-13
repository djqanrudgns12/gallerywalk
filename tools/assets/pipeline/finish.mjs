// F9 에셋 마무리: 원본 보존 → 설비만 굽기 → 후보 최적화·예산 검사 → 그림 렌더 → 검사된 산출물 반영.
// 실행: resource-guard run --profile build -- npm run --prefix tools/assets assets:build
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { addCorridorDoor } from './corridorDoor.mjs';

if (process.env.RESOURCE_GUARD_ACTIVE !== '1') {
  console.error('resource-guard run --profile build 아래에서 실행하세요.');
  process.exit(2);
}
const root = resolve(import.meta.dirname, '../../..');
const original = resolve(root, process.argv[2] ?? '.local/art/build/modern-history');
const blender = '/Applications/Blender.app/Contents/MacOS/Blender';
const published = join(root, 'apps/web/src/tpl/modern-history');
for (const path of [
  blender,
  join(original, 'modern-history-core.glb'),
  join(original, 'modern-history-exterior.glb'),
]) {
  if (!existsSync(path)) throw new Error(`에셋 빌드 입력 없음: ${path}`);
}
const parent = join(root, '.local/art/build');
mkdirSync(parent, { recursive: true });
const run = mkdtempSync(join(parent, 'f9-x2-'));
const raw = join(run, 'raw');
const candidate = join(run, 'candidate');
const before = join(run, 'before');
for (const dir of [raw, candidate, before]) mkdirSync(dir, { recursive: true });
console.log(`[에셋] 원본 보존·후보·로그: ${run}`);
for (const file of ['core.glb', 'exterior.glb', 'fixtures.glb', 'manifest.json']) {
  copyFileSync(join(published, file), join(before, file));
  copyFileSync(join(published, file), join(candidate, file));
}
copyFileSync(join(published, 'manifest.json'), join(raw, 'manifest.json'));
for (const part of ['core', 'exterior'])
  copyFileSync(join(original, `modern-history-${part}.glb`), join(raw, `modern-history-${part}.glb`));
const call = (bin, args) => execFileSync(bin, args, { cwd: root, stdio: 'inherit' });
call(process.execPath, ['tools/assets/pipeline/contract.mjs', raw]);
call(blender, [
  '-b',
  '--factory-startup',
  '-P',
  'tools/assets/blender/build.py',
  '--',
  '--out',
  raw,
  '--only',
  'fixtures',
]);
const rawManifest = JSON.parse(readFileSync(join(raw, 'manifest.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const corePath = join(raw, 'modern-history-core.glb');
const core = await io.read(corePath);
addCorridorDoor(core, rawManifest);
await io.write(corePath, core);
writeFileSync(join(raw, 'manifest.json'), `${JSON.stringify(rawManifest, null, 2)}\n`);
call(process.execPath, [
  'tools/assets/pipeline/build.mjs',
  raw,
  'modern-history',
  candidate,
  'core,fixtures',
]);
call(process.execPath, ['tools/assets/pipeline/verifyOutput.mjs', 'modern-history', candidate]);
call(blender, [
  '-b',
  '--factory-startup',
  '-P',
  'tools/assets/blender/render.py',
  '--',
  '--src',
  raw,
  '--out',
  candidate,
  '--only',
  'poster,template-card,decorations',
]);
const manifest = JSON.parse(readFileSync(join(candidate, 'manifest.json'), 'utf8'));
manifest.images = { poster: 'poster.png', templateCard: 'template-card.png' };
writeFileSync(join(candidate, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
// 어느 단계든 실패하면 기존 앱 산출물은 그대로다. 실내 표면은 재사용하고 외관은 다시 굽지 않는다.
for (const file of ['core.glb', 'fixtures.glb', 'manifest.json', 'poster.png', 'template-card.png'])
  copyFileSync(join(candidate, file), join(published, file));
console.log(`[에셋] 예산 검사 뒤 반영 완료: ${published}`);
console.log(`[에셋] 장식 검수 그림: ${join(candidate, 'decorations.png')}`);
