import { readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, gzip } from 'node:zlib';

// 이미 압축된 이미지·3D·글꼴·음원과 압축 사본은 대상이 아니다.
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.wasm', '.webmanifest']);
const br = promisify(brotliCompress);
const gz = promisify(gzip);

/**
 * Vite와 서비스 워커 목록 생성이 모두 끝난 뒤 실행한다. 원본과 목록은 고치지 않아
 * `__GALLERY_SW_MANIFEST__`에 .br·.gz가 들어가지 않는다. 파일마다 순서대로 처리한다.
 */
export async function precompress(dist: string): Promise<void> {
  for (const entry of await readdir(dist, { withFileTypes: true })) {
    const path = join(dist, entry.name);
    if (entry.isDirectory()) await precompress(path);
    else if (entry.isFile() && COMPRESSIBLE.has(extname(entry.name).toLowerCase())) {
      const source = await readFile(path);
      await writeFile(`${path}.br`, await br(source));
      await writeFile(`${path}.gz`, await gz(source));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await precompress(fileURLToPath(new URL('../dist/', import.meta.url)));
