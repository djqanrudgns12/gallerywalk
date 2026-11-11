import { Hono } from 'hono';
import type { Logger } from '../log.ts';
import type { Deps } from '../ports/index.ts';
import type { Db } from '../store/db.ts';
import type { Lifecycle } from './lifecycle.ts';
import { jsonBodyLimit } from './middleware/bodyLimit.ts';
import { errorHandler, notFoundHandler } from './middleware/errors.ts';
import { requestId } from './middleware/requestId.ts';
import { apiNoStore, securityHeaders } from './middleware/securityHeaders.ts';
import { healthRoutes } from './routes/health.ts';
import { mediaRoutes } from './routes/media.ts';
import { publicRoutes } from './routes/public.ts';
import { staticRoutes } from './routes/static.ts';
import { teacherRoutes, type TeacherRouteOptions } from './routes/teacher.ts';
import type { AppEnv } from './types.ts';

export interface AppLimits {
  /** JSON 본문 한도(바이트, PLAN §9.3) */
  readonly jsonBodyMaxBytes: number;
  readonly hstsMaxAgeSec: number;
}

export interface AppDeps {
  readonly db: Db;
  readonly log: Logger;
  readonly mediaDir: string;
  readonly queueLength: () => number;
  readonly lifecycle: Lifecycle;
  readonly limits: AppLimits;
  /** 유스케이스 의존성(저장소·시계·난수·보안). 없으면 건강 확인만 도는 앱(시작 확인·미들웨어 시험) */
  readonly useCases?: Deps;
  /**
   * 교사 경로(PLAN §9.2 교사 표): 라우트가 쓰는 보안 묶음(`ServerSecurity` — 칸·PIN 칸·시작 코드 기기·IP/기기 키)과
   * 함께 관람 허브(닫을 때 방문자 내보내기). `useCases`가 있을 때만 붙는다.
   */
  readonly teacher?: Omit<TeacherRouteOptions, 'deps'> | undefined;
  /**
   * 웹 빌드 폴더(Vite `apps/web/dist`). 주면 앱 정적 경로(`/assets/g/*`·`/`·`/{입장 코드}`·`/t/*`·`/sw.js`, PLAN §9.6)를
   * 붙인다. 없으면 붙이지 않는다(개발은 Vite 4522가 낸다).
   */
  readonly webDir?: string | undefined;
}

/**
 * HTTP 앱. 미들웨어 순서(PLAN §9.3): 요청 ID·접근 기록 → 보안 머리 → (`/api/*` no-store) → 끝내는 중이면 거절
 * → 본문 크기 → [라우트: zod 검증(`readJson`) → 속도 칸 → 처리] → 오류 봉투.
 * 라우트(`routes/*`)는 유스케이스(`application/**`)를 부르는 얇은 층이다(P3-3). 교사 경로는 인증(P3-2) 뒤에 붙인다.
 */
export const createApp = (deps: AppDeps): Hono<AppEnv> => {
  const app = new Hono<AppEnv>();
  app.use('*', requestId(deps.log));
  app.use('*', securityHeaders({ hstsMaxAgeSec: deps.limits.hstsMaxAgeSec }));
  app.use('/api/*', apiNoStore);
  app.use('*', deps.lifecycle.middleware);
  app.use('*', jsonBodyLimit({ maxBytes: deps.limits.jsonBodyMaxBytes }));
  app.route('/', healthRoutes({ db: deps.db, diskPath: deps.mediaDir, queueLength: deps.queueLength }));
  if (deps.useCases) app.route('/', publicRoutes(deps.useCases));
  if (deps.useCases && deps.teacher) app.route('/', teacherRoutes({ ...deps.teacher, deps: deps.useCases }));
  // 작품 미디어(§9.6)는 앱 정적 `/assets/g/*`보다 먼저 — 미디어 자리 `/assets/g/m/`은 정적 경로가 찾지 않는다
  if (deps.useCases) app.route('/', mediaRoutes({ deps: deps.useCases, mediaDir: deps.mediaDir }));
  if (deps.webDir !== undefined) app.route('/', staticRoutes({ webDir: deps.webDir }));
  app.notFound(notFoundHandler);
  app.onError(errorHandler(deps.log));
  return app;
};
