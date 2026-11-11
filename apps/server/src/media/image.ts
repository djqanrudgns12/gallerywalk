import { join } from 'node:path';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { analyzeImage, type ImageAnalysis, type ImagePixels } from './analyze.ts';

export interface MediaVariant {
  readonly name: string;
  readonly ext: 'webp' | 'mp3' | 'm4a';
  readonly w: number;
  readonly h: number;
  readonly bytes: number;
  readonly path: string;
}

export interface ProcessedImage {
  readonly w: number;
  readonly h: number;
  readonly lowRes: boolean;
  readonly analysis: ImageAnalysis;
  readonly variants: readonly MediaVariant[];
}

const dimensionsSchema = z.object({
  autoOrient: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
});

export async function normalizeImage(input: string | Buffer, checkSize = true): Promise<ImagePixels> {
  sharp.concurrency(config().SHARP_THREADS);
  const pipeline = sharp(input, {
    limitInputPixels: config().SHARP_LIMIT_INPUT_PIXELS,
    failOn: 'error',
    pages: 1,
  });
  const metadata = dimensionsSchema.parse(await pipeline.metadata());
  const { width, height } = metadata.autoOrient;
  const short = Math.min(width, height);
  if (checkSize && short < config().MIN_SHORT_SIDE_PX) throw new AppError('E_FILE_TOO_SMALL');
  if (Math.max(width, height) / short > config().MAX_ASPECT) throw new AppError('E_ASPECT');
  // raw에는 방향·색 공간만 남는다. EXIF/ICC/XMP와 원본 파일은 파생 처리에 넘기지 않는다.
  const { data, info } = await pipeline
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function pixels(input: ImagePixels): ReturnType<typeof sharp> {
  return sharp(input.data, { raw: { width: input.w, height: input.h, channels: 4 } });
}

export async function writeWebp(
  pipeline: ReturnType<typeof sharp>,
  outDir: string,
  name: string,
  long: number,
  quality: number,
): Promise<MediaVariant> {
  const path = join(outDir, `${name}.webp`);
  const info = await pipeline
    .resize({ width: long, height: long, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toFile(path);
  return { name, ext: 'webp', w: info.width, h: info.height, bytes: info.size, path };
}

/** 호출자 소유의 빈 임시 폴더에만 쓴다. 공개와 실패 시 정리는 index.ts가 맡는다. */
export async function deriveImage(
  inputPath: string,
  outDir: string,
  includeLineProfile = false,
): Promise<ProcessedImage> {
  const input = await normalizeImage(inputPath);
  const ratio = input.w / input.h;
  const tall = ratio < config().FORM_PORTRAIT_MIN_R;
  const panorama = ratio > config().FORM_PANORAMA_MIN_R;
  const sliced = tall || panorama;
  const window = {
    left: 0,
    top: 0,
    width: panorama ? Math.min(input.w, Math.round(input.h * config().PANORAMA_WINDOW_RATIO)) : input.w,
    height: tall ? Math.min(input.h, Math.round(input.w / config().TALL_WINDOW_RATIO)) : input.h,
  };
  const variants: MediaVariant[] = [];
  for (const [name, size, quality] of [
    ['thumb', config().THUMB_PX, config().WEBP_Q_THUMB],
    ['wall', config().WALL_PX, config().WEBP_Q_WALL],
    ['wall-lo', config().WALL_LO_PX, config().WEBP_Q_WALL_LO],
  ] as const) {
    variants.push(await writeWebp(pixels(input).extract(window), outDir, name, size, quality));
  }
  if (sliced) {
    const scale = Math.min(1, config().STRIP_SHORT_MAX_PX / Math.min(input.w, input.h));
    const w = Math.max(1, Math.round(input.w * scale));
    const h = Math.max(1, Math.round(input.h * scale));
    // WebP의 한 변 상한을 넘지 않도록 전체 인코딩 없이 raw에서 띠를 잘라 낸다.
    const data =
      scale === 1 ? input.data : await pixels(input).resize(w, h, { fit: 'fill' }).raw().toBuffer();
    const normalized = { data, w, h };
    const long = Math.max(w, h);
    for (let offset = 0, i = 0; offset < long; offset += config().STRIP_PX, i++) {
      const length = Math.min(config().STRIP_PX, long - offset);
      const region = tall
        ? { left: 0, top: offset, width: w, height: length }
        : { left: offset, top: 0, width: length, height: h };
      variants.push(
        await writeWebp(
          pixels(normalized).extract(region),
          outDir,
          `strip-${i}`,
          config().STRIP_PX,
          config().WEBP_Q_ZOOM,
        ),
      );
    }
  } else {
    variants.push(await writeWebp(pixels(input), outDir, 'zoom', config().ZOOM_PX, config().WEBP_Q_ZOOM));
    if (Math.max(input.w, input.h) > config().ZOOM_PX) {
      variants.push(
        await writeWebp(pixels(input), outDir, 'zoom-hi', config().ZOOM_HI_PX, config().WEBP_Q_ZOOM),
      );
    }
  }
  return {
    w: input.w,
    h: input.h,
    lowRes: Math.min(input.w, input.h) < config().WARN_SHORT_SIDE_PX,
    analysis: await analyzeImage(input, includeLineProfile || sliced),
    variants,
  };
}

export async function deriveCover(input: Buffer, outDir: string): Promise<MediaVariant> {
  const type = await fileTypeFromBuffer(input);
  if (type === undefined || !['jpg', 'png', 'webp', 'gif'].includes(type.ext)) {
    throw new AppError('E_FILE_TYPE');
  }
  return writeWebp(
    pixels(await normalizeImage(input, false)),
    outDir,
    'cover',
    config().THUMB_PX,
    config().WEBP_Q_THUMB,
  );
}
