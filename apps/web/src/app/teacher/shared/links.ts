import { PATHS } from '../../routes.ts';

/** 이 앱이 열린 출처(`https://{도메인}`). 시험(jsdom)은 `http://localhost:3000` 같은 값 */
const origin = (): string => globalThis.location?.origin ?? '';

/** 학생 전시 주소(QR에 담음): `https://{도메인}/{입장 코드}` */
export const studentUrl = (entryCode: string): string => `${origin()}${PATHS.exhibition(entryCode)}`;

/** 짧은 주소(칠판에 적기 좋게 `https://` 없이): `{도메인}/{입장 코드}` */
export const shortStudentUrl = (entryCode: string): string =>
  `${globalThis.location?.host ?? ''}${PATHS.exhibition(entryCode)}`;

/** 선생님 링크(ADR-044): `https://{도메인}/t#{토큰}` — 조각이라 서버·CDN·기록에 가지 않는다 */
export const teacherLinkUrl = (linkToken: string): string => `${origin()}${PATHS.teacher}#${linkToken}`;
