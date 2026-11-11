import { config } from '../../config.ts';

/**
 * 보관 규칙 한 곳(PRD G-18 "만료 처리는 `RetentionPolicy` 한 곳에서", PLAN §9.6·§9.7).
 * 모든 시각은 UTC 밀리초 정수이고 인자로 받는다 — 지금 시각을 여기서 읽지 않는다(같은 입력 → 같은 결과).
 *
 * 경계는 한 가지로 맞춘다: **정해진 시각이 되는 순간(`at <= now`)부터** 그 일이 일어난 것으로 본다
 * (만료·정리 대상 모두). 만료 시각에 정확히 들어온 요청은 이미 없는 전시다.
 */

// 단위 바꾸기(설정값이 아니라 시간 단위의 정의).
const MS_PER_SECOND = 1000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * 만료 시각 = 만든 시각 + 보관 일수. 전시마다 `retention_days`를 저장하고(기본값은 `EXHIBITION_TTL_DAYS`),
 * 그 값으로 이 함수를 부른다. 결과는 1밀리초로 반올림한다(일수가 소수여도 정수 시각).
 */
export const expiresAt = (
  createdAt: number,
  retentionDays: number = config().EXHIBITION_TTL_DAYS,
): number => {
  if (!Number.isFinite(createdAt)) throw new RangeError('createdAt');
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) throw new RangeError('retentionDays');
  return Math.round(createdAt + retentionDays * MS_PER_DAY);
};

export interface ExhibitionLifetime {
  readonly expiresAt: number;
  /** 지우는 중(§9.7 1단계 `deleting = 1`) */
  readonly deleting: boolean;
}

/**
 * 없는 전시로 다루는가(§9.7): 만료 시각이 지났거나(`expiresAt <= now`) 지우는 중이면 그렇다.
 * 정리 작업 주기(60초)를 기다리지 않고 모든 API·미디어 요청이 이 판정을 쓴다.
 */
export const isGone = (e: ExhibitionLifetime, now: number): boolean => e.deleting || e.expiresAt <= now;

export interface MediaCacheSeconds {
  /** 브라우저 사본 `max-age` */
  readonly maxAge: number;
  /** CDN 사본 `s-maxage` */
  readonly sMaxAge: number;
  /** 서버가 멈췄을 때 CDN이 이미 가진 사본을 내주는 시간 `stale-if-error`(ADR-049) */
  readonly staleIfError: number;
}

/** 만료까지 남은 초. 1초 미만은 버린다 — 캐시가 만료 시각을 넘기지 않게. 지났으면 0. */
const remainingSeconds = (expiresAt: number, now: number): number =>
  Math.max(0, Math.floor((expiresAt - now) / MS_PER_SECOND));

/**
 * 작품 미디어 `/assets/g/m/*`의 캐시 초(§9.6 표). 셋 다 min(설정, 남은 초)이고 0 아래로 내려가지 않는다.
 * 그래서 브라우저 사본은 보관 기간을 넘지 않고, 삭제 뒤 CDN 사본은 길어야 `MEDIA_CDN_MAX_AGE_SEC`(1일)이다.
 *
 * `stale-if-error`의 상한은 `MEDIA_STALE_IF_ERROR_SEC`(기본 1일, §9.6·ADR-049).
 */
export const mediaCacheSeconds = (expiresAt: number, now: number): MediaCacheSeconds => {
  const c = config();
  const left = remainingSeconds(expiresAt, now);
  return {
    maxAge: Math.min(c.MEDIA_BROWSER_MAX_AGE_SEC, left),
    sMaxAge: Math.min(c.MEDIA_CDN_MAX_AGE_SEC, left),
    staleIfError: Math.min(c.MEDIA_STALE_IF_ERROR_SEC, left),
  };
};

/** 지운 작품(`deleted_at`)의 파일·행을 정리해도 되는 시각(§9.7, `PURGE_DELETED_HOURS`). `now >=` 이 값이면 정리 대상. */
export const deletedArtworkPurgeAt = (deletedAt: number): number =>
  deletedAt + config().PURGE_DELETED_HOURS * MS_PER_HOUR;

/** 완성되지 않은 PDF(`PROCESSING`)를 치워도 되는 시각(§9.2 PDF 3단계, `PDF_INCOMPLETE_PURGE_HOURS`). `now >=` 이 값이면 정리 대상. */
export const incompletePdfPurgeAt = (createdAt: number): number =>
  createdAt + config().PDF_INCOMPLETE_PURGE_HOURS * MS_PER_HOUR;

/**
 * 화면의 "○일 뒤 지워져요"에 쓸 남은 일수.
 *
 * **올림**: 남은 시간을 24시간 단위로 올린다. 만든 직후는 보관 일수 그대로(30일 → 30, 토스트 "30일 동안"과
 * 같음), 1밀리초라도 남았으면 최소 1, 만료 시각부터는 0. 내림을 쓰면 만든 지 1초 만에 29일로 보인다.
 * 이 수는 "그 일수 안에 지워진다"는 뜻이고, 정확한 날짜는 삭제 예정일(한국 시각)로 따로 보여 준다.
 */
export const daysLeft = (expiresAt: number, now: number): number =>
  Math.max(0, Math.ceil((expiresAt - now) / MS_PER_DAY));
