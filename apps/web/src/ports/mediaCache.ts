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
/** 앱 연결 계층이 등록·시작·visibilitychange 알림을 소유한다. */
export interface MediaCache {
  register(): Promise<boolean>;
  appStarted(): Promise<void>;
  screenResumed(): Promise<void>;
  preload(view: ExhibitionView, onProgress: (progress: PreloadProgress) => void): Promise<PreloadResult>;
  space(requiredBytes: number): Promise<StorageSpace>;
}
