import { randomInt, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { config, overrideConfig, resetConfig } from '@gallery/core/config';
import {
  ApiErrorSchema,
  ArtworkTeacherSchema,
  CreateExhibitionResultSchema,
  ExhibitionTeacherSchema,
  okEnvelope,
  PinLoginResultSchema,
  RoomTeacherSchema,
  TeacherExhibitionViewSchema,
  TeacherMeSchema,
  TeacherReactionSchema,
} from '@gallery/core/types';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteExhibition } from '../../src/application/deleteExhibition.ts';
import { putReaction, registerVisitor } from '../../src/application/visitors.ts';
import { createApp } from '../../src/http/app.ts';
import { createLifecycle } from '../../src/http/lifecycle.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import type { Deps } from '../../src/ports/index.ts';
import { createSecurity, storeStartCode, tokenHash } from '../../src/security/index.ts';
import type { Db } from '../../src/store/db.ts';
import { TEST_JSON_LIMIT_BYTES } from '../helpers/server.ts';
import { randomDeviceId, randomStrongPin, randomToken, tempDb, type TempDb } from '../security/support.ts';
import { memoryTestDeps, sqliteTestDeps, type TestDeps } from '../support/sqliteDeps.ts';

/**
 * 교사 경로(PLAN §9.2 교사 표)를 HTTP로: 메모리·SQLite 두 저장소(칸·시작 코드 기기는 늘 임시 SQLite).
 * 토큰·PIN·기기 ID·시작 코드는 시험 안에서 만든 난수, IP는 문서용 주소(RFC 5737), 글은 가상 글.
 * 응답은 웹 어댑터가 짝지은 core 스키마로 검사한다.
 */

const IP = '203.0.113.7';
const MS_PER_MIN = 60_000;

const STORES: readonly { readonly name: string; readonly make: (t: TempDb) => { s: TestDeps; db: Db } }[] = [
  { name: 'memory', make: t => ({ s: memoryTestDeps(), db: t.db }) },
  {
    name: 'sqlite',
    make: () => {
      const s = sqliteTestDeps();
      return { s, db: s.db };
    },
  },
];

interface Req {
  readonly body?: unknown;
  readonly token?: string;
  readonly ifMatch?: string;
  readonly device?: string;
  readonly ip?: string;
  readonly headers?: Record<string, string>;
  readonly raw?: string;
}

