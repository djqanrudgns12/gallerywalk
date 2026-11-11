import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';

const MS_PER_SEC = 1000;
const BYTES_PER_KB = 1024;
const MULTIPART_FILES = 1;
const MULTIPART_FIELDS = 1;
const MULTIPART_PARTS = 3;

export interface ReceivedFile {
  readonly path: string;
  readonly contentHash: string;
  readonly bytes: number;
  readonly filename: string;
  readonly meta: unknown;
}

/** incoming 한 스트림만 읽는다. 응답할 수 있도록 실패 때 소켓 대신 파서·파일 쓰기를 중단한다. */
export async function receiveFile(
  incoming: IncomingMessage,
  path: string,
  contentLength: number,
  maxFileBytes: number,
  signal: AbortSignal,
): Promise<ReceivedFile> {
  signal.throwIfAborted();
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: incoming.headers,
      defParamCharset: 'utf8',
      limits: {
        files: MULTIPART_FILES,
        fields: MULTIPART_FIELDS,
        parts: MULTIPART_PARTS,
        fileSize: maxFileBytes + 1,
        fieldSize: config().JSON_BODY_MAX_KB * BYTES_PER_KB,
      },
    });
  } catch (cause) {
    throw new AppError('E_VALIDATION', { fields: { _: 'multipart' }, cause });
  }
  const hash = createHash('sha256');
  const fileWriting = new AbortController();
  let meta: unknown;
  let filename = '';
  let fileBytes = 0;
  let bodyBytes = 0;
  let fileStream: Readable | undefined;
  let output: ReturnType<typeof createWriteStream> | undefined;
  let writing: Promise<void> | undefined;
  let problem: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveParsed = () => {};
  let rejectParsed: (cause: unknown) => void = () => {};
  const parsed = new Promise<void>((resolve, reject) => {
    resolveParsed = resolve;
    rejectParsed = reject;
  });
  void parsed.catch(() => undefined);
  const fail = (cause: unknown): void => {
    problem ??= cause;
    rejectParsed(problem);
  };
  const tooLarge = () => fail(new AppError('E_FILE_TOO_LARGE'));
  const aborted = () => fail(signal.reason);
  const disconnected = () => fail(new AppError('E_FILE_BROKEN'));
  const closed = () => {
    if (!incoming.complete) disconnected();
  };
  const armTimer = (): void => {
    clearTimeout(timer);
    timer = setTimeout(
      () => fail(new AppError('E_FILE_BROKEN', { fields: { _: 'upload_idle' } })),
      config().UPLOAD_IDLE_TIMEOUT_SEC * MS_PER_SEC,
    );
  };
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bodyBytes += chunk.length;
      armTimer();
      if (bodyBytes > contentLength) {
        tooLarge();
        done();
      } else done(null, chunk);
    },
  });
  counter.on('error', fail);
  parser.on('error', cause => fail(new AppError('E_FILE_BROKEN', { cause })));
  parser.on('filesLimit', tooLarge);
  parser.on('fieldsLimit', tooLarge);
  parser.on('partsLimit', tooLarge);
  parser.on('field', (name, value, info) => {
    if (info.valueTruncated || info.nameTruncated) {
      tooLarge();
      return;
    }
    if (name !== 'meta') {
      fail(new AppError('E_VALIDATION', { fields: { _: 'multipart_field' } }));
      return;
    }
    try {
      meta = JSON.parse(value) as unknown;
    } catch {
      fail(new AppError('E_VALIDATION', { fields: { meta: 'json' } }));
    }
  });
  parser.on('file', (name, stream, info) => {
    fileStream = stream;
    if (name !== 'file') {
      stream.resume();
      fail(new AppError('E_VALIDATION', { fields: { file: 'required' } }));
      return;
    }
    filename = info.filename ?? '';
    stream.on('limit', tooLarge);
    output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
    const digest = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        fileBytes += chunk.length;
        hash.update(chunk);
        done(null, chunk);
      },
    });
    writing = pipeline(stream, digest, output, { signal: fileWriting.signal }).catch(cause => {
      fail(new AppError('E_FILE_BROKEN', { cause }));
    });
    stream.on('end', () => {
      if (stream.truncated) tooLarge();
    });
  });
  parser.on('close', () => resolveParsed());
  incoming.on('aborted', disconnected);
  incoming.on('error', disconnected);
  incoming.on('close', closed);
  signal.addEventListener('abort', aborted, { once: true });
  try {
    if (incoming.destroyed || incoming.readableEnded) throw new AppError('E_FILE_BROKEN');
    armTimer();
    incoming.pipe(counter).pipe(parser);
    await parsed;
    await writing;
    if (problem !== undefined) throw problem;
    if (!writing || fileBytes === 0) throw new AppError('E_VALIDATION', { fields: { file: 'required' } });
    if (bodyBytes !== contentLength || fileBytes > maxFileBytes) throw new AppError('E_FILE_TOO_LARGE');
    signal.throwIfAborted();
    return { path, contentHash: hash.digest('hex'), bytes: fileBytes, filename, meta };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', aborted);
    incoming.removeListener('aborted', disconnected);
    incoming.removeListener('error', disconnected);
    incoming.removeListener('close', closed);
    incoming.unpipe(counter);
    counter.unpipe(parser);
    fileWriting.abort();
    counter.destroy();
    parser.destroy();
    fileStream?.destroy();
    output?.destroy();
    // 파서 실패 뒤에도 파일 핸들이 닫힌 다음에 호출자가 임시 폴더를 지운다.
    await writing;
  }
}
