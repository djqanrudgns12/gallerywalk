import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import type { ExhibitionView } from '@gallery/core/types';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ART_A,
  ART_B,
  makeReactionServices,
  REACTION_CODE,
  reactionView,
  registerOnServer,
  seedReaction,
} from '../../dev/reactionFixtures.ts';
import { EX_ID } from '../../dev/studentFixtures.ts';
import { ServicesContext } from '../services.ts';
import { memoryOutboxStorage, reactionKey } from './outbox.ts';
import { ReactionLayer } from './ReactionLayer.tsx';
import { installReactionRuntime, useReactionPending } from './reactionRuntime.ts';
import { createReactionSheetStore } from './reactionSheetStore.ts';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CONSENT = config().CONSENT_VERSION;
const TARGET = { code: REACTION_CODE, exhibitionId: EX_ID };

type Ctx = ReturnType<typeof makeReactionServices>;
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const flush = async (times = 6): Promise<void> => {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
};

const click = (el: Element | null | undefined): void => {
  if (!(el instanceof HTMLElement)) throw new Error('click: element not found');
  act(() => el.click());
};

const typeInto = (el: Element | null, value: string): void => {
  if (!(el instanceof HTMLInputElement)) throw new Error('typeInto: input not found');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const byText = (root: ParentNode, text: string): HTMLButtonElement | null =>
  Array.from(root.querySelectorAll('button')).find(b => b.textContent?.trim() === text) ?? null;

const PendingProbe = ({ id }: { readonly id: string }) => (
  <i data-testid="pending" data-pending={String(useReactionPending(id))} />
);

/** 서비스 묶음 + 주입한 줄 저장소로 반응 덮개를 띄운다 */
const setup = (opts: { readonly triggers?: boolean } = {}) => {
  const ctx = makeReactionServices();
  const storage = memoryOutboxStorage();
  const runtime = installReactionRuntime(ctx.services, { storage, triggers: opts.triggers ?? false });
  cleanups.push(() => runtime.dispose());
  return { ctx, storage, runtime };
};

const mount = (ctx: Ctx, view: ExhibitionView, artworkId: string, extra?: ReactNode) => {
  const onClose = vi.fn();
  const onUnavailable = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ServicesContext value={ctx.services}>
        <div data-theme="modern-history">
          <ReactionLayer
            view={view}
            code={REACTION_CODE}
            artworkId={artworkId}
            onClose={onClose}
            onUnavailable={onUnavailable}
          />
          {extra}
        </div>
      </ServicesContext>,
    );
  });
  const unmount = () => {
    act(() => root.unmount());
    container.remove();
  };
  cleanups.push(unmount);
  return {
    onClose,
    onUnavailable,
    unmount,
    q: <E extends Element = HTMLElement>(sel: string): E | null => container.querySelector<E>(sel),
    text: (): string => container.textContent ?? '',
    sticker: (s: string) => container.querySelector<HTMLButtonElement>(`[data-sticker="${s}"]`),
    memo: () =>
      container.querySelector<HTMLInputElement>('[data-testid="reaction-sheet"] input[type="text"]'),
    submit: () => container.querySelector<HTMLButtonElement>('[data-testid="reaction-submit"]'),
  };
};

