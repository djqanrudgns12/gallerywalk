import { config } from '@gallery/core/config';
import { AppError } from '@gallery/core/errors';
import { isGone } from '@gallery/core/retention';
import {
  ArtworkBatchSchema,
  ArtworkOrderSchema,
  CreateExhibitionSchema,
  CreateJsonArtworkSchema,
  CreateRoomSchema,
  LinkRotateSchema,
  PatchArtworkSchema,
  PatchExhibitionSchema,
  PatchRoomSchema,
  PinLoginSchema,
  ReactionPatchSchema,
  RoomOrderSchema,
  UuidSchema,
  type ArtworkTeacher,
  type LiveStats,
  type RoomTeacher,
  type TeacherExhibitionView,
} from '@gallery/core/types';
import type { Context } from 'hono';
import { Hono } from 'hono';
import {
  batchArtworks,
  deleteArtwork,
  patchArtwork,
  reorderArtworks,
  restoreArtwork,
} from '../../application/artworks.ts';
import { liveExhibition } from '../../application/common.ts';
import { deleteExhibition } from '../../application/deleteExhibition.ts';
import {
  changeStatus,
  createExhibition,
  patchExhibition,
  rotateLink,
  type CreateOutcome,
} from '../../application/exhibitions.ts';
import { recomputeLayout } from '../../application/layout.ts';
import { pinLogin } from '../../application/pin.ts';
import { createRoom, deleteRoom, patchRoom, reorderRooms } from '../../application/rooms.ts';
import { patchTeacherReaction, reactionsCsv, teacherReactions } from '../../application/teacherReactions.ts';
import { createTextArtwork } from '../../application/textArtworks.ts';
import { teacherView } from '../../application/views.ts';
import type { LiveHub } from '../../live/hub.ts';
import type { Deps, FileUploads, UploadTarget } from '../../ports/index.ts';
import {
  clientRequestOf,
  GLOBAL_SUBJECT,
  type BucketSubject,
  type ClientIdentity,
  type PinGate,
  type ServerSecurity,
} from '../../security/index.ts';
import { teacherAuth, type TeacherEnv } from '../middleware/auth.ts';
import { readJson } from '../validate.ts';
import { checkTarget, completePdfArtwork, createPdfArtwork, removeAttachment } from '../../upload/records.ts';

/**
 * 교사 경로(PLAN §9.2 교사 표). 유스케이스(`application/**`)를 부르는 얇은 층 — 여기서는 검증·인증·속도 칸·응답 모양만.
 *
 * - 인증 없음: `POST /api/teacher/exhibitions`(만들기), `POST /api/teacher/pin`(PIN 로그인). 나머지는 모두
 *   `teacherAuth`(Bearer = 선생님 링크 또는 PIN 세션 토큰) 뒤.
 * - 전시 경계: 경로의 전시 ID가 토큰의 전시가 아니면 `E_NOT_FOUND`. 전시실·작품·반응 ID는 유스케이스가 토큰의 전시로
 *   `assertSameExhibition`(다른 전시의 행이면 `E_NOT_FOUND`). UUID 모양이 아닌 ID도 `E_NOT_FOUND`(있는지 알려 주지 않음).
 * - `If-Match: {rev}`(정수, `"3"`처럼 따옴표도 받음) — 빠졌거나 모양이 틀리면 없는 것으로 → 유스케이스가 `E_CONFLICT`.
 * - 응답 모양은 웹 어댑터(`apps/web/src/adapters/api/client.ts`)가 짝지은 core 스키마: 고친 행은 교사 보기
 *   (`teacherView`)에서 꺼낸다(GET과 같은 모양, 바뀐 요청 뒤 배치 다시 계산 — ADR-055). 돌려줄 값이 없으면 204.
 * - PIN 칸 셋(§11.2): PIN 로그인 실패, 만들기의 "이미 쓰이는 PIN", 만들기의 틀린 시작 코드를 실패로 센다.
 *   잠겼으면 `E_PIN_LOCKED`(+ `Retry-After`, `fields.retryAfterMin`), 전역 실패가 많으면 모든 PIN 응답을 늦춘다.
 * - 만들기 칸(§11.3): 기기·IP·전체 하루 수 — 새로 만든 전시만 센다(같은 요청 다시 보내기는 세지 않음).
 */

