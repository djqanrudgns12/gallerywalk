import { config } from '@gallery/core/config';
import { copy, errorCopy } from '@gallery/core/copy';
import { AppError, type ErrorCode } from '@gallery/core/errors';
import { isBlocked, prepareNickname } from '@gallery/core/reactions';
import type { ExhibitionView } from '@gallery/core/types';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DeviceStore, StudentApi, VisitTarget, VisitorRegisterInput } from '../../ports/index.ts';
import type {
  NicknameEditState,
  ReactionSheetStatus,
  ReactionSheetValue,
} from '../../ui/patterns/visitor/ReactionSheet.tsx';
import type { VisitorPrefs } from '../student/visitorPrefs.ts';
import type { ConsentState } from '../student/visitorStore.ts';
import { errorCodeOf, isQueueable, reactionKey, type OutboxItem } from './outbox.ts';
import { bodyOf, EMPTY_VALUE, reactionsEnabled, sheetFields, valueOf } from './reactionModel.ts';
import type { ReactionRuntime } from './reactionRuntime.ts';

/**
 * 반응 시트 한 번 열기의 상태(G-07, PLAN §7.3). `ReactionLayer`가 열 때 만들고 닫으면 버린다.
 *
 * - 열기: 줄에 같은 작품 반응이 있으면 그 값(끊김 문구와 함께), 아니면 기억한 내 반응, 없으면 빈 시트. 등록한 기기면
 *   `myReactions`를 전시마다 한 번 받아 손대기 전이면 채운다.
 * - 별명 방식인데 이 기기가 아직 등록하지 않았으면 먼저 PRD 13.2 동의(공개에 '모두에게'가 있으면 그 판). 익명 방식은 동의 없이
 *   시트 위 안내 한 줄만 두고, 보낼 때 별명 없이 등록한다.
 * - 보내기: 성공하면 닫기. 끊김·`E_SERVER`·`E_RATE_LIMITED`면 줄에 넣고 시트·값을 그대로 둔다(연결되면 자동으로 보냄).
 *   걸러진 메모는 칸 아래, 반응 꺼짐·전시 닫힘은 시트 대신 문구.
 */

export type ReactionStep = 'consent' | 'sheet' | 'notice';

export interface ReactionSheetState {
  readonly step: ReactionStep;
  readonly value: ReactionSheetValue;
  /** 이미 남긴 반응이 있음(`고치기`) */
  readonly editing: boolean;
  /** 학생이 값을 바꿨음(늦게 온 내 반응으로 덮지 않음) */
  readonly dirty: boolean;
  readonly status: ReactionSheetStatus;
  readonly memoError: string | null;
  readonly formError: string | null;
  /** `notice` 단계의 문구 */
  readonly notice: string | null;
  /** 시트 위 "{별명}으로 남겨요"의 별명(등록했거나 등록을 기다림). 없으면 null */
  readonly nickname: string | null;
  readonly nicknameEdit: NicknameEditState | null;
  /** 동의 시트의 별명 칸 */
  readonly consentNickname: string;
  readonly consent: ConsentState;
  /** 동의는 받았는데 끊겨서 아직 등록하지 못함 → 보낼 때 함께 등록 */
  readonly pendingRegister: VisitorRegisterInput | null;
}

export interface ReactionSheetActions {
  /** 줄 소식 듣기·내 반응 받기를 시작. 멈추는 함수를 돌려준다 */
  start(): () => void;
  change(value: ReactionSheetValue): void;
  submit(): Promise<void>;
  setConsentNickname(nickname: string): void;
  setConsentChecked(checked: boolean): void;
  confirmConsent(): Promise<void>;
  startNicknameEdit(): void;
  setNicknameDraft(value: string): void;
  cancelNicknameEdit(): void;
  saveNickname(): Promise<void>;
}

export type ReactionSheetStore = StoreApi<ReactionSheetState & ReactionSheetActions>;

