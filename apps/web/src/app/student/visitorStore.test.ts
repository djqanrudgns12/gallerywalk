import { config } from '@gallery/core/config';
import { copy, errorCopy } from '@gallery/core/copy';
import { AppError, type ErrorCode } from '@gallery/core/errors';
import { describe, expect, it } from 'vitest';
import { createDeviceStore } from '../../adapters/deviceStore.ts';
import { createTokenTools } from '../../adapters/tokens.ts';
import {
  CODE,
  deferred,
  EX_ID,
  fakeStudentApi,
  makeView,
  memoryStorage,
  type FakeStudentOptions,
  VIEW_TITLE,
} from '../../dev/studentFixtures.ts';
import { createVisitorPrefs } from './visitorPrefs.ts';
import { createVisitorStore, isEntered, isVisiting } from './visitorStore.ts';

type Extra = Omit<FakeStudentOptions, 'device' | 'tokens'>;

const setup = (extra: Extra = {}, reducedMotion?: () => boolean) => {
  const storage = memoryStorage();
  const device = createDeviceStore({ storage: () => storage });
  const tokens = createTokenTools();
  const prefs = createVisitorPrefs(() => storage);
  const api = fakeStudentApi({ device, tokens, ...extra });
  const store = createVisitorStore({
    code: CODE,
    student: api.student,
    device,
    tokens,
    prefs,
    ...(reducedMotion ? { reducedMotion } : {}),
  });
  const s = () => store.getState();
  return { store, s, api, device, tokens, prefs, storage };
};

/** 포스터까지 불러오고 관람 화면이 준비 끝을 알린 상태 */
const atPoster = async (extra: Extra = {}) => {
  const t = setup(extra);
  await t.s().load();
  t.s().setProgress({ ready: true, progress: 1 });
  return t;
};

const TARGET = { code: CODE, exhibitionId: EX_ID };

describe('visitorStore 불러오기', () => {
  it('열린 전시 → 포스터, 최근 전시로 기억', async () => {
    const { s, device, api } = setup();
    expect(s().phase).toBe('loading');
    await s().load();
    expect(api.exhibition).toHaveBeenCalledWith(CODE, undefined);
    expect(s().phase).toBe('poster');
    expect(s().view?.exhibition.id).toBe(EX_ID);
    expect(device.recentExhibitions()[0]).toMatchObject({ exhibitionId: EX_ID, title: VIEW_TITLE });
  });

  it.each<[ErrorCode, string]>([
    ['E_EXHIBITION_CLOSED', 'closed'],
    ['E_NOT_FOUND', 'closed'],
    ['E_EXHIBITION_DRAFT', 'notReady'],
    ['E_OFFLINE', 'failed'],
    ['E_SERVER', 'failed'],
  ])('%s → %s', async (code, phase) => {
    const { s, device } = setup({ exhibition: () => Promise.reject(new AppError(code)) });
    await s().load();
    expect(s().phase).toBe(phase);
    expect(s().failure).toBe(phase === 'failed' ? code : null);
    expect(s().view).toBeNull();
    expect(device.recentExhibitions()).toHaveLength(0);
  });

  it('AppError가 아닌 실패는 다시 시도 화면(E_SERVER)', async () => {
    const { s } = setup({ exhibition: () => Promise.reject(new TypeError('boom')) });
    await s().load();
    expect(s().phase).toBe('failed');
    expect(s().failure).toBe('E_SERVER');
  });

  it('멈춘 불러오기는 상태를 바꾸지 않고, 다시 시도하면 포스터', async () => {
    const first = deferred<ReturnType<typeof makeView>>();
    let calls = 0;
    const { s } = setup({
      exhibition: () => {
        calls++;
        return calls === 1 ? first.promise : Promise.resolve(makeView());
      },
    });
    const ac = new AbortController();
    const p = s().load(ac.signal);
    ac.abort();
    first.reject(new DOMException('aborted', 'AbortError'));
    await p;
    expect(s().phase).toBe('loading');
    await s().load();
    expect(s().phase).toBe('poster');
  });

  it('다시 시도: 실패 → 성공이면 포스터로', async () => {
    let calls = 0;
    const { s } = setup({
      exhibition: () =>
        ++calls === 1 ? Promise.reject(new AppError('E_OFFLINE')) : Promise.resolve(makeView()),
    });
    await s().load();
    expect(s().phase).toBe('failed');
    await s().load();
    expect(s().phase).toBe('poster');
    expect(s().failure).toBeNull();
  });

  it('별명·캐릭터는 기기에 기억한 값으로 채운다(그 전시의 등록 별명이 먼저)', async () => {
    const a = setup();
    a.prefs.setLastNickname('별빛');
    a.prefs.setCharacter('student-f-04');
    await a.s().load();
    expect(a.s().nickname).toBe('별빛');
    expect(a.s().character).toBe('student-f-04');

    const b = setup();
    b.prefs.setLastNickname('별빛');
    b.device.setVisitor(EX_ID, {
      token: b.tokens.newToken(),
      consentVersion: config().CONSENT_VERSION,
      nickname: '은하',
    });
    await b.s().load();
    expect(b.s().nickname).toBe('은하');
  });

  it('캐릭터를 바꾸면 바로 기억한다', async () => {
    const { s, prefs } = await atPoster();
    s().setCharacter('student-f-02');
    expect(s().character).toBe('student-f-02');
    expect(prefs.character()).toBe('student-f-02');
  });

  it('기억한 캐릭터가 없으면 1번, 예전에 저장한 옛 ID는 01번으로(M4-9)', async () => {
    const fresh = setup();
    await fresh.s().load();
    expect(fresh.s().character).toBe('student-m-01');

    const old = setup();
    old.storage.setItem('gw:student-character', 'student-f');
    await old.s().load();
    expect(old.s().character).toBe('student-f-01');
  });
});

