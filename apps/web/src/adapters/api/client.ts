import { AppError } from '@gallery/core/errors';
import {
  ArtworkTeacherSchema,
  CreateExhibitionResultSchema,
  ExhibitionTeacherSchema,
  ExhibitionViewSchema,
  normalizeLine,
  PinLoginResultSchema,
  ReactionViewSchema,
  RoomTeacherSchema,
  TeacherExhibitionViewSchema,
  TeacherMeSchema,
  TeacherReactionSchema,
  VersionInfoSchema,
} from '@gallery/core/types';
import { z } from 'zod';
import type {
  ApiClient,
  DeviceStore,
  StudentApi,
  TeacherApi,
  TeacherMe,
  TeacherSession,
  TokenTools,
  UploadCallOptions,
  UploadFile,
  UploadProgress,
  VisitTarget,
  VisitorIdentity,
} from '../../ports/index.ts';
import type { Http, UploadRequest } from './http.ts';

/**
 * `ApiClient` 구현(PLAN §9.2): 경로·메서드·응답 스키마의 짝과 토큰 다루기(ADR-025).
 *
 * - 교사 토큰·방문자 토큰은 `DeviceStore`에서 원문을 꺼내 `Authorization: Bearer`로 보낸다. 서버는 해시만 저장한다.
 * - 해시를 보내는 본문(전시 만들기 `linkTokenHash`·PIN 로그인 `sessionTokenHash`·방문자 등록 `tokenHash`·링크 새로 만들기)은
 *   토큰을 **보내기 전에** 기기에 저장하고 `TokenTools.sha256Hex`로 만든 해시만 보낸다 — 답이 사라져도 기기는 토큰을 안다.
 * - 응답 스키마가 core에 따로 없는 경로는 core의 행 스키마로 짝지었다(서버 라우트가 같은 모양을 돌려줘야 한다):
 *   반응 PUT → `ReactionView` · `GET /e/{code}/me` → `ReactionView[]` · 전시 PATCH·열기/닫기/다시 열기 → `ExhibitionTeacher`
 *   · 전시실 POST·PATCH → `RoomTeacher` · 작품 POST(JSON)·PATCH·complete·restore → `ArtworkTeacher`
 *   · 교사 반응 목록 → `TeacherReaction[]` · 반응 PATCH → `TeacherReaction`.
 *   돌려받을 값이 없는 경로(방문자 등록·별명·지우기·순서·여러 개·링크 새로 만들기·포스터/배경음악 빼기)는 204나
 *   `data`가 무엇이든 성공 봉투면 받는다.
 */

export interface ApiClientDeps {
  readonly http: Http;
  readonly device: DeviceStore;
  readonly tokens: TokenTools;
}

const MyReactionsSchema = z.array(ReactionViewSchema);
const TeacherReactionsSchema = z.array(TeacherReactionSchema);

const seg = encodeURIComponent;
const studentPath = (code: string, rest = '') => `/e/${seg(code)}${rest}`;
const exhibitionPath = (id: string, rest = '') => `/teacher/exhibitions/${seg(id)}${rest}`;
const roomPath = (id: string, rest = '') => `/teacher/rooms/${seg(id)}${rest}`;
const artworkPath = (id: string, rest = '') => `/teacher/artworks/${seg(id)}${rest}`;

/** 답을 받지 못해 서버에서 됐는지 모르는 실패(연결 끊김·시간 초과·앞단 오류·부른 쪽이 멈춤) */
const outcomeUnknown = (err: unknown): boolean =>
  !(err instanceof AppError) || err.code === 'E_OFFLINE' || err.code === 'E_SERVER';

/** multipart 본문: `meta`(있으면, JSON) 먼저, 그다음 `file`(서버 한도: 파일 1·필드 1) */
const formOf = (file: UploadFile, meta?: unknown): FormData => {
  const form = new FormData();
  if (meta !== undefined) form.append('meta', JSON.stringify(meta));
  form.append('file', file.blob, file.name);
  return form;
};

const uploadOpts = (opts: UploadCallOptions | undefined): Pick<UploadRequest, 'signal' | 'onProgress'> => ({
  signal: opts?.signal,
  onProgress: opts?.onProgress,
});

const nicknameOf = (nickname: string | undefined): string | null => {
  if (nickname === undefined) return null;
  const n = normalizeLine(nickname);
  return n === '' ? null : n;
};

