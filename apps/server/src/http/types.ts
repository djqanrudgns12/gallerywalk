import type { HttpBindings } from '@hono/node-server';
import type { ErrorCode } from '@gallery/core/errors';

/** 요청마다 미들웨어·라우트가 함께 쓰는 값 */
export interface AppVariables {
  requestId: string;
  /** 라우트가 대상 전시를 알게 되면 넣는다(접근 기록의 `exhibitionId`) */
  exhibitionId: string | undefined;
  /** 오류 봉투가 넣는다(접근 기록의 `code`) */
  errorCode: ErrorCode | undefined;
}

/** `c.env.incoming`: 업로드 경로가 본문을 Hono 파서 없이 바로 읽을 때(PLAN §9.4-1) */
export interface AppEnv {
  Bindings: HttpBindings;
  Variables: AppVariables;
}
