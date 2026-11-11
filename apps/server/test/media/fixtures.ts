import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from '@gallery/core/config';

const run = promisify(execFile);

/** wavBytes의 16비트 PCM에 WAVEFORMATEXTENSIBLE 헤더를 씌운다. */
export function extensibleWav(wav: Buffer): Buffer {
  const header = Buffer.alloc(68);
  wav.copy(header, 0, 0, 36);
  header.writeUInt32LE(wav.length + 16, 4);
  header.writeUInt32LE(40, 16);
  header.writeUInt16LE(0xfffe, 20);
  header.writeUInt16LE(22, 36);
  header.writeUInt16LE(16, 38);
  header.writeUInt32LE(4, 40); // SPEAKER_FRONT_CENTER(모노)
  header.set(Buffer.from('0100000000001000800000aa00389b71', 'hex'), 44);
  wav.copy(header, 60, 36, 44);
  return Buffer.concat([header, wav.subarray(44)]);
}

function atom(name: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8);
  header.write(name, 4, 4, 'latin1');
  return Buffer.concat([header, body]);
}

/** 음원 청크 위치를 보존한 채, 위치 정보가 든 moov를 파일 끝에 쓴다. */
export async function makeLocationM4a(wav: string, path: string): Promise<void> {
  await run(
    '/usr/bin/afconvert',
    [wav, path, '-f', 'm4af', '-d', 'aac', '-b', String(config().AUDIO_AAC_KBPS * 1000)],
    { timeout: config().TOOL_TIMEOUT_MS },
  );
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
  for (let position = 0; position + 8 <= original.length;) {
    const size = original.readUInt32BE(position);
    if (size < 8 || position + size > original.length) throw new Error('Invalid synthetic MP4');
    if (original.toString('ascii', position + 4, position + 8) === 'moov') {
      const moov = atom('moov', Buffer.concat([original.subarray(position + 8, position + size), udta]));
      // 원래 moov를 같은 크기의 free로 바꾸면 stco/co64의 절대 오프셋이 그대로 유효하다.
      await writeFile(
        path,
        Buffer.concat([
          original.subarray(0, position),
          atom('free', Buffer.alloc(size - 8)),
          original.subarray(position + size),
          moov,
        ]),
      );
      return;
    }
    position += size;
  }
  throw new Error('Missing synthetic moov');
}
