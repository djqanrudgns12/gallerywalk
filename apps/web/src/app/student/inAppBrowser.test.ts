import { describe, expect, it } from 'vitest';
import { isInAppBrowser } from './inAppBrowser.ts';

/** 실제 앱들이 보내는 모양을 본뜬 UA(버전 숫자는 아무 값) */
const IN_APP: readonly (readonly [string, string])[] = [
  [
    '카카오톡 iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5',
  ],
  [
    '카카오톡 Android',
    'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Safari/537.36 KAKAOTALK/10.8.5 (INAPP)',
  ],
  [
    '네이버 앱',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.6.3; 15PRO)',
  ],
  [
    '인스타그램',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 339.0.3.12.91 (iPhone15,3; iOS 17_5; ko_KR; ko)',
  ],
  [
    '페이스북 iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.106;FBBV/0;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.5]',
  ],
  [
    '페이스북 Android',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.37.106;]',
  ],
  [
    '라인',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0',
  ],
];

const BROWSERS: readonly (readonly [string, string])[] = [
  [
    'iOS Safari',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ],
  [
    'iPad Safari',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  ],
  [
    'Android Chrome',
    'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  ],
  [
    '삼성 인터넷',
    'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  ],
  [
    '웨일',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Whale/3.26.244.21 Safari/537.36',
  ],
  [
    '데스크톱 Chrome(Online 낱말이 섞인 UA)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Online/2.0',
  ],
  ['빈 UA', ''],
];

describe('isInAppBrowser', () => {
  it.each(IN_APP)('%s → 앱 안 창', (_name, ua) => {
    expect(isInAppBrowser(ua)).toBe(true);
  });

  it.each(BROWSERS)('%s → 보통 창', (_name, ua) => {
    expect(isInAppBrowser(ua)).toBe(false);
  });
});
