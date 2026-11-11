import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileTypeFromBuffer, fileTypeFromFile } from 'file-type';
import { parseFile } from 'music-metadata';
import { z } from 'zod';
import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { deriveCover, type MediaVariant } from './image.ts';

const run = promisify(execFile);
const durationSchema = z.number().finite().positive();
const pictureSchema = z.object({ data: z.instanceof(Uint8Array) });

export interface AudioInspection {
  readonly format: 'mp3' | 'm4a' | 'wav';
  readonly durationMs: number;
  readonly cover: Buffer | null;
}

export interface AudioAnalysis {
  readonly audibleStartMs: number;
  readonly audibleEndMs: number;
  /** 완전한 무음은 null. JSON에 저장할 수 없는 -Infinity를 내보내지 않는다. */
  readonly loudnessDb: number | null;
}

export interface ProcessedAudio {
  readonly durationMs: number;
  readonly analysis: AudioAnalysis;
  readonly variants: readonly MediaVariant[];
}

/** 길이 판정만 따로 할 수 있어 긴 파일을 디코딩하기 전에 거절할 수 있다. */
export async function inspectAudio(inputPath: string): Promise<AudioInspection> {
  try {
    const type = await fileTypeFromFile(inputPath);
    const format = type?.ext;
    if (format !== 'mp3' && format !== 'm4a' && format !== 'wav') throw new AppError('E_FILE_TYPE');
    if ((await stat(inputPath)).size > config().MAX_AUDIO_MB * 1024 ** 2) {
      throw new AppError('E_FILE_TOO_LARGE');
    }
    const metadata = await parseFile(inputPath, { duration: true });
    const durationMs = durationSchema.parse(metadata.format.duration) * 1000;
    const picture = metadata.common.picture?.[0];
    return {
      format,
      durationMs,
      cover: picture === undefined ? null : Buffer.from(pictureSchema.parse(picture).data),
    };
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError('E_FILE_BROKEN', { cause });
  }
}

/** 태그 영역만 제거하고 MPEG 프레임은 바이트 단위로 보존한다. */
export function stripMp3Tags(input: Buffer): Buffer {
  let start = 0;
  let end = input.length;
  while (input.toString('ascii', start, start + 3) === 'ID3') {
    if (start + 10 > end) throw new AppError('E_FILE_BROKEN');
    const version = input[start + 3]!;
    if (version < 2 || version > 4) throw new AppError('E_FILE_BROKEN');
    let size = 0;
    for (let i = start + 6; i < start + 10; i++) {
      if (input[i]! & 0x80) throw new AppError('E_FILE_BROKEN');
      size = size * 128 + input[i]!;
    }
    const footer = version === 4 && (input[start + 5]! & 0x10) !== 0 ? 10 : 0;
    start += 10 + size + footer;
    if (start > end) throw new AppError('E_FILE_BROKEN');
  }
  // APEv2는 보통 끝에 있지만 선두 헤더 형식도 처리한다.
  while (input.toString('ascii', start, start + 8) === 'APETAGEX') {
    if (start + 32 > end) throw new AppError('E_FILE_BROKEN');
    const size = input.readUInt32LE(start + 12);
    if (size < 32 || start + 32 + size > end) throw new AppError('E_FILE_BROKEN');
    start += 32 + size;
  }
  for (;;) {
    if (end - start >= 128 && input.toString('ascii', end - 128, end - 125) === 'TAG') {
      end -= 128;
      continue;
    }
    if (end - start >= 32 && input.toString('ascii', end - 32, end - 24) === 'APETAGEX') {
      const size = input.readUInt32LE(end - 20);
      if (size < 32 || size > end - start) throw new AppError('E_FILE_BROKEN');
      end -= size;
      if (end - start >= 32 && input.toString('ascii', end - 32, end - 24) === 'APETAGEX') end -= 32;
      continue;
    }
    break;
  }
  if (end <= start) throw new AppError('E_FILE_BROKEN');
  return input.subarray(start, end);
}