describe.each(STORES)('교사 경로 · $name', ({ make }) => {
  let t: TempDb;
  let s: TestDeps;
  let deps: Deps;
  let log: Logger;
  let app: ReturnType<typeof createApp>;
  let device: string;
  let startCode: string;
  let closed: [string, string][];
  /** 허브에 알린 설정 바뀜(전시 ID · 그때 저장소의 말풍선 설정 — 고친 뒤에 불렸는지) */
  let changed: [string, unknown][];
  let slept: number[];

  beforeEach(async () => {
    t = await tempDb();
    const made = make(t);
    s = made.s;
    const security = createSecurity(t.env, { db: made.db, clock: s.deps.clock });
    deps = { ...s.deps, security };
    startCode = String(randomInt(10_000_000, 100_000_000));
    storeStartCode(made.db, t.env.secrets.startCodeHmac, startCode);
    log = createLogger({ dir: join(t.root, 'logs'), keepFiles: 1 });
    closed = [];
    changed = [];
    slept = [];
    device = randomDeviceId();
    app = createApp({
      db: made.db,
      log,
      mediaDir: t.root,
      queueLength: () => 0,
      lifecycle: createLifecycle(),
      limits: { jsonBodyMaxBytes: TEST_JSON_LIMIT_BYTES, hstsMaxAgeSec: 31_536_000 },
      useCases: deps,
      teacher: {
        security,
        live: {
          closeExhibition: (id, code) => void closed.push([id, code]),
          settingsChanged: id => void changed.push([id, s.store.exhibitions.get(id)?.settings.bubbles]),
        },
        sleep: async ms => void slept.push(ms),
      },
    });
  });

  afterEach(async () => {
    resetConfig();
    log.close();
    s.close();
    await t.close();
  });

  const call = (method: string, path: string, o: Req = {}) =>
    app.request(path, {
      method,
      headers: {
        'x-device-id': o.device ?? device,
        'x-gw-viewer-ip': o.ip ?? IP,
        ...(o.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(o.token === undefined ? {} : { authorization: `Bearer ${o.token}` }),
        ...(o.ifMatch === undefined ? {} : { 'if-match': o.ifMatch }),
        ...o.headers,
      },
      ...(o.raw !== undefined
        ? { body: o.raw }
        : o.body === undefined
          ? {}
          : { body: JSON.stringify(o.body) }),
    });

  const data = async <S extends z.ZodType>(res: Response, schema: S): Promise<z.output<S>> => {
    const json: unknown = await res.json();
    expect({ status: res.status, json }).toMatchObject({ status: 200 });
    return schema.parse(okEnvelope(z.unknown()).parse(json).data);
  };

  const failure = async (res: Response) => ({
    status: res.status,
    ...ApiErrorSchema.parse(await res.json()).error,
  });
  const codeOf = async (res: Response) => (await failure(res)).code;

  const createBody = (over: Record<string, unknown> = {}) => ({
    exhibitionId: randomUUID(),
    title: '하늘고래 전시',
    templateId: 'modern-history',
    pin: randomStrongPin(),
    linkTokenHash: tokenHash(randomToken()),
    startCode,
    ...over,
  });

  interface Made {
    readonly id: string;
    readonly token: string;
    readonly pin: string;
    readonly entryCode: string;
  }

  /** 이 기기(처음이면 시작 코드)로 전시 하나 */
  const newExhibition = async (title = '하늘고래 전시'): Promise<Made> => {
    const token = randomToken();
    const body = createBody({ title, linkTokenHash: tokenHash(token) });
    const res = await data(
      await call('POST', '/api/teacher/exhibitions', { body }),
      CreateExhibitionResultSchema,
    );
    return { id: res.exhibitionId, token, pin: body.pin, entryCode: res.entryCode };
  };

  const view = async (ex: Made) =>
    data(
      await call('GET', `/api/teacher/exhibitions/${ex.id}`, { token: ex.token }),
      TeacherExhibitionViewSchema,
    );

  const newRoom = async (ex: Made, order = 0, title = '1 전시실') =>
    data(
      await call('POST', `/api/teacher/exhibitions/${ex.id}/rooms`, {
        token: ex.token,
        body: { id: randomUUID(), order, title },
      }),
      RoomTeacherSchema,
    );

  const textBody = (roomId: string, order = 0, title = '바람의 편지') => ({
    id: randomUUID(),
    roomId,
    order,
    title,
    kind: 'TEXT',
    textBody: '바람이 불면 편지를 써요.\n둘째 줄',
  });

  const newText = async (ex: Made, roomId: string, order = 0, title?: string) =>
    data(
      await call('POST', `/api/teacher/exhibitions/${ex.id}/artworks`, {
        token: ex.token,
        body: textBody(roomId, order, title),
      }),
      ArtworkTeacherSchema,
    );

  const pinLogin = (pin: string, token = randomToken(), o: Req = {}) =>
    call('POST', '/api/teacher/pin', { ...o, body: { pin, sessionTokenHash: tokenHash(token) } });

  describe('만들기', () => {
    it('처음 기기는 시작 코드 — 맞히면 기기 등록, 같은 ID·본문은 처음 결과, 다른 본문은 E_CONFLICT', async () => {
      const { startCode: _drop, ...noCode } = createBody();
      expect(await codeOf(await call('POST', '/api/teacher/exhibitions', { body: noCode }))).toBe(
        'E_START_CODE',
      );
      const wrong = createBody({ startCode: `${startCode}1` });
      expect(await failure(await call('POST', '/api/teacher/exhibitions', { body: wrong }))).toMatchObject({
        status: 401,
        code: 'E_START_CODE',
      });

      const token = randomToken();
      const body = createBody({ linkTokenHash: tokenHash(token) });
      const first = await data(
        await call('POST', '/api/teacher/exhibitions', { body }),
        CreateExhibitionResultSchema,
      );
      expect(first.exhibitionId).toBe(body.exhibitionId);
      expect(first.entryCode).toMatch(new RegExp(`^\\d{${config().ENTRY_CODE_DIGITS}}$`));
      const again = await data(
        await call('POST', '/api/teacher/exhibitions', { body }),
        CreateExhibitionResultSchema,
      );
      expect(again).toEqual(first);
      expect(
        await codeOf(
          await call('POST', '/api/teacher/exhibitions', { body: { ...body, title: '다른 이름' } }),
        ),
      ).toBe('E_CONFLICT');
      expect(s.count('exhibitions')).toBe(1);

      // 등록된 기기는 다음부터 시작 코드 없이, 처음 보는 기기는 다시 묻는다
      const { startCode: _again, ...second } = createBody();
      await data(
        await call('POST', '/api/teacher/exhibitions', { body: second }),
        CreateExhibitionResultSchema,
      );
      const { startCode: _other, ...third } = createBody();
      expect(
        await codeOf(
          await call('POST', '/api/teacher/exhibitions', { body: third, device: randomDeviceId() }),
        ),
      ).toBe('E_START_CODE');
      expect(s.count('exhibitions')).toBe(2);

      // 링크 토큰으로 me
      const me = await data(await call('GET', '/api/teacher/me', { token }), TeacherMeSchema);
      expect(me).toEqual({ exhibitionId: body.exhibitionId, title: body.title, sessionKind: 'LINK' });
      expect(await failure(await call('GET', '/api/teacher/me'))).toMatchObject({
        status: 401,
        code: 'E_AUTH',
      });
    });

    it('쉬운 PIN은 E_PIN_WEAK(세지 않음), 이미 쓰이는 PIN은 E_PIN_TAKEN이면서 PIN 실패로 세어 잠긴다', async () => {
      const a = await newExhibition();
      const max = config().PIN_MAX_FAILS;
      for (let i = 0; i <= max; i++)
        expect(
          await codeOf(
            await call('POST', '/api/teacher/exhibitions', { body: createBody({ pin: '111111' }) }),
          ),
        ).toBe('E_PIN_WEAK');
      for (let i = 1; i < max; i++)
        expect(
          await codeOf(await call('POST', '/api/teacher/exhibitions', { body: createBody({ pin: a.pin }) })),
        ).toBe('E_PIN_TAKEN');
      const locked = await call('POST', '/api/teacher/exhibitions', { body: createBody({ pin: a.pin }) });
      expect(locked.headers.get('retry-after')).toBe(String(config().PIN_LOCK_MIN * 60));
      expect(await failure(locked)).toMatchObject({
        status: 429,
        code: 'E_PIN_LOCKED',
        fields: { retryAfterMin: String(config().PIN_LOCK_MIN) },
      });
      expect(s.count('exhibitions')).toBe(1);
      // 같은 기기는 PIN 로그인도 잠김, 같은 IP의 다른 기기는 그대로
      expect(await codeOf(await pinLogin(a.pin))).toBe('E_PIN_LOCKED');
      await data(await pinLogin(a.pin, randomToken(), { device: randomDeviceId() }), PinLoginResultSchema);
    });

    it('만들기 칸: 새로 만든 전시만 세고(다시 보내기는 그대로 통과), 하루가 지나면 풀린다', async () => {
      overrideConfig({ CREATE_PER_DEVICE_DAY: 1 });
      const body = createBody();
      const first = await data(
        await call('POST', '/api/teacher/exhibitions', { body }),
        CreateExhibitionResultSchema,
      );
      const limited = await call('POST', '/api/teacher/exhibitions', { body: createBody() });
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(await failure(limited)).toMatchObject({ status: 429, code: 'E_RATE_LIMITED' });
      expect(
        await data(await call('POST', '/api/teacher/exhibitions', { body }), CreateExhibitionResultSchema),
      ).toEqual(first);
      s.advance(24 * 60 * MS_PER_MIN);
      await data(
        await call('POST', '/api/teacher/exhibitions', { body: createBody() }),
        CreateExhibitionResultSchema,
      );
      expect(s.count('exhibitions')).toBe(2);
    });
  });

  describe('PIN 로그인', () => {
    it('맞으면 PIN 세션, 틀리면 E_PIN_INVALID, 기기 실패가 쌓이면 잠기고 가짜 시계로 풀린다', async () => {
      const a = await newExhibition();
      const pinToken = randomToken();
      expect(await data(await pinLogin(a.pin, pinToken), PinLoginResultSchema)).toEqual({
        exhibitionId: a.id,
      });
      // 답을 못 받은 기기가 같은 해시로 다시 보내도 성공
      expect(await data(await pinLogin(a.pin, pinToken), PinLoginResultSchema)).toEqual({
        exhibitionId: a.id,
      });
      const me = await data(await call('GET', '/api/teacher/me', { token: pinToken }), TeacherMeSchema);
      expect(me.sessionKind).toBe('PIN');

      let wrong = randomStrongPin();
      while (wrong === a.pin) wrong = randomStrongPin();
      const max = config().PIN_MAX_FAILS;
      for (let i = 1; i < max; i++)
        expect(await failure(await pinLogin(wrong))).toMatchObject({ status: 401, code: 'E_PIN_INVALID' });
      expect(await failure(await pinLogin(wrong))).toMatchObject({ status: 429, code: 'E_PIN_LOCKED' });
      expect(await codeOf(await pinLogin(a.pin))).toBe('E_PIN_LOCKED');
      // 모양이 틀린 PIN은 검사 단계에서 거절(세지 않음)
      expect(await codeOf(await pinLogin('12ab'))).toBe('E_VALIDATION');

      s.advance(config().PIN_LOCK_MIN * MS_PER_MIN);
      expect(await data(await pinLogin(a.pin), PinLoginResultSchema)).toEqual({ exhibitionId: a.id });
      expect(slept.every(ms => ms === 0)).toBe(true);
    });

    it('전역 실패가 많으면 맞는 PIN 응답도 늦춘다', async () => {
      overrideConfig({ PIN_GLOBAL_SLOW_AT: 3 });
      const a = await newExhibition();
      let wrong = randomStrongPin();
      while (wrong === a.pin) wrong = randomStrongPin();
      slept.length = 0;
      for (let i = 0; i < 3; i++)
        expect(await codeOf(await pinLogin(wrong, randomToken(), { device: randomDeviceId() }))).toBe(
          'E_PIN_INVALID',
        );
      await data(await pinLogin(a.pin, randomToken(), { device: randomDeviceId() }), PinLoginResultSchema);
      const delay = config().PIN_GLOBAL_DELAY_MS;
      expect(slept).toEqual([0, 0, delay, delay]);
    });

    it('만료된 전시의 PIN은 틀린 PIN과 같다', async () => {
      const a = await newExhibition();
      const ex = s.store.exhibitions.get(a.id);
      if (!ex) throw new Error('exhibition');
      s.advance(ex.expiresAt - s.at());
      expect(await codeOf(await pinLogin(a.pin))).toBe('E_PIN_INVALID');
    });
  });

  describe('고치기·링크', () => {
    it('If-Match 빠짐·어긋남·모양 틀림은 E_CONFLICT, 맞으면 rev가 오르고 교사 모양으로 돌아온다', async () => {
      const a = await newExhibition();
      const rev = (await view(a)).exhibition.rev;
      const path = `/api/teacher/exhibitions/${a.id}`;
      const body = { title: '바다거북 전시' };
      for (const ifMatch of [undefined, String(rev + 5), 'abc', '1.5'])
        expect(
          await failure(await call('PATCH', path, { token: a.token, body, ...(ifMatch ? { ifMatch } : {}) })),
        ).toMatchObject({
          status: 409,
          code: 'E_CONFLICT',
        });
      const patched = await data(
        await call('PATCH', path, { token: a.token, body, ifMatch: String(rev) }),
        ExhibitionTeacherSchema,
      );
      expect([patched.title, patched.rev]).toEqual(['바다거북 전시', rev + 1]);
      // 따옴표로 감싼 rev도 받는다
      const quoted = await data(
        await call('PATCH', path, {
          token: a.token,
          body: { subtitle: '가상 소개' },
          ifMatch: `"${rev + 1}"`,
        }),
        ExhibitionTeacherSchema,
      );
      expect(quoted.rev).toBe(rev + 2);

      // 전시실: 고치기·지우기도 rev
      const room = await newRoom(a);
      expect(room.rev).toBe(1);
      const roomPath = `/api/teacher/rooms/${room.id}`;
      const renamed = await data(
        await call('PATCH', roomPath, { token: a.token, body: { title: '첫 전시실' }, ifMatch: '1' }),
        RoomTeacherSchema,
      );
      expect([renamed.title, renamed.rev]).toEqual(['첫 전시실', 2]);
      expect(
        await codeOf(await call('PATCH', roomPath, { token: a.token, body: { intro: null }, ifMatch: '1' })),
      ).toBe('E_CONFLICT');
      expect(await codeOf(await call('DELETE', roomPath, { token: a.token, ifMatch: '1' }))).toBe(
        'E_CONFLICT',
      );

      // 작품
      const art = await newText(a, room.id);
      const artPath = `/api/teacher/artworks/${art.id}`;
      expect(await codeOf(await call('PATCH', artPath, { token: a.token, body: { title: '새 제목' } }))).toBe(
        'E_CONFLICT',
      );
      const artPatched = await data(
        await call('PATCH', artPath, {
          token: a.token,
          body: { title: '새 제목', author: null },
          ifMatch: '1',
        }),
        ArtworkTeacherSchema,
      );
      expect([artPatched.title, artPatched.rev]).toEqual(['새 제목', 2]);
      expect((await call('DELETE', artPath, { token: a.token, ifMatch: '1' })).status).toBe(409);
      expect((await call('DELETE', artPath, { token: a.token, ifMatch: '2' })).status).toBe(204);
      const restored = await data(
        await call('POST', `${artPath}/restore`, { token: a.token }),
        ArtworkTeacherSchema,
      );
      expect([restored.deletedAt, restored.rev]).toEqual([null, 4]);
      // 작품이 있는 마지막 전시실은 지울 수 없다
      expect(await codeOf(await call('DELETE', roomPath, { token: a.token, ifMatch: '2' }))).toBe(
        'E_CONFLICT',
      );
    });

    it('설정을 고치면 고친 뒤에 함께 관람 허브에 알린다(W-02 말풍선), 설정이 없거나 고치기가 실패하면 알리지 않는다', async () => {
      const a = await newExhibition();
      const path = `/api/teacher/exhibitions/${a.id}`;
      let rev = (await view(a)).exhibition.rev;
      await data(
        await call('PATCH', path, { token: a.token, body: { title: '바다거북 전시' }, ifMatch: String(rev) }),
        ExhibitionTeacherSchema,
      );
      expect(changed).toEqual([]);
      rev += 1;
      const body = { settings: { bubbles: { enabled: false } } };
      expect(
        await codeOf(await call('PATCH', path, { token: a.token, body, ifMatch: String(rev + 5) })),
      ).toBe('E_CONFLICT');
      expect(changed).toEqual([]);
      await data(
        await call('PATCH', path, { token: a.token, body, ifMatch: String(rev) }),
        ExhibitionTeacherSchema,
      );
      // 허브가 읽을 저장소 값이 이미 바뀐 뒤에 불렸다
      expect(changed).toEqual([[a.id, { enabled: false, text: false }]]);
    });

    it('링크 새로 만들기: 옛 링크는 E_AUTH, 새 링크와 PIN 세션은 그대로', async () => {
      const a = await newExhibition();
      const pinToken = randomToken();
      await data(await pinLogin(a.pin, pinToken), PinLoginResultSchema);
      const next = randomToken();
      const res = await call('POST', `/api/teacher/exhibitions/${a.id}/link/rotate`, {
        token: a.token,
        body: { linkTokenHash: tokenHash(next) },
      });
      expect(res.status).toBe(204);
      expect(await codeOf(await call('GET', '/api/teacher/me', { token: a.token }))).toBe('E_AUTH');
      expect(
        (await data(await call('GET', '/api/teacher/me', { token: next }), TeacherMeSchema)).sessionKind,
      ).toBe('LINK');
      expect(
        (await data(await call('GET', '/api/teacher/me', { token: pinToken }), TeacherMeSchema)).sessionKind,
      ).toBe('PIN');
    });
  });

  describe('전시 경계', () => {
    it('전시 A 토큰으로 B의 전시·전시실·작품·반응 ID를 넣으면 모두 E_NOT_FOUND이고 B는 그대로', async () => {
      const a = await newExhibition('가 전시');
      const b = await newExhibition('나 전시');
      const aRoom = await newRoom(a);
      const aArt = await newText(a, aRoom.id);
      const bRoom = await newRoom(b);
      const bArt = await newText(b, bRoom.id);
      await data(
        await call('POST', `/api/teacher/exhibitions/${b.id}/open`, { token: b.token }),
        ExhibitionTeacherSchema,
      );
      const visitor = randomToken();
      registerVisitor(deps, b.entryCode, {
        tokenHash: tokenHash(visitor),
        nickname: '하늘고래',
        consentVersion: config().CONSENT_VERSION,
      });
      putReaction(deps, b.entryCode, tokenHash(visitor), bArt.id, {
        sticker: 'MOVED',
        memo: '배운 게 많아요',
        scoreFact: null,
        scoreDelivery: null,
      });
      const bReaction = s.store.reactions.listByExhibition(b.id)[0];
      if (!bReaction) throw new Error('reaction');
      const before = await view(b);
      const bExRev = String(before.exhibition.rev);

      const ex = `/api/teacher/exhibitions/${b.id}`;
      const tries: readonly [string, string, Req][] = [
        ['GET', ex, {}],
        ['PATCH', ex, { body: { title: '바꿈' }, ifMatch: bExRev }],
        ['POST', `${ex}/close`, {}],
        ['POST', `${ex}/link/rotate`, { body: { linkTokenHash: tokenHash(randomToken()) } }],
        ['POST', `${ex}/rooms`, { body: { id: randomUUID(), order: 1, title: '끼어든 방' } }],
        ['PUT', `${ex}/rooms/order`, { body: { ids: [bRoom.id] } }],
        ['POST', `${ex}/artworks`, { body: textBody(bRoom.id) }],
        ['GET', `${ex}/reactions`, {}],
        ['GET', `${ex}/reactions.csv`, {}],
        ['PATCH', `/api/teacher/rooms/${bRoom.id}`, { body: { title: '바꿈' }, ifMatch: '1' }],
        ['DELETE', `/api/teacher/rooms/${bRoom.id}`, { ifMatch: '1' }],
        ['PUT', `/api/teacher/rooms/${bRoom.id}/artwork-order`, { body: { ids: [bArt.id] } }],
        ['PATCH', `/api/teacher/artworks/${bArt.id}`, { body: { title: '바꿈' }, ifMatch: '1' }],
        ['DELETE', `/api/teacher/artworks/${bArt.id}`, { ifMatch: '1' }],
        ['POST', `/api/teacher/artworks/${bArt.id}/restore`, {}],
        ['POST', '/api/teacher/artworks/batch', { body: { action: 'HIDE', ids: [bArt.id] } }],
        [
          'POST',
          '/api/teacher/artworks/batch',
          { body: { action: 'MOVE', ids: [aArt.id], roomId: bRoom.id } },
        ],
        ['PATCH', `/api/teacher/artworks/${aArt.id}`, { body: { roomId: bRoom.id }, ifMatch: '1' }],
        ['POST', `/api/teacher/exhibitions/${a.id}/artworks`, { body: textBody(bRoom.id) }],
        ['PATCH', `/api/teacher/reactions/${bReaction.id}`, { body: { hidden: true } }],
        ['PATCH', '/api/teacher/artworks/not-a-uuid', { body: { title: '바꿈' }, ifMatch: '1' }],
      ];
      for (const [method, path, o] of tries)
        expect({
          method,
          path,
          ...(await failure(await call(method, path, { ...o, token: a.token }))),
        }).toMatchObject({
          status: 404,
          code: 'E_NOT_FOUND',
        });

      const after = await view(b);
      expect(after.exhibition).toEqual(before.exhibition);
      expect(after.rooms).toEqual(before.rooms);
      expect(after.artworks).toEqual(before.artworks);
      expect(s.store.reactions.listByExhibition(b.id)).toEqual([bReaction]);
      expect(closed).toEqual([]);
      // A의 작품도 그대로(옮기기 실패는 되돌림)
      expect((await view(a)).artworks.map(x => [x.id, x.roomId, x.rev])).toEqual([[aArt.id, aRoom.id, 1]]);
    });
  });

  describe('상태·작품·순서', () => {
    it('열기: 게시 작품이 없으면 E_NOTHING_PUBLISHED, 닫으면 함께 관람 방문자를 내보내고 다시 열 수 있다', async () => {
      const a = await newExhibition();
      const room = await newRoom(a);
      const open = `/api/teacher/exhibitions/${a.id}/open`;
      expect(await failure(await call('POST', open, { token: a.token }))).toMatchObject({
        status: 409,
        code: 'E_NOTHING_PUBLISHED',
      });
      const art = await newText(a, room.id);
      expect([art.kind, art.form, art.status, art.textHeavy, art.featured]).toEqual([
        'TEXT',
        'TEXTCARD',
        'PUBLISHED',
        true,
        false,
      ]);
      const opened = await data(await call('POST', open, { token: a.token }), ExhibitionTeacherSchema);
      expect([opened.status, opened.openedAt]).toEqual(['OPEN', s.at()]);
      expect((await app.request(`/api/e/${a.entryCode}`)).status).toBe(200);

      const close = `/api/teacher/exhibitions/${a.id}/close`;
      const closedEx = await data(await call('POST', close, { token: a.token }), ExhibitionTeacherSchema);
      expect(closedEx.status).toBe('CLOSED');
      expect(closed).toEqual([[a.id, 'E_EXHIBITION_CLOSED']]);
      expect(await codeOf(await app.request(`/api/e/${a.entryCode}`))).toBe('E_EXHIBITION_CLOSED');
      // 다시 보내도 그대로
      expect(
        (await data(await call('POST', close, { token: a.token }), ExhibitionTeacherSchema)).status,
      ).toBe('CLOSED');
      const reopened = await data(
        await call('POST', `/api/teacher/exhibitions/${a.id}/reopen`, { token: a.token }),
        ExhibitionTeacherSchema,
      );
      expect(reopened.status).toBe('OPEN');
      // 교사 보기: 게시 작품이 있으면 배치가 있다
      expect((await view(a)).layout).not.toBeNull();
    });

    it('글 작품은 멱등·충돌을 지키고 PDF는 처리 중으로 시작한다(파일은 Node 수신 경로)', async () => {
      const a = await newExhibition();
      const room = await newRoom(a);
      const path = `/api/teacher/exhibitions/${a.id}/artworks`;
      const body = textBody(room.id);
      const first = await data(await call('POST', path, { token: a.token, body }), ArtworkTeacherSchema);
      expect(first.textBody).toBe(body.textBody);
      expect(await data(await call('POST', path, { token: a.token, body }), ArtworkTeacherSchema)).toEqual(
        first,
      );
      expect(
        await codeOf(await call('POST', path, { token: a.token, body: { ...body, textBody: '다른 글' } })),
      ).toBe('E_CONFLICT');
      const pdf = { id: randomUUID(), roomId: room.id, order: 1, title: '보고서', kind: 'PDF', pageCount: 3 };
      expect(
        await data(await call('POST', path, { token: a.token, body: pdf }), ArtworkTeacherSchema),
      ).toMatchObject({
        id: pdf.id,
        kind: 'PDF',
        status: 'PROCESSING',
        pages: [],
      });
      const multipart = await call('POST', path, {
        token: a.token,
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        raw: '--x--',
      });
      expect(await failure(multipart)).toMatchObject({ code: 'E_VALIDATION', fields: { _: 'multipart' } });
      expect((await view(a)).artworks.map(x => x.id)).toEqual([first.id, pdf.id]);
    });

    it('전시실·작품 순서는 전체 집합만 받고(다르면 E_CONFLICT), 여러 개 바꾸기는 바뀐 수를 돌려준다', async () => {
      const a = await newExhibition();
      const r1 = await newRoom(a, 0, '1 전시실');
      const r2 = await newRoom(a, 1, '2 전시실');
      const order = `/api/teacher/exhibitions/${a.id}/rooms/order`;
      expect((await call('PUT', order, { token: a.token, body: { ids: [r2.id, r1.id] } })).status).toBe(204);
      expect((await view(a)).rooms.map(r => r.id)).toEqual([r2.id, r1.id]);
      expect(await codeOf(await call('PUT', order, { token: a.token, body: { ids: [r1.id] } }))).toBe(
        'E_CONFLICT',
      );

      const arts = [
        await newText(a, r1.id, 0, '하나'),
        await newText(a, r1.id, 1, '둘'),
        await newText(a, r1.id, 2, '셋'),
      ];
      const [one, two, three] = arts.map(x => x.id) as [string, string, string];
      const artOrder = `/api/teacher/rooms/${r1.id}/artwork-order`;
      expect((await call('PUT', artOrder, { token: a.token, body: { ids: [three, one, two] } })).status).toBe(
        204,
      );
      const inRoom = (v: z.infer<typeof TeacherExhibitionViewSchema>) =>
        v.artworks.filter(x => x.roomId === r1.id && x.deletedAt === null).map(x => x.id);
      expect(inRoom(await view(a))).toEqual([three, one, two]);
      expect(await codeOf(await call('PUT', artOrder, { token: a.token, body: { ids: [one, two] } }))).toBe(
        'E_CONFLICT',
      );
      expect(
        await codeOf(await call('PUT', artOrder, { token: a.token, body: { ids: [one, one, two] } })),
      ).toBe('E_VALIDATION');

      const batch = '/api/teacher/artworks/batch';
      const changed = z.object({ changed: z.number() });
      expect(
        await data(
          await call('POST', batch, { token: a.token, body: { action: 'MOVE', ids: [one], roomId: r2.id } }),
          changed,
        ),
      ).toEqual({ changed: 1 });
      expect(
        await data(
          await call('POST', batch, { token: a.token, body: { action: 'HIDE', ids: [two, three] } }),
          changed,
        ),
      ).toEqual({ changed: 2 });
      const v = await view(a);
      expect(v.artworks.find(x => x.id === one)?.roomId).toBe(r2.id);
      expect(
        v.artworks
          .filter(x => x.status === 'HIDDEN')
          .map(x => x.id)
          .sort(),
      ).toEqual([two, three].sort());
    });
  });

  describe('반응', () => {
    const visitorOf = (entryCode: string, nickname: string) => {
      const token = randomToken();
      registerVisitor(deps, entryCode, {
        tokenHash: tokenHash(token),
        nickname,
        consentVersion: config().CONSENT_VERSION,
      });
      return tokenHash(token);
    };

    it('모아 보기·숨기기/고르기(공개 집계가 바뀔 때만 내용 버전), CSV는 BOM·CRLF·따옴표·수식 막기·파일 이름', async () => {
      const a = await newExhibition('하늘/바다 전시');
      const room = await newRoom(a, 0, '1 전시실');
      const art = await newText(a, room.id, 0, '바람의 편지');
      await data(
        await call('POST', `/api/teacher/exhibitions/${a.id}/open`, { token: a.token }),
        ExhibitionTeacherSchema,
      );
      const v1 = visitorOf(a.entryCode, '하늘고래');
      const v2 = visitorOf(a.entryCode, '바람');
      putReaction(deps, a.entryCode, v1, art.id, {
        sticker: 'MOVED',
        memo: '=1+2',
        scoreFact: null,
        scoreDelivery: null,
      });
      s.advance(MS_PER_MIN);
      putReaction(deps, a.entryCode, v2, art.id, {
        sticker: 'GREAT',
        memo: '정말 "멋져요"',
        scoreFact: null,
        scoreDelivery: null,
      });

      const list = await data(
        await call('GET', `/api/teacher/exhibitions/${a.id}/reactions`, { token: a.token }),
        z.array(TeacherReactionSchema),
      );
      expect(list.map(r => [r.nickname, r.memo, r.hidden])).toEqual([
        ['하늘고래', '=1+2', false],
        ['바람', '정말 "멋져요"', false],
      ]);
      const [first, second] = list as [
        z.infer<typeof TeacherReactionSchema>,
        z.infer<typeof TeacherReactionSchema>,
      ];
      const version = () => s.store.exhibitions.get(a.id)?.contentVersion;

      // 메모 공개가 '교사만'이면 숨겨도 학생에게 보이는 것이 같다 → 내용 버전 그대로
      const v0 = version();
      const hidden = await data(
        await call('PATCH', `/api/teacher/reactions/${first.id}`, { token: a.token, body: { hidden: true } }),
        TeacherReactionSchema,
      );
      expect([hidden.hidden, hidden.updatedAt]).toEqual([true, first.updatedAt]);
      expect(version()).toBe(v0);

      // '고른 것만 모두에게'에서 고르면 공개 집계가 바뀐다 → 내용 버전 +1
      const rev = (await view(a)).exhibition.rev;
      await data(
        await call('PATCH', `/api/teacher/exhibitions/${a.id}`, {
          token: a.token,
          body: { settings: { reactions: { memoVisibility: 'SELECTED' } } },
          ifMatch: String(rev),
        }),
        ExhibitionTeacherSchema,
      );
      const v1Version = version();
      await data(
        await call('PATCH', `/api/teacher/reactions/${second.id}`, {
          token: a.token,
          body: { publicSelected: true },
        }),
        TeacherReactionSchema,
      );
      expect(version()).toBe((v1Version ?? 0) + 1);
      expect(
        await codeOf(
          await call('PATCH', `/api/teacher/reactions/${second.id}`, { token: a.token, body: {} }),
        ),
      ).toBe('E_VALIDATION');

      const res = await call('GET', `/api/teacher/exhibitions/${a.id}/reactions.csv`, { token: a.token });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const disposition = res.headers.get('content-disposition') ?? '';
      const star = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? '';
      expect(decodeURIComponent(star)).toBe('반응_하늘_바다 전시_20261111.csv');
      expect(disposition).toContain('filename="reactions_20261111.csv"');
      const bytes = Buffer.from(await res.arrayBuffer());
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const text = bytes.subarray(3).toString('utf8');
      expect(text.endsWith('\r\n')).toBe(true);
      expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
      expect(text.split('\r\n')).toEqual([
        '"작품","전시실","스티커","메모","사실 정확성","전달력","별명","시각","숨김"',
        `"바람의 편지","1 전시실","감동했어요","'=1+2","","","하늘고래","2026-11-11 10:00","예"`,
        `"바람의 편지","1 전시실","멋져요","정말 ""멋져요""","","","바람","2026-11-11 10:01","아니오"`,
        '',
      ]);

      // 이름 방식이 '익명'이면 교사에게도 별명을 보이지 않는다(CSV는 '익명')
      const rev2 = (await view(a)).exhibition.rev;
      await data(
        await call('PATCH', `/api/teacher/exhibitions/${a.id}`, {
          token: a.token,
          body: { settings: { reactions: { naming: 'ANONYMOUS' } } },
          ifMatch: String(rev2),
        }),
        ExhibitionTeacherSchema,
      );
      const anon = await data(
        await call('GET', `/api/teacher/exhibitions/${a.id}/reactions`, { token: a.token }),
        z.array(TeacherReactionSchema),
      );
      expect(anon.map(r => r.nickname)).toEqual([null, null]);
      const anonCsv = Buffer.from(
        await (
          await call('GET', `/api/teacher/exhibitions/${a.id}/reactions.csv`, { token: a.token })
        ).arrayBuffer(),
      ).toString('utf8');
      expect(anonCsv).toContain('"익명"');
      expect(anonCsv).not.toContain('하늘고래');

      // 지운 작품의 반응은 목록·고치기에서 빠진다
      const current = (await view(a)).artworks.find(x => x.id === art.id);
      expect(
        (
          await call('DELETE', `/api/teacher/artworks/${art.id}`, {
            token: a.token,
            ifMatch: String(current?.rev),
          })
        ).status,
      ).toBe(204);
      expect(
        await data(
          await call('GET', `/api/teacher/exhibitions/${a.id}/reactions`, { token: a.token }),
          z.array(TeacherReactionSchema),
        ),
      ).toEqual([]);
      expect(
        await codeOf(
          await call('PATCH', `/api/teacher/reactions/${first.id}`, {
            token: a.token,
            body: { hidden: false },
          }),
        ),
      ).toBe('E_NOT_FOUND');
    });
  });

  describe('지금 삭제(§9.7)', () => {
    const reaction = { sticker: 'GREAT', memo: null, scoreFact: null, scoreDelivery: null } as const;

    /** 전시실·글 작품·열기·방문자·반응·PIN 세션·미디어 폴더까지 채운 전시 */
    const filled = async (title = '하늘고래 전시') => {
      const a = await newExhibition(title);
      const room = await newRoom(a);
      const art = await newText(a, room.id);
      await data(
        await call('POST', `/api/teacher/exhibitions/${a.id}/open`, { token: a.token }),
        ExhibitionTeacherSchema,
      );
      const visitor = randomToken();
      registerVisitor(deps, a.entryCode, {
        tokenHash: tokenHash(visitor),
        nickname: '하늘고래',
        consentVersion: config().CONSENT_VERSION,
      });
      putReaction(deps, a.entryCode, tokenHash(visitor), art.id, { ...reaction, memo: '배운 게 많아요' });
      const pinToken = randomToken();
      await data(await pinLogin(a.pin, pinToken), PinLoginResultSchema);
      s.media.folders.add(a.id);
      return { ...a, roomId: room.id, artId: art.id, visitor, pinToken };
    };
    type Filled = Awaited<ReturnType<typeof filled>>;

    const TABLES = [
      'exhibitions',
      'rooms',
      'artworks',
      'layouts',
      'sessions',
      'visitors',
      'reactions',
    ] as const;
    const rowsOf = (exhibitionId: string) => TABLES.map(table => s.count(table, exhibitionId));
    const revOf = async (a: Filled) => String((await view(a)).exhibition.rev);

    /** 그 전시에 닿는 교사·학생 요청 — 지우는 중이면 모두 E_NOT_FOUND여야 한다 */
    const probes = (a: Filled, rev: string): readonly [string, string, Req][] => {
      const ex = `/api/teacher/exhibitions/${a.id}`;
      const pub = `/api/e/${a.entryCode}`;
      return [
        ['GET', '/api/teacher/me', { token: a.token }],
        ['GET', '/api/teacher/me', { token: a.pinToken }],
        ['GET', ex, { token: a.token }],
        ['PATCH', ex, { token: a.token, body: { title: '바꿈' }, ifMatch: rev }],
        ['DELETE', ex, { token: a.token, ifMatch: rev }],
        ['POST', `${ex}/close`, { token: a.token }],
        ['POST', `${ex}/rooms`, { token: a.token, body: { id: randomUUID(), order: 1, title: '끼어든 방' } }],
        ['POST', `${ex}/artworks`, { token: a.token, body: textBody(a.roomId, 1) }],
        ['GET', `${ex}/reactions`, { token: a.pinToken }],
        [
          'PATCH',
          `/api/teacher/artworks/${a.artId}`,
          { token: a.token, body: { title: '바꿈' }, ifMatch: '1' },
        ],
        ['GET', pub, {}],
        ['GET', `${pub}/v`, {}],
        [
          'POST',
          `${pub}/visitor`,
          { body: { tokenHash: tokenHash(randomToken()), consentVersion: config().CONSENT_VERSION } },
        ],
        ['PATCH', `${pub}/visitor`, { token: a.visitor, body: { nickname: '바다거북' } }],
        ['GET', `${pub}/me`, { token: a.visitor }],
        ['PUT', `${pub}/reactions/${a.artId}`, { token: a.visitor, body: reaction }],
      ];
    };
    const probe = async (a: Filled, rev: string) => {
      const out: { method: string; path: string; status: number; code: string }[] = [];
      for (const [method, path, o] of probes(a, rev)) {
        const { status, code } = await failure(await call(method, path, o));
        out.push({ method, path, status, code });
      }
      return out;
    };
    const allNotFound = (a: Filled, rev: string) =>
      probes(a, rev).map(([method, path]) => ({ method, path, status: 404, code: 'E_NOT_FOUND' }));

    it('If-Match가 맞을 때만 지우고 봉투로 답한다 — 행·폴더·세션이 사라지고 함께 관람도 끊는다', async () => {
      const a = await filled();
      const b = await filled('나 전시');
      const path = `/api/teacher/exhibitions/${a.id}`;
      const rev = await revOf(a);
      expect(rowsOf(a.id).every(n => n > 0)).toBe(true);
      const bRows = rowsOf(b.id);
      for (const ifMatch of [undefined, String(Number(rev) + 1), 'abc'])
        expect(
          await failure(await call('DELETE', path, { token: a.token, ...(ifMatch ? { ifMatch } : {}) })),
        ).toMatchObject({ status: 409, code: 'E_CONFLICT' });
      expect(s.store.exhibitions.get(a.id)?.deleting).toBe(false);
      expect(s.media.folders.has(a.id)).toBe(true);
      expect(closed).toEqual([]);

      const res = await call('DELETE', path, { token: a.token, ifMatch: rev });
      expect(await data(res, z.object({ exhibitionId: z.string() }))).toEqual({ exhibitionId: a.id });
      expect(rowsOf(a.id)).toEqual(TABLES.map(() => 0));
      expect(s.media.folders.has(a.id)).toBe(false);
      expect(closed).toEqual([[a.id, 'E_NOT_FOUND']]);
      expect(s.trail.at(-1)).toBe('checkpoint');
      // 지운 뒤: 링크·PIN 세션은 모르는 토큰, PIN은 틀림, 학생은 없는 전시
      expect(await codeOf(await call('GET', '/api/teacher/me', { token: a.token }))).toBe('E_AUTH');
      expect(await codeOf(await call('GET', '/api/teacher/me', { token: a.pinToken }))).toBe('E_AUTH');
      expect(await codeOf(await pinLogin(a.pin))).toBe('E_PIN_INVALID');
      expect(await codeOf(await app.request(`/api/e/${a.entryCode}`))).toBe('E_NOT_FOUND');
      // 다른 전시는 그대로
      expect(rowsOf(b.id)).toEqual(bRows);
      expect(s.media.folders.has(b.id)).toBe(true);
      expect((await view(b)).exhibition.status).toBe('OPEN');
    });

    it('지우는 중(업로드를 기다리는 동안)·폴더 실패 뒤에는 교사·학생 요청이 모두 E_NOT_FOUND, 보관 정리가 이어서 지운다', async () => {
      const a = await filled();
      const rev = await revOf(a);
      let during: Awaited<ReturnType<typeof probe>> = [];
      s.uploads.during = async () => {
        during = await probe(a, rev);
      };
      s.media.failNext();

      expect(
        await failure(
          await call('DELETE', `/api/teacher/exhibitions/${a.id}`, { token: a.token, ifMatch: rev }),
        ),
      ).toMatchObject({ status: 500, code: 'E_SERVER', retryable: true });
      expect(during).toEqual(allNotFound(a, rev));
      s.uploads.during = undefined;
      expect(await probe(a, rev)).toEqual(allNotFound(a, rev));
      // PIN이 맞아도 틀림과 같다(있는지 알려 주지 않음)
      expect(await codeOf(await pinLogin(a.pin))).toBe('E_PIN_INVALID');
      // 행은 지우는 중으로 남아 있다(다시 할 근거), 함께 관람은 이미 끊었다
      expect(s.store.exhibitions.get(a.id)?.deleting).toBe(true);
      expect(rowsOf(a.id).every(n => n > 0)).toBe(true);
      expect(s.media.folders.has(a.id)).toBe(true);
      expect(closed).toEqual([[a.id, 'E_NOT_FOUND']]);

      // 보관 정리(같은 함수)가 다시 하면 끝까지
      await deleteExhibition(deps, a.id);
      expect(rowsOf(a.id)).toEqual(TABLES.map(() => 0));
      expect(s.media.folders.has(a.id)).toBe(false);
    });

    it('다른 전시의 토큰으로는 지울 수 없다', async () => {
      const a = await filled('가 전시');
      const b = await filled('나 전시');
      const aRev = await revOf(a);
      const before = rowsOf(a.id);
      for (const token of [b.token, b.pinToken])
        expect(
          await failure(await call('DELETE', `/api/teacher/exhibitions/${a.id}`, { token, ifMatch: aRev })),
        ).toMatchObject({ status: 404, code: 'E_NOT_FOUND' });
      expect(s.store.exhibitions.get(a.id)?.deleting).toBe(false);
      expect(rowsOf(a.id)).toEqual(before);
      expect(s.media.folders.has(a.id)).toBe(true);
      expect(s.trail).toEqual([]);
      // 자기 전시는 지울 수 있다
      const bRev = await revOf(b);
      expect(
        (await call('DELETE', `/api/teacher/exhibitions/${b.id}`, { token: b.pinToken, ifMatch: bRev }))
          .status,
      ).toBe(200);
      expect(s.store.exhibitions.get(b.id)).toBeNull();
      expect(s.store.exhibitions.get(a.id)?.deleting).toBe(false);
      expect(closed).toEqual([[b.id, 'E_NOT_FOUND']]);
    });

    it('지우는 중인 전시의 ID로 다시 온 만들기는 처음 결과(입장 코드)를 돌려주지 않는다', async () => {
      const token = randomToken();
      const body = createBody({ linkTokenHash: tokenHash(token) });
      await data(await call('POST', '/api/teacher/exhibitions', { body }), CreateExhibitionResultSchema);
      s.media.folders.add(body.exhibitionId);
      s.media.failNext();
      const rev = String(s.store.exhibitions.get(body.exhibitionId)?.rev);
      expect(
        await codeOf(
          await call('DELETE', `/api/teacher/exhibitions/${body.exhibitionId}`, { token, ifMatch: rev }),
        ),
      ).toBe('E_SERVER');
      expect(await failure(await call('POST', '/api/teacher/exhibitions', { body }))).toMatchObject({
        status: 404,
        code: 'E_NOT_FOUND',
      });
      expect(s.store.exhibitions.get(body.exhibitionId)?.deleting).toBe(true);
    });
  });
});
