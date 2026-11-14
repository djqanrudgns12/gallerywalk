import { mediaPath, type ArtworkTeacher, type AssetRef } from '@gallery/core/types';

/** 작품 겉모습 판정(보드 액자·살펴보기·확인할 것 칩이 같이 쓴다) */

export const isUntitled = (a: Pick<ArtworkTeacher, 'title'>): boolean => a.title.trim() === '';
export const isBlurry = (a: Pick<ArtworkTeacher, 'warnings'>): boolean => a.warnings.includes('LOW_RES');

/** 확인할 것: 처리 실패·제목 없음·흐림 */
export const needsCheck = (a: ArtworkTeacher): boolean =>
  a.status === 'FAILED' || isUntitled(a) || isBlurry(a);

/** 썸네일(`thumb` 파생, 없으면 첫 파생) */
export const thumbOf = (exhibitionId: string, a: ArtworkTeacher): string | null => {
  const ref: AssetRef | null = a.image?.asset ?? a.pages?.[0]?.asset ?? a.audio?.cover ?? null;
  if (!ref) return null;
  const v = ref.variants.find(x => x.name === 'thumb') ?? ref.variants[0];
  return v ? mediaPath(exhibitionId, ref.assetId, v) : null;
};