export interface TeacherRouteOptions {
  readonly deps: Deps;
  readonly security: ServerSecurity;
  readonly uploads?: FileUploads;
  /** PLAN §9.4에 단계만 있고 core 설정 키가 없어, 통합 담당이 정책을 정한 뒤 연결하는 속도 칸. */
  readonly uploadRateLimits?: { readonly device: number; readonly ip: number; readonly windowSec: number };
  /**
   * 함께 관람 허브: 전시를 닫으면 방문자 연결을 끊는다(ADR-057), 지금 이어진 수를 읽는다(HT-07), 설정을 바꾸면 이어진 기기에
   * 말풍선 설정을 알린다(W-02). 없으면 건너뜀·0. 가벼운 화면으로 들어온 수(HW-02)는 `deps.diag`에서 읽는다.
   */
  readonly live?:
    | (Pick<LiveHub, 'closeExhibition'> & Partial<Pick<LiveHub, 'exhibitionCounts' | 'settingsChanged'>>)
    | undefined;
  /** PIN 응답 지연 기다리기(기본 `setTimeout`). 시험은 가짜로 */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

type TeacherContext = Context<TeacherEnv>;

const SEC_PER_MIN = 60;
const SEC_PER_DAY = 86_400;
const MULTIPART = /^multipart\/form-data(?:;|$)/i;
/** `If-Match`: 정수 하나(따옴표로 감싼 꼴도) */
const IF_MATCH = /^(?:(\d+)|"(\d+)")$/;

/** 만들기 칸 종류 이름(`rate_buckets` 키 앞부분) */
const CREATE_BUCKET = { device: 'create_device', ip: 'create_ip', global: 'create_global' } as const;

const defaultSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();

/** 성공 봉투(`respond.ts`의 `ok`와 같은 모양 — 교사 문맥 타입으로) */
const ok = <T>(c: TeacherContext, data: T) => c.json({ data, requestId: c.get('requestId') }, 200);

const noContent = (c: TeacherContext) => c.body(null, 204);

const ifMatchOf = (c: TeacherContext): number | null => {
  const m = IF_MATCH.exec(c.req.header('if-match')?.trim() ?? '');
  const n = Number(m?.[1] ?? m?.[2] ?? Number.NaN);
  return Number.isSafeInteger(n) ? n : null;
};

const uuidParam = (raw: string): string => {
  const parsed = UuidSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('E_NOT_FOUND');
  return parsed.data;
};

/** 토큰의 전시 ID */
const mine = (c: TeacherContext): string => c.get('teacher').exhibitionId;

/** 경로 `:id`가 토큰의 전시여야 한다 */
const ownExhibition = (c: TeacherContext): string => {
  const id = mine(c);
  if (c.req.param('id') !== id) throw new AppError('E_NOT_FOUND');
  return id;
};

const roomOf = (view: TeacherExhibitionView, roomId: string): RoomTeacher => {
  const room = view.rooms.find(r => r.id === roomId);
  if (!room) throw new AppError('E_NOT_FOUND');
  return room;
};

const artworkOf = (view: TeacherExhibitionView, artworkId: string): ArtworkTeacher => {
  const art = view.artworks.find(a => a.id === artworkId);
  if (!art) throw new AppError('E_NOT_FOUND');
  return art;
};

/** RFC 5987 `attr-char` 밖의 글자는 모두 %로(`encodeURIComponent`가 남기는 `'()*`도) */
const rfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    ch => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );

