import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';

const run = promisify(execFile);

export async function convertHeic(inputPath: string, jpegPath: string): Promise<void> {
  if (process.platform !== 'darwin') throw new AppError('E_HEIC_UNSUPPORTED');
  try {
    await run('/usr/bin/sips', ['-s', 'format', 'jpeg', inputPath, '--out', jpegPath], {
      timeout: config().TOOL_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
  } catch (cause) {
    throw new AppError('E_FILE_BROKEN', { cause });
  }
}
