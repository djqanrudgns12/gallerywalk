import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { runMedia } from '../../src/upload/process.ts';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/**
 * 개발 서버는 `node --watch`로 돈다. 그 환경 값(`WATCH_REPORT_DEPENDENCIES`)을 자식이 물려받으면 Node가 IPC로
 * 감시용 메시지(`watch:import` 등)를 먼저 보내고, 처리 결과 검사가 그것을 거절해 업로드가 `E_SERVER`가 됐다(P4 시드에서 발견).
 */
it('개발 서버 감시 환경 값을 물려받아도 처리 결과를 받는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gallery-process-'));
  dirs.push(root);
  const input = join(root, 'synthetic.png');
  const bytes = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#5f7a93' } })
    .png()
    .toBuffer();
  await writeFile(input, bytes);
  const prev = process.env['WATCH_REPORT_DEPENDENCIES'];
  process.env['WATCH_REPORT_DEPENDENCIES'] = '1';
  try {
    const result = await runMedia('IMAGE', input, join(root, 'out'), new AbortController().signal);
    expect(result.kind).toBe('IMAGE');
  } finally {
    if (prev === undefined) delete process.env['WATCH_REPORT_DEPENDENCIES'];
    else process.env['WATCH_REPORT_DEPENDENCIES'] = prev;
  }
});
