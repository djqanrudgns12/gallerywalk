import { fork } from 'node:child_process';
import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import {
  AudioAnalysisSchema,
  ErrorCodeSchema,
  ImageAnalysisWireSchema,
  MediaVariantSchema,
} from '@gallery/core/types';
import { z } from 'zod';

const VariantsSchema = z.array(MediaVariantSchema.extend({ path: z.string().min(1) })).min(1);
const ProcessResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('IMAGE'),
    result: z.object({
      w: z.number().int().positive(),
      h: z.number().int().positive(),
      lowRes: z.boolean(),
      analysis: ImageAnalysisWireSchema,
      variants: VariantsSchema,
    }),
  }),
  z.object({
    kind: z.literal('AUDIO'),
    result: z.object({
      durationMs: z.number().positive(),
      analysis: AudioAnalysisSchema,
      variants: VariantsSchema,
    }),
  }),
  z.object({
    kind: z.literal('ERROR'),
    code: ErrorCodeSchema,
    fields: z.record(z.string(), z.string()).optional(),
  }),
]);

type WorkerResult = z.infer<typeof ProcessResultSchema>;
export type ProcessResult = Exclude<WorkerResult, { kind: 'ERROR' }>;

/**
 * 자식 환경: 부모 그대로에서 `node --watch`의 의존성 보고(`WATCH_REPORT_DEPENDENCIES`)만 뺀다 — 물려받으면 Node가 IPC로
 * 감시용 메시지를 먼저 보내 처리 결과 검사가 거절한다(개발 서버에서 업로드가 `E_SERVER`가 되던 원인).
 */
const childEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env['WATCH_REPORT_DEPENDENCIES'];
  return env;
};

/** 자식의 exit까지 기다려 작업 폴더를 다시 쓸 가능성을 없앤다. 프로세스 그룹은 이 작업의 자식들만 포함한다. */
export async function runMedia(
  kind: 'IMAGE' | 'AUDIO',
  inputPath: string,
  outDir: string,
  signal: AbortSignal,
  includeLineProfile = false,
): Promise<ProcessResult> {
  signal.throwIfAborted();
  const source = import.meta.url.endsWith('.ts');
  const child = fork(new URL(source ? './worker.ts' : './worker.js', import.meta.url), [], {
    detached: true,
    env: childEnv(),
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    execArgv: source ? ['--conditions=@gallery/source'] : [],
  });
  let result: WorkerResult | undefined;
  let failure: unknown;
  const stop = (): void => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (cause) {
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'ESRCH')) failure ??= cause;
    }
  };
  const cancel = (): void => {
    failure ??= signal.reason;
    stop();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      child.on('error', cause => {
        failure ??= cause;
        stop();
        if (child.pid === undefined) reject(cause);
      });
      child.on('message', (message: unknown) => {
        const parsed = ProcessResultSchema.safeParse(message);
        if (parsed.success && parsed.data.kind !== 'ERROR' && parsed.data.kind !== kind) {
          failure = new AppError('E_SERVER');
          stop();
        } else if (parsed.success) result = parsed.data;
        else {
          failure = new AppError('E_SERVER', { cause: parsed.error });
          stop();
        }
      });
      child.once('exit', (code, termination) => {
        if (code !== 0 || termination !== null) failure ??= new AppError('E_SERVER');
        resolve();
      });
      child.send(
        {
          kind,
          inputPath,
          outDir,
          includeLineProfile,
          config: Object.fromEntries(
            Object.entries(config()).filter(
              ([, value]) => typeof value === 'number' || typeof value === 'boolean',
            ),
          ),
        },
        cause => {
          if (cause) {
            failure ??= cause;
            stop();
          }
        },
      );
      if (signal.aborted) cancel();
    });
    if (failure !== undefined) throw failure;
    if (!result) throw new AppError('E_SERVER');
    if (result.kind === 'ERROR')
      throw new AppError(result.code, result.fields ? { fields: result.fields } : undefined);
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