describe('visitorStore 입장', () => {
  it('관람 화면 준비 전에는 입장하지 않는다', async () => {
    const { s } = setup();
    await s().load();
    s().setProgress({ ready: false, progress: 0.4 });
    s().requestEnter();
    expect(s().phase).toBe('poster');
    expect(s().overlay).toBeNull();
    expect(isEntered(s().phase)).toBe(false);
  });

  it('별명이 비면 동의 없이 바로 관람: 방문자 토큰을 만들어 기기에 저장(서버 등록 없음)', async () => {
    const { s, api, device, tokens } = await atPoster();
    s().setNickname('   ');
    s().requestEnter();
    expect(s().overlay).toBeNull();
    expect(s().phase).toBe('entering');
    expect(isEntered(s().phase)).toBe(true);
    expect(api.registerVisitor).not.toHaveBeenCalled();
    const saved = device.visitor(EX_ID);
    expect(saved).toEqual({ token: s().liveToken, consentVersion: null, nickname: null });
    expect(tokens.isToken(s().liveToken ?? '')).toBe(true);
    s().finishEntering();
    expect(s().phase).toBe('viewing');
  });

  it('별명이 비면 이미 있는 방문자 토큰을 그대로 쓴다', async () => {
    const t = setup();
    const token = t.tokens.newToken();
    t.device.setVisitor(EX_ID, { token, consentVersion: null, nickname: null });
    await t.s().load();
    t.s().setProgress({ ready: true, progress: 1 });
    t.s().setNickname('');
    t.s().requestEnter();
    expect(t.s().liveToken).toBe(token);
  });

  it('별명이 있으면 동의 → 등록 → 관람', async () => {
    const { s, api, device, prefs } = await atPoster();
    s().setNickname('  하늘   고래 ');
    s().requestEnter();
    expect(s().overlay).toBe('consent');
    expect(s().phase).toBe('poster');

    await s().confirmConsent();
    expect(api.registerVisitor).not.toHaveBeenCalled();

    s().setConsentChecked(true);
    await s().confirmConsent();
    expect(api.registerVisitor).toHaveBeenCalledWith(TARGET, {
      nickname: '하늘 고래',
      consentVersion: config().CONSENT_VERSION,
    });
    expect(s().overlay).toBeNull();
    expect(s().phase).toBe('entering');
    const saved = device.visitor(EX_ID);
    expect(saved?.consentVersion).toBe(config().CONSENT_VERSION);
    expect(saved?.nickname).toBe('하늘 고래');
    expect(s().liveToken).toBe(saved?.token);
    expect(prefs.lastNickname()).toBe('하늘 고래');
  });

  it('동의 시트를 닫으면 포스터로 돌아간다(체크는 다시 열 때 풀림)', async () => {
    const { s } = await atPoster();
    s().setNickname('하늘고래');
    s().requestEnter();
    s().setConsentChecked(true);
    s().closeConsent();
    expect(s().overlay).toBeNull();
    expect(s().phase).toBe('poster');
    s().requestEnter();
    expect(s().consent.checked).toBe(false);
  });

  it('이미 등록한 같은 별명이면 동의 없이 바로 관람', async () => {
    const t = setup();
    const token = t.tokens.newToken();
    t.device.setVisitor(EX_ID, { token, consentVersion: config().CONSENT_VERSION, nickname: '하늘고래' });
    await t.s().load();
    t.s().setProgress({ ready: true, progress: 1 });
    t.s().requestEnter();
    expect(t.s().overlay).toBeNull();
    expect(t.s().phase).toBe('entering');
    expect(t.s().liveToken).toBe(token);
    expect(t.api.registerVisitor).not.toHaveBeenCalled();
  });

  it('이미 등록했는데 별명을 바꾸면 동의 뒤 별명 바꾸기(PATCH)', async () => {
    const t = setup();
    const token = t.tokens.newToken();
    t.device.setVisitor(EX_ID, { token, consentVersion: config().CONSENT_VERSION, nickname: '하늘고래' });
    await t.s().load();
    t.s().setProgress({ ready: true, progress: 1 });
    t.s().setNickname('바다고래');
    t.s().requestEnter();
    t.s().setConsentChecked(true);
    await t.s().confirmConsent();
    expect(t.api.changeNickname).toHaveBeenCalledWith(TARGET, '바다고래');
    expect(t.api.registerVisitor).not.toHaveBeenCalled();
    expect(t.s().phase).toBe('entering');
    expect(t.s().liveToken).toBe(token);
  });
});

