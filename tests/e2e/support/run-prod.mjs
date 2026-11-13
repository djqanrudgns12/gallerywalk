#!/usr/bin/env node
// V-30만 허용된 로컬 빌드 1회 + 해당 prod spec 1회. guard 안에서만 실행하고 기존 서비스를 재사용하지 않는다.
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const argv = process.argv.slice(2);
const skipBuild = argv.length === 1 && argv[0] === '--skip-build';
if (argv.length > 0 && !skipBuild) throw new Error('허용 옵션은 --skip-build뿐입니다.');
if (process.env['RESOURCE_GUARD_ACTIVE'] !== '1')
  throw new Error('resource-guard --profile test 안에서 실행하세요.');

async function requireFreePort(port) {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once('error', () =>
      reject(new Error(`${port} 사용 중: 기존 서버를 끄거나 재사용하지 않고 중단합니다.`)),
    );
    server.listen({ host: '127.0.0.1', port, exclusive: true }, accept);
  });
  await new Promise((accept, reject) => server.close(error => (error ? reject(error) : accept())));
}

function run(command, args, env = process.env) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    const forward = signal => child.kill(signal);
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    child.once('error', reject);
    child.once('exit', code => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      if (code === 0) accept();
      else reject(new Error(`운영 빌드 시험 명령 실패 (${code ?? 'signal'})`));
    });
  });
}

try {
  // Playwright의 기본 webServer 두 개는 이 실행이 직접 소유해야 한다.
  for (const port of [4521, 4522]) await requireFreePort(port);
  if (!skipBuild) await run('npm', ['run', 'build']);
  const webDir = resolve(root, 'apps/web/dist');
  await access(resolve(webDir, 'index.html'));
  await access(resolve(webDir, 'sw.js'));
  const fixtureRoot = resolve(root, '.local/prod-e2e', `${Date.now()}-${process.pid}`);
  await run('npx', ['playwright', 'test', 'tests/e2e/prod.spec.ts', '--project=prod', '--workers=1'], {
    ...process.env,
    NODE_ENV: 'development',
    GALLERY_PROD_E2E: '1',
    WEB_DIR: webDir,
    DATA_DIR: resolve(fixtureRoot, 'data'),
    MEDIA_DIR: resolve(fixtureRoot, 'media'),
    TMP_DIR: resolve(fixtureRoot, 'tmp'),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : '운영 빌드 시험 실행 실패');
  process.exitCode = 1;
}