describe('반응 덮개(ReactionLayer)', () => {
  it('열 때 내 반응을 채우고 `고치기` — 내 반응은 전시마다 한 번만 받는다', async () => {
    const { ctx } = setup();
    registerOnServer(ctx, EX_ID, '하늘고래', CONSENT);
    seedReaction(ctx.server, ART_A, { sticker: 'LEARNED', memo: '가상의 메모' });
    const view = reactionView();

    const a = mount(ctx, view, ART_A);
    await flush();
    expect(a.sticker('LEARNED')?.getAttribute('aria-pressed')).toBe('true');
    expect(a.memo()?.value).toBe('가상의 메모');
    expect(a.submit()?.textContent).toBe(copy.reaction.update);
    expect(a.text()).toContain('하늘고래로 남겨요');
    a.unmount();

    const b = mount(ctx, view, ART_B);
    await flush();
    expect(b.submit()?.textContent).toBe(copy.reaction.submit);
    expect(b.sticker('LEARNED')?.getAttribute('aria-pressed')).toBe('false');
    b.unmount();

    // 다시 열어도 기억한 값으로 바로 채운다
    const again = mount(ctx, view, ART_A);
    expect(again.memo()?.value).toBe('가상의 메모');
    expect(ctx.student.myReactions).toHaveBeenCalledTimes(1);
  });

  it('`남기기` 본문: 고른 스티커·정리한 메모, 받지 않는 칸은 null — 성공하면 닫힌다. `고치기`도 같은 길', async () => {
    const { ctx } = setup();
    registerOnServer(ctx, EX_ID, '하늘고래', CONSENT);
    seedReaction(ctx.server, ART_A, { sticker: 'LEARNED', memo: '가상의 메모' });
    const view = reactionView();

    const m = mount(ctx, view, ART_B);
    await flush();
    expect(m.submit()?.disabled).toBe(true);
    click(m.sticker('GREAT'));
    typeInto(m.memo(), '  새로   알게 된  것 ');
    expect(m.text()).toContain(`${'새로   알게 된  것'.length + 3}/${config().MEMO_MAX_CHARS}`);
    click(m.submit());
    await flush();
    expect(ctx.student.putReaction).toHaveBeenLastCalledWith(TARGET, ART_B, {
      sticker: 'GREAT',
      memo: '새로 알게 된 것',
      scoreFact: null,
      scoreDelivery: null,
    });
    expect(m.onClose).toHaveBeenCalledTimes(1);
    m.unmount();

    const edit = mount(ctx, view, ART_A);
    await flush();
    click(edit.sticker('CURIOUS'));
    click(edit.submit());
    await flush();
    expect(ctx.student.putReaction).toHaveBeenLastCalledWith(TARGET, ART_A, {
      sticker: 'CURIOUS',
      memo: '가상의 메모',
      scoreFact: null,
      scoreDelivery: null,
    });
    expect(ctx.server.reactions.get(ART_A)?.sticker).toBe('CURIOUS');
    // 같은 작품은 서버에 하나(멱등 PUT)
    expect(ctx.server.reactions.size).toBe(2);
  });

  it('평가를 켜면 두 줄을 모두 골라야 보낼 수 있다', async () => {
    const { ctx } = setup();
    registerOnServer(ctx, EX_ID, null, CONSENT);
    const m = mount(ctx, reactionView({ collect: { sticker: true, memo: true, score: true } }), ART_A);
    await flush();
    const cells = (label: string) =>
      Array.from(
        m
          .q('[data-testid="reaction-sheet"]')!
          .querySelectorAll<HTMLButtonElement>(`button[aria-label^="${label}"]`),
      );
    expect(cells(copy.reaction.scoreFact)).toHaveLength(3);
    click(cells(copy.reaction.scoreFact)[1]);
    expect(m.submit()?.disabled).toBe(true);
    expect(m.text()).toContain(copy.reaction.scorePairHint);
    click(cells(copy.reaction.scoreDelivery)[2]);
    expect(m.submit()?.disabled).toBe(false);
    click(m.submit());
    await flush();
    expect(ctx.student.putReaction).toHaveBeenLastCalledWith(TARGET, ART_A, {
      sticker: null,
      memo: null,
      scoreFact: 2,
      scoreDelivery: 3,
    });
  });

  it('끊기면 시트를 닫지 않고 값을 둔 채 줄에 넣는다 → `online`에 다시 보내고 성공하면 줄에서 빠진다', async () => {
    const { ctx, storage } = setup({ triggers: true });
    registerOnServer(ctx, EX_ID, '하늘고래', CONSENT);
    ctx.server.online = false;
    const m = mount(ctx, reactionView(), ART_A, <PendingProbe id={EX_ID} />);
    await flush();
    click(m.sticker('MOVED'));
    typeInto(m.memo(), '가상의 메모');
    click(m.submit());
    await flush();

    expect(m.onClose).not.toHaveBeenCalled();
    expect(m.text()).toContain(copy.reaction.queued);
    expect(m.sticker('MOVED')?.getAttribute('aria-pressed')).toBe('true');
    expect(m.memo()?.value).toBe('가상의 메모');
    expect(m.q('[data-testid="pending"]')?.dataset['pending']).toBe('true');
    expect([...storage.rows.keys()]).toEqual([reactionKey(EX_ID, ART_A)]);

    ctx.server.online = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await flush();
    expect(ctx.student.putReaction).toHaveBeenCalledTimes(2);
    expect(ctx.server.reactions.get(ART_A)).toMatchObject({ sticker: 'MOVED', memo: '가상의 메모' });
    expect(storage.rows.size).toBe(0);
    expect(m.q('[data-testid="pending"]')?.dataset['pending']).toBe('false');
    expect(m.text()).toContain(copy.reaction.sent);
    expect(m.submit()?.textContent).toBe(copy.reaction.update);
  });

  it('줄에 남은 채로 다시 열면 줄의 값과 끊김 문구로 열린다', async () => {
    const { ctx } = setup();
    registerOnServer(ctx, EX_ID, '하늘고래', CONSENT);
    ctx.server.online = false;
    const first = mount(ctx, reactionView(), ART_A);
    await flush();
    click(first.sticker('GREAT'));
    click(first.submit());
    await flush();
    first.unmount();

    const again = mount(ctx, reactionView(), ART_A);
    await flush();
    expect(again.sticker('GREAT')?.getAttribute('aria-pressed')).toBe('true');
    expect(again.text()).toContain(copy.reaction.queued);
  });

  it('걸러진 메모는 칸 아래에 문구(E_MEMO_BLOCKED · E_VALIDATION {memo:"blocked"}) — 시트·값은 그대로', async () => {
    const { ctx, runtime } = setup();
    registerOnServer(ctx, EX_ID, '하늘고래', CONSENT);
    ctx.server.putErrors.push(new AppError('E_MEMO_BLOCKED'));
    const m = mount(ctx, reactionView(), ART_A);
    await flush();
    typeInto(m.memo(), '가상의 메모');
    click(m.submit());
    await flush();
    const describedBy = m.memo()?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(errorCopy.E_MEMO_BLOCKED);
    expect(m.memo()?.value).toBe('가상의 메모');
    expect(m.onClose).not.toHaveBeenCalled();
    expect(runtime.outbox.hasPending()).toBe(false);

    // 고치면 문구가 사라지고, 서버가 E_VALIDATION {memo:'blocked'}로 답해도 같은 자리
    typeInto(m.memo(), '다른 가상의 메모');
    expect(m.memo()?.getAttribute('aria-describedby')).toBeNull();
    ctx.server.putErrors.push(new AppError('E_VALIDATION', { fields: { memo: 'blocked' } }));
    click(m.submit());
    await flush();
    expect(document.getElementById(m.memo()!.getAttribute('aria-describedby')!)?.textContent).toBe(
      errorCopy.E_MEMO_BLOCKED,
    );
  });

  it('반응 꺼짐(E_REACTIONS_OFF)·전시 닫힘이면 시트를 닫고 문구만 보인다', async () => {
    const { ctx } = setup();
    registerOnServer(ctx, EX_ID, '하늘고래', CONSENT);
    ctx.server.putErrors.push(new AppError('E_REACTIONS_OFF'));
    const m = mount(ctx, reactionView(), ART_A);
    await flush();
    click(m.sticker('MOVED'));
    click(m.submit());
    await flush();
    expect(m.q('[data-testid="reaction-sheet"]')).toBeNull();
    expect(m.text()).toContain(errorCopy.E_REACTIONS_OFF);
    expect(m.onUnavailable).toHaveBeenCalledWith('E_REACTIONS_OFF');
    click(m.q('[data-testid="reaction-close"]'));
    expect(m.onClose).toHaveBeenCalledTimes(1);
    m.unmount();

    ctx.server.putErrors.push(new AppError('E_EXHIBITION_CLOSED'));
    const closed = mount(ctx, reactionView(), ART_A);
    await flush();
    click(closed.sticker('MOVED'));
    click(closed.submit());
    await flush();
    expect(closed.text()).toContain(errorCopy.E_EXHIBITION_CLOSED);
    expect(closed.q('[data-testid="reaction-submit"]')).toBeNull();

    // 반응 꺼짐 보기로 열면 처음부터 문구
    const off = mount(ctx, reactionView({ enabled: false }), ART_A);
    expect(off.text()).toContain(errorCopy.E_REACTIONS_OFF);
    expect(off.q('[data-testid="reaction-submit"]')).toBeNull();
  });

  it('별명 방식 처음: 동의(PRD 13.2) → 등록 → 보내기', async () => {
    const { ctx } = setup();
    // 입장 때 별명을 비운 기기: 토큰만 있고 등록 전
    ctx.device.setVisitor(EX_ID, { token: ctx.tokens.newToken(), consentVersion: null, nickname: null });
    const m = mount(ctx, reactionView(), ART_A);
    await flush();
    const dialog = m.q('[data-testid="reaction-consent"]');
    expect(dialog?.textContent).toContain(copy.consent.title);
    expect(dialog?.textContent).toContain(copy.consent.teacherOnly);
    expect(m.q('[data-testid="reaction-sheet"]')).toBeNull();
    expect(ctx.student.myReactions).not.toHaveBeenCalled();

    typeInto(dialog!.querySelector('input[type="text"]'), '하늘고래');
    click(dialog!.querySelector('input[type="checkbox"]'));
    click(byText(dialog!, copy.consent.start));
    await flush();
    expect(ctx.student.registerVisitor).toHaveBeenCalledWith(TARGET, {
      nickname: '하늘고래',
      consentVersion: CONSENT,
    });
    expect(m.q('[data-testid="reaction-consent"]')).toBeNull();
    expect(m.text()).toContain('하늘고래로 남겨요');

    click(m.sticker('LEARNED'));
    click(m.submit());
    await flush();
    expect(ctx.student.putReaction).toHaveBeenCalledTimes(1);
    const registerOrder = vi.mocked(ctx.student.registerVisitor).mock.invocationCallOrder[0]!;
    const putOrder = vi.mocked(ctx.student.putReaction).mock.invocationCallOrder[0]!;
    expect(registerOrder).toBeLessThan(putOrder);
    expect(m.onClose).toHaveBeenCalledTimes(1);
  });

  it("공개 설정에 '모두에게'가 있으면 동의 문구도 그 판", async () => {
    const { ctx } = setup();
    const m = mount(ctx, reactionView({ stickerVisibility: 'PUBLIC' }), ART_A);
    await flush();
    const dialog = m.q('[data-testid="reaction-consent"]');
    expect(dialog?.textContent).toContain(copy.consent.everyone);
    expect(dialog?.textContent).not.toContain(copy.consent.teacherOnly);
  });

  it('익명 방식: 동의 화면 없이 안내 한 줄 → 보낼 때 별명 없이 등록하고 보낸다', async () => {
    const { ctx } = setup();
    const m = mount(ctx, reactionView({ naming: 'ANONYMOUS' }), ART_A);
    await flush();
    expect(m.q('[data-testid="reaction-consent"]')).toBeNull();
    expect(m.text()).toContain(copy.reaction.anonymousTeacher);
    expect(m.q('[data-testid="nickname-change"]')).toBeNull();
    click(m.sticker('GREAT'));
    click(m.submit());
    await flush();
    expect(ctx.student.registerVisitor).toHaveBeenCalledWith(TARGET, { consentVersion: CONSENT });
    expect(ctx.student.putReaction).toHaveBeenCalledTimes(1);
    expect(ctx.server.reactions.get(ART_A)?.sticker).toBe('GREAT');
  });

  it('동의 뒤 끊겨서 등록하지 못하면 시트로 가고, 줄에 넣었다가 연결되면 등록 → 보내기', async () => {
    const { ctx, runtime } = setup();
    ctx.server.online = false;
    const m = mount(ctx, reactionView(), ART_A);
    await flush();
    const dialog = m.q('[data-testid="reaction-consent"]')!;
    typeInto(dialog.querySelector('input[type="text"]'), '바다고래');
    click(dialog.querySelector('input[type="checkbox"]'));
    click(byText(dialog, copy.consent.start));
    await flush();
    expect(m.text()).toContain('바다고래로 남겨요');
    click(m.sticker('MOVED'));
    click(m.submit());
    await flush();
    expect(m.text()).toContain(copy.reaction.queued);
    expect(runtime.outbox.get(reactionKey(EX_ID, ART_A))?.register).toEqual({
      nickname: '바다고래',
      consentVersion: CONSENT,
    });

    ctx.server.online = true;
    await act(() => runtime.outbox.flush());
    await flush();
    const token = ctx.device.visitor(EX_ID)?.token ?? '';
    expect(ctx.server.visitors.get(token)).toBe('바다고래');
    expect(ctx.server.reactions.get(ART_A)?.sticker).toBe('MOVED');
    expect(runtime.outbox.hasPending()).toBe(false);
  });

  it('`바꾸기`는 별명 바꾸기(changeNickname)', async () => {
    const { ctx } = setup();
    registerOnServer(ctx, EX_ID, '하늘고래', CONSENT);
    const m = mount(ctx, reactionView(), ART_A);
    await flush();
    click(m.q('[data-testid="nickname-change"]'));
    const input = m.q<HTMLInputElement>('[data-testid="reaction-sheet"] input[aria-invalid]');
    expect(input?.value).toBe('하늘고래');
    typeInto(input, '바다고래');
    click(m.q('[data-testid="nickname-save"]'));
    await flush();
    expect(ctx.student.changeNickname).toHaveBeenCalledWith(TARGET, '바다고래');
    expect(m.text()).toContain('바다고래로 남겨요');
    expect(ctx.services.prefs.lastNickname()).toBe('바다고래');
  });
});

describe('반응 시트 상태(reactionSheetStore)', () => {
  it('기기에서도 메모 걸러내기를 먼저 본다(끊겨 있어도 바로 칸 아래 문구, 보내지 않음)', async () => {
    const { ctx, runtime } = setup();
    registerOnServer(ctx, EX_ID, '하늘고래', CONSENT);
    const store = createReactionSheetStore({
      view: reactionView(),
      code: REACTION_CODE,
      artworkId: ART_A,
      student: ctx.student,
      device: ctx.device,
      prefs: ctx.services.prefs,
      runtime,
      onClose: vi.fn(),
      memoBlocked: memo => memo.includes('가짜욕'),
    });
    const stop = store.getState().start();
    store
      .getState()
      .change({ sticker: null, memo: '이건 가짜욕 메모', scoreFact: null, scoreDelivery: null });
    await store.getState().submit();
    expect(store.getState().memoError).toBe(errorCopy.E_MEMO_BLOCKED);
    expect(ctx.student.putReaction).not.toHaveBeenCalled();
    stop();
  });
});
