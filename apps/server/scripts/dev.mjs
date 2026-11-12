// 개발 서버 실행기(포트 4521). 운영은 쓰지 않는다 — 운영 비밀값은 사용자가 환경 값으로 넣는다(PLAN §9.9).
// 개발 비밀값은 실제 비밀이 아니라 고정 이름표의 SHA-256이다: 다시 시작해도 개발 DB의 PIN·기기 칸이 그대로 맞는다.
// 이미 환경 값으로 준 것은 그대로 쓴다. 개발 DB·미디어·임시 파일은 저장소의 `.local/dev/`(git 제외).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const server = resolve(here, '..');
const root = resolve(server, '../..');
const devSecret = label => createHash('sha256').update(`gallerywalk-dev:${label}`).digest('hex');

const env = {
  NODE_ENV: 'development',
  PORT: '4521',
  DATA_DIR: join(root, '.local/dev/data'),
  MEDIA_DIR: join(root, '.local/dev/media'),
  TMP_DIR: join(root, '.local/dev/tmp'),
  PIN_HMAC_SECRET: devSecret('pin'),
  RATE_KEY_SECRET: devSecret('rate'),
  START_CODE_HMAC: devSecret('start'),
  // 개발에서는 처음 쓰는 기기도 시작 코드 없이 전시를 만든다(운영은 `config.ts` 기본값 true)
  START_CODE_REQUIRED: 'false',
  // 개발에서는 e2e·시드 도구가 하루에도 전시를 수십 개 만든다 — 만들기 하루 상한만 넉넉히(운영은 `config.ts` 30·5)
  CREATE_PER_IP_DAY: '1000',
  CREATE_PER_DEVICE_DAY: '1000',
  ...process.env,
};

const child = spawn(
  process.execPath,
  ['--conditions=@gallery/source', '--disable-warning=ExperimentalWarning', '--watch', 'src/index.ts'],
  { cwd: server, env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