export interface ReactionSheetDeps {
  readonly view: ExhibitionView;
  readonly code: string;
  readonly artworkId: string;
  readonly student: StudentApi;
  readonly device: DeviceStore;
  readonly prefs: VisitorPrefs;
  readonly runtime: ReactionRuntime;
  /** 성공해서 닫을 때 */
  readonly onClose: () => void;
  /** 반응 꺼짐·전시 닫힘·작품 없음을 알았을 때(관람 화면이 단추를 숨기거나 버전 확인을 앞당기게) */
  readonly onUnavailable?: ((code: ErrorCode) => void) | undefined;
  readonly now?: (() => number) | undefined;
  /** 메모 걸러내기(기본: core 목록 — 끊겨 있어도 바로 알려 준다. 서버가 다시 본다) */
  readonly memoBlocked?: ((memo: string) => boolean) | undefined;
}

const CLOSED_CONSENT: ConsentState = { checked: false, busy: false, error: null, canSkip: false };

/** 시트를 닫고 문구만 보일 실패 */
const GONE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'E_REACTIONS_OFF',
  'E_EXHIBITION_CLOSED',
  'E_EXHIBITION_DRAFT',
  'E_NOT_FOUND',
]);

const fieldsOf = (err: unknown): Readonly<Record<string, string>> =>
  err instanceof AppError && err.fields ? err.fields : {};

/** 별명 칸 아래 문구: 걸러진 별명은 서버가 `E_VALIDATION {nickname:'blocked'}`로 답한다(`application/visitors.ts`) */
const nicknameErrorText = (code: ErrorCode, err: unknown): string =>
  code === 'E_MEMO_BLOCKED' || (code === 'E_VALIDATION' && fieldsOf(err)['nickname'] === 'blocked')
    ? errorCopy.E_MEMO_BLOCKED
    : code === 'E_VALIDATION'
      ? errorCopy.E_VALIDATION
      : errorCopy[code];

/** 반응 꺼짐·닫힘은 그 코드 문구, 작품이 없어졌으면(게시 취소 등 — 서버는 `E_NOT_FOUND`) 작품 문구 */
const goneText = (code: ErrorCode): string =>
  code === 'E_NOT_FOUND' ? copy.reaction.artworkGone : errorCopy[code];

