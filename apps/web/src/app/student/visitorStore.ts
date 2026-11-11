import { config } from '@gallery/core/config';
import { copy, errorCopy } from '@gallery/core/copy';
import { AppError, type ErrorCode } from '@gallery/core/errors';
import { prepareNickname } from '@gallery/core/reactions';
import { normalizeLine, type ExhibitionView } from '@gallery/core/types';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DeviceStore, StudentApi, TokenTools, VisitTarget } from '../../ports/index.ts';
import type { StudentCharacterId } from '../../ui/patterns/visitor/EntryPoster.tsx';
import type { VisitProgress } from '../visit/contract.ts';
import type { VisitorPrefs } from './visitorPrefs.ts';

/**
 * 학생 전시 흐름의 상태(PLAN §7.2 `visitorStore`). 한 입장 코드마다 하나(`/{코드}` 화면이 만든다).
 *
 * 불러오기 → 포스터(뒤에서 관람 화면이 첫 자리를 준비) → 입장:
 * - 별명이 비면 동의 없이 바로 관람. 함께 관람 토큰이 있어야 하므로 기기에 방문자 토큰이 없으면 만들어 저장만 한다
 *   (서버 등록 없음 — 함께 관람 서버는 기록 없는 토큰도 받는다, ADR-057 R-5).
 * - 별명이 있으면 PRD 13.2 동의 시트 → `알겠어요` → `시작하기` → 등록(이미 등록한 기기면 별명 바꾸기) → 관람.
 *   이미 등록한 같은 별명이면 시트 없이 바로 관람.
 * - 등록 실패: 걸러진 별명·확인 필요는 칸 아래 문구, 끊김(다시 해도 되는 실패)은 문구 + 별명 없이 들어가기,
 *   그 사이 전시가 닫히거나 준비 중으로 돌아가면 그 화면.
 *
 * `phase`는 PLAN §7.2 목록에 불러오기(`loading`)·다시 시도(`failed`)를 더했다.
 *
 * 2D 대체 화면(P4-10, ADR-019, PLAN §6.12): 관람 화면이 `onFallback2d`를 부르면 `mode`가 '2d'가 되고 그 전시 동안 남는다
 * (이 저장소는 입장 코드 화면마다 새로 만들므로 다음 방문에 3D를 다시 시도한다). 이유는 기록하지 않는다.
 * - 관람 중이면 바로 `fallback2d`. 입장 연출 중이면 연출이 끝난 뒤 `fallback2d`.
 * - 포스터에서(WebGL2를 못 만듦) 알면 3D 준비를 기다리지 않고 입장 단추를 연다(2D는 첫 그림을 화면이 받는다).
 *
 * 동작 줄이기(P4-11, PRD 8.4)가 켜져 있으면 포스터가 사라지는 연출(`entering`) 없이 바로 관람 단계로 간다.
 */

export type VisitorPhase =
  'loading' | 'failed' | 'poster' | 'entering' | 'viewing' | 'closed' | 'notReady' | 'fallback2d';

/** 관람 화면에 `entered={true}`를 줄 단계 */
export const isEntered = (phase: VisitorPhase): boolean => phase === 'entering' || phase === 'viewing';

/** 관람 중(3D·2D 모두): 바뀜 확인·화면 꺼짐 막기를 켠다 */
export const isVisiting = (phase: VisitorPhase): boolean => isEntered(phase) || phase === 'fallback2d';

/** 3D 관람 화면 / 2D 대체 화면 */
export type VisitMode = '3d' | '2d';

export interface ConsentState {
  readonly checked: boolean;
  /** 등록을 보내는 중 */
  readonly busy: boolean;
  /** 별명 칸 아래 문구 */
  readonly error: string | null;
  /** 끊겨서 등록하지 못함 → 별명 없이 들어가기를 보인다 */
  readonly canSkip: boolean;
}

export interface VisitorState {
  readonly code: string;
  readonly phase: VisitorPhase;
  readonly view: ExhibitionView | null;
  /** `failed`일 때의 코드(문구는 `errorCopy`) */
  readonly failure: ErrorCode | null;
  readonly nickname: string;
  readonly character: StudentCharacterId;
  /** 뒤에서 준비하는 관람 화면이 알린 진행 */
  readonly progress: VisitProgress;
  /** 덮개 칸 하나(PLAN §7.2 — 동시에 열린 창 하나 이하) */
  readonly overlay: 'consent' | null;
  readonly consent: ConsentState;
  /** 함께 관람 토큰 원문. 입장하는 순간 정해진다 */
  readonly liveToken: string | null;
  /** 3D로 보는가, 2D 대체 화면으로 보는가(한 번 '2d'가 되면 이 전시 동안 그대로) */
  readonly mode: VisitMode;
}

