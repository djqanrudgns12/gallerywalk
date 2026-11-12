import type { ExhibitionView } from '@gallery/core/types';

export type PreloadResult = { readonly kind: 'READY' | 'NO_SPACE' | 'UNAVAILABLE' | 'FAILED' };
export interface PreloadProgress {
  readonly kind: 'LOADING' | PreloadResult['kind'];
  readonly completed: number;
  readonly total: number;
  /** 실제 저장된 본문 바이트 합. 같은 주소는 한 번만 센다. */
  readonly bytes: number;
}
export interface StorageSpace {
  readonly availableBytes: number | null;
  readonly sufficient: boolean | null;
}
/**
 * 미리 받을 범위. `FIRST_ROOM`(기본) = 학생 포스터의 첫 전시실(§2.5) ·
 * `WHOLE` = 교사의 수업 전 미리 불러오기(P5-10): 모든 작품 썸네일·벽용, 배경음악, 소리 작품, 포스터, 템플릿.
 */
export type PreloadScope = 'FIRST_ROOM' | 'WHOLE';
export interface PreloadOptions {
  readonly scope?: PreloadScope;
}
/** 앱 연결 계층이 등록·시작·visibilitychange 알림을 소유한다. */
export interface MediaCache {
  register(): Promise<boolean>;
  appStarted(): Promise<void>;
  screenResumed(): Promise<void>;
  preload(
    view: ExhibitionView,
    onProgress: (progress: PreloadProgress) => void,
    options?: PreloadOptions,
  ): Promise<PreloadResult>;
  space(requiredBytes: number): Promise<StorageSpace>;
}
