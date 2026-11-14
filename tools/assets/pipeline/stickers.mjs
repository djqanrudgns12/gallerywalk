// 말풍선 스티커 그림(PRD_V2 M4-1, W-02): 그림 세션 최종 PNG → 3D 아틀라스(KTX2 UASTC) + 서랍 단추 WebP.
// 사용: node tools/assets/pipeline/stickers.mjs [원본 폴더=.local/art/m4/stickers/final] [출력 폴더=apps/web/public/assets/g/stk-1]
//   원본은 `NN-이름.png`(투명 정사각) `BUBBLE_STICKERS`장, 번호 순서가 `copy.bubble.stickers` 순서다.
// 결과: atlas.ktx2(`BUBBLE_ATLAS` 칸 배치, 그림은 칸 안 `pad`px 안쪽에 가운데 맞춤) + s01.webp~sNN.webp(`uiPx`²).
//   아틀라스는 왼쪽 아래가 UV (0,0)이 되게 굽는다(`--lower_left_maps_to_s0t0`) — 웹 `viewer/live/bubbleAtlas.ts`의 `stickerRect`가
//   캔버스 아틀라스(위가 v=1)와 같은 UV를 쓴다.
//   폴더 판 번호(`stk-1`)는 웹 `STICKER_BASE`와 같아야 한다 — 이미 낸 파일을 바꾸면 둘 다 올린다(영구 캐시, PLAN §9.6).
// 필요: `toktx`(KTX-Software 4.x), `sharp`(저장소 의존성). 아틀라스가 `maxBytes`를 넘으면 종료 코드 1.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '../../..');
const { config } = await import(join(root, 'packages/core/src/config.ts'));

const src = resolve(process.argv[2] ?? join(root, '.local/art/m4/stickers/final'));
const out = resolve(process.argv[3] ?? join(root, 'apps/web/public/assets/g/stk-1'));
const { cols, rows, cell, pad, uiPx, maxBytes } = config().BUBBLE_ATLAS;
const count = config().BUBBLE_STICKERS;

const files = readdirSync(src)
  .filter(name => /^\d{2}-[\w-]+\.png$/.test(name))
  .sort();
if (files.length !== count) {
  console.error(`스티커 원본이 ${files.length}장이다(필요 ${count}장): ${src}`);
  process.exit(1);
}
if (cols * rows < count) {
  console.error(`아틀라스 칸(${cols}×${rows})이 스티커 ${count}장보다 적다`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'stickers-'));
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
try {
  const inner = cell - pad * 2;
  const layers = [];
  for (const [i, name] of files.entries()) {
    const file = join(src, name);
    const meta = await sharp(file).metadata();
    if (meta.width !== meta.height || !meta.hasAlpha) {
      console.error(
        `정사각 투명 PNG가 아니다: ${name} (${meta.width}×${meta.height}, 알파 ${meta.hasAlpha})`,
      );
      process.exit(1);
    }
    const tile = await sharp(file)
      .resize(inner, inner, { fit: 'contain', background: transparent })
      .png()
      .toBuffer();
    layers.push({
      input: tile,
      left: (i % cols) * cell + pad,
      top: Math.floor(i / cols) * cell + pad,
    });
    const ui = join(out, `s${String(i + 1).padStart(2, '0')}.webp`);
    await sharp(file)
      .resize(uiPx, uiPx, { fit: 'contain', background: transparent })
      .webp({ quality: 85, alphaQuality: 90, effort: 6 })
      .toFile(ui);
    console.log(`${name} → ${ui.slice(root.length + 1)} ${statSync(ui).size}B`);
  }
  const atlasPng = join(work, 'atlas.png');
  await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: transparent } })
    .composite(layers)
    .png()
    .toFile(atlasPng);
  const atlas = join(out, 'atlas.ktx2');
  execFileSync(
    'toktx',
    [
      '--t2',
      '--encode',
      'uastc',
      '--uastc_quality',
      '2',
      '--zcmp',
      '19',
      '--genmipmap',
      '--assign_oetf',
      'srgb',
      '--lower_left_maps_to_s0t0',
      atlas,
      atlasPng,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const bytes = statSync(atlas).size;
  console.log(
    `아틀라스 ${cols * cell}×${rows * cell} ${count}칸 → ${atlas.slice(root.length + 1)} ${bytes}B`,
  );
  if (bytes > maxBytes) {
    console.error(`아틀라스가 상한 ${maxBytes}B를 넘는다`);
    process.exit(1);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
