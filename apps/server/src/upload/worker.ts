import { z } from 'zod';
import { config, overrideConfig } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { processAudio, processImage } from '../media/index.ts';

/** 부모가 보내는 비밀값 없는 숫자·참거짓 설정만 받는다. 모르는 키·다른 자료형은 거절한다. */
const ConfigPatchSchema = z
  .record(z.string(), z.union([z.number().finite(), z.boolean()]))
  .refine(patch =>
    Object.entries(patch).every(
      ([key, value]) => Object.hasOwn(config(), key) && typeof Reflect.get(config(), key) === typeof value,
    ),
  );
const WorkSchema = z.strictObject({
  kind: z.enum(['IMAGE', 'AUDIO']),
  inputPath: z.string().min(1),
  outDir: z.string().min(1),
  includeLineProfile: z.boolean(),
  config: ConfigPatchSchema,
});

/** 독립 프로세스라 sharp·분석 루프·sips/afconvert까지 삭제 대기 제한 뒤 함께 중단할 수 있다. */
process.once('message', (message: unknown) => {
  void (async () => {
    try {
      const work = WorkSchema.parse(message);
      overrideConfig(work.config);
      const result =
        work.kind === 'IMAGE'
          ? await processImage(work.inputPath, work.outDir, { includeLineProfile: work.includeLineProfile })
          : await processAudio(work.inputPath, work.outDir);
      process.send?.({ kind: work.kind, result });
    } catch (cause) {
      const error = cause instanceof AppError ? cause : new AppError('E_SERVER');
      process.send?.({ kind: 'ERROR', code: error.code, fields: error.fields });
    } finally {
      process.disconnect();
    }
  })();
});
