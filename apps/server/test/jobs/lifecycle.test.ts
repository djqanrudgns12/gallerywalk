import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createExhibition } from '../../src/application/exhibitions.ts';
import { createServerDeps } from '../../src/deps.ts';
import { loadEnv } from '../../src/env.ts';
import { makeTempDir, openTestDb, testEnvSource } from '../helpers/server.ts';

it('실제 시작 코드가 듣기 뒤 보관 정리를 시작하고 SIGTERM에서 작업·DB를 닫는다', async () => {
  const root = await makeTempDir();
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  const source = testEnvSource(root, { PORT: String(address.port) });
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const env = loadEnv(source);
  await mkdir(env.dataDir, { recursive: true });
  const db = openTestDb(env.dataDir);
  const { deps, uploads } = createServerDeps(db, env);
  const exhibitionId = '10000000-0000-4000-8000-000000000001';
  createExhibition(
    deps,
    {
      exhibitionId,
      title: '합성 시작 시험',
      pin: '58392647',
      templateId: 'modern-history',
      linkTokenHash: 'c'.repeat(64),
    },
    { deviceRegistered: true },
  );
  deps.store.exhibitions.update(exhibitionId, { expiresAt: deps.clock.now() - 1 });
  const media = join(env.mediaDir, 'exh', exhibitionId);
  await mkdir(media, { recursive: true });
  await writeFile(join(media, 'synthetic.webp'), 'x');
  await uploads.drainAll(0);
  db.close();

  // 실제 서비스와 분리된 합성 DB·미디어·임시 폴더와 OS가 배정한 시험 포트만 쓴다.
  const child = spawn(
    process.execPath,
    ['--conditions=@gallery/source', resolve(import.meta.dirname, '../../src/index.ts')],
    { env: { ...source }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = once(child, 'exit');
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  try {
    await vi.waitFor(
      () => {
        expect(child.exitCode, errors).toBeNull();
        expect(output).toContain('"msg":"listening"');
        expect(output).toContain('"msg":"exhibition_deleted"');
      },
      { timeout: 5_000 },
    );
    expect(output.indexOf('"msg":"listening"')).toBeLessThan(output.indexOf('"msg":"exhibition_deleted"'));
    expect(existsSync(media)).toBe(false);
    child.kill('SIGTERM');
    expect(await exited).toEqual([0, null]);
    expect(output).toContain('"msg":"shutdown_done"');
    const reopened = openTestDb(env.dataDir);
    try {
      expect(reopened.prepare('SELECT count(*) FROM exhibitions').pluck().get()).toBe(0);
      expect(reopened.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
    } finally {
      reopened.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
