import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileTypeFromFile } from 'file-type';
import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { deriveImage, type MediaVariant, type ProcessedImage } from './image.ts';
import { deriveAudio, type ProcessedAudio } from './audio.ts';
import { convertHeic } from './heic.ts';

export type { MediaVariant, ProcessedImage } from './image.ts';
export type { ImageAnalysis } from './analyze.ts';
export { inspectAudio } from './audio.ts';
export type { AudioAnalysis, AudioInspection, ProcessedAudio } from './audio.ts';

/** 새 asset 폴더만 만들고, 파생 생성이 끝나면 공개 이름으로 옮긴다. */
async function withOutput<T extends { readonly variants: readonly MediaVariant[] }>(
  outDir: string,
  generate: (stage: string, work: string) => Promise<T>,
): Promise<T> {
  const destination = resolve(outDir);
  await mkdir(dirname(destination), { recursive: true });
  const work = await mkdtemp(join(dirname(destination), '.media-'));
  const stage = join(work, 'variants');
  let ownsDestination = false;
  try {
    await mkdir(stage);
    const result = await generate(stage, work);
    try {
      await mkdir(destination);
      ownsDestination = true;
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'EEXIST') {
        throw new AppError('E_CONFLICT');
      }
      throw cause;
    }
    for (const name of await readdir(stage)) await rename(join(stage, name), join(destination, name));
    return {
      ...result,
      variants: result.variants.map(variant => ({
        ...variant,
        path: join(destination, basename(variant.path)),
      })),
    };
  } catch (cause) {
    if (ownsDestination) await rm(destination, { recursive: true, force: true });
    if (cause instanceof AppError) throw cause;
    throw new AppError('E_FILE_BROKEN', { cause });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** 원본은 호출자의 소유다. 성공·실패 모두 삭제하지 않는다(P3-4에서 관리). */
export async function processImage(
  inputPath: string,
  outDir: string,
  options: { readonly includeLineProfile?: boolean } = {},
): Promise<ProcessedImage> {
  return withOutput(outDir, async (stage, work) => {
    if ((await stat(inputPath)).size > config().MAX_IMAGE_MB * 1024 ** 2) {
      throw new AppError('E_FILE_TOO_LARGE');
    }
    const type = await fileTypeFromFile(inputPath);
    if (type === undefined) throw new AppError('E_FILE_BROKEN');
    let path = inputPath;
    if (type.ext === 'heic' || type.ext === 'heif') {
      path = join(work, 'converted.jpg');
      await convertHeic(inputPath, path);
    } else if (!['jpg', 'png', 'webp', 'gif'].includes(type.ext)) {
      throw new AppError('E_FILE_TYPE');
    }
    return deriveImage(path, stage, options.includeLineProfile);
  });
}

export async function processAudio(inputPath: string, outDir: string): Promise<ProcessedAudio> {
  return withOutput(outDir, (stage, work) => deriveAudio(inputPath, stage, work));
}
