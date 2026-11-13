import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { precompress } from '../../../web/scripts/precompress.ts';
import { makeTempDir } from '../helpers/server.ts';

let root: string;
let dist: string;
const SOURCE = '/* 합성 빌드 파일 */\n'.repeat(256);

beforeEach(async () => {
  root = await makeTempDir();
  dist = join(root, 'dist');
  await mkdir(join(dist, 'assets/g'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('웹 빌드 뒤 정적 파일 압축', () => {
  it('대상 확장자만 br·gzip으로 만들고 원본·서비스 워커 목록은 그대로 둔다', async () => {
    const manifest = JSON.stringify({ version: '합성 판', urls: ['/', '/assets/g/app.js'] });
    const sw = `const manifest = ${JSON.stringify(manifest)};`;
    const originals = new Map([
      ['index.html', SOURCE],
      ['sw.js', sw],
      ...['js', 'mjs', 'css', 'svg', 'json', 'wasm', 'webmanifest'].map(
        ext => [`assets/g/file.${ext}`, SOURCE] as const,
      ),
    ]);
    const excluded = ['glb', 'ktx2', 'webp', 'woff2', 'mp3', 'png', 'bin', 'br', 'gz', 'map'];
    for (const [file, source] of originals) await writeFile(join(dist, file), source);
    for (const ext of excluded) await writeFile(join(dist, `assets/g/skip.${ext}`), SOURCE);
    await writeFile(join(root, 'outside.js'), SOURCE);
    await symlink(join(root, 'outside.js'), join(dist, 'assets/g/link.js'));
    await symlink(root, join(dist, 'linked-directory'));

    await precompress(dist);

    for (const [file, source] of originals) {
      expect(await readFile(join(dist, file), 'utf8')).toBe(source);
      const br = await readFile(join(dist, `${file}.br`));
      const gzip = await readFile(join(dist, `${file}.gz`));
      expect(brotliDecompressSync(br).toString()).toBe(source);
      expect(gunzipSync(gzip).toString()).toBe(source);
      if (source === SOURCE) {
        expect(br.length).toBeLessThan(Buffer.byteLength(source));
        expect(gzip.length).toBeLessThan(Buffer.byteLength(source));
      }
    }
    expect(await readFile(join(dist, 'sw.js'), 'utf8')).toBe(sw);
    const files = await readdir(join(dist, 'assets/g'));
    for (const ext of excluded) {
      expect(files).not.toContain(`skip.${ext}.br`);
      expect(files).not.toContain(`skip.${ext}.gz`);
    }
    expect(files).not.toContain('link.js.br');
    expect(files).not.toContain('link.js.gz');
    expect(await readdir(root)).toEqual(['dist', 'outside.js']);
  });

  it('다시 실행하면 사본을 갱신하고 압축 사본을 겹쳐 압축하지 않는다', async () => {
    const file = join(dist, 'assets/g/app.js');
    await writeFile(file, SOURCE);
    await precompress(dist);
    const updated = `${SOURCE}/* 수정 */`;
    await writeFile(file, updated);
    await precompress(dist);
    expect(brotliDecompressSync(await readFile(`${file}.br`)).toString()).toBe(updated);
    expect(gunzipSync(await readFile(`${file}.gz`)).toString()).toBe(updated);
    expect(await readdir(join(dist, 'assets/g'))).toEqual(['app.js', 'app.js.br', 'app.js.gz']);
  });
});