describe('visitorStore 등록 실패', () => {
  const failingAt = async (fail: AppError | Error) => {
    const t = await atPoster({ register: { fail } });
    t.s().setNickname('하늘고래');
    t.s().requestEnter();
    t.s().setConsentChecked(true);
    await t.s().confirmConsent();
    return t;
  };

  it('E_MEMO_BLOCKED → 시트에 남아 칸 아래 문구, 별명을 고치면 문구가 사라짐', async () => {
    const { s } = await failingAt(new AppError('E_MEMO_BLOCKED'));
    expect(s().overlay).toBe('consent');
    expect(s().phase).toBe('poster');
    expect(s().consent).toMatchObject({ error: errorCopy.E_MEMO_BLOCKED, canSkip: false, busy: false });
    s().setNickname('다른고래');
    expect(s().consent.error).toBeNull();
  });

  it('E_VALIDATION: 걸러진 별명이면 걸러짐 문구, 그 밖은 확인 문구', async () => {
    const blocked = await failingAt(new AppError('E_VALIDATION', { fields: { nickname: 'blocked' } }));
    expect(blocked.s().consent.error).toBe(errorCopy.E_MEMO_BLOCKED);
    const other = await failingAt(new AppError('E_VALIDATION', { fields: { nickname: 'too_long' } }));
    expect(other.s().consent.error).toBe(errorCopy.E_VALIDATION);
    expect(other.s().consent.canSkip).toBe(false);
  });

  it('너무 긴 별명은 보내기 전에 칸 아래 문구', async () => {
    const { s, api } = await atPoster();
    s().setNickname('별'.repeat(config().NICKNAME_MAX_CHARS + 1));
    s().requestEnter();
    s().setConsentChecked(true);
    await s().confirmConsent();
    expect(api.registerVisitor).not.toHaveBeenCalled();
    expect(s().consent.error).toBe(errorCopy.E_VALIDATION);
  });

  it('E_OFFLINE → 알림 문구 + 별명 없이 들어가기', async () => {
    const { s, device } = await failingAt(new AppError('E_OFFLINE'));
    expect(s().overlay).toBe('consent');
    expect(s().consent).toMatchObject({ error: copy.consent.offline, canSkip: true, busy: false });
    s().enterWithoutNickname();
    expect(s().overlay).toBeNull();
    expect(s().phase).toBe('entering');
    const saved = device.visitor(EX_ID);
    expect(saved?.consentVersion).toBeNull();
    expect(s().liveToken).toBe(saved?.token);
  });

  it('별명 없이 들어가기는 끊겼을 때만', async () => {
    const { s } = await failingAt(new AppError('E_MEMO_BLOCKED'));
    s().enterWithoutNickname();
    expect(s().phase).toBe('poster');
    expect(s().overlay).toBe('consent');
  });

  it('등록 중 전시가 닫히면 막 내림, 준비 중이면 준비 중', async () => {
    const closed = await failingAt(new AppError('E_EXHIBITION_CLOSED'));
    expect(closed.s().phase).toBe('closed');
    expect(closed.s().overlay).toBeNull();
    const draft = await failingAt(new AppError('E_EXHIBITION_DRAFT'));
    expect(draft.s().phase).toBe('notReady');
  });
});