export interface VisitorActions {
  load(signal?: AbortSignal): Promise<void>;
  setNickname(nickname: string): void;
  setCharacter(character: StudentCharacterId): void;
  setProgress(progress: VisitProgress): void;
  /** 포스터의 입장 단추 */
  requestEnter(): void;
  setConsentChecked(checked: boolean): void;
  closeConsent(): void;
  confirmConsent(): Promise<void>;
  /** 끊겨서 등록하지 못했을 때 별명 없이 들어가기 */
  enterWithoutNickname(): void;
  /** 포스터가 다 사라짐(입장 연출 끝) */
  finishEntering(): void;
  /** 바뀜 확인(P4-9)이 받은 새 보기 묶음으로 바꾼다(지금 단계는 그대로) */
  applyView(view: ExhibitionView): void;
  /** 관람 중 전시가 닫히거나 준비 중으로 돌아감(바뀜 확인) */
  endVisit(phase: 'closed' | 'notReady'): void;
  /** 관람 화면의 `onFallback2d`: 2D 대체 화면으로(두 번째부터는 무시) */
  fallBack2d(): void;
}

export type VisitorStore = StoreApi<VisitorState & VisitorActions>;

export interface VisitorDeps {
  readonly code: string;
  readonly student: StudentApi;
  readonly device: DeviceStore;
  readonly tokens: TokenTools;
  readonly prefs: VisitorPrefs;
  /** 기기의 '동작 줄이기'(없으면 꺼짐) — `motion.ts`의 `prefersReducedMotion` */
  readonly reducedMotion?: (() => boolean) | undefined;
}

const DEFAULT_CHARACTER: StudentCharacterId = 'student-m';
const CLOSED_CONSENT: ConsentState = { checked: false, busy: false, error: null, canSkip: false };
/** 2D는 3D 준비(템플릿 핵심·첫 관)를 기다리지 않는다 */
const READY: VisitProgress = { ready: true, progress: 1 };

const codeOf = (err: unknown): ErrorCode => (err instanceof AppError ? err.code : 'E_SERVER');

/** 전시를 볼 수 없게 된 실패 → 그 단계 */
const goneTo = (code: ErrorCode): 'closed' | 'notReady' | null =>
  code === 'E_EXHIBITION_CLOSED' || code === 'E_NOT_FOUND'
    ? 'closed'
    : code === 'E_EXHIBITION_DRAFT'
      ? 'notReady'
      : null;

/** 별명 칸 아래 문구: 걸러진 별명은 서버가 `E_VALIDATION {nickname:'blocked'}`로도 답한다(`application/visitors.ts`) */
const nicknameErrorText = (err: AppError): string =>
  err.code === 'E_VALIDATION' && err.fields?.['nickname'] === 'blocked'
    ? errorCopy.E_MEMO_BLOCKED
    : errorCopy[err.code];

