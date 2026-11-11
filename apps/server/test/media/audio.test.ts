import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { parseFile } from 'music-metadata';
import { analyzePcm, inspectAudio, stripMp3Tags } from '../../src/media/audio.ts';
import { processAudio } from '../../src/media/index.ts';
import { makeTaggedMp3, makeWorkspace, wavBytes } from '../fixtures/make.ts';
import { extensibleWav, makeLocationM4a } from './fixtures.ts';

let root: string;
beforeEach(async () => {
  root = await makeWorkspace();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('11분 8kHz WAV는 길이를 읽고 변환 전에 거절한다', async () => {
  const source = join(root, 'long.wav');
  await writeFile(source, wavBytes(11 * 60, { sampleRate: 8000 }));
  expect((await inspectAudio(source)).durationMs).toBe(660000);
  await expect(processAudio(source, join(root, 'out'))).rejects.toMatchObject({ code: 'E_AUDIO_LENGTH' });
  expect(await readdir(root)).toEqual(['long.wav']);
});

it('50ms PCM 창은 22.05kHz의 반 샘플 오차를 누적하지 않는다', () => {
  const analysis = analyzePcm(wavBytes(12, { sampleRate: 22050, startSec: 10, endSec: 11 }));
  expect(Math.abs(analysis.audibleStartMs - 10000)).toBeLessThanOrEqual(1);
  expect(Math.abs(analysis.audibleEndMs - 11000)).toBeLessThanOrEqual(1);
  expect(analysis.loudnessDb).toBeCloseTo(10 * Math.log10(0.25 ** 2 / 2), 1);
});

it('WAVE_FORMAT_EXTENSIBLE의 정수 PCM도 같은 무음 경계와 크기로 분석한다', () => {
  const wav = wavBytes(3, { sampleRate: 22050, startSec: 0.5, endSec: 2.5 });
  expect(analyzePcm(extensibleWav(wav))).toEqual(analyzePcm(wav));
});

it.each([
  ['부동소수점 하위 형식', (wav: Buffer) => wav.writeUInt32LE(3, 44)],
  ['잘못된 GUID', (wav: Buffer) => wav.writeUInt8(0, 59)],
  ['잘린 확장 헤더', (wav: Buffer) => wav.writeUInt16LE(24, 36)],
  ['다른 유효 비트 수', (wav: Buffer) => wav.writeUInt16LE(8, 38)],
] as const)('확장 WAV의 %s를 정수 PCM으로 읽지 않는다', (_name, damage) => {
  const wav = extensibleWav(wavBytes(1, { sampleRate: 22050 }));
  damage(wav);
  expect(() => analyzePcm(wav)).toThrow('E_FILE_BROKEN');
});

it('완전한 무음은 JSON에 저장 가능한 null 크기를 반환한다', () => {
  expect(analyzePcm(wavBytes(1, { sampleRate: 22050 }))).toEqual({
    audibleStartMs: 0,
    audibleEndMs: 0,
    loudnessDb: null,
  });
});

it('ID3v2·ID3v1·APE와 표지를 빼고 MP3 프레임은 그대로 둔다', async () => {
  const source = join(root, 'tagged.mp3');
  const frames = await makeTaggedMp3(source);
  const metadata = await parseFile(source, { duration: true });
  expect(metadata.common.title).toBe('Synthetic title');
  expect(metadata.common.picture).toHaveLength(1);
  expect(metadata.format.tagTypes).toContain('APEv2');
  const stripped = stripMp3Tags(await readFile(source));
  expect(stripped).toEqual(frames);
  const clean = join(root, 'clean.mp3');
  await writeFile(clean, stripped);
  const result = await parseFile(clean, { duration: true });
  expect(result.common.title).toBeUndefined();
  expect(result.common.picture).toBeUndefined();
  expect(Object.keys(result.native)).toEqual([]);
  expect(result.format.duration).toBeGreaterThan(1);
});

it('깨진 MP3 태그와 소리 파일을 거절한다', async () => {
  expect(() => stripMp3Tags(Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]))).toThrow(
    'E_FILE_BROKEN',
  );
  const source = join(root, 'broken.wav');
  await writeFile(source, Buffer.from('synthetic broken audio'));
  await expect(processAudio(source, join(root, 'out'))).rejects.toMatchObject({ code: 'E_FILE_TYPE' });
  expect(await readdir(root)).toEqual(['broken.wav']);
});

describe.skipIf(process.platform !== 'darwin')('macOS 소리 변환', () => {
  it('앞뒤 무음 시험음을 AAC로 바꿔 들리는 시작·끝을 ±60ms로 찾는다', async () => {
    const source = join(root, 'tone.wav');
    await writeFile(source, wavBytes(3, { startSec: 0.5, endSec: 2.5 }));
    const before = await readFile(source);
    const result = await processAudio(source, join(root, 'out'));
    expect(Math.abs(result.analysis.audibleStartMs - 500)).toBeLessThanOrEqual(60);
    expect(Math.abs(result.analysis.audibleEndMs - 2500)).toBeLessThanOrEqual(60);
    expect(result.analysis.loudnessDb).toBeCloseTo(10 * Math.log10(0.25 ** 2 / 2), 0);
    expect(result.durationMs).toBe(3000);
    expect(result.variants.map(v => v.ext)).toEqual(['m4a']);
    const output = await parseFile(result.variants[0]!.path);
    expect(Object.keys(output.native)).toEqual([]);
    expect(await readFile(source)).toEqual(before);
    expect((await readdir(root)).sort()).toEqual(['out', 'tone.wav']);
  });

  it('M4A의 위치 atom·위치가 든 댓글이 재인코딩 결과에 남지 않는다', async () => {
    const wav = join(root, 'tone.wav');
    const source = join(root, 'location.m4a');
    await writeFile(wav, wavBytes(2, { startSec: 0.2, endSec: 1.8 }));
    await makeLocationM4a(wav, source);
    const before = await parseFile(source);
    expect(before.common.comment?.[0]?.text).toContain('+37.5000+127.0000/');
    expect((await readFile(source)).includes(Buffer.from('+37.5000+127.0000/'))).toBe(true);
    const result = await processAudio(source, join(root, 'out'));
    const output = result.variants[0]!;
    const after = await parseFile(output.path);
    expect(after.common.comment).toBeUndefined();
    expect(Object.keys(after.native)).toEqual([]);
    expect((await readFile(output.path)).includes(Buffer.from('+37.5000+127.0000/'))).toBe(false);
  });

  it('합성 MP3를 디코딩해 분석하고 표지를 별도 WebP로 꺼낸다', async () => {
    const source = join(root, 'tagged.mp3');
    const frames = await makeTaggedMp3(source);
    const result = await processAudio(source, join(root, 'out'));
    const audio = result.variants.find(v => v.name === 'audio')!;
    const cover = result.variants.find(v => v.name === 'cover')!;
    expect(await readFile(audio.path)).toEqual(frames);
    expect(result.analysis.audibleStartMs).toBe(0);
    expect(result.analysis.audibleEndMs).toBe(0);
    expect(result.analysis.loudnessDb).toBeNull();
    expect((await sharp(cover.path).metadata()).format).toBe('webp');
    expect((await parseFile(audio.path)).common.picture).toBeUndefined();
    expect((await readdir(join(root, 'out'))).sort()).toEqual(['audio.mp3', 'cover.webp']);
  });
});
