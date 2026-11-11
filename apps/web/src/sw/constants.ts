import { config } from '@gallery/core/config';

/** 서비스 워커 값(P4-8). 조정값은 `config.ts`에 있고(PLAN §17.1), 여기는 캐시 이름 앞머리만 정한다. */
export const SW_API_TIMEOUT_MS = config().SW_API_TIMEOUT_MS;
export const SW_READY_TIMEOUT_MS = config().SW_READY_TIMEOUT_MS;
export const SW_MESSAGE_TIMEOUT_MS = config().SW_MESSAGE_TIMEOUT_MS;
export const SW_TEMPLATE_RESERVE_BYTES = config().SW_TEMPLATE_RESERVE_BYTES;
export const SW_SHELL_PREFIX = 'gallery-shell-';
export const SW_EXHIBITION_PREFIX = 'gallery-exhibition-';