export const createApiClient = ({ http, device, tokens }: ApiClientDeps): ApiClient => {
  const teacherToken = (exhibitionId: string): TeacherSession => {
    const session = device.teacherSession(exhibitionId);
    if (!session) throw new AppError('E_AUTH');
    return session;
  };
  const visitorOf = (target: VisitTarget): VisitorIdentity => {
    const visitor = device.visitor(target.exhibitionId);
    if (!visitor) throw new AppError('E_AUTH');
    return visitor;
  };

  /** 그 토큰으로 `GET /teacher/me`가 그 전시를 돌려주는가(E_AUTH면 아님, 그 밖의 실패는 던짐) */
  const linkWorks = async (exhibitionId: string, token: string): Promise<boolean> => {
    try {
      const me = await http.json({ method: 'GET', path: '/teacher/me', token }, TeacherMeSchema);
      return me.exhibitionId === exhibitionId;
    } catch (err) {
      if (err instanceof AppError && err.code === 'E_AUTH') return false;
      throw err;
    }
  };

  const student: StudentApi = {
    exhibition: (code, opts) =>
      http.json({ method: 'GET', path: studentPath(code), signal: opts?.signal }, ExhibitionViewSchema),

    versions: (code, opts) =>
      http.json({ method: 'GET', path: studentPath(code, '/v'), signal: opts?.signal }, VersionInfoSchema),

    diag: (code, body) =>
      http.send({ method: 'POST', path: studentPath(code, '/diag'), body, keepalive: true }),

    async registerVisitor(target, input) {
      const saved = device.visitor(target.exhibitionId);
      const token = saved?.token ?? tokens.newToken();
      if (!saved) device.setVisitor(target.exhibitionId, { token, consentVersion: null, nickname: null });
      await http.send({
        method: 'POST',
        path: studentPath(target.code, '/visitor'),
        body: { ...input, tokenHash: await tokens.sha256Hex(token) },
      });
      device.setVisitor(target.exhibitionId, {
        token,
        consentVersion: input.consentVersion,
        nickname: nicknameOf(input.nickname),
      });
    },

    async changeNickname(target, nickname) {
      const visitor = visitorOf(target);
      await http.send({
        method: 'PATCH',
        path: studentPath(target.code, '/visitor'),
        body: { nickname },
        token: visitor.token,
      });
      device.setVisitor(target.exhibitionId, { ...visitor, nickname: nicknameOf(nickname) });
    },

    myReactions: async (target, opts) =>
      http.json(
        {
          method: 'GET',
          path: studentPath(target.code, '/me'),
          token: visitorOf(target).token,
          signal: opts?.signal,
        },
        MyReactionsSchema,
      ),

    putReaction: async (target, artworkId, body) =>
      http.json(
        {
          method: 'PUT',
          path: studentPath(target.code, `/reactions/${seg(artworkId)}`),
          body,
          token: visitorOf(target).token,
        },
        ReactionViewSchema,
      ),
  };

  /** 교사 경로 하나: 저장된 토큰으로. 없으면 요청 없이 E_AUTH */
  const asTeacher = (exhibitionId: string) => teacherToken(exhibitionId).token;

  const teacher: TeacherApi = {
    async createExhibition(input) {
      const saved = device.teacherSession(input.exhibitionId);
      const linkToken = saved?.linkToken ?? tokens.newToken();
      if (saved?.linkToken !== linkToken)
        device.setTeacherSession(input.exhibitionId, {
          kind: 'LINK',
          token: linkToken,
          linkToken,
          pendingLinkToken: null,
        });
      const result = await http.json(
        {
          method: 'POST',
          path: '/teacher/exhibitions',
          body: { ...input, linkTokenHash: await tokens.sha256Hex(linkToken) },
        },
        CreateExhibitionResultSchema,
      );
      // 만들기에 성공한 기기는 시작 코드를 맞혔거나 이미 등록된 기기다(ADR-048)
      device.setStartCodePassed(true);
      return result;
    },

    async openLink(linkToken) {
      if (!tokens.isToken(linkToken)) throw new AppError('E_AUTH');
      const me: TeacherMe = await http.json(
        { method: 'GET', path: '/teacher/me', token: linkToken },
        TeacherMeSchema,
      );
      device.setTeacherSession(me.exhibitionId, {
        kind: me.sessionKind,
        token: linkToken,
        linkToken: me.sessionKind === 'LINK' ? linkToken : null,
        pendingLinkToken: null,
      });
      return me;
    },

    me: async (exhibitionId, opts) =>
      http.json(
        { method: 'GET', path: '/teacher/me', token: asTeacher(exhibitionId), signal: opts?.signal },
        TeacherMeSchema,
      ),

    async pinLogin(pin) {
      const token = tokens.newToken();
      const result = await http.json(
        {
          method: 'POST',
          path: '/teacher/pin',
          body: { pin, sessionTokenHash: await tokens.sha256Hex(token) },
        },
        PinLoginResultSchema,
      );
      device.setTeacherSession(result.exhibitionId, {
        kind: 'PIN',
        token,
        linkToken: null,
        pendingLinkToken: null,
      });
      return result;
    },

    exhibition: async (exhibitionId, opts) =>
      http.json(
        {
          method: 'GET',
          path: exhibitionPath(exhibitionId),
          token: asTeacher(exhibitionId),
          signal: opts?.signal,
        },
        TeacherExhibitionViewSchema,
      ),

    patchExhibition: async (exhibitionId, rev, patch) =>
      http.json(
        {
          method: 'PATCH',
          path: exhibitionPath(exhibitionId),
          body: patch,
          ifMatch: rev,
          token: asTeacher(exhibitionId),
        },
        ExhibitionTeacherSchema,
      ),

    changeStatus: async (exhibitionId, action) =>
      http.json(
        { method: 'POST', path: exhibitionPath(exhibitionId, `/${action}`), token: asTeacher(exhibitionId) },
        ExhibitionTeacherSchema,
      ),

    deleteExhibition: async (exhibitionId, rev) => {
      try {
        await http.send({
          method: 'DELETE',
          path: exhibitionPath(exhibitionId),
          ifMatch: rev,
          token: asTeacher(exhibitionId),
        });
      } catch (err) {
        // 앞선 삭제가 폴더 단계에서 E_SERVER로 멈췄다가 정리 작업이 마저 지웠거나, 응답을 못 받고 다시 보낸 경우
        // 서버는 이미 없는 전시라 E_NOT_FOUND — 바라던 끝이므로 성공으로(PLAN §9.2)
        if (err instanceof AppError && err.code === 'E_NOT_FOUND') return;
        throw err;
      }
    },

    removePoster: async exhibitionId =>
      http.send({
        method: 'DELETE',
        path: exhibitionPath(exhibitionId, '/poster'),
        token: asTeacher(exhibitionId),
      }),

    async rotateLink(exhibitionId) {
      const session = teacherToken(exhibitionId);
      const save = (fresh: TeacherSession, linkToken: string) =>
        device.setTeacherSession(exhibitionId, {
          kind: fresh.kind,
          // 링크로 들어온 기기는 옛 링크 세션이 지워졌으니 새 링크로, PIN 세션은 그대로 통한다
          token: fresh.kind === 'LINK' ? linkToken : fresh.token,
          linkToken,
          pendingLinkToken: null,
        });

      const pending = session.pendingLinkToken;
      if (pending !== null && (await linkWorks(exhibitionId, pending))) {
        save(session, pending);
        return;
      }
      const next = pending ?? tokens.newToken();
      if (pending === null) device.setTeacherSession(exhibitionId, { ...session, pendingLinkToken: next });
      try {
        await http.send({
          method: 'POST',
          path: exhibitionPath(exhibitionId, '/link/rotate'),
          body: { linkTokenHash: await tokens.sha256Hex(next) },
          token: session.token,
        });
      } catch (err) {
        if (!outcomeUnknown(err))
          device.setTeacherSession(exhibitionId, { ...session, pendingLinkToken: null });
        throw err;
      }
      save(session, next);
    },

    createRoom: async (exhibitionId, body) =>
      http.json(
        {
          method: 'POST',
          path: exhibitionPath(exhibitionId, '/rooms'),
          body,
          token: asTeacher(exhibitionId),
        },
        RoomTeacherSchema,
      ),

    patchRoom: async (exhibitionId, roomId, rev, patch) =>
      http.json(
        {
          method: 'PATCH',
          path: roomPath(roomId),
          body: patch,
          ifMatch: rev,
          token: asTeacher(exhibitionId),
        },
        RoomTeacherSchema,
      ),

    deleteRoom: async (exhibitionId, roomId, rev) =>
      http.send({ method: 'DELETE', path: roomPath(roomId), ifMatch: rev, token: asTeacher(exhibitionId) }),

    reorderRooms: async (exhibitionId, ids) =>
      http.send({
        method: 'PUT',
        path: exhibitionPath(exhibitionId, '/rooms/order'),
        body: { ids },
        token: asTeacher(exhibitionId),
      }),

    removeBgm: async (exhibitionId, roomId) =>
      http.send({ method: 'DELETE', path: roomPath(roomId, '/bgm'), token: asTeacher(exhibitionId) }),

    createArtwork: async (exhibitionId, body) =>
      http.json(
        {
          method: 'POST',
          path: exhibitionPath(exhibitionId, '/artworks'),
          body,
          token: asTeacher(exhibitionId),
        },
        ArtworkTeacherSchema,
      ),

    completePdf: async (exhibitionId, artworkId) =>
      http.json(
        { method: 'POST', path: artworkPath(artworkId, '/complete'), token: asTeacher(exhibitionId) },
        ArtworkTeacherSchema,
      ),

    patchArtwork: async (exhibitionId, artworkId, rev, patch) =>
      http.json(
        {
          method: 'PATCH',
          path: artworkPath(artworkId),
          body: patch,
          ifMatch: rev,
          token: asTeacher(exhibitionId),
        },
        ArtworkTeacherSchema,
      ),

    reorderArtworks: async (exhibitionId, roomId, ids) =>
      http.send({
        method: 'PUT',
        path: roomPath(roomId, '/artwork-order'),
        body: { ids },
        token: asTeacher(exhibitionId),
      }),

    batchArtworks: async (exhibitionId, batch) =>
      http.send({
        method: 'POST',
        path: '/teacher/artworks/batch',
        body: batch,
        token: asTeacher(exhibitionId),
      }),

    deleteArtwork: async (exhibitionId, artworkId, rev) =>
      http.send({
        method: 'DELETE',
        path: artworkPath(artworkId),
        ifMatch: rev,
        token: asTeacher(exhibitionId),
      }),

    restoreArtwork: async (exhibitionId, artworkId) =>
      http.json(
        { method: 'POST', path: artworkPath(artworkId, '/restore'), token: asTeacher(exhibitionId) },
        ArtworkTeacherSchema,
      ),

    reactions: async (exhibitionId, opts) =>
      http.json(
        {
          method: 'GET',
          path: exhibitionPath(exhibitionId, '/reactions'),
          token: asTeacher(exhibitionId),
          signal: opts?.signal,
        },
        TeacherReactionsSchema,
      ),

    patchReaction: async (exhibitionId, reactionId, patch) =>
      http.json(
        {
          method: 'PATCH',
          path: `/teacher/reactions/${seg(reactionId)}`,
          body: patch,
          token: asTeacher(exhibitionId),
        },
        TeacherReactionSchema,
      ),

    reactionsCsv: async (exhibitionId, opts) =>
      http.file({
        method: 'GET',
        path: exhibitionPath(exhibitionId, '/reactions.csv'),
        token: asTeacher(exhibitionId),
        signal: opts?.signal,
      }),

    uploadArtwork: async (exhibitionId, meta, file, opts) =>
      http.upload(
        {
          method: 'POST',
          path: exhibitionPath(exhibitionId, '/artworks'),
          form: formOf(file, meta),
          token: asTeacher(exhibitionId),
          ...uploadOpts(opts),
        },
        ArtworkTeacherSchema,
      ),

    uploadPoster: async (exhibitionId, file, opts) =>
      http.upload(
        {
          method: 'PUT',
          path: exhibitionPath(exhibitionId, '/poster'),
          form: formOf(file),
          token: asTeacher(exhibitionId),
          ...uploadOpts(opts),
        },
        ExhibitionTeacherSchema,
      ),

    uploadBgm: async (exhibitionId, roomId, file, opts) =>
      http.upload(
        {
          method: 'PUT',
          path: roomPath(roomId, '/bgm'),
          form: formOf(file),
          token: asTeacher(exhibitionId),
          ...uploadOpts(opts),
        },
        RoomTeacherSchema,
      ),

    uploadPdfPage: async (exhibitionId, artworkId, idx, file, opts) =>
      http.uploadSend({
        method: 'PUT',
        path: artworkPath(artworkId, `/pages/${seg(String(idx))}`),
        form: formOf(file),
        token: asTeacher(exhibitionId),
        ...uploadOpts(opts),
      }),

    async uploadPdf(exhibitionId, input, pages, opts) {
      const token = asTeacher(exhibitionId);
      if (pages.length === 0) throw new AppError('E_VALIDATION', { fields: { pageCount: 'required' } });
      await http.json(
        {
          method: 'POST',
          path: exhibitionPath(exhibitionId, '/artworks'),
          body: { ...input, kind: 'PDF', pageCount: pages.length },
          token,
          signal: opts?.signal,
        },
        ArtworkTeacherSchema,
      );
      const total = pages.reduce((sum, p) => sum + p.blob.size, 0);
      let done = 0;
      for (const [i, page] of pages.entries()) {
        await http.uploadSend({
          method: 'PUT',
          path: artworkPath(input.id, `/pages/${i + 1}`),
          form: formOf(page),
          token,
          signal: opts?.signal,
          onProgress: (p: UploadProgress) =>
            opts?.onProgress?.({ loaded: done + Math.min(p.loaded, page.blob.size), total }),
        });
        done += page.blob.size;
        opts?.onProgress?.({ loaded: done, total });
      }
      return http.json(
        { method: 'POST', path: artworkPath(input.id, '/complete'), token, signal: opts?.signal },
        ArtworkTeacherSchema,
      );
    },
  };

  return { student, teacher };
};
