import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { processImage } from '../../src/media/index.ts';
import { deriveCover } from '../../src/media/image.ts';
import { makeHeic, makeImage, makeWorkspace } from '../fixtures/make.ts';

let root: string;
beforeEach(async () => {
  root = await makeWorkspace();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('그림 처리', () => {
  it('소리 표지도 허용된 래스터 형식만 받는다', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900"/>');
    await expect(deriveCover(svg, root)).rejects.toMatchObject({ code: 'E_FILE_TYPE' });
    expect(await readdir(root)).toEqual([]);
  });
  it('GPS EXIF를 포함한 원본은 보존하고 모든 파생에서 메타데이터를 버린다', async () => {
    const source = join(root, 'gps.jpg');
    await makeImage(source, 1000, 1200, { gps: true });
    const before = await readFile(source);
    const metadata = await sharp(before).metadata();
    expect(metadata.exif).toBeDefined();
    // TIFF GPSInfo 포인터(0x8825)가 합성 EXIF에 실제로 들어 있다.
    expect(
      metadata.exif!.includes(Buffer.from([0x25, 0x88])) ||
        metadata.exif!.includes(Buffer.from([0x88, 0x25])),
    ).toBe(true);
    const result = await processImage(source, join(root, 'out'));
    expect(result.variants.map(v => v.name)).toEqual(['thumb', 'wall', 'wall-lo', 'zoom']);
    for (const variant of result.variants) {
      const output = await sharp(variant.path).metadata();
      expect(output.exif).toBeUndefined();
      expect(output.xmp).toBeUndefined();
      expect(output.icc).toBeUndefined();
      expect(output.orientation).toBeUndefined();
      expect(output.space).toBe('srgb');
      expect([output.width, output.height]).toEqual([variant.w, variant.h]);
      expect((await readFile(variant.path)).length).toBe(variant.bytes);
    }
    expect(await readFile(source)).toEqual(before);
    expect((await readdir(root)).sort()).toEqual(['gps.jpg', 'out']);
  });

  it('투명 PNG의 투명 부분과 불투명 부분을 WebP에서도 유지한다', async () => {
    const source = join(root, 'alpha.png');
    await makeImage(source, 800, 900, { alpha: true });
    const result = await processImage(source, join(root, 'out'));
    for (const variant of result.variants) {
      expect((await sharp(variant.path).metadata()).hasAlpha).toBe(true);
      const stats = await sharp(variant.path).stats();
      expect(stats.channels[3]?.min).toBe(0);
      expect(stats.channels[3]?.max).toBe(255);
    }
  });

  it('EXIF 6을 먼저 회전해 가로 그림으로 만들고 회전 태그를 버린다', async () => {
    const source = join(root, 'rotated.jpg');
    // EXIF 문자열 필드만 쓰면 libvips의 기본 orientation 값이 우선한다.
    await sharp({ create: { width: 600, height: 900, channels: 3, background: '#ae7251' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(source);
    expect((await sharp(source).metadata()).orientation).toBe(6);
    const result = await processImage(source, join(root, 'out'));
    expect([result.w, result.h]).toEqual([900, 600]);
    const wall = result.variants.find(v => v.name === 'wall')!;
    expect([wall.w, wall.h]).toEqual([900, 600]);
    expect((await sharp(wall.path).metadata()).orientation).toBeUndefined();
  });

  it.each([
    [800, 20000],
    [20000, 800],
    [1600, 8000],
  ])('%i×%i는 짧은 변을 유지하고 겹침 없이 띠로 나누며 첫 창을 보여 준다', async (w, h) => {
    const source = join(root, 'long.png');
    await makeImage(source, w, h, { bands: true });
    const result = await processImage(source, join(root, 'out'));
    const strips = result.variants.filter(v => v.name.startsWith('strip-'));
    const scale = Math.min(1, 1440 / Math.min(w, h));
    const long = Math.round(Math.max(w, h) * scale);
    const short = Math.round(Math.min(w, h) * scale);
    expect(strips).toHaveLength(Math.ceil(long / 2048));
    expect(strips.reduce((sum, v) => sum + (h > w ? v.h : v.w), 0)).toBe(long);
    expect(strips.map(v => (h > w ? v.w : v.h))).toEqual(strips.map(() => short));
    expect(result.variants.some(v => v.name === 'zoom')).toBe(false);
    for (const name of ['thumb', 'wall', 'wall-lo']) {
      const variant = result.variants.find(v => v.name === name)!;
      expect(variant.w / variant.h).toBeCloseTo(h > w ? 0.62 : 1.6, 2);
    }
    if (Math.min(w, h) === 800) {
      const wall = result.variants.find(v => v.name === 'wall')!;
      const mean = (await sharp(wall.path).stats()).channels;
      expect(mean[0]!.mean).toBeGreaterThan(200);
      expect(mean[2]!.mean).toBeLessThan(30);
    }
    expect(result.analysis.lineProfile).not.toBeNull();
    expect(Buffer.from(result.analysis.lineProfile!, 'base64').length).toBeLessThanOrEqual(4096);
  });

  it('원본이 클 때만 zoom-hi를 만들고 원본 크기 이상으로 늘리지 않는다', async () => {
    const source = join(root, 'large.png');
    await makeImage(source, 2200, 1600);
    const result = await processImage(source, join(root, 'out'));
    expect(result.variants.find(v => v.name === 'zoom')?.w).toBe(2048);
    expect(result.variants.find(v => v.name === 'zoom-hi')?.w).toBe(2200);
  });

  it('299px는 거절하고 799px는 경고 값만 반환한다', async () => {
    const small = join(root, 'small.png');
    const low = join(root, 'low.png');
    await makeImage(small, 299, 600);
    await makeImage(low, 799, 900);
    await expect(processImage(small, join(root, 'small-out'))).rejects.toMatchObject({
      code: 'E_FILE_TOO_SMALL',
    });
    expect((await processImage(low, join(root, 'low-out'))).lowRes).toBe(true);
    expect((await readdir(root)).sort()).toEqual(['low-out', 'low.png', 'small.png']);
  });

  it('비율 31과 깨진 파일을 거절하고 부분 결과를 남기지 않는다', async () => {
    const long = join(root, 'long.png');
    const broken = join(root, 'broken.png');
    await makeImage(long, 300, 9300);
    await writeFile(broken, Buffer.from('synthetic broken image'));
    await expect(processImage(long, join(root, 'long-out'))).rejects.toMatchObject({ code: 'E_ASPECT' });
    await expect(processImage(broken, join(root, 'broken-out'))).rejects.toMatchObject({
      code: 'E_FILE_BROKEN',
    });
    expect((await readdir(root)).sort()).toEqual(['broken.png', 'long.png']);
  });

  it('이미 있는 결과를 덮어쓰지 않는다', async () => {
    const source = join(root, 'source.png');
    await makeImage(source, 800, 900);
    await processImage(source, join(root, 'out'));
    const original = await readFile(join(root, 'out', 'wall.webp'));
    await expect(processImage(source, join(root, 'out'))).rejects.toMatchObject({ code: 'E_CONFLICT' });
    expect(await readFile(join(root, 'out', 'wall.webp'))).toEqual(original);
  });

  it.skipIf(process.platform !== 'darwin')(
    'sips가 만든 HEIC를 JPEG로 바꿔 같은 파이프라인에 넣는다',
    async () => {
      const jpeg = join(root, 'source.jpg');
      const heic = join(root, 'source.heic');
      await makeImage(jpeg, 900, 1200, { gps: true });
      await makeHeic(jpeg, heic);
      const result = await processImage(heic, join(root, 'out'));
      expect([result.w, result.h]).toEqual([900, 1200]);
      expect(result.variants.length).toBe(4);
      for (const variant of result.variants)
        expect((await sharp(variant.path).metadata()).exif).toBeUndefined();
      expect((await readdir(root)).sort()).toEqual(['out', 'source.heic', 'source.jpg']);
    },
  );
});