describe('visitorStore 2D 대체 화면(P4-10)', () => {
  it('관람 중 2D로 바꾸면 fallback2d 단계, 두 번째 알림은 무시, 그 전시 동안 2D', async () => {
    const { s } = await atPoster();
    s().requestEnter();
    s().finishEntering();
    expect(s().phase).toBe('viewing');
    expect(s().mode).toBe('3d');
    s().fallBack2d();
    expect(s().phase).toBe('fallback2d');
    expect(s().mode).toBe('2d');
    s().fallBack2d();
    expect(s().phase).toBe('fallback2d');
    // 3D 관람 화면에는 `entered`를 주지 않지만 관람 중이다(바뀜 확인·화면 꺼짐 막기)
    expect(isEntered('fallback2d')).toBe(false);
    expect(isVisiting('fallback2d')).toBe(true);
    expect(isVisiting('viewing')).toBe(true);
    expect(isVisiting('poster')).toBe(false);
    // 바뀜 확인이 새 보기 묶음을 주어도 2D 그대로
    s().applyView(makeView({ poster: true }));
    expect(s().phase).toBe('fallback2d');
  });

  it('포스터에서 2D로(WebGL2 없음): 3D 준비를 기다리지 않고 입장 단추를 열고, 입장 연출이 끝나면 fallback2d', async () => {
    const { s } = setup();
    await s().load();
    expect(s().progress.ready).toBe(false);
    s().fallBack2d();
    expect(s().phase).toBe('poster');
    expect(s().mode).toBe('2d');
    expect(s().progress.ready).toBe(true);
    // 내려간 3D 화면의 늦은 진행 알림은 받지 않는다
    s().setProgress({ ready: false, progress: 0.3 });
    expect(s().progress.ready).toBe(true);
    s().requestEnter();
    expect(s().phase).toBe('entering');
    s().finishEntering();
    expect(s().phase).toBe('fallback2d');
  });

  it('3D 준비가 시간 상한을 넘기면(markSlow) 준비 전에도 입장되고, 가벼운 화면으로 들어간다(까닭 ready_timeout, G-24)', async () => {
    const { s } = setup();
    await s().load();
    s().setProgress({ ready: false, progress: 0.4 });
    s().requestEnter();
    expect(s().phase).toBe('poster');
    s().markSlow();
    expect(s().slow).toBe(true);
    expect(s().mode).toBe('3d');
    s().requestEnter();
    expect(s().mode).toBe('2d');
    expect(s().fallback).toBe('ready_timeout');
    expect(s().phase).toBe('entering');
    s().finishEntering();
    expect(s().phase).toBe('fallback2d');
  });

  it('늦었어도 누르기 전에 3D가 준비되면 3D로 들어간다(까닭 없음)', async () => {
    const { s } = setup();
    await s().load();
    s().markSlow();
    s().setProgress({ ready: true, progress: 1 });
    s().requestEnter();
    expect(s().mode).toBe('3d');
    expect(s().fallback).toBeNull();
    s().finishEntering();
    expect(s().phase).toBe('viewing');
  });

  it('늦음 + 별명 있음: 동의를 거쳐 가벼운 화면으로', async () => {
    const { s } = setup();
    await s().load();
    s().setNickname('하늘');
    s().markSlow();
    s().requestEnter();
    expect(s().overlay).toBe('consent');
    expect(s().mode).toBe('2d');
    s().setConsentChecked(true);
    await s().confirmConsent();
    expect(s().phase).toBe('entering');
    s().finishEntering();
    expect(s().phase).toBe('fallback2d');
  });

  it('2D로 바꾼 까닭이 남고, 2D가 된 뒤의 markSlow는 무시', async () => {
    const { s } = setup();
    await s().load();
    s().fallBack2d('webgl_none');
    expect(s().fallback).toBe('webgl_none');
    s().markSlow();
    expect(s().slow).toBe(false);
  });

  it('입장 연출 중에 2D로 바뀌면 연출이 끝난 뒤 fallback2d', async () => {
    const { s } = await atPoster();
    s().requestEnter();
    s().fallBack2d();
    expect(s().phase).toBe('entering');
    s().finishEntering();
    expect(s().phase).toBe('fallback2d');
  });

  it('동작 줄이기: 포스터가 사라지는 연출 없이 바로 관람(3D는 viewing, 2D는 fallback2d)', async () => {
    const three = setup({}, () => true);
    await three.s().load();
    three.s().setProgress({ ready: true, progress: 1 });
    three.s().requestEnter();
    expect(three.s().phase).toBe('viewing');
    const two = setup({}, () => true);
    await two.s().load();
    two.s().fallBack2d();
    two.s().requestEnter();
    expect(two.s().phase).toBe('fallback2d');
  });

  it('동작 줄이기가 꺼져 있으면 입장 연출(entering)을 거친다', async () => {
    const { s } = setup({}, () => false);
    await s().load();
    s().setProgress({ ready: true, progress: 1 });
    s().requestEnter();
    expect(s().phase).toBe('entering');
  });
});

describe('처음 쓰는 친구예요(U-20 나안)', () => {
  it('누르면 이 전시의 방문자 기록(토큰·별명)과 마지막 별명을 지우고 별명 칸을 비운다 — 캐릭터는 그대로', async () => {
    const t = await atPoster();
    t.device.setVisitor(EX_ID, { token: 'a'.repeat(43), consentVersion: '2026-11', nickname: '앞 친구' });
    t.prefs.setLastNickname('앞 친구');
    t.s().setNickname('앞 친구');
    t.s().setCharacter('student-f-05');
    t.s().startFresh();
    expect(t.device.visitor(EX_ID)).toBeNull();
    expect(t.prefs.lastNickname()).toBeNull();
    expect(t.s().nickname).toBe('');
    expect(t.s().character).toBe('student-f-05');
    expect(t.s().freshStarted).toBe(true);
  });
});