export const createVisitorStore = (deps: VisitorDeps): VisitorStore =>
  createStore<VisitorState & VisitorActions>()((set, get) => {
    const target = (view: ExhibitionView): VisitTarget => ({
      code: deps.code,
      exhibitionId: view.exhibition.id,
    });

    /** 입장 연출이 끝난 뒤의 관람 단계 */
    const landing = (): VisitorPhase => (get().mode === '2d' ? 'fallback2d' : 'viewing');

    const enter = (liveToken: string): void =>
      set({
        phase: deps.reducedMotion?.() ? landing() : 'entering',
        overlay: null,
        consent: CLOSED_CONSENT,
        liveToken,
      });

    /** 이 기기의 방문자 토큰(없으면 만들어 저장만 — 서버 등록 없음) */
    const ensureToken = (exhibitionId: string): string => {
      const saved = deps.device.visitor(exhibitionId);
      if (saved) return saved.token;
      const token = deps.tokens.newToken();
      deps.device.setVisitor(exhibitionId, { token, consentVersion: null, nickname: null });
      return token;
    };

    const setConsent = (patch: Partial<ConsentState>): void =>
      set({ consent: { ...get().consent, ...patch } });

    const failRegistration = (err: unknown): void => {
      const code = codeOf(err);
      const gone = goneTo(code);
      if (gone) {
        set({ phase: gone, overlay: null, consent: CLOSED_CONSENT });
        return;
      }
      if (err instanceof AppError && (code === 'E_MEMO_BLOCKED' || code === 'E_VALIDATION')) {
        setConsent({ busy: false, error: nicknameErrorText(err), canSkip: false });
        return;
      }
      const retryable = err instanceof AppError ? err.retryable : true;
      setConsent({
        busy: false,
        error: code === 'E_OFFLINE' ? copy.consent.offline : errorCopy[code],
        canSkip: retryable,
      });
    };

    return {
      code: deps.code,
      phase: 'loading',
      view: null,
      failure: null,
      nickname: '',
      character: deps.prefs.character() ?? DEFAULT_CHARACTER,
      progress: { ready: false, progress: 0 },
      overlay: null,
      consent: CLOSED_CONSENT,
      liveToken: null,
      mode: '3d',

      async load(signal) {
        set({ phase: 'loading', failure: null });
        try {
          const view = await deps.student.exhibition(deps.code, signal ? { signal } : undefined);
          if (signal?.aborted) return;
          const id = view.exhibition.id;
          // 기기에 기억한 값은 포스터를 여는 때 읽는다(그 전시에 등록한 별명이 먼저)
          const nickname = deps.device.visitor(id)?.nickname ?? deps.prefs.lastNickname() ?? '';
          const character = deps.prefs.character() ?? get().character;
          set({
            phase: 'poster',
            view,
            nickname,
            character,
            overlay: null,
            consent: CLOSED_CONSENT,
            ...(get().mode === '2d' ? { progress: READY } : {}),
          });
          deps.device.rememberExhibition({
            exhibitionId: id,
            title: view.exhibition.title,
            expiresAt: view.exhibition.expiresAt,
          });
        } catch (err) {
          if (signal?.aborted) return;
          const code = codeOf(err);
          const gone = goneTo(code);
          set(gone ? { phase: gone, view: null } : { phase: 'failed', failure: code, view: null });
        }
      },

      setNickname(nickname) {
        set(
          get().consent.error === null
            ? { nickname }
            : { nickname, consent: { ...get().consent, error: null } },
        );
      },

      setCharacter(character) {
        set({ character });
        deps.prefs.setCharacter(character);
      },

      setProgress(progress) {
        if (get().mode === '2d') return;
        const now = get().progress;
        if (now.ready !== progress.ready || now.progress !== progress.progress) set({ progress });
      },

      requestEnter() {
        const s = get();
        if (s.phase !== 'poster' || s.overlay !== null || !s.progress.ready || !s.view) return;
        const id = s.view.exhibition.id;
        const nickname = normalizeLine(s.nickname);
        deps.prefs.setCharacter(s.character);
        deps.prefs.setLastNickname(nickname);
        if (nickname === '') {
          enter(ensureToken(id));
          return;
        }
        const saved = deps.device.visitor(id);
        if (saved && saved.consentVersion !== null && saved.nickname === nickname) {
          enter(saved.token);
          return;
        }
        set({ overlay: 'consent', consent: CLOSED_CONSENT });
      },

      setConsentChecked(checked) {
        if (get().overlay === 'consent') setConsent({ checked });
      },

      closeConsent() {
        if (get().consent.busy) return;
        set({ overlay: null, consent: CLOSED_CONSENT });
      },

      async confirmConsent() {
        const s = get();
        if (s.overlay !== 'consent' || !s.view || !s.consent.checked || s.consent.busy) return;
        const view = s.view;
        const prepared = prepareNickname(s.nickname);
        if ('error' in prepared) {
          setConsent({
            error: prepared.error === 'blocked' ? errorCopy.E_MEMO_BLOCKED : errorCopy.E_VALIDATION,
            canSkip: false,
          });
          return;
        }
        const nickname = prepared.display;
        setConsent({ busy: true, error: null, canSkip: false });
        const register = () =>
          deps.student.registerVisitor(target(view), { nickname, consentVersion: config().CONSENT_VERSION });
        try {
          const saved = deps.device.visitor(view.exhibition.id);
          if (saved && saved.consentVersion !== null) {
            try {
              await deps.student.changeNickname(target(view), nickname);
            } catch (err) {
              // 기기는 등록했다고 알지만 서버에 기록이 없음 → 새로 등록
              if (err instanceof AppError && err.code === 'E_AUTH') await register();
              else throw err;
            }
          } else {
            await register();
          }
        } catch (err) {
          if (get().overlay === 'consent') failRegistration(err);
          return;
        }
        if (get().overlay !== 'consent') return;
        deps.prefs.setLastNickname(nickname);
        enter(ensureToken(view.exhibition.id));
      },

      enterWithoutNickname() {
        const s = get();
        if (s.overlay !== 'consent' || !s.consent.canSkip || s.consent.busy || !s.view) return;
        enter(ensureToken(s.view.exhibition.id));
      },

      finishEntering() {
        if (get().phase === 'entering') set({ phase: landing() });
      },

      applyView(view) {
        if (get().view) set({ view });
      },

      endVisit(phase) {
        set({ phase, overlay: null, consent: CLOSED_CONSENT, view: null });
      },

      fallBack2d() {
        const s = get();
        if (s.mode === '2d') return;
        if (s.phase === 'viewing') set({ mode: '2d', phase: 'fallback2d' });
        else if (s.phase === 'poster' || s.phase === 'loading') set({ mode: '2d', progress: READY });
        else set({ mode: '2d' });
      },
    };
  });