/** 태그를 같은 크기의 빈 상자로 바꿔 mdat와 stco/co64의 절대 위치를 보존한다. */
function stripM4aTags(input: Buffer): Buffer {
  const output = Buffer.from(input);
  function stripBoxes(start: number, end: number): void {
    for (let position = start; position < end;) {
      if (end - position < 8) throw new AppError('E_FILE_BROKEN');
      const shortSize = output.readUInt32BE(position);
      const headerSize = shortSize === 1 ? 16 : 8;
      if (end - position < headerSize) throw new AppError('E_FILE_BROKEN');
      let size = shortSize;
      if (shortSize === 1) size = Number(output.readBigUInt64BE(position + 8));
      if (shortSize === 0) size = end - position;
      if (!Number.isSafeInteger(size) || size < headerSize || size > end - position) {
        throw new AppError('E_FILE_BROKEN');
      }
      const name = output.toString('ascii', position + 4, position + 8);
      if (name === 'udta' || name === 'meta') {
        output.write('free', position + 4, 4, 'ascii');
        output.fill(0, position + headerSize, position + size);
      } else if (name === 'moov') {
        stripBoxes(position + headerSize, position + size);
      }
      position += size;
    }
  }
  stripBoxes(0, output.length);
  return output;
}

const pcmFormatSchema = z.object({
  encoding: z.literal(1),
  channels: z.number().int().positive(),
  sampleRate: z.number().int().positive(),
  bits: z.literal(16),
});

/** afconvert가 만든 RIFF에서 fmt/data만 읽는다. LIST·ID3 등 부가 상자는 버린다. */
function readPcm(wav: Buffer): { data: Buffer; channels: number; sampleRate: number } {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new AppError('E_FILE_BROKEN');
  }
  let format: z.infer<typeof pcmFormatSchema> | undefined;
  let data: Buffer | undefined;
  for (let position = 12; position + 8 <= wav.length;) {
    const name = wav.toString('ascii', position, position + 4);
    const size = wav.readUInt32LE(position + 4);
    const body = position + 8;
    if (body + size > wav.length) throw new AppError('E_FILE_BROKEN');
    if (name === 'fmt ') {
      if (size < 16) throw new AppError('E_FILE_BROKEN');
      let encoding = wav.readUInt16LE(body);
      if (encoding === 0xfffe) {
        // afconvert는 LEI16도 WAVE_FORMAT_EXTENSIBLE로 쓴다. 하위 형식이
        // KSDATAFORMAT_SUBTYPE_PCM인 16비트 정수일 때만 기존 PCM 경로로 넘긴다.
        if (
          size < 40 ||
          wav.readUInt16LE(body + 16) < 22 ||
          wav.readUInt16LE(body + 16) > size - 18 ||
          wav.readUInt16LE(body + 18) !== 16 ||
          !wav.subarray(body + 24, body + 40).equals(Buffer.from('0100000000001000800000aa00389b71', 'hex'))
        )
          throw new AppError('E_FILE_BROKEN');
        encoding = 1;
      }
      format = pcmFormatSchema.parse({
        encoding,
        channels: wav.readUInt16LE(body + 2),
        sampleRate: wav.readUInt32LE(body + 4),
        bits: wav.readUInt16LE(body + 14),
      });
    } else if (name === 'data') data = wav.subarray(body, body + size);
    position = body + size + (size % 2);
  }
  if (
    format === undefined ||
    data === undefined ||
    data.length === 0 ||
    data.length % (format.channels * 2) !== 0
  )
    throw new AppError('E_FILE_BROKEN');
  return { data, channels: format.channels, sampleRate: format.sampleRate };
}

function cleanWav(pcm: ReturnType<typeof readPcm>): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(pcm.data.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(pcm.channels, 22);
  header.writeUInt32LE(pcm.sampleRate, 24);
  header.writeUInt32LE(pcm.sampleRate * pcm.channels * 2, 28);
  header.writeUInt16LE(pcm.channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.data.length, 40);
  return Buffer.concat([header, pcm.data]);
}

