import { isAbsolute, relative, resolve } from 'node:path';
import { inspect } from 'node:util';
import { z } from 'zod';
import { configDefaults, type Config, type ConfigKey } from '@gallery/core/config';

/**
 * 환경 값 검증(PLAN §9.1·§9.9). `.env` 파일을 읽지 않는다 — 받은 객체(`process.env` 또는 시험이 만든 객체)만 본다.
 * 잘못되면 `EnvError`로 시작을 거부한다. 오류에는 키 이름과 사유만 있고 값은 없다.
 */

export type EnvSource = Readonly<Record<string, string | undefined>>;

export type ConfigPatch = Partial<{ -readonly [K in ConfigKey]: Config[K] }>;

/** 비밀값 바이트. 기록·`JSON.stringify`·`console.log`에 찍혀도 값이 나가지 않는다. */
export class Secret {
  readonly #bytes: Buffer;

  constructor(bytes: Buffer) {
    this.#bytes = bytes;
  }

  /** HMAC 키로 쓸 때만 꺼낸다. 받은 쪽이 바꾸지 못하게 사본을 준다. */
  bytes(): Buffer {
    return Buffer.from(this.#bytes);
  }

  get length(): number {
    return this.#bytes.length;
  }

  toJSON(): string {
    return '***';
  }

  toString(): string {
    return '***';
  }

  [inspect.custom](): string {
    return 'Secret(***)';
  }
}

export interface ServerSecrets {
  readonly pinHmac: Secret;
  readonly rateKey: Secret;
  readonly startCodeHmac: Secret;
}

export interface ServerEnv {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly dataDir: string;
  readonly mediaDir: string;
  readonly tmpDir: string;
  /** 웹 빌드 폴더(`apps/web/dist`) — 있으면 앱 정적 파일·HTML을 낸다(P3-7). 개발은 Vite가 내므로 없음. 운영에서는 시작 코드가 요구한다 */
  readonly webDir: string | undefined;
  readonly secrets: ServerSecrets;
  /** 개발·시험에서만: 보관 기간을 분 단위로(PLAN §9.7, PRD 15.6) */
  readonly retentionTestMinutes: number | undefined;
  /** `config.ts` 키와 같은 이름의 환경 값(숫자·참거짓). 시작할 때 `overrideConfig`로 건다. */
  readonly configPatch: ConfigPatch;
  /** 이름은 `config.ts` 키인데 숫자·참거짓이 아니라 덮어쓰지 않은 키(기록용, 값은 없음) */
  readonly ignoredConfigKeys: readonly string[];
}

export class EnvError extends Error {
  /** `키: 사유` 목록. 값은 넣지 않는다. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`invalid server environment: ${problems.join('; ')}`);
    this.name = 'EnvError';
    this.problems = problems;
  }
}

/** HMAC-SHA256 키 길이 = 해시 출력 길이(PLAN §9.9 "32바이트"). 짧은 키는 받지 않는다. */
const SECRET_MIN_BYTES = 32;
const HEX = /^[0-9a-f]+$/i;
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const PORT_MAX = 65_535;

/** hex(짝수 길이)를 먼저, 아니면 base64·base64url. 다시 인코딩해 같지 않으면(쓰레기 글자) 거부. */
function decodeSecret(raw: string): Buffer | undefined {
  const text = raw.trim();
  if (HEX.test(text) && text.length % 2 === 0) return Buffer.from(text, 'hex');
  if (!BASE64.test(text)) return undefined;
  const bytes = Buffer.from(text, 'base64');
  const canonical = text.replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/, '');
  return bytes.toString('base64').replace(/=+$/, '') === canonical ? bytes : undefined;
}

const secretSchema = z.string().transform((raw, ctx) => {
  const bytes = decodeSecret(raw);
  if (bytes === undefined) {
    ctx.addIssue({ code: 'custom', message: 'must be hex or base64' });
    return z.NEVER;
  }
  if (bytes.length < SECRET_MIN_BYTES) {
    ctx.addIssue({ code: 'custom', message: `must decode to at least ${SECRET_MIN_BYTES} bytes` });
    return z.NEVER;
  }
  return new Secret(bytes);
});

const absolutePath = z
  .string()
  .refine(isAbsolute, { message: 'must be an absolute path' })
  .transform(path => resolve(path));

const positiveInt = (max?: number) =>
  z
    .string()
    .regex(/^\d+$/, { message: 'must be a positive integer' })
    .transform(Number)
    .pipe(max === undefined ? z.number().int().positive() : z.number().int().positive().max(max));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: positiveInt(PORT_MAX),
  DATA_DIR: absolutePath,
  MEDIA_DIR: absolutePath,
  TMP_DIR: absolutePath,
  WEB_DIR: absolutePath.optional(),
  PIN_HMAC_SECRET: secretSchema,
  RATE_KEY_SECRET: secretSchema,
  START_CODE_HMAC: secretSchema,
  RETENTION_TEST_MINUTES: positiveInt().optional(),
});

