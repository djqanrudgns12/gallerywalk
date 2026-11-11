import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv, type EnvSource } from '../src/env.ts';
import { randomSecretHex, testEnvSource } from './helpers/server.ts';

const ROOT = '/srv/gallery-test';

function problemsOf(source: EnvSource): readonly string[] {
  try {
    loadEnv(source);
  } catch (cause) {
    if (cause instanceof EnvError) return cause.problems;
    throw cause;
  }
  throw new Error('loadEnv accepted an invalid environment');
}

describe('환경 값 검증', () => {
  it('맞는 값을 읽고 비밀값을 hex·base64·base64url 모두 32바이트로 푼다', () => {
    const hex = randomSecretHex();
    const base64 = randomBytes(32).toString('base64');
    const base64url = randomBytes(32).toString('base64url');
    const env = loadEnv(
      testEnvSource(ROOT, { PIN_HMAC_SECRET: hex, RATE_KEY_SECRET: base64, START_CODE_HMAC: base64url }),
    );
    expect(env.nodeEnv).toBe('test');
    expect(env.port).toBe(4521);
    expect(env.dataDir).toBe(`${ROOT}/data`);
    expect(env.secrets.pinHmac.bytes().toString('hex')).toBe(hex);
    expect(env.secrets.rateKey.bytes().toString('base64')).toBe(base64);
    expect(env.secrets.startCodeHmac.bytes().toString('base64url')).toBe(base64url);
    expect(env.retentionTestMinutes).toBeUndefined();
    expect(env.configPatch).toEqual({});
  });

  it.each(['PIN_HMAC_SECRET', 'RATE_KEY_SECRET', 'START_CODE_HMAC'])('비밀값 %s가 없으면 시작 거부', key => {
    const problems = problemsOf(testEnvSource(ROOT, { [key]: undefined }));
    expect(problems.some(p => p.startsWith(`${key}:`))).toBe(true);
  });

  it('짧은 비밀값(16바이트)·hex도 base64도 아닌 값은 거부하고, 오류에 값이 나오지 않는다', () => {
    const short = randomSecretHex(16);
    const garbage = `${randomSecretHex()}!?`;
    const source = testEnvSource(ROOT, { PIN_HMAC_SECRET: short, RATE_KEY_SECRET: garbage });
    let error: unknown;
    try {
      loadEnv(source);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(EnvError);
    const envError = error as EnvError;
    expect(envError.problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^PIN_HMAC_SECRET: .*32 bytes/),
        expect.stringMatching(/^RATE_KEY_SECRET: must be hex or base64/),
      ]),
    );
    const shown = `${envError.message}\n${envError.problems.join('\n')}\n${inspect(envError)}`;
    expect(shown).not.toContain(short);
    expect(shown).not.toContain(garbage);
    expect(shown).not.toContain(String(source['START_CODE_HMAC']));
  });

  it('세 비밀값이 같으면 거부(키 재사용)', () => {
    const same = randomSecretHex();
    const problems = problemsOf(
      testEnvSource(ROOT, {
        PIN_HMAC_SECRET: same,
        RATE_KEY_SECRET: same,
        START_CODE_HMAC: randomSecretHex(),
      }),
    );
    expect(problems).toEqual([expect.stringContaining('must all be different')]);
  });

  it('운영에서 RETENTION_TEST_MINUTES가 있으면 시작 거부, 개발에서는 분 단위 값으로 읽음', () => {
    expect(problemsOf(testEnvSource(ROOT, { NODE_ENV: 'production', RETENTION_TEST_MINUTES: '5' }))).toEqual([
      'RETENTION_TEST_MINUTES: not allowed in production',
    ]);
    const dev = loadEnv(testEnvSource(ROOT, { NODE_ENV: 'development', RETENTION_TEST_MINUTES: '5' }));
    expect(dev.retentionTestMinutes).toBe(5);
    expect(problemsOf(testEnvSource(ROOT, { NODE_ENV: 'development', RETENTION_TEST_MINUTES: '0' }))).toEqual(
      [expect.stringMatching(/^RETENTION_TEST_MINUTES:/)],
    );
  });

  it('NODE_ENV·PORT·경로가 빠지거나 틀리면 거부', () => {
    const problems = problemsOf(
      testEnvSource(ROOT, {
        NODE_ENV: 'staging',
        PORT: '99999',
        DATA_DIR: 'relative/data',
        MEDIA_DIR: undefined,
      }),
    );
    for (const key of ['NODE_ENV', 'PORT', 'DATA_DIR', 'MEDIA_DIR']) {
      expect(problems.some(p => p.startsWith(`${key}:`))).toBe(true);
    }
  });

  it('임시 폴더가 DB·작품 폴더와 겹치면 거부(1시간 정리가 지우지 않게)', () => {
    expect(problemsOf(testEnvSource(ROOT, { TMP_DIR: `${ROOT}/data/tmp` }))).toEqual([
      'TMP_DIR: must not overlap DATA_DIR',
    ]);
    expect(problemsOf(testEnvSource(ROOT, { TMP_DIR: ROOT }))).toEqual([
      'TMP_DIR: must not overlap DATA_DIR',
      'TMP_DIR: must not overlap MEDIA_DIR',
    ]);
  });

  it('config.ts 키와 같은 이름은 숫자·참거짓·정해진 문자열(CLIENT_IP_HEADER)만 덮어쓰고, 다른 문자열 키는 무시 목록에, 그 밖의 환경 값은 보지 않는다', () => {
    const env = loadEnv(
      testEnvSource(ROOT, {
        MAX_IMAGE_MB: '10',
        READ_SCALE_MIN: '0.5',
        AUDIO_SILENCE_DBFS: '-40',
        START_CODE_REQUIRED: 'false',
        CLIENT_IP_HEADER: 'cf-connecting-ip',
        TEXT_HEAVY_NAME_WORDS: 'x',
        PATH: '/usr/bin',
        HOME: '/Users/nobody',
      }),
    );
    expect(env.configPatch).toEqual({
      MAX_IMAGE_MB: 10,
      READ_SCALE_MIN: 0.5,
      AUDIO_SILENCE_DBFS: -40,
      START_CODE_REQUIRED: false,
      CLIENT_IP_HEADER: 'cf-connecting-ip',
    });
    expect([...env.ignoredConfigKeys].sort()).toEqual(['TEXT_HEAVY_NAME_WORDS']);
  });

  it('정해진 문자열 설정에 다른 값이 오면 거부(앞단 머리 오타로 IP를 잘못 믿지 않게)', () => {
    expect(problemsOf(testEnvSource(ROOT, { CLIENT_IP_HEADER: 'x-forwarded-for' }))).toEqual([
      'CLIENT_IP_HEADER: must be one of x-gw-viewer-ip, cf-connecting-ip',
    ]);
  });

  it('덮어쓰는 값의 모양이 틀리면 거부(오타를 조용히 넘기지 않음)', () => {
    const problems = problemsOf(
      testEnvSource(ROOT, { MAX_IMAGE_MB: 'abc', PIN_MAX_FAILS: '0x10', START_CODE_REQUIRED: 'yes' }),
    );
    expect([...problems].sort()).toEqual([
      'MAX_IMAGE_MB: must be a decimal number',
      'PIN_MAX_FAILS: must be a decimal number',
      'START_CODE_REQUIRED: must be true or false',
    ]);
  });

  it('비밀값은 JSON·inspect·문자열로 찍어도 값이 나오지 않는다', () => {
    const source = testEnvSource(ROOT);
    const env = loadEnv(source);
    const printed = [JSON.stringify(env), inspect(env, { depth: 5 }), `${env.secrets.pinHmac}`].join('\n');
    for (const key of ['PIN_HMAC_SECRET', 'RATE_KEY_SECRET', 'START_CODE_HMAC']) {
      expect(printed).not.toContain(String(source[key]));
    }
    expect(env.secrets.pinHmac.length).toBe(32);
  });
});
