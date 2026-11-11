import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { getRequestListener } from '@hono/node-server';
import { config } from '@gallery/core/config';
import { ArtworkTeacherSchema, okEnvelope } from '@gallery/core/types';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { createServerDeps, exhibitionMediaDir } from '../../src/deps.ts';
import { createApp } from '../../src/http/app.ts';
import { createLifecycle } from '../../src/http/lifecycle.ts';
import { createLogger } from '../../src/log.ts';
import { createExhibition } from '../../src/application/exhibitions.ts';
import { createRoom } from '../../src/application/rooms.ts';
import { tokenHash } from '../../src/security/index.ts';
import { randomToken, tempDb } from '../security/support.ts';

it('운영 의존성으로 실제 HTTP 수신·물리 공간 예약·처리·SQLite 쓰기·삭제 기다리기가 연결된다', async () => {
  const t = await tempDb();
  const log = createLogger({ dir: join(t.root, 'logs'), keepFiles: 1 });
  const { deps, security, uploads } = createServerDeps(t.db, t.env, log);
  const lifecycle = createLifecycle();
  const app = createApp({
    db: t.db,
    log,
    mediaDir: t.env.mediaDir,
    queueLength: () => uploads.queueLength(),
    lifecycle,
    limits: { jsonBodyMaxBytes: config().JSON_BODY_MAX_KB * 1024, hstsMaxAgeSec: config().HSTS_MAX_AGE_SEC },
    useCases: deps,
    teacher: { security, uploads },
  });
  const server = createServer(getRequestListener(app.fetch));
  try {
    const exhibitionId = randomUUID();
    const token = randomToken();
    createExhibition(
      deps,
      {
        exhibitionId,
        title: '합성 운영 연결',
        templateId: 'modern-history',
        pin: '58392647',
        linkTokenHash: tokenHash(token),
      },
      { deviceRegistered: true },
    );
    const roomId = randomUUID();
    createRoom(deps, exhibitionId, { id: roomId, order: 0, title: '합성 방' });
    expect(deps.uploads).toBe(uploads);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test address');
    const bytes = await sharp({ create: { width: 800, height: 900, channels: 3, background: '#ae7251' } })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(bytes)]), 'synthetic.png');
    form.set(
      'meta',
      JSON.stringify({ id: randomUUID(), roomId, kind: 'IMAGE', title: '합성 그림', order: 0 }),
    );
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/teacher/exhibitions/${exhibitionId}/artworks`,
      { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form },
    );
    expect(response.status).toBe(200);
    const art = okEnvelope(ArtworkTeacherSchema).parse(await response.json()).data;
    expect(art.status).toBe('PUBLISHED');
    expect(deps.store.artworks.get(art.id)?.sourceAssetId).toBe(art.image?.asset.assetId);
    expect(await readdir(exhibitionMediaDir(t.env.mediaDir, exhibitionId))).toEqual([
      art.image!.asset.assetId,
    ]);
    expect(await readdir(t.env.tmpDir)).toEqual([]);
    expect(uploads.queueLength()).toBe(0);
    const rev = deps.store.exhibitions.get(exhibitionId)!.rev;
    const deleted = await fetch(`http://127.0.0.1:${address.port}/api/teacher/exhibitions/${exhibitionId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, 'if-match': String(rev) },
    });
    expect(deleted.status).toBe(200);
    expect(deps.store.exhibitions.get(exhibitionId)).toBeNull();
    expect(await deps.media.exists(exhibitionId)).toBe(false);
  } finally {
    lifecycle.beginDrain();
    server.closeAllConnections();
    await uploads.drainAll(0);
    await new Promise<void>(resolve => server.close(() => resolve()));
    log.close();
    await t.close();
  }
});
