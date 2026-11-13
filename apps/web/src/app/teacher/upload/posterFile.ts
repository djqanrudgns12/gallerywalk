import { fileKindFromName } from '@gallery/core/classify';
import type { ErrorCode } from '@gallery/core/errors';
import { precheckFile } from './precheck.ts';

/** 포스터 고르기 창이 보여 줄 형식(그림만). 실제 형식은 사전 검사가 첫 바이트로 다시 본다 */
export const POSTER_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.heic,.heif';

/**
 * 포스터 그림 하나의 기기 사전 검사(V-02, PLAN §5.3과 같은 검사). 통과하면 null, 막히면 그 사유 코드.
 * 그림이 아닌 파일(PDF·글·소리)은 `E_FILE_TYPE`, 영상은 `E_VIDEO_UNSUPPORTED`. 안전 검사는 서버가 다시 한다.
 */
export const checkPosterFile = async (file: Blob, name: string): Promise<ErrorCode | null> => {
  const kind = fileKindFromName(name);
  if (kind === 'VIDEO') return 'E_VIDEO_UNSUPPORTED';
  if (kind !== 'IMAGE') return 'E_FILE_TYPE';
  const checked = await precheckFile(file, kind);
  return checked.ok ? null : checked.problem;
};
