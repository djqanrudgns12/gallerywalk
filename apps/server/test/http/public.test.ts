import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from '@gallery/core/layout';
import {
  ApiErrorSchema,
  ExhibitionViewSchema,
  okEnvelope,
  ReactionViewSchema,
  VersionInfoSchema,
} from '@gallery/core/types';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changeStatus, createExhibition, patchExhibition } from '../../src/application/exhibitions.ts';
import { createRoom } from '../../src/application/rooms.ts';
import { createApp } from '../../src/http/app.ts';
import { createLifecycle } from '../../src/http/lifecycle.ts';
import { createLogger } from '../../src/log.ts';
import { makeTempDir, openTestDb, TEST_JSON_LIMIT_BYTES } from '../helpers/server.ts';
import { testDeps } from '../support/memoryStore.ts';

const EX = '00000000-0000-4000-8001-000000000001';
const ROOM = '00000000-0000-4000-8002-000000000001';

let root: string;
let t: ReturnType<typeof testDeps>;
let app: ReturnType<typeof createApp>;
let logDir: string;

beforeEach(async () => {
  root = await makeTempDir();
  t = testDeps();
  logDir = join(root, 'logs');
  app = createApp({
    db: openTestDb(root),
    log: createLogger({ dir: logDir, keepFiles: 7 }),
    mediaDir: root,
    queueLength: () => 0,
    lifecycle: createLifecycle(),
    limits: { jsonBodyMaxBytes: TEST_JSON_LIMIT_BYTES, hstsMaxAgeSec: 31_536_000 },
    useCases: t.deps,
  });
  createExhibition(
    t.deps,
    {
      exhibitionId: EX,
      title: '시험 전시',
      templateId: 'modern-history',
      pin: '482910',
      linkTokenHash: 'a'.repeat(64),
    },
    { deviceRegistered: true },
  );
  createRoom(t.deps, EX, { id: ROOM, order: 0, title: '전시실 1' });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const seedPublished = (): void => {
  t.deps.store.assets.insert({
    id: '00000000-0000-4000-8009-000000000001',
    exhibitionId: EX,
    kind: 'IMAGE',
    width: 3000,
    height: 2000,
    durationMs: null,
    variants: [{ name: 'wall', ext: 'webp', w: 1600, h: 1067, bytes: 1000 }],
    analysis: {
      edgeLuma: 0.8,
      linePitchPx: null,
      linePitchConfidence: 0,
      lineProfile: null,
      profileBinPx: 8,
    },
    bytesTotal: 1000,
    contentHash: 'h1',
    createdAt: 0,
  });
  t.deps.store.artworks.insert({
    id: '00000000-0000-4000-8003-000000000001',
    exhibitionId: EX,
    roomId: ROOM,
    order: 0,
    title: '하늘고래의 호외',
    author: null,
    captionShort: null,
    descriptionLong: null,
    kind: 'IMAGE',
    form: 'LANDSCAPE',
    formOverride: null,
    textHeavy: false,
    textHeavyOverride: null,
    featured: false,
    pageMode: 'AUTO',
    status: 'PUBLISHED',
    sourceAssetId: '00000000-0000-4000-8009-000000000001',
    pageCount: null,
    textBody: null,
    warnings: [],
    failCode: null,
    deletedAt: null,
    rev: 1,
    createHash: 'c1',
    createdAt: 0,
    updatedAt: 0,
  });
};

describe('학생 경로', () => {
  it('열린 전시: 보기 묶음과 버전이 봉투·스키마대로', async () => {
    seedPublished();
    changeStatus(t.deps, EX, 'open');
    const code = t.deps.store.exhibitions.get(EX)!.entryCode;
    const res = await app.request(`/api/e/${code}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = okEnvelope(ExhibitionViewSchema).parse(await res.json());
    expect(body.data.artworks.map(a => a.title)).toEqual(['하늘고래의 호외']);
    const v = okEnvelope(VersionInfoSchema).parse(await (await app.request(`/api/e/${code}/v`)).json());
    expect(v.data.status).toBe('OPEN');
    expect(v.data.layoutVersion).toBe(body.data.versions.layoutVersion);
  });

  it('준비 중·없는 코드·형식이 틀린 코드', async () => {
    const code = t.deps.store.exhibitions.get(EX)!.entryCode;
    const draft = await app.request(`/api/e/${code}`);
    expect(draft.status).toBe(409);
    expect(ApiErrorSchema.parse(await draft.json()).error.code).toBe('E_EXHIBITION_DRAFT');
    for (const bad of ['000000', '12ab56', '1234567']) {
      const res = await app.request(`/api/e/${bad}`);
      expect(res.status).toBe(404);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe('E_NOT_FOUND');
    }
  });
});

describe('방문자·반응(학생)', () => {
  const ART = '00000000-0000-4000-8003-000000000001';
  // 시험 안에서 만든 가짜 토큰(base64url 43자)
  const TOKEN = 'Tq3Vb2Xn8Lr0Yc5Wk1Hd7Fj4Ms9Pa6Ge2Ui8Oz0Rw3E';
  const OTHER = 'Zx9Cv8Bn7Mm6Ll5Kk4Jj3Hh2Gg1Ff0Dd9Ss8Aa7Qq6W';
  let code: string;

  const call = (method: string, path: string, body?: unknown, token: string | null = TOKEN) =>
    app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const errorOf = async (res: Response) => ApiErrorSchema.parse(await res.json()).error;
  const register = (token = TOKEN, nickname?: string) =>
    call(
      'POST',
      `/api/e/${code}/visitor`,
      { tokenHash: sha256Hex(token), consentVersion: '2026-11', ...(nickname ? { nickname } : {}) },
      null,
    );
  const reaction = { sticker: 'MOVED', memo: '배운 게 많아요', scoreFact: null, scoreDelivery: null };

  beforeEach(() => {
    seedPublished();
    changeStatus(t.deps, EX, 'open');
    code = t.deps.store.exhibitions.get(EX)!.entryCode;
  });

  it('등록은 멱등(처음 별명 유지)이고, 별명은 정리되어 돌아온다', async () => {
    const first = await register(TOKEN, '  하늘   고래 ');
    expect(first.status).toBe(200);
    expect(
      okEnvelope(z.object({ nickname: z.string().nullable() })).parse(await first.json()).data.nickname,
    ).toBe('하늘 고래');
    const again = await register(TOKEN, '바람개비');
    expect(
      okEnvelope(z.object({ nickname: z.string().nullable() })).parse(await again.json()).data.nickname,
    ).toBe('하늘 고래');
    const renamed = await call('PATCH', `/api/e/${code}/visitor`, { nickname: '바람개비' });
    expect(okEnvelope(z.object({ nickname: z.string() })).parse(await renamed.json()).data.nickname).toBe(
      '바람개비',
    );
  });

  it('반응: 남기기·다시 보내도 같은 행·내 반응 목록, 토큰 없음·모르는 토큰은 E_AUTH', async () => {
    await register();
    const put = await call('PUT', `/api/e/${code}/reactions/${ART}`, reaction);
    expect(put.status).toBe(200);
    expect(okEnvelope(ReactionViewSchema).parse(await put.json()).data.sticker).toBe('MOVED');
    await call('PUT', `/api/e/${code}/reactions/${ART}`, { ...reaction, sticker: 'GREAT' });
    expect(t.deps.store.reactions.listByExhibition(EX)).toHaveLength(1);
    const me = okEnvelope(z.array(ReactionViewSchema)).parse(
      await (await call('GET', `/api/e/${code}/me`)).json(),
    );
    expect(me.data.map(r => r.sticker)).toEqual(['GREAT']);
    expect((await errorOf(await call('GET', `/api/e/${code}/me`, undefined, null))).code).toBe('E_AUTH');
    expect((await errorOf(await call('PUT', `/api/e/${code}/reactions/${ART}`, reaction, OTHER))).code).toBe(
      'E_AUTH',
    );
  });

  it('반응 꺼짐·받지 않는 칸·없는 작품(메모 걸러내기 단어 목록은 core 시험)', async () => {
    await register();
    const scored = await call('PUT', `/api/e/${code}/reactions/${ART}`, {
      ...reaction,
      scoreFact: 2,
      scoreDelivery: 3,
    });
    expect((await errorOf(scored)).code).toBe('E_VALIDATION');
    const missing = await call(
      'PUT',
      `/api/e/${code}/reactions/00000000-0000-4000-8003-000000000099`,
      reaction,
    );
    expect((await errorOf(missing)).code).toBe('E_NOT_FOUND');
    const ex = t.deps.store.exhibitions.get(EX)!;
    patchExhibition(
      t.deps,
      EX,
      { settings: { ...ex.settings, reactions: { ...ex.settings.reactions, enabled: false } } },
      ex.rev,
    );
    expect((await errorOf(await call('PUT', `/api/e/${code}/reactions/${ART}`, reaction))).code).toBe(
      'E_REACTIONS_OFF',
    );
  });

  it('교사가 공개로 고른 메모는 학생이 글을 바꾸면 다시 고르기 전까지 공개되지 않는다', async () => {
    await register();
    await call('PUT', `/api/e/${code}/reactions/${ART}`, reaction);
    const r = t.deps.store.reactions.listByExhibition(EX)[0]!;
    t.deps.store.reactions.update(r.id, { publicSelected: true });
    await call('PUT', `/api/e/${code}/reactions/${ART}`, { ...reaction, sticker: 'GREAT' });
    expect(t.deps.store.reactions.listByExhibition(EX)[0]!.publicSelected).toBe(true);
    await call('PUT', `/api/e/${code}/reactions/${ART}`, { ...reaction, memo: '다른 글' });
    expect(t.deps.store.reactions.listByExhibition(EX)[0]!.publicSelected).toBe(false);
  });
});
