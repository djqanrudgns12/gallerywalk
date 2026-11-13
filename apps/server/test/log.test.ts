import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, formatLine, redactPath, STAT_KEYS, type LogFields } from '../src/log.ts';
import { makeTempDir, randomSecretHex } from './helpers/server.ts';

let root: string;
beforeEach(async () => {
  root = await makeTempDir();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const T0 = new Date('2026-11-11T09:00:00.000Z');

describe('기록 모양', () => {
  it('JSON 한 줄에 시각·수준·requestId·경로·상태·ms·exhibitionId가 들어간다', () => {
    const line = formatLine(T0, 'info', 'request', {
      requestId: 'req-1',
      method: 'GET',
      path: '/api/e/123456',
      status: 200,
      ms: 12,
      exhibitionId: 'exh-1',
    });
    expect(JSON.parse(line)).toEqual({
      t: '2026-11-11T09:00:00.000Z',
      level: 'info',
      msg: 'request',
      requestId: 'req-1',
      method: 'GET',
      path: '/api/e/123456',
      status: 200,
      ms: 12,
      exhibitionId: 'exh-1',
    });
    expect(line).not.toContain('\n');
  });

  it('허용하지 않은 칸(별명·메모·PIN·토큰·IP)은 타입을 우회해 넣어도 쓰지 않는다', () => {
    const smuggled = {
      path: '/api/x',
      nickname: '가상별명',
      memo: '가상 메모',
      pin: '482913',
      token: randomSecretHex(),
      ip: '203.0.113.7',
      headers: { authorization: 'Bearer abc' },
    } as unknown as LogFields;
    const record: unknown = JSON.parse(formatLine(T0, 'info', 'request', smuggled));
    expect(record).toEqual({ t: T0.toISOString(), level: 'info', msg: 'request', path: '/api/x' });
  });

  it('1분 서버 기록 숫자(stats): STAT_KEYS 이름의 유한한 수만 정해진 차례로, 글·다른 이름은 버린다', () => {
    const stats = {
      heapMb: 41.2,
      loopP99Ms: 12.5,
      loopP50Ms: 1.1,
      elu: 0.031,
      liveBytes: Number.NaN,
      liveMsgs: Number.POSITIVE_INFINITY,
      diagFail: 2,
      ip: '203.0.113.7',
      nickname: '가상별명',
      token: randomSecretHex(),
      loopMaxMs: '99',
    } as unknown as LogFields['stats'];
    const line = formatLine(T0, 'info', 'server_stats', { stats });
    expect(line).not.toContain('203.0.113.7');
    expect(line).not.toContain('가상별명');
    const record = JSON.parse(line) as Record<string, unknown>;
    expect(record).toEqual({
      t: T0.toISOString(),
      level: 'info',
      msg: 'server_stats',
      loopP50Ms: 1.1,
      loopP99Ms: 12.5,
      elu: 0.031,
      heapMb: 41.2,
      diagFail: 2,
    });
    expect(Object.keys(record).slice(3)).toEqual(STAT_KEYS.filter(key => key in record));
  });

  it('경로: 쿼리를 떼고 /t/ 뒤는 *** (PLAN §9.8)', () => {
    const token = randomSecretHex();
    expect(redactPath(`/t/${token}`)).toBe('/t/***');
    expect(redactPath(`/t/${token}/more?x=1`)).toBe('/t/***');
    expect(redactPath(`/api/e/123456?token=${token}`)).toBe('/api/e/123456');
    expect(redactPath('/t')).toBe('/t');
    expect(redactPath('/api/teacher/me')).toBe('/api/teacher/me');
  });

  it('메시지·오류 스택에 섞인 /t/… 와 Bearer 토큰도 가린다', () => {
    const token = randomSecretHex();
    const err = new Error(`failed at https://gallery.example/t/${token} with Bearer ${token}`, {
      cause: new Error(`inner /t/${token}`),
    });
    const line = formatLine(T0, 'error', `boom /t/${token}`, { err });
    expect(line).not.toContain(token);
    const record = JSON.parse(line) as {
      err: { message: string; stack: string; cause: { message: string } };
    };
    expect(record.err.message).toBe('failed at https://gallery.example/t/*** with Bearer ***');
    expect(record.err.cause.message).toBe('inner /t/***');
    expect(record.err.stack).toContain('Error: failed at');
  });
});

describe('파일·회전', () => {
  it('DATA_DIR/logs에 날짜 파일로 쓰고, 날마다 바꾸고, 최근 7개만 남긴다', async () => {
    const dir = join(root, 'logs');
    let now = T0;
    const log = createLogger({ dir, keepFiles: 7, now: () => now });
    for (let day = 0; day < 10; day++) {
      now = new Date(T0.getTime() + day * 86_400_000);
      log.info('tick', { count: day });
      log.info('tock', { count: day });
    }
    log.close();
    const files = (await readdir(dir)).sort();
    expect(files).toEqual([
      'gallery-2026-11-14.log',
      'gallery-2026-11-15.log',
      'gallery-2026-11-16.log',
      'gallery-2026-11-17.log',
      'gallery-2026-11-18.log',
      'gallery-2026-11-19.log',
      'gallery-2026-11-20.log',
    ]);
    const last = (await readFile(join(dir, 'gallery-2026-11-20.log'), 'utf8')).trim().split('\n');
    expect(last.map(l => (JSON.parse(l) as { msg: string; count: number }).msg)).toEqual(['tick', 'tock']);
    expect((JSON.parse(last[0] ?? '') as { count: number }).count).toBe(9);
  });

  it('보관 개수는 1 이상의 정수여야 한다', () => {
    expect(() => createLogger({ dir: join(root, 'logs'), keepFiles: 0 })).toThrow();
  });
});
