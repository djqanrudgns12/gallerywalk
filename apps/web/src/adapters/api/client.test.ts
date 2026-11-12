import { AppError } from '@gallery/core/errors';
import { computeLayout } from '@gallery/core/layout';
import { ExhibitionSettingsSchema, ReactionSettingsSchema } from '@gallery/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient, DeviceStore, TeacherSession, TokenTools } from '../../ports/index.ts';
import { createDeviceStore, type KeyValueStorage } from '../deviceStore.ts';
import { createTokenTools } from '../tokens.ts';
import { errorEnvelopeOf, fakeXhrFactory, okEnvelopeOf } from '../../dev/fakeXhr.ts';
import { createApiClient } from './client.ts';
import { createHttp } from './http.ts';

// ── 가짜 값(합성) ─────────────────────────────────────────────

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EX = id(1);
const ROOM = id(2);
const ART = id(3);
const REACTION = id(4);
const CODE = '123456';
const DEVICE = id(99);

const exhibitionTeacher = {
  id: EX,
  entryCode: CODE,
  title: '우리 반 역사관',
  subtitle: null,
  templateId: 'modern-history',
  poster: null,
  schoolName: null,
  className: null,
  showSchool: false,
  settings: ExhibitionSettingsSchema.parse({}),
  status: 'DRAFT',
  rev: 2,
  createdAt: 1,
  expiresAt: 2,
  openedAt: null,
  closedAt: null,
};
const roomTeacher = { id: ROOM, order: 0, title: '1 전시실', intro: null, bgm: null, rev: 1 };
const artworkTeacher = {
  id: ART,
  roomId: ROOM,
  order: 0,
  title: '가상의 글',
  author: null,
  caption: null,
  description: null,
  kind: 'TEXT',
  form: 'TEXTCARD',
  textHeavy: false,
  featured: false,
  pageMode: 'AUTO',
  image: null,
  pages: null,
  audio: null,
  textBody: '가상의 본문',
  status: 'PUBLISHED',
  formAuto: 'TEXTCARD',
  formOverride: null,
  textHeavyAuto: false,
  textHeavyOverride: null,
  warnings: [],
  failCode: null,
  rev: 1,
  deletedAt: null,
  createdAt: 1,
  updatedAt: 1,
};
const teacherReaction = {
  id: REACTION,
  artworkId: ART,
  sticker: 'MOVED',
  memo: null,
  scoreFact: null,
  scoreDelivery: null,
  nickname: null,
  hidden: false,
  publicSelected: false,
  createdAt: 1,
  updatedAt: 1,
};
const reactionView = {
  artworkId: ART,
  sticker: 'GREAT',
  memo: '새로 알았어요',
  scoreFact: null,
  scoreDelivery: null,
  updatedAt: 1,
};
const versions = { layoutVersion: 1, contentVersion: 1, settingsVersion: 1 };
const exhibitionView = {
  exhibition: {
    id: EX,
    title: '우리 반 역사관',
    subtitle: null,
    templateId: 'modern-history',
    poster: null,
    school: null,
    expiresAt: 2,
    reactions: ReactionSettingsSchema.parse({}),
  },
  rooms: [{ id: ROOM, order: 0, title: '1 전시실', intro: null, bgm: null }],
  artworks: [],
  layout: computeLayout({
    exhibitionId: EX,
    templateId: 'modern-history',
    algoVersion: 1,
    rooms: [{ id: ROOM, order: 0, hasBgm: false }],
    artworks: [
      {
        id: ART,
        roomId: ROOM,
        order: 0,
        kind: 'IMAGE',
        form: 'PORTRAIT',
        featured: false,
        textHeavy: false,
        pixel: { w: 2000, h: 3000 },
        pageCount: null,
      },
    ],
  }),
  versions,
  reactions: [],
};
const teacherView = {
  exhibition: exhibitionTeacher,
  rooms: [roomTeacher],
  artworks: [artworkTeacher],
  layout: null,
  versions,
};

// ── 가짜 서버 ─────────────────────────────────────────────────

interface Call {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
}

type Reply = Response | (() => Response | Promise<Response>);