/** a와 b가 같은 폴더이거나 한쪽이 다른 쪽 안에 있는지 */
const overlaps = (a: string, b: string): boolean =>
  !relative(a, b).startsWith('..') || !relative(b, a).startsWith('..');

/** 문자열 설정 중 환경 값으로 바꿀 수 있는 것과 받는 값(그 밖의 문자열·배열·객체 키는 기록만 하고 무시) */
const STRING_CHOICES: Partial<Record<ConfigKey, readonly string[]>> = {
  CLIENT_IP_HEADER: ['x-gw-viewer-ip', 'cf-connecting-ip'],
};

/** `config.ts` 키 중 숫자·참거짓과 `STRING_CHOICES`의 문자열만 덮어쓴다. */
function readConfigOverrides(source: EnvSource, problems: string[]) {
  const patch: Record<string, number | boolean | string> = {};
  const ignored: string[] = [];
  for (const key of Object.keys(configDefaults) as ConfigKey[]) {
    const raw = source[key];
    if (raw === undefined) continue;
    const base: unknown = configDefaults[key];
    const text = raw.trim();
    if (typeof base === 'number') {
      if (DECIMAL.test(text)) patch[key] = Number(text);
      else problems.push(`${key}: must be a decimal number`);
    } else if (typeof base === 'boolean') {
      if (text === 'true' || text === 'false') patch[key] = text === 'true';
      else problems.push(`${key}: must be true or false`);
    } else if (STRING_CHOICES[key]) {
      if (STRING_CHOICES[key].includes(text)) patch[key] = text;
      else problems.push(`${key}: must be one of ${STRING_CHOICES[key].join(', ')}`);
    } else {
      ignored.push(key);
    }
  }
  return { patch: patch as ConfigPatch, ignored };
}

export function loadEnv(source: EnvSource): ServerEnv {
  const problems: string[] = [];
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${issue.path.map(String).join('.') || '_'}: ${issue.message}`);
    }
  }
  const { patch, ignored } = readConfigOverrides(source, problems);
  if (!parsed.success) throw new EnvError(problems);

  const env = parsed.data;
  if (env.NODE_ENV === 'production' && source['RETENTION_TEST_MINUTES'] !== undefined) {
    problems.push('RETENTION_TEST_MINUTES: not allowed in production');
  }
  const secrets = [env.PIN_HMAC_SECRET, env.RATE_KEY_SECRET, env.START_CODE_HMAC];
  const distinct = new Set(secrets.map(secret => secret.bytes().toString('hex')));
  if (distinct.size !== secrets.length) {
    problems.push('PIN_HMAC_SECRET/RATE_KEY_SECRET/START_CODE_HMAC: must all be different');
  }
  // 임시 폴더 정리(1시간 지난 것)가 DB·작품 파일을 지우지 않게(PLAN §9.7)
  if (overlaps(env.TMP_DIR, env.DATA_DIR)) problems.push('TMP_DIR: must not overlap DATA_DIR');
  if (overlaps(env.TMP_DIR, env.MEDIA_DIR)) problems.push('TMP_DIR: must not overlap MEDIA_DIR');
  if (problems.length > 0) throw new EnvError(problems);

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    dataDir: env.DATA_DIR,
    mediaDir: env.MEDIA_DIR,
    tmpDir: env.TMP_DIR,
    webDir: env.WEB_DIR,
    secrets: {
      pinHmac: env.PIN_HMAC_SECRET,
      rateKey: env.RATE_KEY_SECRET,
      startCodeHmac: env.START_CODE_HMAC,
    },
    retentionTestMinutes: env.RETENTION_TEST_MINUTES,
    configPatch: patch,
    ignoredConfigKeys: ignored,
  };
}