export const createReactionSheetStore = (deps: ReactionSheetDeps): ReactionSheetStore =>
  createStore<ReactionSheetState & ReactionSheetActions>()((set, get) => {
    const { view, artworkId, runtime, device, student, prefs } = deps;
    const exhibitionId = view.exhibition.id;
    const settings = view.exhibition.reactions;
    const fields = sheetFields(view);
    const key = reactionKey(exhibitionId, artworkId);
    const target: VisitTarget = { code: deps.code, exhibitionId };
    const now = deps.now ?? Date.now;
    const memoBlocked = deps.memoBlocked ?? ((memo: string) => isBlocked(memo));
    let alive = true;

    const fillMine = (): void => {
      void runtime.loadMine(target).then(() => {
        if (!alive) return;
        const mine = runtime.mine(exhibitionId, artworkId);
        if (!mine) return;
        const s = get();
        if (!s.dirty && runtime.outbox.get(key) === null && s.status === 'idle')
          set({ value: valueOf(mine), editing: true });
        else set({ editing: true });
      });
    };

    const toNotice = (code: ErrorCode): void => {
      set({
        step: 'notice',
        notice: goneText(code),
        status: 'idle',
        nicknameEdit: null,
        consent: CLOSED_CONSENT,
      });
      deps.onUnavailable?.(code);
    };

    /** 보내기·줄 보내기가 실패했을 때 */
    const applyFailure = (code: ErrorCode, err: unknown): void => {
      if (GONE_CODES.has(code)) {
        toNotice(code);
        return;
      }
      const f = fieldsOf(err);
      if (code === 'E_MEMO_BLOCKED' || (code === 'E_VALIDATION' && f['memo'] !== undefined)) {
        set({
          status: 'idle',
          memoError:
            code === 'E_MEMO_BLOCKED' || f['memo'] === 'blocked'
              ? errorCopy.E_MEMO_BLOCKED
              : errorCopy.E_VALIDATION,
        });
        return;
      }
      if (code === 'E_VALIDATION' && f['nickname'] !== undefined && settings.naming === 'NICKNAME') {
        // 끊겨서 미뤄 둔 등록의 별명이 걸러짐 → 동의 시트로 돌아가 고치게
        set({
          step: 'consent',
          status: 'idle',
          pendingRegister: null,
          consentNickname: get().pendingRegister?.nickname ?? get().consentNickname,
          consent: { ...CLOSED_CONSENT, checked: true, error: nicknameErrorText(code, err) },
        });
        return;
      }
      set({ status: 'idle', formError: errorCopy[code] });
    };

    const queued = runtime.outbox.get(key);
    const visitor = device.visitor(exhibitionId);
    const isRegistered = runtime.registered(exhibitionId);
    const mine = runtime.mine(exhibitionId, artworkId);
    const pendingRegister = isRegistered ? null : (queued?.register ?? null);
    const needsConsent = settings.naming === 'NICKNAME' && !isRegistered && pendingRegister === null;

    return {
      step: !reactionsEnabled(view) ? 'notice' : needsConsent ? 'consent' : 'sheet',
      value: queued ? valueOf(queued.body) : mine ? valueOf(mine) : EMPTY_VALUE,
      editing: mine !== null,
      dirty: false,
      status: queued ? 'queued' : 'idle',
      memoError: null,
      formError: null,
      notice: reactionsEnabled(view) ? null : errorCopy.E_REACTIONS_OFF,
      nickname: isRegistered ? (visitor?.nickname ?? null) : (pendingRegister?.nickname ?? null),
      nicknameEdit: null,
      consentNickname: visitor?.nickname ?? prefs.lastNickname() ?? '',
      consent: CLOSED_CONSENT,
      pendingRegister,

      start() {
        alive = true;
        const unsubscribe = runtime.outbox.subscribe(e => {
          if (e.type === 'change' || e.item.key !== key) return;
          if (e.type === 'sent') {
            const s = get();
            set({
              status: s.status === 'queued' ? 'sent' : s.status,
              editing: true,
              pendingRegister: null,
              nickname: device.visitor(exhibitionId)?.nickname ?? s.nickname,
            });
          } else if (get().status === 'queued') applyFailure(e.code, e.error);
        });
        if (get().step === 'sheet') fillMine();
        return () => {
          alive = false;
          unsubscribe();
        };
      },

      change(value) {
        const s = get();
        if (s.step !== 'sheet' || s.status === 'sending') return;
        set({
          value,
          dirty: true,
          memoError: value.memo === s.value.memo ? s.memoError : null,
          formError: null,
          status: s.status === 'sent' ? 'idle' : s.status,
        });
      },

      async submit() {
        const s = get();
        if (s.step !== 'sheet' || s.status === 'sending') return;
        const body = bodyOf(s.value, fields);
        if (!body) return;
        if (body.memo !== null && memoBlocked(body.memo)) {
          set({ memoError: errorCopy.E_MEMO_BLOCKED });
          return;
        }
        const register = runtime.registered(exhibitionId)
          ? null
          : (s.pendingRegister ?? { consentVersion: config().CONSENT_VERSION });
        const item: OutboxItem = {
          key,
          exhibitionId,
          code: deps.code,
          artworkId,
          body,
          register,
          queuedAt: now(),
          expiresAt: view.exhibition.expiresAt,
        };
        set({ status: 'sending', memoError: null, formError: null });
        const result = await runtime.outbox.submit(item);
        if (!alive) return;
        if (result.ok) {
          if (register?.nickname) prefs.setLastNickname(register.nickname);
          set({ status: 'idle', editing: true, pendingRegister: null, dirty: false });
          deps.onClose();
          return;
        }
        if (result.queued) {
          set({ status: 'queued' });
          return;
        }
        applyFailure(result.code, result.error);
      },

      setConsentNickname(nickname) {
        const s = get();
        if (s.step !== 'consent') return;
        set({ consentNickname: nickname, consent: { ...s.consent, error: null } });
      },

      setConsentChecked(checked) {
        const s = get();
        if (s.step === 'consent') set({ consent: { ...s.consent, checked } });
      },

      async confirmConsent() {
        const s = get();
        if (s.step !== 'consent' || !s.consent.checked || s.consent.busy) return;
        const prepared = prepareNickname(s.consentNickname);
        if ('error' in prepared) {
          set({
            consent: {
              ...s.consent,
              error: prepared.error === 'blocked' ? errorCopy.E_MEMO_BLOCKED : errorCopy.E_VALIDATION,
            },
          });
          return;
        }
        const input: VisitorRegisterInput = {
          nickname: prepared.display,
          consentVersion: config().CONSENT_VERSION,
        };
        set({ consent: { ...s.consent, busy: true, error: null } });
        try {
          await student.registerVisitor(target, input);
        } catch (err) {
          if (!alive) return;
          const code = errorCodeOf(err);
          if (GONE_CODES.has(code)) {
            toNotice(code);
            return;
          }
          if (isQueueable(code)) {
            // 끊김: 동의는 받았으니 시트로 가고, 보낼 때 함께 등록한다(줄에 넣으면 연결되면 자동으로)
            prefs.setLastNickname(input.nickname ?? '');
            set({
              step: 'sheet',
              nickname: input.nickname ?? null,
              pendingRegister: input,
              consent: CLOSED_CONSENT,
            });
            return;
          }
          set({ consent: { ...get().consent, busy: false, error: nicknameErrorText(code, err) } });
          return;
        }
        if (!alive) return;
        prefs.setLastNickname(input.nickname ?? '');
        set({
          step: 'sheet',
          nickname: device.visitor(exhibitionId)?.nickname ?? input.nickname ?? null,
          pendingRegister: null,
          consent: CLOSED_CONSENT,
        });
        fillMine();
      },

      startNicknameEdit() {
        const s = get();
        if (s.step !== 'sheet' || settings.naming !== 'NICKNAME' || s.status === 'sending') return;
        set({ nicknameEdit: { value: s.nickname ?? '', busy: false, error: null } });
      },

      setNicknameDraft(value) {
        const e = get().nicknameEdit;
        if (e && !e.busy) set({ nicknameEdit: { ...e, value, error: null } });
      },

      cancelNicknameEdit() {
        const e = get().nicknameEdit;
        if (e && !e.busy) set({ nicknameEdit: null });
      },

      async saveNickname() {
        const e = get().nicknameEdit;
        if (!e || e.busy) return;
        const prepared = prepareNickname(e.value);
        if ('error' in prepared) {
          set({
            nicknameEdit: {
              ...e,
              error: prepared.error === 'blocked' ? errorCopy.E_MEMO_BLOCKED : errorCopy.E_VALIDATION,
            },
          });
          return;
        }
        const nickname = prepared.display;
        if (nickname === get().nickname) {
          set({ nicknameEdit: null });
          return;
        }
        if (!runtime.registered(exhibitionId)) {
          // 아직 등록 전(끊겨서 미뤄 둠): 보낼 때 이 별명으로 등록한다
          set({
            nickname,
            nicknameEdit: null,
            pendingRegister: { nickname, consentVersion: config().CONSENT_VERSION },
          });
          return;
        }
        set({ nicknameEdit: { ...e, busy: true, error: null } });
        try {
          try {
            await student.changeNickname(target, nickname);
          } catch (err) {
            // 기기는 등록했다고 아는데 서버에 기록이 없음 → 이 별명으로 새로 등록
            if (err instanceof AppError && err.code === 'E_AUTH')
              await student.registerVisitor(target, { nickname, consentVersion: config().CONSENT_VERSION });
            else throw err;
          }
        } catch (err) {
          if (!alive) return;
          const code = errorCodeOf(err);
          if (GONE_CODES.has(code)) {
            toNotice(code);
            return;
          }
          set({ nicknameEdit: { value: e.value, busy: false, error: nicknameErrorText(code, err) } });
          return;
        }
        if (!alive) return;
        prefs.setLastNickname(nickname);
        set({ nickname: device.visitor(exhibitionId)?.nickname ?? nickname, nicknameEdit: null });
      },
    };
  });