const okJson = (data: unknown) =>
  new Response(JSON.stringify({ data, requestId: 'req' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const errJson = (status: number, code: string, fields?: Record<string, string>) =>
  new Response(
    JSON.stringify({
      error: { code, message: 'x', retryable: false, ...(fields ? { fields } : {}) },
      requestId: 'req',
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
const noContent = () => new Response(null, { status: 204 });
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

/** "METHOD /api/경로" → 차례로 쓸 답들. 답이 없으면 404 오류 봉투 */
const server = () => {
  const routes = new Map<string, Reply[]>();
  const calls: Call[] = [];
  const onRequest: ((call: Call) => void)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        url: String(input),
        headers: new Headers(init?.headers),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      };
      calls.push(call);
      for (const f of onRequest) f(call);
      const reply = routes.get(`${call.method} ${call.url}`)?.shift();
      if (reply === undefined) return errJson(404, 'E_NOT_FOUND');
      return typeof reply === 'function' ? reply() : reply;
    }),
  );
  return {
    calls,
    on(route: string, ...replies: Reply[]) {
      routes.set(route, [...(routes.get(route) ?? []), ...replies]);
    },
    /** 요청을 받는 순간 기기 저장을 들여다보기(보내기 전에 저장했는지) */
    peek(f: (call: Call) => void) {
      onRequest.push(f);
    },
  };
};

const memoryStorage = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return {
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: k => void data.delete(k),
  };
};

let device: DeviceStore;
let tokens: TokenTools;
let api: ApiClient;
let srv: ReturnType<typeof server>;
let xhrs: ReturnType<typeof fakeXhrFactory>;

beforeEach(() => {
  const storage = memoryStorage();
  device = createDeviceStore({ storage: () => storage, newDeviceId: () => DEVICE });
  tokens = createTokenTools();
  xhrs = fakeXhrFactory();
  api = createApiClient({
    http: createHttp({ timeoutMs: 5000, deviceId: () => device.deviceId(), xhr: xhrs.create }),
    device,
    tokens,
  });
  srv = server();
});

afterEach(() => vi.unstubAllGlobals());

const rejection = async (p: Promise<unknown>): Promise<AppError> => {
  const err: unknown = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
};

const linkSession = (): TeacherSession => {
  const token = tokens.newToken();
  return { kind: 'LINK', token, linkToken: token, pendingLinkToken: null };
};

// ── 학생 ──────────────────────────────────────────────────────

describe('학생 경로', () => {
  const target = { code: CODE, exhibitionId: EX };

  it('전시 보기·버전: 토큰 없이 X-Device-Id만, 응답을 스키마로 검사', async () => {
    srv.on(`GET /api/e/${CODE}`, okJson(exhibitionView));
    srv.on(`GET /api/e/${CODE}/v`, okJson({ ...versions, status: 'OPEN' }));
    const view = await api.student.exhibition(CODE);
    expect(view.exhibition.id).toBe(EX);
    expect(view.layout.stops.length).toBeGreaterThanOrEqual(2);
    await expect(api.student.versions(CODE)).resolves.toEqual({ ...versions, status: 'OPEN' });
    for (const c of srv.calls) {
      expect(c.headers.get('X-Device-Id')).toBe(DEVICE);
      expect(c.headers.get('Authorization')).toBeNull();
    }
  });

  it('전시 보기 모양이 틀리면 E_SERVER, 준비 중·막 내림은 그 코드', async () => {
    srv.on(`GET /api/e/${CODE}`, okJson({ ...exhibitionView, layout: null }));
    expect((await rejection(api.student.exhibition(CODE))).code).toBe('E_SERVER');
    srv.on(`GET /api/e/${CODE}`, errJson(409, 'E_EXHIBITION_DRAFT'), errJson(409, 'E_EXHIBITION_CLOSED'));
    expect((await rejection(api.student.exhibition(CODE))).code).toBe('E_EXHIBITION_DRAFT');
    expect((await rejection(api.student.exhibition(CODE))).code).toBe('E_EXHIBITION_CLOSED');
  });

  it('경로 조각은 인코딩한다', async () => {
    srv.on('GET /api/e/12%2F34/v', okJson({ ...versions, status: 'OPEN' }));
    await api.student.versions('12/34');
    expect(srv.calls[0]?.url).toBe('/api/e/12%2F34/v');
  });

  it('방문자 등록: 토큰을 보내기 전에 저장하고 해시만 보낸다, 다시 보내도 같은 해시', async () => {
    const seen: (string | null)[] = [];
    srv.peek(() => seen.push(device.visitor(EX)?.token ?? null));
    srv.on(`POST /api/e/${CODE}/visitor`, offline, noContent);

    const input = { nickname: '  별빛   고양이 ', consentVersion: '2026-11' };
    expect((await rejection(api.student.registerVisitor(target, input))).code).toBe('E_OFFLINE');
    const token = device.visitor(EX)?.token;
    expect(token).toBeDefined();
    expect(device.visitor(EX)?.consentVersion).toBeNull();
    await api.student.registerVisitor(target, input);

    expect(seen).toEqual([token, token]);
    const [first, second] = srv.calls;
    const hash = await tokens.sha256Hex(token!);
    expect(first?.body).toEqual({ ...input, tokenHash: hash });
    expect(second?.body).toEqual(first?.body);
    expect(JSON.stringify(srv.calls.map(c => c.body))).not.toContain(token);
    expect(first?.headers.get('Authorization')).toBeNull();
    expect(device.visitor(EX)).toEqual({ token, consentVersion: '2026-11', nickname: '별빛 고양이' });
  });

  it('익명 방식(별명 없음)도 등록, 별명은 null', async () => {
    srv.on(`POST /api/e/${CODE}/visitor`, okJson(null));
    await api.student.registerVisitor(target, { consentVersion: '2026-11' });
    expect(srv.calls[0]?.body).not.toHaveProperty('nickname');
    expect(device.visitor(EX)?.nickname).toBeNull();
  });

  it('방문자 토큰이 필요한 경로: 없으면 요청 없이 E_AUTH', async () => {
    const body = { sticker: 'MOVED' as const, memo: null, scoreFact: null, scoreDelivery: null };
    expect((await rejection(api.student.putReaction(target, ART, body))).code).toBe('E_AUTH');
    expect((await rejection(api.student.myReactions(target))).code).toBe('E_AUTH');
    expect((await rejection(api.student.changeNickname(target, '별빛'))).code).toBe('E_AUTH');
    expect(srv.calls).toHaveLength(0);
  });

  it('반응 남기기·내 반응·별명 바꾸기: Bearer 방문자 토큰 원문', async () => {
    const token = tokens.newToken();
    device.setVisitor(EX, { token, consentVersion: '2026-11', nickname: '별빛' });
    srv.on(`PUT /api/e/${CODE}/reactions/${ART}`, okJson(reactionView));
    srv.on(`GET /api/e/${CODE}/me`, okJson([reactionView]));
    srv.on(`PATCH /api/e/${CODE}/visitor`, noContent());

    const body = { sticker: 'GREAT' as const, memo: '새로 알았어요', scoreFact: null, scoreDelivery: null };
    await expect(api.student.putReaction(target, ART, body)).resolves.toEqual(reactionView);
    await expect(api.student.myReactions(target)).resolves.toEqual([reactionView]);
    await api.student.changeNickname(target, ' 달빛 ');

    expect(srv.calls.map(c => [c.method, c.url, c.headers.get('Authorization')])).toEqual([
      ['PUT', `/api/e/${CODE}/reactions/${ART}`, `Bearer ${token}`],
      ['GET', `/api/e/${CODE}/me`, `Bearer ${token}`],
      ['PATCH', `/api/e/${CODE}/visitor`, `Bearer ${token}`],
    ]);
    expect(srv.calls[0]?.body).toEqual(body);
    expect(srv.calls[2]?.body).toEqual({ nickname: ' 달빛 ' });
    expect(device.visitor(EX)?.nickname).toBe('달빛');
  });

  it('반응 오류 코드는 그대로(메모 걸러짐·반응 꺼짐)', async () => {
    device.setVisitor(EX, { token: tokens.newToken(), consentVersion: '2026-11', nickname: null });
    srv.on(
      `PUT /api/e/${CODE}/reactions/${ART}`,
      errJson(422, 'E_MEMO_BLOCKED'),
      errJson(409, 'E_REACTIONS_OFF'),
    );
    const body = { sticker: null, memo: '가상의 메모', scoreFact: null, scoreDelivery: null };
    expect((await rejection(api.student.putReaction(target, ART, body))).code).toBe('E_MEMO_BLOCKED');
    expect((await rejection(api.student.putReaction(target, ART, body))).code).toBe('E_REACTIONS_OFF');
  });
});

// ── 교사: 토큰 ────────────────────────────────────────────────

describe('교사 토큰', () => {
  const create = {
    exhibitionId: EX,
    title: '우리 반 역사관',
    templateId: 'modern-history' as const,
    pin: '583920',
  };
  const created = { exhibitionId: EX, entryCode: CODE, expiresAt: 2 };

  it('전시 만들기: 링크 토큰을 보내기 전에 저장, 해시만 보냄, 다시 보내도 같은 해시, 성공하면 시작 코드 기억', async () => {
    const seen: (TeacherSession | null)[] = [];
    srv.peek(() => seen.push(device.teacherSession(EX)));
    srv.on('POST /api/teacher/exhibitions', offline, okJson(created));

    expect((await rejection(api.teacher.createExhibition({ ...create, startCode: '0000' }))).code).toBe(
      'E_OFFLINE',
    );
    expect(device.startCodePassed()).toBe(false);
    await expect(api.teacher.createExhibition({ ...create, startCode: '0000' })).resolves.toEqual(created);

    const session = device.teacherSession(EX);
    expect(session).toMatchObject({ kind: 'LINK', pendingLinkToken: null });
    expect(session?.token).toBe(session?.linkToken);
    expect(seen).toEqual([session, session]);
    const hash = await tokens.sha256Hex(session!.token);
    expect(srv.calls.map(c => c.body)).toEqual([
      { ...create, startCode: '0000', linkTokenHash: hash },
      { ...create, startCode: '0000', linkTokenHash: hash },
    ]);
    expect(JSON.stringify(srv.calls.map(c => c.body))).not.toContain(session!.token);
    expect(srv.calls[0]?.headers.get('Authorization')).toBeNull();
    expect(device.startCodePassed()).toBe(true);
  });

  it('전시 만들기 실패 코드는 그대로(PIN 중복·시작 코드)', async () => {
    srv.on('POST /api/teacher/exhibitions', errJson(409, 'E_PIN_TAKEN'), errJson(401, 'E_START_CODE'));
    expect((await rejection(api.teacher.createExhibition(create))).code).toBe('E_PIN_TAKEN');
    expect((await rejection(api.teacher.createExhibition(create))).code).toBe('E_START_CODE');
    expect(device.startCodePassed()).toBe(false);
  });

  it('선생님 링크 열기: 그 토큰으로 /teacher/me → 받은 전시 ID 아래 저장', async () => {
    const token = tokens.newToken();
    srv.on('GET /api/teacher/me', okJson({ exhibitionId: EX, title: 't', sessionKind: 'LINK' }));
    await expect(api.teacher.openLink(token)).resolves.toEqual({
      exhibitionId: EX,
      title: 't',
      sessionKind: 'LINK',
    });
    expect(srv.calls[0]?.headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(device.teacherSession(EX)).toEqual({
      kind: 'LINK',
      token,
      linkToken: token,
      pendingLinkToken: null,
    });
  });

  it('선생님 링크 열기: 토큰 모양이 틀리면 요청 없이 E_AUTH, 서버가 거절하면 저장하지 않음', async () => {
    expect((await rejection(api.teacher.openLink('not-a-token'))).code).toBe('E_AUTH');
    expect(srv.calls).toHaveLength(0);
    srv.on('GET /api/teacher/me', errJson(401, 'E_AUTH'));
    expect((await rejection(api.teacher.openLink(tokens.newToken()))).code).toBe('E_AUTH');
    expect(device.teacherSession(EX)).toBeNull();
  });

  it('PIN 로그인: 세션 토큰 해시를 보내고 받은 전시 ID 아래 PIN 세션으로', async () => {
    srv.on('POST /api/teacher/pin', okJson({ exhibitionId: EX }), errJson(401, 'E_PIN_INVALID'));
    await expect(api.teacher.pinLogin('583920')).resolves.toEqual({ exhibitionId: EX });
    const session = device.teacherSession(EX);
    expect(session).toMatchObject({ kind: 'PIN', linkToken: null, pendingLinkToken: null });
    expect(srv.calls[0]?.body).toEqual({
      pin: '583920',
      sessionTokenHash: await tokens.sha256Hex(session!.token),
    });
    expect((await rejection(api.teacher.pinLogin('111111'))).code).toBe('E_PIN_INVALID');
    expect(device.teacherSession(EX)).toEqual(session);
  });

  it('저장된 토큰이 없으면 교사 경로는 요청 없이 E_AUTH', async () => {
    expect((await rejection(api.teacher.exhibition(EX))).code).toBe('E_AUTH');
    expect((await rejection(api.teacher.patchArtwork(EX, ART, 1, { title: 'x' }))).code).toBe('E_AUTH');
    expect((await rejection(api.teacher.rotateLink(EX))).code).toBe('E_AUTH');
    expect(srv.calls).toHaveLength(0);
  });
});

describe('선생님 링크 새로 만들기', () => {
  const rotate = `POST /api/teacher/exhibitions/${EX}/link/rotate`;

  it('링크로 들어온 기기: 옛 토큰으로 보내고 새 링크로 바꿔 저장', async () => {
    const before = linkSession();
    device.setTeacherSession(EX, before);
    srv.on(rotate, noContent());
    await api.teacher.rotateLink(EX);
    const after = device.teacherSession(EX)!;
    expect(after.kind).toBe('LINK');
    expect(after.token).not.toBe(before.token);
    expect(after.linkToken).toBe(after.token);
    expect(after.pendingLinkToken).toBeNull();
    expect(srv.calls[0]?.headers.get('Authorization')).toBe(`Bearer ${before.token}`);
    expect(srv.calls[0]?.body).toEqual({ linkTokenHash: await tokens.sha256Hex(after.token) });
  });

  it('PIN으로 들어온 기기: PIN 세션은 그대로, 새 링크를 복사할 수 있게 남김', async () => {
    const pin = tokens.newToken();
    device.setTeacherSession(EX, { kind: 'PIN', token: pin, linkToken: null, pendingLinkToken: null });
    srv.on(rotate, okJson(null));
    await api.teacher.rotateLink(EX);
    const after = device.teacherSession(EX)!;
    expect(after).toMatchObject({ kind: 'PIN', token: pin, pendingLinkToken: null });
    expect(tokens.isToken(after.linkToken ?? '')).toBe(true);
    expect(srv.calls[0]?.body).toEqual({ linkTokenHash: await tokens.sha256Hex(after.linkToken!) });
  });

  it('답을 못 받으면 새 토큰을 남겨 두고, 다음에 그 토큰이 이미 통하면 다시 보내지 않는다', async () => {
    const before = linkSession();
    device.setTeacherSession(EX, before);
    srv.on(rotate, offline);
    expect((await rejection(api.teacher.rotateLink(EX))).code).toBe('E_OFFLINE');
    const pending = device.teacherSession(EX)?.pendingLinkToken;
    expect(tokens.isToken(pending ?? '')).toBe(true);
    expect(device.teacherSession(EX)?.token).toBe(before.token);

    srv.on('GET /api/teacher/me', okJson({ exhibitionId: EX, title: 't', sessionKind: 'LINK' }));
    await api.teacher.rotateLink(EX);
    expect(srv.calls.map(c => `${c.method} ${c.url} ${c.headers.get('Authorization')}`)).toEqual([
      `${rotate} Bearer ${before.token}`,
      `GET /api/teacher/me Bearer ${pending}`,
    ]);
    expect(device.teacherSession(EX)).toEqual({
      kind: 'LINK',
      token: pending,
      linkToken: pending,
      pendingLinkToken: null,
    });
  });

  it('남겨 둔 토큰이 통하지 않으면(서버에 안 감) 같은 토큰으로 다시 보낸다', async () => {
    const before = linkSession();
    device.setTeacherSession(EX, before);
    srv.on(rotate, offline, noContent());
    await rejection(api.teacher.rotateLink(EX));
    const pending = device.teacherSession(EX)!.pendingLinkToken!;
    srv.on('GET /api/teacher/me', errJson(401, 'E_AUTH'));
    await api.teacher.rotateLink(EX);
    const hash = await tokens.sha256Hex(pending);
    expect(srv.calls.map(c => [c.method, c.url, c.body])).toEqual([
      ['POST', `/api/teacher/exhibitions/${EX}/link/rotate`, { linkTokenHash: hash }],
      ['GET', '/api/teacher/me', undefined],
      ['POST', `/api/teacher/exhibitions/${EX}/link/rotate`, { linkTokenHash: hash }],
    ]);
    expect(srv.calls[2]?.headers.get('Authorization')).toBe(`Bearer ${before.token}`);
    expect(device.teacherSession(EX)?.token).toBe(pending);
  });

  it('서버가 분명히 거절하면 남겨 둔 토큰을 버린다', async () => {
    const before = linkSession();
    device.setTeacherSession(EX, before);
    srv.on(rotate, errJson(429, 'E_RATE_LIMITED'));
    expect((await rejection(api.teacher.rotateLink(EX))).code).toBe('E_RATE_LIMITED');
    expect(device.teacherSession(EX)).toEqual(before);
  });
});

// ── 교사: 경로 표 ─────────────────────────────────────────────

describe('교사 경로 표(메서드·경로·If-Match·본문·응답 스키마)', () => {
  interface Case {
    readonly name: string;
    readonly run: () => Promise<unknown>;
    readonly route: string;
    readonly reply: Response;
    readonly ifMatch?: string;
    readonly body?: unknown;
    readonly result?: unknown;
  }
  const t = () => api.teacher;
  const patchExhibition = { title: '새 이름', settings: { reactions: { collect: { score: true } } } };
  const patchArtwork = { title: '새 제목', author: null };
  const batch = { action: 'MOVE' as const, ids: [ART], roomId: ROOM };
  const textArtwork = {
    id: ART,
    roomId: ROOM,
    order: 0,
    title: '글',
    kind: 'TEXT' as const,
    textBody: '본문',
  };
  const pdfArtwork = { id: ART, roomId: ROOM, order: 1, title: '보고서', kind: 'PDF' as const, pageCount: 3 };

  const cases: readonly Case[] = [
    {
      name: '전시 교사 보기',
      run: () => t().exhibition(EX),
      route: `GET /api/teacher/exhibitions/${EX}`,
      reply: okJson(teacherView),
      result: teacherView,
    },
    {
      name: '내 토큰 확인',
      run: () => t().me(EX),
      route: 'GET /api/teacher/me',
      reply: okJson({ exhibitionId: EX, title: 't', sessionKind: 'LINK' }),
    },
    {
      name: '전시 고치기',
      run: () => t().patchExhibition(EX, 2, patchExhibition),
      route: `PATCH /api/teacher/exhibitions/${EX}`,
      reply: okJson({ ...exhibitionTeacher, rev: 3 }),
      ifMatch: '2',
      body: patchExhibition,
      result: { ...exhibitionTeacher, rev: 3 },
    },
    {
      name: '열기',
      run: () => t().changeStatus(EX, 'open'),
      route: `POST /api/teacher/exhibitions/${EX}/open`,
      reply: okJson({ ...exhibitionTeacher, status: 'OPEN' }),
    },
    {
      name: '닫기',
      run: () => t().changeStatus(EX, 'close'),
      route: `POST /api/teacher/exhibitions/${EX}/close`,
      reply: okJson({ ...exhibitionTeacher, status: 'CLOSED' }),
    },
    {
      name: '다시 열기',
      run: () => t().changeStatus(EX, 'reopen'),
      route: `POST /api/teacher/exhibitions/${EX}/reopen`,
      reply: okJson({ ...exhibitionTeacher, status: 'OPEN' }),
    },
    {
      name: '지금 삭제',
      run: () => t().deleteExhibition(EX, 2),
      route: `DELETE /api/teacher/exhibitions/${EX}`,
      reply: noContent(),
      ifMatch: '2',
    },
    {
      name: '포스터 빼기',
      run: () => t().removePoster(EX),
      route: `DELETE /api/teacher/exhibitions/${EX}/poster`,
      reply: noContent(),
    },
    {
      name: '전시실 만들기',
      run: () => t().createRoom(EX, { id: ROOM, order: 0, title: '1 전시실' }),
      route: `POST /api/teacher/exhibitions/${EX}/rooms`,
      reply: okJson(roomTeacher),
      body: { id: ROOM, order: 0, title: '1 전시실' },
      result: roomTeacher,
    },
    {
      name: '전시실 고치기',
      run: () => t().patchRoom(EX, ROOM, 1, { intro: null }),
      route: `PATCH /api/teacher/rooms/${ROOM}`,
      reply: okJson({ ...roomTeacher, rev: 2 }),
      ifMatch: '1',
      body: { intro: null },
    },
    {
      name: '전시실 지우기',
      run: () => t().deleteRoom(EX, ROOM, 4),
      route: `DELETE /api/teacher/rooms/${ROOM}`,
      reply: noContent(),
      ifMatch: '4',
    },
    {
      name: '전시실 순서',
      run: () => t().reorderRooms(EX, [ROOM]),
      route: `PUT /api/teacher/exhibitions/${EX}/rooms/order`,
      reply: noContent(),
      body: { ids: [ROOM] },
    },
    {
      name: '배경음악 빼기',
      run: () => t().removeBgm(EX, ROOM),
      route: `DELETE /api/teacher/rooms/${ROOM}/bgm`,
      reply: noContent(),
    },
    {
      name: '글 작품 만들기',
      run: () => t().createArtwork(EX, textArtwork),
      route: `POST /api/teacher/exhibitions/${EX}/artworks`,
      reply: okJson(artworkTeacher),
      body: textArtwork,
      result: artworkTeacher,
    },
    {
      name: 'PDF 1단계',
      run: () => t().createArtwork(EX, pdfArtwork),
      route: `POST /api/teacher/exhibitions/${EX}/artworks`,
      reply: okJson({ ...artworkTeacher, kind: 'PDF', status: 'PROCESSING' }),
      body: pdfArtwork,
    },
    {
      name: 'PDF 3단계',
      run: () => t().completePdf(EX, ART),
      route: `POST /api/teacher/artworks/${ART}/complete`,
      reply: okJson(artworkTeacher),
    },
    {
      name: '작품 고치기',
      run: () => t().patchArtwork(EX, ART, 5, patchArtwork),
      route: `PATCH /api/teacher/artworks/${ART}`,
      reply: okJson({ ...artworkTeacher, rev: 6 }),
      ifMatch: '5',
      body: patchArtwork,
    },
    {
      name: '작품 순서',
      run: () => t().reorderArtworks(EX, ROOM, [ART]),
      route: `PUT /api/teacher/rooms/${ROOM}/artwork-order`,
      reply: noContent(),
      body: { ids: [ART] },
    },
    {
      name: '여러 개 바꾸기',
      run: () => t().batchArtworks(EX, batch),
      route: 'POST /api/teacher/artworks/batch',
      reply: okJson({ changed: 1 }),
      body: batch,
    },
    {
      name: '작품 지우기',
      run: () => t().deleteArtwork(EX, ART, 6),
      route: `DELETE /api/teacher/artworks/${ART}`,
      reply: noContent(),
      ifMatch: '6',
    },
    {
      name: '작품 되살리기',
      run: () => t().restoreArtwork(EX, ART),
      route: `POST /api/teacher/artworks/${ART}/restore`,
      reply: okJson(artworkTeacher),
    },
    {
      name: '반응 모아 보기',
      run: () => t().reactions(EX),
      route: `GET /api/teacher/exhibitions/${EX}/reactions`,
      reply: okJson([teacherReaction]),
      result: [teacherReaction],
    },
    {
      name: '반응 숨기기',
      run: () => t().patchReaction(EX, REACTION, { hidden: true }),
      route: `PATCH /api/teacher/reactions/${REACTION}`,
      reply: okJson({ ...teacherReaction, hidden: true }),
      body: { hidden: true },
    },
  ];

  it.each(cases)('$name', async c => {
    const session = linkSession();
    device.setTeacherSession(EX, session);
    srv.on(c.route, c.reply);
    const result = await c.run();
    expect(srv.calls).toHaveLength(1);
    const call = srv.calls[0]!;
    expect(`${call.method} ${call.url}`).toBe(c.route);
    expect(call.headers.get('Authorization')).toBe(`Bearer ${session.token}`);
    expect(call.headers.get('X-Device-Id')).toBe(DEVICE);
    expect(call.headers.get('If-Match')).toBe(c.ifMatch ?? null);
    expect(call.body).toEqual(c.body);
    if (c.result !== undefined) expect(result).toEqual(c.result);
  });

  it('응답 모양이 짝지은 스키마와 다르면 E_SERVER(예: 작품 고치기에 전시 모양)', async () => {
    device.setTeacherSession(EX, linkSession());
    srv.on(`PATCH /api/teacher/artworks/${ART}`, okJson(exhibitionTeacher));
    expect((await rejection(api.teacher.patchArtwork(EX, ART, 1, { title: 'x' }))).code).toBe('E_SERVER');
  });

  it('충돌·검사 실패는 코드와 fields 그대로', async () => {
    device.setTeacherSession(EX, linkSession());
    srv.on(
      `PATCH /api/teacher/artworks/${ART}`,
      errJson(409, 'E_CONFLICT'),
      errJson(400, 'E_VALIDATION', { title: 'too_long' }),
    );
    const conflict = await rejection(api.teacher.patchArtwork(EX, ART, 1, { title: 'x' }));
    expect([conflict.code, conflict.retryable]).toEqual(['E_CONFLICT', true]);
    const invalid = await rejection(api.teacher.patchArtwork(EX, ART, 1, { title: 'x' }));
    expect([invalid.code, invalid.fields]).toEqual(['E_VALIDATION', { title: 'too_long' }]);
  });

  it('지금 삭제: 앞선 삭제가 이미 지웠으면(다시 보내 E_NOT_FOUND) 성공으로, 다른 실패는 그대로', async () => {
    device.setTeacherSession(EX, linkSession());
    srv.on(
      `DELETE /api/teacher/exhibitions/${EX}`,
      errJson(500, 'E_SERVER'),
      errJson(404, 'E_NOT_FOUND'),
      errJson(409, 'E_CONFLICT'),
    );
    expect((await rejection(api.teacher.deleteExhibition(EX, 2))).code).toBe('E_SERVER');
    await expect(api.teacher.deleteExhibition(EX, 2)).resolves.toBeUndefined();
    expect((await rejection(api.teacher.deleteExhibition(EX, 2))).code).toBe('E_CONFLICT');
  });

  it('반응 CSV 내려받기: Bearer, 파일 이름', async () => {
    const session = linkSession();
    device.setTeacherSession(EX, session);
    srv.on(
      `GET /api/teacher/exhibitions/${EX}/reactions.csv`,
      new Response('\uFEFF"작품"\r\n', {
        status: 200,
        headers: {
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('반응_가상_20261111.csv')}`,
        },
      }),
    );
    const file = await api.teacher.reactionsCsv(EX);
    expect(file.filename).toBe('반응_가상_20261111.csv');
    // 엑셀 한글용 BOM이 바이트 그대로 남는다(`Blob.text()`는 UTF-8로 풀며 BOM을 떼어 낸다)
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(await file.blob.text()).toBe('"작품"\r\n');
    expect(srv.calls[0]?.headers.get('Authorization')).toBe(`Bearer ${session.token}`);
  });
});

describe('파일 올리기(multipart·진행률)', () => {
  const meta = { id: ART, roomId: ROOM, order: 0, title: '가상의 그림', kind: 'IMAGE' as const };
  const png = () => ({ blob: new Blob([new Uint8Array(64)], { type: 'image/png' }), name: '01_가상.png' });
  const imageArtwork = { ...artworkTeacher, kind: 'IMAGE', form: 'PORTRAIT', textBody: null };
  /** 약속이 한 번 돌 때까지(가짜 XHR이 만들어지도록) */
  const tick = () => new Promise(r => setTimeout(r, 0));

  it('작품: POST multipart(meta JSON + file), Bearer·X-Device-Id, 진행률을 차례로 알린다', async () => {
    const session = linkSession();
    device.setTeacherSession(EX, session);
    const seen: [number, number][] = [];
    const p = api.teacher.uploadArtwork(EX, meta, png(), { onProgress: e => seen.push([e.loaded, e.total]) });
    const x = xhrs.last();
    expect([x.method, x.url]).toEqual(['POST', `/api/teacher/exhibitions/${EX}/artworks`]);
    expect(x.headers.get('authorization')).toBe(`Bearer ${session.token}`);
    expect(x.headers.get('x-device-id')).toBe(DEVICE);
    // Content-Type(경계 포함)은 브라우저가 FormData로 채운다 — 직접 넣으면 경계가 빠진다
    expect(x.headers.has('content-type')).toBe(false);
    expect(x.meta()).toEqual(meta);
    expect(x.file()?.name).toBe('01_가상.png');
    expect(x.file()?.size).toBe(64);
    x.progress(16, 64);
    x.progress(64, 64);
    x.respond(200, okEnvelopeOf(imageArtwork));
    await expect(p).resolves.toEqual(imageArtwork);
    expect(seen).toEqual([
      [16, 64],
      [64, 64],
    ]);
  });

  it('중복·형식 오류는 그 코드, 연결 끊김은 E_OFFLINE, 모양이 틀린 답은 E_SERVER', async () => {
    device.setTeacherSession(EX, linkSession());
    const dup = api.teacher.uploadArtwork(EX, meta, png());
    xhrs.last().respond(409, errorEnvelopeOf('E_DUPLICATE'));
    expect((await rejection(dup)).code).toBe('E_DUPLICATE');
    const cut = api.teacher.uploadArtwork(EX, meta, png());
    xhrs.last().fail();
    expect((await rejection(cut)).code).toBe('E_OFFLINE');
    const odd = api.teacher.uploadArtwork(EX, meta, png());
    xhrs.last().respond(200, okEnvelopeOf({ nope: true }));
    expect((await rejection(odd)).code).toBe('E_SERVER');
  });

  it('부른 쪽이 멈추면 보내던 것을 끊고 AbortError를 그대로', async () => {
    device.setTeacherSession(EX, linkSession());
    const ctl = new AbortController();
    const p = api.teacher.uploadArtwork(EX, meta, png(), { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(xhrs.last().aborted).toBe(true);
  });

  it('멈춤 한도 동안 진척이 없으면 E_OFFLINE(진행 알림이 오면 다시 잰다)', async () => {
    vi.useFakeTimers();
    try {
      device.setTeacherSession(EX, linkSession());
      const slow = createApiClient({
        http: createHttp({ timeoutMs: 5000, deviceId: () => DEVICE, xhr: xhrs.create, uploadIdleMs: 1000 }),
        device,
        tokens,
      });
      const p = slow.teacher.uploadArtwork(EX, meta, png());
      const result = p.then(
        () => null,
        (e: unknown) => e,
      );
      vi.advanceTimersByTime(900);
      xhrs.last().progress(10, 64);
      vi.advanceTimersByTime(900);
      expect(xhrs.last().aborted).toBe(false);
      vi.advanceTimersByTime(200);
      expect(xhrs.last().aborted).toBe(true);
      expect(await result).toMatchObject({ code: 'E_OFFLINE' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('토큰이 없으면 보내지 않고 E_AUTH', async () => {
    expect((await rejection(api.teacher.uploadArtwork(EX, meta, png()))).code).toBe('E_AUTH');
    expect(xhrs.made).toHaveLength(0);
  });

  it('포스터 PUT(meta 없음) → 전시 행, 배경음악 PUT → 전시실 행', async () => {
    device.setTeacherSession(EX, linkSession());
    const poster = api.teacher.uploadPoster(EX, png());
    const px = xhrs.last();
    expect([px.method, px.url, px.meta()]).toEqual([
      'PUT',
      `/api/teacher/exhibitions/${EX}/poster`,
      undefined,
    ]);
    px.respond(200, okEnvelopeOf(exhibitionTeacher));
    await expect(poster).resolves.toEqual(exhibitionTeacher);
    const mp3 = { blob: new Blob([new Uint8Array(8)], { type: 'audio/mpeg' }), name: 'bgm.mp3' };
    const bgm = api.teacher.uploadBgm(EX, ROOM, mp3);
    const bx = xhrs.last();
    expect([bx.method, bx.url]).toEqual(['PUT', `/api/teacher/rooms/${ROOM}/bgm`]);
    bx.respond(200, okEnvelopeOf(roomTeacher));
    await expect(bgm).resolves.toEqual(roomTeacher);
  });

  it('PDF 3단계: 만들기(JSON, 쪽 수) → 쪽 PUT 1..n 차례로(합친 진행률) → complete', async () => {
    device.setTeacherSession(EX, linkSession());
    const processing = {
      ...artworkTeacher,
      kind: 'PDF',
      form: 'MULTIPAGE',
      status: 'PROCESSING',
      textBody: null,
    };
    srv.on(`POST /api/teacher/exhibitions/${EX}/artworks`, okJson(processing));
    srv.on(`POST /api/teacher/artworks/${ART}/complete`, okJson({ ...processing, status: 'PUBLISHED' }));
    const page = (n: number) => ({
      blob: new Blob([new Uint8Array(n)], { type: 'image/jpeg' }),
      name: `p${n}.jpg`,
    });
    const seen: number[] = [];
    const input = { id: ART, roomId: ROOM, order: 2, title: '가상의 보고서' };
    const p = api.teacher.uploadPdf(EX, input, [page(10), page(30)], {
      onProgress: e => seen.push(e.loaded),
    });
    await tick();
    expect(srv.calls[0]?.body).toEqual({ ...input, kind: 'PDF', pageCount: 2 });
    const first = xhrs.last();
    expect([first.method, first.url]).toEqual(['PUT', `/api/teacher/artworks/${ART}/pages/1`]);
    first.progress(5, 10);
    first.respond(204);
    await tick();
    const second = xhrs.last();
    expect(second.url).toBe(`/api/teacher/artworks/${ART}/pages/2`);
    second.progress(30, 30);
    second.respond(204);
    const done = await p;
    expect(done.status).toBe('PUBLISHED');
    expect(seen).toEqual([5, 10, 40, 40]);
    expect(srv.calls.map(c => `${c.method} ${c.url}`)).toEqual([
      `POST /api/teacher/exhibitions/${EX}/artworks`,
      `POST /api/teacher/artworks/${ART}/complete`,
    ]);
  });

  it('PDF 쪽 하나가 실패하면 complete를 부르지 않는다', async () => {
    device.setTeacherSession(EX, linkSession());
    srv.on(
      `POST /api/teacher/exhibitions/${EX}/artworks`,
      okJson({ ...artworkTeacher, status: 'PROCESSING' }),
    );
    const page = { blob: new Blob([new Uint8Array(4)]), name: 'p.jpg' };
    const p = api.teacher.uploadPdf(EX, { id: ART, roomId: ROOM, order: 0, title: 't' }, [page]);
    await tick();
    xhrs.last().respond(413, errorEnvelopeOf('E_FILE_TOO_LARGE'));
    expect((await rejection(p)).code).toBe('E_FILE_TOO_LARGE');
    expect(srv.calls).toHaveLength(1);
  });
});
