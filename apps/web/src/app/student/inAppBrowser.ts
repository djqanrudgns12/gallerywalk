/**
 * 인앱 브라우저 판정(PLAN §7.3): 카카오톡·네이버·인스타그램·페이스북·라인 앱 안의 창은 소리 자동 재생·전체 화면이 막히는
 * 일이 많아 포스터 아래 한 줄로 Safari·Chrome을 권한다(막지는 않음). UA 글자만 보는 순수 함수.
 *
 * - 카카오톡: `KAKAOTALK` · 네이버 앱: `NAVER(inapp; …)`(웨일은 `Whale/`이라 해당 없음)
 * - 인스타그램: `Instagram 3xx…` · 페이스북·메신저: `FBAN/`·`FBAV/`·`FB_IAB/`
 * - 라인: `Line/14.x`(낱말 경계 — `Online/` 같은 글자는 빼려고)
 */
const IN_APP_UA: readonly RegExp[] = [
  /\bKAKAOTALK\b/i,
  /\bNAVER\(inapp/i,
  /\bInstagram\b/i,
  /\bFB(?:AN|AV|_IAB)\//,
  /\bLine\/\d/i,
];

export const isInAppBrowser = (userAgent: string): boolean => IN_APP_UA.some(re => re.test(userAgent));