export function analyzePcm(wav: Buffer): AudioAnalysis {
  const pcm = readPcm(wav);
  if (pcm.channels !== 1 || pcm.sampleRate !== config().AUDIO_ANALYSIS_SAMPLE_RATE)
    throw new AppError('E_FILE_BROKEN');
  const samples = pcm.data.length / 2;
  let audibleStartMs: number | null = null;
  let audibleEndMs = 0;
  let loudEnergy = 0;
  let loudSamples = 0;
  const silenceEnergy = 10 ** (config().AUDIO_SILENCE_DBFS / 10);
  const gateEnergy = 10 ** (config().AUDIO_LOUDNESS_GATE_DBFS / 10);
  // 22.05kHz의 50ms는 1102.5샘플이다. 창마다 시각으로 반올림해 누적 오차를 막는다.
  for (let window = 0; ; window++) {
    const start = Math.round((window * config().AUDIO_ANALYSIS_WINDOW_MS * pcm.sampleRate) / 1000);
    if (start >= samples) break;
    const end = Math.min(
      samples,
      Math.round(((window + 1) * config().AUDIO_ANALYSIS_WINDOW_MS * pcm.sampleRate) / 1000),
    );
    let energy = 0;
    for (let i = start; i < end; i++) energy += (pcm.data.readInt16LE(i * 2) / 32768) ** 2;
    const mean = energy / (end - start);
    if (mean > silenceEnergy) {
      audibleStartMs ??= (start / pcm.sampleRate) * 1000;
      audibleEndMs = (end / pcm.sampleRate) * 1000;
    }
    if (mean > gateEnergy) {
      loudEnergy += energy;
      loudSamples += end - start;
    }
  }
  return {
    audibleStartMs: audibleStartMs ?? 0,
    audibleEndMs,
    loudnessDb: loudSamples > 0 ? 10 * Math.log10(loudEnergy / loudSamples) : null,
  };
}

async function convert(args: readonly string[]): Promise<void> {
  if (process.platform !== 'darwin') throw new AppError('E_FILE_TYPE');
  try {
    await run('/usr/bin/afconvert', [...args], { timeout: config().TOOL_TIMEOUT_MS, killSignal: 'SIGKILL' });
  } catch (cause) {
    throw new AppError('E_FILE_BROKEN', { cause });
  }
}

/** 호출자의 작업 폴더에 파생만 남긴다. 중간 PCM은 workDir에 격리한다. */
export async function deriveAudio(
  inputPath: string,
  outDir: string,
  workDir: string,
): Promise<ProcessedAudio> {
  const inspection = await inspectAudio(inputPath);
  if (inspection.durationMs > config().AUDIO_MAX_MIN * 60 * 1000) {
    throw new AppError('E_AUDIO_LENGTH', { fields: { durationMs: String(inspection.durationMs) } });
  }
  const variants: MediaVariant[] = [];
  const ext = inspection.format === 'mp3' ? 'mp3' : 'm4a';
  const path = join(outDir, `audio.${ext}`);
  if (ext === 'mp3') {
    const stripped = stripMp3Tags(await readFile(inputPath));
    if ((await fileTypeFromBuffer(stripped))?.ext !== 'mp3') throw new AppError('E_FILE_BROKEN');
    await writeFile(path, stripped, { flag: 'wx' });
  } else {
    const decoded = join(workDir, 'decoded.wav');
    const clean = join(workDir, 'clean.wav');
    await convert([inputPath, decoded, '-f', 'WAVE', '-d', 'LEI16']);
    // 위치 상자를 포함한 모든 메타데이터가 AAC 인코더 입력에 도달하지 않게 한다.
    await writeFile(clean, cleanWav(readPcm(await readFile(decoded))), { flag: 'wx' });
    await convert([clean, path, '-f', 'm4af', '-d', 'aac', '-b', String(config().AUDIO_AAC_KBPS * 1000)]);
    // afconvert가 새로 붙인 인코더·iTunSMPB 태그도 최종 분석 전에 제거한다.
    await writeFile(path, stripM4aTags(await readFile(path)));
  }
  const analysisPath = join(workDir, 'analysis.wav');
  await convert([
    path,
    analysisPath,
    '-f',
    'WAVE',
    '-d',
    `LEI16@${config().AUDIO_ANALYSIS_SAMPLE_RATE}`,
    '-c',
    '1',
  ]);
  const analysis = analyzePcm(await readFile(analysisPath));
  variants.push({ name: 'audio', ext, w: 0, h: 0, bytes: (await stat(path)).size, path });
  if (inspection.cover !== null) variants.push(await deriveCover(inspection.cover, outDir));
  return { durationMs: inspection.durationMs, analysis, variants };
}
