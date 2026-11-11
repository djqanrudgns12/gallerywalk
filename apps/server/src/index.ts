import { config } from '@gallery/core/config';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { overrideConfig } from '@gallery/core/config';
import { EnvError, loadEnv } from './env.ts';
import { createServerDeps } from './deps.ts';
import { createApp } from './http/app.ts';
import { createLifecycle } from './http/lifecycle.ts';
import { createCleanupJobs } from './jobs/index.ts';
import { attachLive } from './live/attach.ts';
import { createLiveHub } from './live/hub.ts';
import { createLogger, type Logger } from './log.ts';
import { closeDb, migrate, openDb } from './store/db.ts';

/**
 * `config.ts`에 아직 없는 서버 값(P3-1 보고 "필요한 것"). 키가 생기면 `config()`에서 읽고 이 묶음을 지운다.
 * PLAN §9.1(끝내기 20초·busy_timeout) · §9.3(JSON 64KB) · §9.8(기록 7개) · §11.4(HSTS, 값은 PLAN에 없어 1년).
 */
/** 터널만 들어오도록 127.0.0.1에서만 듣는다(PLAN §9.1, §11.3). */
const HOST = '127.0.0.1';
const DIR_MODE = 0o700;
const MS_PER_SEC = 1000;
const BYTES_PER_KB = 1024;

/** 기록기를 만들기 전(환경 값이 틀린 경우)에는 표준 오류에 한 줄. 값은 넣지 않는다. */
function fatalBeforeLog(msg: string, problems: readonly string[]): void {
  process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), level: 'fatal', msg, problems })}\n`);
}

function main(): void {
  // 1. 환경 값 검증(비밀값이 없거나 짧으면 시작 거부)
  const env = loadEnv(process.env);
  overrideConfig(env.configPatch);
  // 운영은 CloudFront가 이 서버 하나를 원본으로 쓴다(ADR-002) — 웹 빌드가 없으면 앱 화면이 나가지 않으므로 시작 거부
  if (env.nodeEnv === 'production' && (!env.webDir || !existsSync(join(env.webDir, 'index.html')))) {
    fatalBeforeLog('web_dir_missing', ['WEB_DIR: production needs the web build (index.html)']);
    process.exit(1);
  }
  for (const dir of [env.dataDir, env.mediaDir, env.tmpDir])
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });

  const log: Logger = createLogger({
    dir: join(env.dataDir, 'logs'),
    keepFiles: config().LOG_KEEP_FILES,
    ...(env.nodeEnv === 'production' ? {} : { echo: (line: string) => process.stdout.write(`${line}\n`) }),
  });
  const overridden = Object.keys(env.configPatch);
  if (overridden.length > 0) log.info('config_override', { keys: overridden });
  if (env.ignoredConfigKeys.length > 0) log.warn('config_key_ignored', { keys: env.ignoredConfigKeys });

  // 2. SQLite 열기(PRAGMA) → 3. 마이그레이션(앞으로만)
  const db = openDb(join(env.dataDir, 'gallery.sqlite'), {
    busyTimeoutMs: config().DB_BUSY_TIMEOUT_MS,
  });
  const migrated = migrate(db);
  log.info(`db_ready_v${migrated.to}`, { count: migrated.applied.length });

  // 4. 의존성(SQLite 저장소·시계·난수·보안·처리 대기열).
  // 기록기를 넘겨야 "지금 삭제"·보관 정리의 지운 행 수 기록이 남는다
  const { deps, security, uploads } = createServerDeps(db, env, log);
  // 함께 관람 허브(ADR-057): 교사가 전시를 닫으면 방문자 연결을 끊어야 해서 앱보다 먼저 만든다
  const hub = createLiveHub({ deps, log });
  const jobs = createCleanupJobs(deps, {
    tmpDir: env.tmpDir,
    isTemporaryPathActive: path => uploads.isTemporaryPathActive(path),
    onExhibitionGone: id => hub.closeExhibition(id, 'E_NOT_FOUND'),
  });

  // 5. 듣기
  const lifecycle = createLifecycle();
  const app = createApp({
    db,
    log,
    mediaDir: env.mediaDir,
    queueLength: () => uploads.queueLength(),
    lifecycle,
    limits: {
      jsonBodyMaxBytes: config().JSON_BODY_MAX_KB * BYTES_PER_KB,
      hstsMaxAgeSec: config().HSTS_MAX_AGE_SEC,
    },
    useCases: deps,
    teacher: { security, uploads, live: hub, uploadRateLimits: config().UPLOAD_RATE },
    webDir: env.webDir,
  });
  const server = serve({ fetch: app.fetch, hostname: HOST, port: env.port }, info => {
    log.info('listening', { port: info.port });
    void jobs.start();
  });
  // 함께 관람(ADR-057): 같은 서버의 웹소켓 업그레이드 `/api/e/{code}/live`. 위치는 메모리에만
  const live = attachLive(server, hub, {
    production: env.nodeEnv === 'production',
    rateKey: env.secrets.rateKey,
  });

  // 끝내기(SIGTERM): 새 요청 거부 → 처리 중인 것은 20초까지 기다림 → 체크포인트(TRUNCATE) → 닫기
  let stopping: Promise<void> | undefined;
  const shutdown = (signal: NodeJS.Signals): void => {
    stopping ??= (async () => {
      log.info(`shutdown_${signal.toLowerCase()}`, { count: lifecycle.inFlight() });
      lifecycle.beginDrain();
      const jobsStopped = jobs.stop();
      // 업그레이드된 소켓이 server.close()를 붙잡지 않게 먼저(기다리지 않음 — 남은 것은 스스로 끊김)
      const liveClosed = live.close();
      server.close();
      if ('closeIdleConnections' in server) server.closeIdleConnections();
      const idle = await lifecycle.waitIdle(config().SHUTDOWN_WAIT_SEC * MS_PER_SEC);
      if (!idle) log.warn('shutdown_timeout', { count: lifecycle.inFlight() });
      if ('closeAllConnections' in server) server.closeAllConnections();
      await uploads.drainAll(0);
      await jobsStopped;
      await liveClosed;
      closeDb(db);
      log.info('shutdown_done');
      log.close();
    })().then(
      () => process.exit(0),
      (cause: unknown) => {
        log.fatal('shutdown_failed', { err: cause });
        log.close();
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

try {
  main();
} catch (cause) {
  if (cause instanceof EnvError) fatalBeforeLog('env_invalid', cause.problems);
  else
    fatalBeforeLog('start_failed', [cause instanceof Error ? `${cause.name}: ${cause.message}` : 'unknown']);
  process.exit(1);
}