export const teacherRoutes = ({
  deps,
  security,
  uploads,
  uploadRateLimits,
  live,
  sleep = defaultSleep,
}: TeacherRouteOptions) => {
  const r = new Hono<TeacherEnv>();
  const auth = teacherAuth(deps);

  /** 바뀐 요청 뒤 배치 다시 계산(ADR-055) — 응답에 교사 보기를 쓰지 않는 경로 */
  const settle = (exhibitionId: string): void => void recomputeLayout(deps, exhibitionId);

  const pinSubjects = (client: ClientIdentity) => ({ device: client.device, ip: client.ip });

  /** 잠김 → `E_PIN_LOCKED`(기다릴 분은 `Retry-After`와 `fields.retryAfterMin`) */
  const pinLocked = (c: TeacherContext, gate: PinGate): AppError => {
    c.header('Retry-After', String(gate.retryAfterSec));
    return new AppError('E_PIN_LOCKED', {
      fields: { retryAfterMin: String(Math.max(1, Math.ceil(gate.retryAfterSec / SEC_PER_MIN))) },
    });
  };

  const createRules = (client: ClientIdentity) => {
    const cfg = config();
    const rules: readonly (readonly [kind: string, subject: BucketSubject, limit: number])[] = [
      [CREATE_BUCKET.device, client.device, cfg.CREATE_PER_DEVICE_DAY],
      [CREATE_BUCKET.ip, client.ip, cfg.CREATE_PER_IP_DAY],
      [CREATE_BUCKET.global, GLOBAL_SUBJECT, cfg.CREATE_GLOBAL_DAY],
    ];
    return rules;
  };

  const receiveUpload = async (c: TeacherContext, target: UploadTarget): Promise<string> => {
    const id = mine(c);
    checkTarget(deps, id, target);
    const client = security.identify(clientRequestOf(c));
    if (uploadRateLimits) {
      for (const [kind, subject, limit] of [
        ['upload_device', client.device, uploadRateLimits.device],
        ['upload_ip', client.ip, uploadRateLimits.ip],
      ] as const) {
        const state = security.buckets.hit(kind, subject, limit, uploadRateLimits.windowSec);
        if (!state.allowed) {
          c.header('Retry-After', String(state.retryAfterSec));
          throw new AppError('E_RATE_LIMITED');
        }
      }
    }
    if (!c.env?.incoming) throw new AppError('E_VALIDATION', { fields: { _: 'multipart' } });
    if (!uploads) throw new AppError('E_BUSY');
    return uploads.receive(id, target, c.env.incoming);
  };

  // ── 인증 없음 ────────────────────────────────────────────

  r.post('/api/teacher/exhibitions', async c => {
    const body = await readJson(c, CreateExhibitionSchema);
    const client = security.identify(clientRequestOf(c));
    const subjects = pinSubjects(client);
    const prior = deps.store.exhibitions.get(body.exhibitionId);
    // 지우는 중·만료된 전시의 ID로 다시 온 만들기는 없는 전시(처음 결과 = 입장 코드를 다시 알려 주지 않음, §9.7)
    if (prior && isGone(prior, deps.clock.now())) throw new AppError('E_NOT_FOUND');
    // 같은 ID로 다시 온 요청(멱등)은 PIN을 다시 보지 않으므로 칸도 보지 않는다
    const replay = prior !== null;
    let delayMs = 0;
    if (!replay) {
      const gate = security.pinGuard.check(subjects);
      if (gate.locked) {
        await sleep(gate.delayMs);
        throw pinLocked(c, gate);
      }
      delayMs = gate.delayMs;
      for (const [kind, subject, limit] of createRules(client)) {
        const state = security.buckets.peek(kind, subject, limit, SEC_PER_DAY);
        if (!state.allowed) {
          c.header('Retry-After', String(state.retryAfterSec));
          throw new AppError('E_RATE_LIMITED');
        }
      }
    }
    let outcome: CreateOutcome;
    try {
      outcome = createExhibition(deps, body, { deviceRegistered: security.devices.isRegistered(client) });
    } catch (err) {
      // "이미 쓰이는 PIN"은 PIN이 있는지 캐내는 길, 틀린 시작 코드는 시작 코드를 캐내는 길 — 둘 다 PIN 실패 칸
      if (err instanceof AppError && (err.code === 'E_PIN_TAKEN' || err.code === 'E_START_CODE')) {
        const gate = security.pinGuard.fail(subjects);
        await sleep(gate.delayMs);
        if (gate.locked) throw pinLocked(c, gate);
      }
      throw err;
    }
    if (!replay) {
      for (const [kind, subject, limit] of createRules(client))
        security.buckets.hit(kind, subject, limit, SEC_PER_DAY);
      if (outcome.registerDevice) security.devices.register(client);
    }
    await sleep(delayMs);
    c.set('exhibitionId', outcome.exhibitionId);
    return ok(c, {
      exhibitionId: outcome.exhibitionId,
      entryCode: outcome.entryCode,
      expiresAt: outcome.expiresAt,
    });
  });

  r.post('/api/teacher/pin', async c => {
    const body = await readJson(c, PinLoginSchema);
    const subjects = pinSubjects(security.identify(clientRequestOf(c)));
    const gate = security.pinGuard.check(subjects);
    if (gate.locked) {
      await sleep(gate.delayMs);
      throw pinLocked(c, gate);
    }
    const result = pinLogin(deps, body);
    if (result === null) {
      const after = security.pinGuard.fail(subjects);
      await sleep(after.delayMs);
      throw after.locked ? pinLocked(c, after) : new AppError('E_PIN_INVALID');
    }
    await sleep(gate.delayMs);
    c.set('exhibitionId', result.exhibitionId);
    return ok(c, { exhibitionId: result.exhibitionId });
  });

  // ── 인증 ────────────────────────────────────────────────

  r.get('/api/teacher/me', auth, c => {
    const teacher = c.get('teacher');
    const ex = liveExhibition(deps, teacher.exhibitionId);
    return ok(c, { exhibitionId: ex.id, title: ex.title, sessionKind: teacher.sessionKind });
  });

  r.get('/api/teacher/exhibitions/:id', auth, c => ok(c, teacherView(deps, ownExhibition(c))));

  // 지금 관람 수(HT-07·HW-02): 함께 관람에 이어진 학생·교사 수 + 최근 창 안 가벼운 화면 수. 토큰·별명은 없다
  r.get('/api/teacher/exhibitions/:id/live', auth, c => {
    const id = ownExhibition(c);
    const audience = live?.exhibitionCounts?.(id) ?? { visitors: 0, teachers: 0 };
    const recent = deps.diag?.recent(id) ?? { light: 0, reasons: {} };
    const stats: LiveStats = {
      visitors: audience.visitors,
      teachers: audience.teachers,
      light: recent.light,
      reasons: recent.reasons,
    };
    return ok(c, stats);
  });

  r.patch('/api/teacher/exhibitions/:id', auth, async c => {
    const id = ownExhibition(c);
    const patch = await readJson(c, PatchExhibitionSchema);
    patchExhibition(deps, id, patch, ifMatchOf(c));
    // 수업 중 말풍선 끄기·켜기가 이어진 기기에 바로 먹게(W-02) — 고친 뒤에 알린다(허브는 저장소의 지금 값을 읽는다)
    if (patch.settings !== undefined) live?.settingsChanged?.(id);
    return ok(c, teacherView(deps, id).exhibition);
  });

  for (const action of ['open', 'close', 'reopen'] as const)
    r.post(`/api/teacher/exhibitions/:id/${action}`, auth, c => {
      const id = ownExhibition(c);
      changeStatus(deps, id, action);
      // 닫으면 함께 관람 방문자를 내보낸다(교사는 남음, hub 규칙)
      if (action === 'close') live?.closeExhibition(id, 'E_EXHIBITION_CLOSED');
      return ok(c, teacherView(deps, id).exhibition);
    });

  // 지금 삭제(§9.7 순서는 유스케이스가). `If-Match: {rev}`는 다른 PATCH·DELETE와 같다 — 빠졌거나 어긋나면 `E_CONFLICT`.
  // 지우는 중이 되는 순간 함께 관람(교사 포함)도 끊는다. 폴더를 못 지우면 `E_SERVER`이고 행은 지우는 중으로 남아
  // 보관 정리가 이어서 한다(그 뒤 이 전시의 요청은 모두 `E_NOT_FOUND` — 다시 보낸 지금 삭제도).
  // 성공은 봉투 `{data: {exhibitionId}}`(웹 어댑터 `send`는 204·봉투 둘 다 받는다).
  r.delete('/api/teacher/exhibitions/:id', auth, async c => {
    const id = ownExhibition(c);
    await deleteExhibition(deps, id, {
      ifMatch: ifMatchOf(c),
      onGone: gone => live?.closeExhibition(gone, 'E_NOT_FOUND'),
    });
    return ok(c, { exhibitionId: id });
  });

  r.post('/api/teacher/exhibitions/:id/link/rotate', auth, async c => {
    const id = ownExhibition(c);
    const body = await readJson(c, LinkRotateSchema);
    rotateLink(deps, id, body.linkTokenHash);
    return noContent(c);
  });

  // 전시실
  r.post('/api/teacher/exhibitions/:id/rooms', auth, async c => {
    const id = ownExhibition(c);
    const body = await readJson(c, CreateRoomSchema);
    const room = createRoom(deps, id, body);
    return ok(c, roomOf(teacherView(deps, id), room.id));
  });

  r.put('/api/teacher/exhibitions/:id/rooms/order', auth, async c => {
    const id = ownExhibition(c);
    const body = await readJson(c, RoomOrderSchema);
    reorderRooms(deps, id, body.ids);
    settle(id);
    return noContent(c);
  });

  r.patch('/api/teacher/rooms/:roomId', auth, async c => {
    const roomId = uuidParam(c.req.param('roomId'));
    const patch = await readJson(c, PatchRoomSchema);
    patchRoom(deps, mine(c), roomId, patch, ifMatchOf(c));
    return ok(c, roomOf(teacherView(deps, mine(c)), roomId));
  });

  r.delete('/api/teacher/rooms/:roomId', auth, c => {
    const roomId = uuidParam(c.req.param('roomId'));
    deleteRoom(deps, mine(c), roomId, ifMatchOf(c));
    settle(mine(c));
    return noContent(c);
  });

  r.put('/api/teacher/rooms/:roomId/artwork-order', auth, async c => {
    const roomId = uuidParam(c.req.param('roomId'));
    const body = await readJson(c, ArtworkOrderSchema);
    reorderArtworks(deps, mine(c), roomId, body.ids);
    settle(mine(c));
    return noContent(c);
  });

  // 작품
  r.post('/api/teacher/exhibitions/:id/artworks', auth, async c => {
    const id = ownExhibition(c);
    if (MULTIPART.test(c.req.header('content-type')?.trim() ?? '')) {
      const artworkId = await receiveUpload(c, { kind: 'ARTWORK' });
      return ok(c, artworkOf(teacherView(deps, id), artworkId));
    }
    const body = await readJson(c, CreateJsonArtworkSchema);
    const art = body.kind === 'PDF' ? createPdfArtwork(deps, id, body) : createTextArtwork(deps, id, body);
    return ok(c, artworkOf(teacherView(deps, id), art.id));
  });

  r.put('/api/teacher/exhibitions/:id/poster', auth, async c => {
    const id = ownExhibition(c);
    await receiveUpload(c, { kind: 'POSTER' });
    return ok(c, teacherView(deps, id).exhibition);
  });

  r.delete('/api/teacher/exhibitions/:id/poster', auth, c => {
    removeAttachment(deps, ownExhibition(c), { kind: 'POSTER' });
    return noContent(c);
  });

  r.put('/api/teacher/rooms/:roomId/bgm', auth, async c => {
    const roomId = uuidParam(c.req.param('roomId'));
    await receiveUpload(c, { kind: 'BGM', roomId });
    return ok(c, roomOf(teacherView(deps, mine(c)), roomId));
  });

  r.delete('/api/teacher/rooms/:roomId/bgm', auth, c => {
    removeAttachment(deps, mine(c), { kind: 'BGM', roomId: uuidParam(c.req.param('roomId')) });
    return noContent(c);
  });

  r.put('/api/teacher/artworks/:aid/pages/:idx', auth, async c => {
    const artworkId = uuidParam(c.req.param('aid'));
    const rawIdx = c.req.param('idx');
    const idx = /^\d+$/.test(rawIdx) ? Number(rawIdx) : Number.NaN;
    await receiveUpload(c, { kind: 'PAGE', artworkId, idx });
    return noContent(c);
  });

  r.post('/api/teacher/artworks/:aid/complete', auth, c => {
    const artworkId = uuidParam(c.req.param('aid'));
    completePdfArtwork(deps, mine(c), artworkId);
    return ok(c, artworkOf(teacherView(deps, mine(c)), artworkId));
  });

  r.post('/api/teacher/artworks/batch', auth, async c => {
    const batch = await readJson(c, ArtworkBatchSchema);
    const changed = batchArtworks(deps, mine(c), batch);
    settle(mine(c));
    return ok(c, { changed });
  });

  r.patch('/api/teacher/artworks/:aid', auth, async c => {
    const artworkId = uuidParam(c.req.param('aid'));
    const patch = await readJson(c, PatchArtworkSchema);
    patchArtwork(deps, mine(c), artworkId, patch, ifMatchOf(c));
    return ok(c, artworkOf(teacherView(deps, mine(c)), artworkId));
  });

  r.delete('/api/teacher/artworks/:aid', auth, c => {
    const artworkId = uuidParam(c.req.param('aid'));
    deleteArtwork(deps, mine(c), artworkId, ifMatchOf(c));
    settle(mine(c));
    return noContent(c);
  });

  r.post('/api/teacher/artworks/:aid/restore', auth, c => {
    const artworkId = uuidParam(c.req.param('aid'));
    restoreArtwork(deps, mine(c), artworkId);
    return ok(c, artworkOf(teacherView(deps, mine(c)), artworkId));
  });

  // 반응
  r.get('/api/teacher/exhibitions/:id/reactions', auth, c => ok(c, teacherReactions(deps, ownExhibition(c))));

  r.get('/api/teacher/exhibitions/:id/reactions.csv', auth, c => {
    const csv = reactionsCsv(deps, ownExhibition(c));
    return c.body(csv.text, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csv.asciiFilename}"; filename*=UTF-8''${rfc5987(csv.filename)}`,
    });
  });

  r.patch('/api/teacher/reactions/:rid', auth, async c => {
    const reactionId = uuidParam(c.req.param('rid'));
    const patch = await readJson(c, ReactionPatchSchema);
    return ok(c, patchTeacherReaction(deps, mine(c), reactionId, patch));
  });

  return r;
};
