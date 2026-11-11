import { z } from 'zod';
import type { ImageAnalysis } from './index.ts';
import { UuidSchema } from './common.ts';

/**
 * 미디어 파생과 분석값(PLAN §5.4·§10.2 `assets.variants_json`·`artworks.analysis_json`).
 * 주소는 저장하지 않고 `mediaPath()`로 만든다(`/assets/g/m/{exhibitionId}/{assetId}/{variant}.{ext}`, PLAN §9.2).
 */

/** 캐시할 미디어는 모두 `/assets/g/` 아래(ADR-002) */
export const MEDIA_PATH_PREFIX = '/assets/g/m';

/** 파생 이름: thumb · wall · wall-lo · zoom · zoom-hi · strip-{i} · cover · audio */
export const VariantNameSchema = z
  .string()
  .regex(/^(?:thumb|wall|wall-lo|zoom|zoom-hi|cover|audio|strip-(?:0|[1-9]\d{0,2}))$/, {
    message: 'variant',
  });

export const MediaVariantSchema = z.object({
  name: VariantNameSchema,
  ext: z.enum(['webp', 'mp3', 'm4a']),
  /** 그림 파생의 화소 크기. 소리는 0 */
  w: z.number().int().nonnegative(),
  h: z.number().int().nonnegative(),
  bytes: z.number().int().positive(),
});
export type MediaVariant = z.infer<typeof MediaVariantSchema>;

export const AssetRefSchema = z.object({
  assetId: UuidSchema,
  variants: z.array(MediaVariantSchema).min(1),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

export const mediaPath = (
  exhibitionId: string,
  assetId: string,
  v: Pick<MediaVariant, 'name' | 'ext'>,
): string => `${MEDIA_PATH_PREFIX}/${exhibitionId}/${assetId}/${v.name}.${v.ext}`;

/** 서버가 저장·전송하는 그림 분석값. 줄 활동 배열은 base64(최대 4,096칸) */
export const ImageAnalysisWireSchema = z.object({
  edgeLuma: z.number().min(0).max(1),
  linePitchPx: z.number().positive().nullable(),
  linePitchConfidence: z.number().min(0).max(1),
  lineProfile: z.base64().nullable(),
  profileBinPx: z.number().int().positive(),
});
export type ImageAnalysisWire = z.infer<typeof ImageAnalysisWireSchema>;

export const AudioAnalysisSchema = z
  .object({
    audibleStartMs: z.number().nonnegative(),
    audibleEndMs: z.number().nonnegative(),
    /** 들리는 구간의 평균 크기(dBFS). 완전한 무음은 null */
    loudnessDb: z.number().max(0).nullable(),
  })
  .refine(a => a.audibleEndMs >= a.audibleStartMs, { message: 'audible_range' });
export type AudioAnalysis = z.infer<typeof AudioAnalysisSchema>;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map(Array.from(B64, (c, i) => [c, i] as const));

/** base64 → 바이트(브라우저·Node 공통, `atob` 없이). 입력은 스키마가 이미 검사했다. */
export const decodeBase64 = (s: string): Uint8Array => {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (const c of clean) {
    const v = B64_INDEX.get(c);
    if (v === undefined) throw new Error('base64');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
};

/** 전송 모양 → 쪽 계획기가 쓰는 모양(줄 활동 배열을 바이트로) */
export const decodeImageAnalysis = (w: ImageAnalysisWire): ImageAnalysis => ({
  edgeLuma: w.edgeLuma,
  linePitchPx: w.linePitchPx,
  linePitchConfidence: w.linePitchConfidence,
  lineProfile: w.lineProfile === null ? null : decodeBase64(w.lineProfile),
  profileBinPx: w.profileBinPx,
});
