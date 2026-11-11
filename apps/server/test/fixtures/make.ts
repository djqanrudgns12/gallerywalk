import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { config } from '@gallery/core/config';

const run = promisify(execFile);

/** 합성 자료·임시 파일도 모두 git 제외된 .local 안에 둔다. */
export async function makeWorkspace(): Promise<string> {
  const root = resolve(import.meta.dirname, '../../../..', '.local', 'test-media');
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, 'case-'));
}

export async function makeImage(
  path: string,
  w: number,
  h: number,
  options: {
    readonly gps?: boolean;
    readonly orientation?: number;
    readonly alpha?: boolean;
    readonly bands?: boolean;
    readonly stripes?: number;
  } = {},
): Promise<void> {
  const data = Buffer.alloc(w * h * 4, 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (options.bands) {
        const first = w > h ? x < 1280 : y < 1290;
        data[i] = first ? 220 : 10;
        data[i + 1] = 20;
        data[i + 2] = first ? 10 : 220;
      }
      if (options.alpha) data[i + 3] = x < w / 2 ? 0 : 255;
      if (options.stripes !== undefined && y % options.stripes < 4) {
        data[i] = data[i + 1] = data[i + 2] = 10;
      }
    }
  }
  let image = sharp(data, { raw: { width: w, height: h, channels: 4 } });
  if (options.gps)
    image = image.withExif({
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '37/1 30/1 0/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '127/1 0/1 0/1',
      },
      IFD0: { Artist: 'Synthetic fixture', ImageDescription: 'Synthetic GPS fixture' },
    });
  if (options.orientation !== undefined)
    image = image.withExifMerge({
      IFD0: { Orientation: String(options.orientation) },
    });
  await (path.endsWith('.jpg') ? image.jpeg() : image.png()).toFile(path);
}

export function wavBytes(
  durationSec: number,
  options: {
    readonly sampleRate?: number;
    readonly startSec?: number;
    readonly endSec?: number;
    readonly amplitude?: number;
  } = {},
): Buffer {
  const sampleRate = options.sampleRate ?? 44100;
  const samples = Math.round(durationSec * sampleRate);
  const output = Buffer.alloc(44 + samples * 2);
  output.write('RIFF', 0);
  output.writeUInt32LE(output.length - 8, 4);
  output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write('data', 36);
  output.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const value =
      t >= (options.startSec ?? Infinity) && t < (options.endSec ?? 0)
        ? Math.sin(2 * Math.PI * 440 * t) * (options.amplitude ?? 0.25)
        : 0;
    output.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return output;
}

function id3Frame(id: string, body: Buffer): Buffer {
  const header = Buffer.alloc(10);
  header.write(id);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** MPEG-1 Layer III 무음 프레임. 외부 인코더나 저장된 음원 없이 만든다. */
export async function makeTaggedMp3(path: string): Promise<Buffer> {
  const cover = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ae7251' } })
    .png()
    .toBuffer();
  const frames = Buffer.concat(
    Array.from({ length: 40 }, () => {
      const frame = Buffer.alloc(417);
      frame.set([0xff, 0xfb, 0x90, 0xc0]);
      return frame;
    }),
  );
  const body = Buffer.concat([
    id3Frame('TIT2', Buffer.from('\0Synthetic title')),
    id3Frame('TXXX', Buffer.from('\0GPS\0+37.5000+127.0000/')),
    id3Frame('APIC', Buffer.concat([Buffer.from('\0image/png\0\x03\0'), cover])),
  ]);
  const id3 = Buffer.from([
    0x49,
    0x44,
    0x33,
    3,
    0,
    0,
    (body.length >>> 21) & 127,
    (body.length >>> 14) & 127,
    (body.length >>> 7) & 127,
    body.length & 127,
  ]);
  const value = Buffer.from('Synthetic APE location +37.5000+127.0000/');
  const itemHeader = Buffer.alloc(8);
  itemHeader.writeUInt32LE(value.length);
  const item = Buffer.concat([itemHeader, Buffer.from('Comment\0'), value]);
  const ape = Buffer.alloc(32);
  ape.write('APETAGEX');
  ape.writeUInt32LE(2000, 8);
  ape.writeUInt32LE(item.length + 32, 12);
  ape.writeUInt32LE(1, 16);
  const id3v1 = Buffer.alloc(128);
  id3v1.write('TAGSynthetic ID3v1');
  await writeFile(path, Buffer.concat([id3, body, frames, item, ape, id3v1]));
  return frames;
}

export async function makeHeic(input: string, output: string): Promise<void> {
  await run('/usr/bin/sips', ['-s', 'format', 'heic', input, '--out', output], {
    timeout: config().TOOL_TIMEOUT_MS,
  });
}

function atom(name: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8);
  header.write(name, 4, 4, 'latin1');
  return Buffer.concat([header, body]);
}

/** 합성 M4A에 위치가 든 댓글과 위치 atom을 넣는다. moov는 mdat 뒤에 있다. */
export async function makeLocationM4a(wav: string, path: string): Promise<void> {
  await run('/usr/bin/afconvert', [wav, path, '-f', 'm4af', '-d', 'aac', '-b', '160000'], {
    timeout: config().TOOL_TIMEOUT_MS,
  });
  const original = await readFile(path);
  const location = Buffer.from('+37.5000+127.0000/');
  const data = Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), location]);
  const udta = atom(
    'udta',
    atom(
      'meta',
      Buffer.concat([
        Buffer.alloc(4),
        atom('ilst', Buffer.concat([atom('©cmt', atom('data', data)), atom('©xyz', atom('data', data))])),
      ]),
    ),
  );
  for (let i = 0; i + 8 <= original.length;) {
    const size = original.readUInt32BE(i);
    if (size < 8 || i + size > original.length) throw new Error('Invalid synthetic MP4');
    if (original.toString('ascii', i + 4, i + 8) === 'moov') {
      const moov = atom('moov', Buffer.concat([original.subarray(i + 8, i + size), udta]));
      await writeFile(path, Buffer.concat([original.subarray(0, i), moov, original.subarray(i + size)]));
      return;
    }
    i += size;
  }
  throw new Error('Missing synthetic moov');
}
