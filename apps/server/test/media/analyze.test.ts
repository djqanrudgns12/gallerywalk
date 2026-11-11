import { afterEach, beforeEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { analyzeImage } from '../../src/media/analyze.ts';
import { normalizeImage } from '../../src/media/image.ts';
import { makeImage, makeWorkspace } from '../fixtures/make.ts';

let root: string;
beforeEach(async () => {
  root = await makeWorkspace();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('40px 줄 간격을 축소하지 않은 활동량에서 ±2px로 찾는다', async () => {
  const source = join(root, 'stripes.png');
  await makeImage(source, 800, 2000, { stripes: 40 });
  const analysis = await analyzeImage(await normalizeImage(source), true);
  expect(analysis.linePitchPx).not.toBeNull();
  expect(Math.abs(analysis.linePitchPx! - 40)).toBeLessThanOrEqual(2);
  expect(analysis.linePitchConfidence).toBeGreaterThanOrEqual(0.6);
  expect(analysis.profileBinPx).toBe(8);
  const profile = Buffer.from(analysis.lineProfile!, 'base64');
  expect(profile.length).toBe(250);
  expect(Math.max(...profile)).toBe(255);
  expect(profile[1]).toBe(0);
});

it('줄무늬 없는 그림은 줄 간격을 만들지 않는다', async () => {
  const source = join(root, 'plain.png');
  await makeImage(source, 800, 1600);
  const analysis = await analyzeImage(await normalizeImage(source));
  expect(analysis.linePitchPx).toBeNull();
  expect(analysis.linePitchConfidence).toBe(0);
  expect(analysis.lineProfile).toBeNull();
  expect(analysis.edgeLuma).toBeCloseTo(1);
});

it('가장자리 8%의 세로 테두리는 줄 활동량에서 제외한다', async () => {
  const data = Buffer.alloc(800 * 1600 * 4, 255);
  for (let y = 0; y < 1600; y++) {
    for (let x = 0; x < 50; x++) {
      const p = (y * 800 + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = y % 40 < 4 ? 0 : 255;
    }
  }
  const analysis = await analyzeImage({ data, w: 800, h: 1600 }, true);
  expect(analysis.linePitchPx).toBeNull();
  expect(Buffer.from(analysis.lineProfile!, 'base64').every(v => v === 0)).toBe(true);
  expect(analysis.edgeLuma).toBeLessThan(1);
});

it('짧은 변 2400px 초과 시에도 원본 좌표의 줄 간격을 반환한다', async () => {
  const source = join(root, 'large-stripes.png');
  await makeImage(source, 2600, 3200, { stripes: 40 });
  const analysis = await analyzeImage(await normalizeImage(source), true);
  expect(analysis.linePitchPx).not.toBeNull();
  expect(Math.abs(analysis.linePitchPx! - 40)).toBeLessThanOrEqual(2);
});

it('긴 활동량은 끝부분을 버리지 않고 4096칸 안에 담는다', async () => {
  const w = 300;
  const h = 40000;
  const data = Buffer.alloc(w * h * 4, 255);
  for (let y = h - 40; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = y % 8 < 4 ? 0 : 255;
    }
  const analysis = await analyzeImage({ data, w, h }, true);
  const profile = Buffer.from(analysis.lineProfile!, 'base64');
  expect(profile.length).toBeLessThanOrEqual(4096);
  expect(analysis.profileBinPx % 8).toBe(0);
  expect(profile.subarray(-3).some(value => value > 0)).toBe(true);
});
