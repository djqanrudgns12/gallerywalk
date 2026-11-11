import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { overrideConfig, resetConfig } from '../../config.ts';
import {
  daysLeft,
  deletedArtworkPurgeAt,
  expiresAt,
  incompletePdfPurgeAt,
  isGone,
  mediaCacheSeconds,
} from './RetentionPolicy.ts';

const SEC = 1000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** 2026-11-11 09:00 KST (00:00 UTC) */
const CREATED = Date.UTC(2026, 10, 11, 0, 0, 0);

afterEach(() => resetConfig());

describe('expiresAt', () => {
  it('기본은 만든 시각 + 30일', () => {
    expect(expiresAt(CREATED)).toBe(CREATED + 30 * DAY);
  });

  it('전시마다 저장한 보관 일수를 쓴다', () => {
    expect(expiresAt(CREATED, 7)).toBe(CREATED + 7 * DAY);
  });

  it('기본 일수는 설정에서 온다', () => {
    overrideConfig({ EXHIBITION_TTL_DAYS: 14 });
    expect(expiresAt(CREATED)).toBe(CREATED + 14 * DAY);
  });

  it('결과는 정수 밀리초', () => {
    expect(Number.isInteger(expiresAt(CREATED, 3 / 1440))).toBe(true);
    expect(expiresAt(CREATED, 3 / 1440)).toBe(CREATED + 3 * 60 * SEC);
  });

  it('0일 이하·유한하지 않은 값은 받지 않는다', () => {
    expect(() => expiresAt(CREATED, 0)).toThrow(RangeError);
    expect(() => expiresAt(CREATED, -1)).toThrow(RangeError);
    expect(() => expiresAt(CREATED, Number.NaN)).toThrow(RangeError);
    expect(() => expiresAt(Number.POSITIVE_INFINITY, 30)).toThrow(RangeError);
  });
});

describe('isGone', () => {
  const exp = expiresAt(CREATED);

  it('만료 1밀리초 전에는 살아 있다', () => {
    expect(isGone({ expiresAt: exp, deleting: false }, exp - 1)).toBe(false);
  });

  it('정확히 만료 시각부터 없는 전시다', () => {
    expect(isGone({ expiresAt: exp, deleting: false }, exp)).toBe(true);
    expect(isGone({ expiresAt: exp, deleting: false }, exp + 1)).toBe(true);
  });

  it('지우는 중이면 만료 전이라도 없는 전시다', () => {
    expect(isGone({ expiresAt: exp, deleting: true }, CREATED)).toBe(true);
  });
});

describe('mediaCacheSeconds', () => {
  const exp = expiresAt(CREATED);

  it('보관 기간이 넉넉하면 설정값 그대로(30일·1일·1일)', () => {
    expect(mediaCacheSeconds(exp, CREATED)).toEqual({
      maxAge: 2_592_000,
      sMaxAge: 86_400,
      staleIfError: 86_400,
    });
  });

  it('남은 시간이 브라우저 설정보다 짧으면 브라우저 사본은 남은 초까지만', () => {
    expect(mediaCacheSeconds(exp, exp - 2 * DAY)).toEqual({
      maxAge: 172_800,
      sMaxAge: 86_400,
      staleIfError: 86_400,
    });
  });

  it('남은 시간이 CDN 설정보다 짧으면 셋 다 남은 초', () => {
    expect(mediaCacheSeconds(exp, exp - HOUR)).toEqual({ maxAge: 3600, sMaxAge: 3600, staleIfError: 3600 });
  });

  it('1초 미만은 버린다(캐시가 만료 시각을 넘기지 않게)', () => {
    expect(mediaCacheSeconds(exp, exp - 1500)).toEqual({ maxAge: 1, sMaxAge: 1, staleIfError: 1 });
    expect(mediaCacheSeconds(exp, exp - 999)).toEqual({ maxAge: 0, sMaxAge: 0, staleIfError: 0 });
  });

  it('만료 시각과 그 뒤에는 0이고 음수가 없다', () => {
    expect(mediaCacheSeconds(exp, exp)).toEqual({ maxAge: 0, sMaxAge: 0, staleIfError: 0 });
    expect(mediaCacheSeconds(exp, exp + 10 * DAY)).toEqual({ maxAge: 0, sMaxAge: 0, staleIfError: 0 });
  });

  it('설정을 바꾸면 상한이 따라간다', () => {
    overrideConfig({
      MEDIA_BROWSER_MAX_AGE_SEC: 600,
      MEDIA_CDN_MAX_AGE_SEC: 60,
      MEDIA_STALE_IF_ERROR_SEC: 120,
    });
    expect(mediaCacheSeconds(exp, CREATED)).toEqual({ maxAge: 600, sMaxAge: 60, staleIfError: 120 });
  });

  it('어떤 시각이든: 0 이상 정수, 설정 이하, 사본이 만료 시각을 넘지 않는다', () => {
    fc.assert(
      fc.property(fc.integer({ min: -40 * DAY, max: 40 * DAY }), offset => {
        const now = exp - offset;
        const s = mediaCacheSeconds(exp, now);
        for (const v of [s.maxAge, s.sMaxAge, s.staleIfError]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          if (v > 0) expect(now + v * SEC).toBeLessThanOrEqual(exp);
        }
        expect(s.maxAge).toBeLessThanOrEqual(2_592_000);
        expect(s.sMaxAge).toBeLessThanOrEqual(86_400);
        expect(s.staleIfError).toBeLessThanOrEqual(86_400);
      }),
    );
  });
});

describe('정리 시각', () => {
  it('지운 작품은 24시간 뒤', () => {
    expect(deletedArtworkPurgeAt(CREATED)).toBe(CREATED + 24 * HOUR);
  });

  it('완성되지 않은 PDF는 2시간 뒤', () => {
    expect(incompletePdfPurgeAt(CREATED)).toBe(CREATED + 2 * HOUR);
  });

  it('시간은 설정에서 온다', () => {
    overrideConfig({ PURGE_DELETED_HOURS: 48, PDF_INCOMPLETE_PURGE_HOURS: 1 });
    expect(deletedArtworkPurgeAt(CREATED)).toBe(CREATED + 48 * HOUR);
    expect(incompletePdfPurgeAt(CREATED)).toBe(CREATED + HOUR);
  });
});

describe('daysLeft', () => {
  const exp = expiresAt(CREATED);

  it('만든 직후는 보관 일수 그대로(올림)', () => {
    expect(daysLeft(exp, CREATED)).toBe(30);
    expect(daysLeft(exp, CREATED + SEC)).toBe(30);
  });

  it('하루 반이 남으면 2일', () => {
    expect(daysLeft(exp, exp - 1.5 * DAY)).toBe(2);
  });

  it('정확히 하루가 남으면 1일, 1밀리초가 남아도 1일', () => {
    expect(daysLeft(exp, exp - DAY)).toBe(1);
    expect(daysLeft(exp, exp - 1)).toBe(1);
  });

  it('만료 시각부터 0이고 음수가 없다', () => {
    expect(daysLeft(exp, exp)).toBe(0);
    expect(daysLeft(exp, exp + 3 * DAY)).toBe(0);
  });

  it('어떤 시각이든: (일수 − 1)일 < 남은 시간 ≤ 일수일', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 * DAY }), left => {
        const d = daysLeft(exp, exp - left);
        expect(d).toBeGreaterThanOrEqual(1);
        expect((d - 1) * DAY).toBeLessThan(left);
        expect(left).toBeLessThanOrEqual(d * DAY);
      }),
    );
  });
});
