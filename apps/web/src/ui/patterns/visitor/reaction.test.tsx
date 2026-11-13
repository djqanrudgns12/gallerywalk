import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatAverage,
  PublicReactions,
  ReactionSheet,
  type ReactionSheetProps,
  type ReactionSheetValue,
} from './index.ts';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const EMPTY: ReactionSheetValue = { sticker: null, memo: '', scoreFact: null, scoreDelivery: null };

let container: HTMLDivElement;
let root: Root;

const render = (ui: JSX.Element): void => {
  act(() => root.render(ui));
};

const sheetProps = (over: Partial<ReactionSheetProps> = {}): ReactionSheetProps => ({
  value: EMPTY,
  fields: { sticker: true, memo: true, score: false },
  editing: false,
  status: 'idle',
  identity: { kind: 'nickname', nickname: '하늘고래' },
  submitDisabled: false,
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ReactionSheet(모양)', () => {
  it('스티커 4개·메모 글자 수·`남기기`/`고치기`·별명 줄', () => {
    const onChange = vi.fn();
    render(<ReactionSheet {...sheetProps({ onChange, value: { ...EMPTY, memo: '가상' } })} />);
    const stickers = container.querySelectorAll('[data-sticker]');
    expect(Array.from(stickers, b => b.textContent)).toEqual([
      copy.reaction.stickers.MOVED,
      copy.reaction.stickers.LEARNED,
      copy.reaction.stickers.GREAT,
      copy.reaction.stickers.CURIOUS,
    ]);
    expect(container.textContent).toContain(`2/${config().MEMO_MAX_CHARS}`);
    const memo = container.querySelector<HTMLInputElement>('input[type="text"]');
    expect(memo?.maxLength).toBe(config().MEMO_MAX_CHARS);
    expect(memo?.placeholder).toBe(copy.reaction.memoPlaceholder);
    expect(container.textContent).toContain('하늘고래로 남겨요');
    expect(container.querySelector('[data-testid="reaction-submit"]')?.textContent).toBe(
      copy.reaction.submit,
    );

    act(() => (stickers[2] as HTMLButtonElement).click());
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, memo: '가상', sticker: 'GREAT' });

    render(
      <ReactionSheet {...sheetProps({ editing: true, value: { ...EMPTY, sticker: 'GREAT' }, onChange })} />,
    );
    expect(container.querySelector('[data-testid="reaction-submit"]')?.textContent).toBe(
      copy.reaction.update,
    );
    const great = container.querySelector<HTMLButtonElement>('[data-sticker="GREAT"]')!;
    expect(great.getAttribute('aria-pressed')).toBe('true');
    // 고른 스티커를 다시 누르면 빼기
    act(() => great.click());
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, sticker: null });
  });

  it('누르면 작게 튀는 표시를 다시 건다(같은 스티커를 또 골라도)', () => {
    let value = EMPTY;
    const onChange = (v: ReactionSheetValue) => {
      value = v;
      render(<ReactionSheet {...sheetProps({ value, onChange })} />);
    };
    render(<ReactionSheet {...sheetProps({ value, onChange })} />);
    const moved = () => container.querySelector<HTMLButtonElement>('[data-sticker="MOVED"]')!;
    act(() => moved().click());
    const first = moved().dataset['pop'];
    expect(first).toBeDefined();
    act(() => moved().click()); // 빼기
    expect(moved().dataset['pop']).toBeUndefined();
    act(() => moved().click());
    expect(moved().dataset['pop']).not.toBe(first);
  });

  it('보내는 중·끊김·보냄 문구, 메모 칸 아래 문구, 보낼 수 없으면 단추 잠금', () => {
    render(<ReactionSheet {...sheetProps({ status: 'sending' })} />);
    expect(container.textContent).toContain(copy.reaction.sending);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="reaction-submit"]')?.disabled).toBe(
      true,
    );
    render(<ReactionSheet {...sheetProps({ status: 'queued' })} />);
    expect(container.textContent).toContain(copy.reaction.queued);
    render(<ReactionSheet {...sheetProps({ status: 'sent' })} />);
    expect(container.textContent).toContain(copy.reaction.sent);
    render(<ReactionSheet {...sheetProps({ memoError: '가상의 문구', submitDisabled: true })} />);
    const memo = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(memo.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(memo.getAttribute('aria-describedby')!)?.textContent).toBe('가상의 문구');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="reaction-submit"]')?.disabled).toBe(
      true,
    );
  });

  it('평가 칸 3개씩(켰을 때만), 고른 칸까지 채움', () => {
    const onChange = vi.fn();
    render(<ReactionSheet {...sheetProps({ onChange })} />);
    expect(container.textContent).not.toContain(copy.reaction.scoreFact);
    render(
      <ReactionSheet
        {...sheetProps({
          onChange,
          fields: { sticker: true, memo: true, score: true },
          value: { ...EMPTY, scoreFact: 2 },
        })}
      />,
    );
    const fact = container.querySelectorAll<HTMLButtonElement>(
      `button[aria-label^="${copy.reaction.scoreFact}"]`,
    );
    expect(fact).toHaveLength(3);
    expect(Array.from(fact, b => b.textContent)).toEqual(['1', '2', '3']);
    const delivery = container.querySelectorAll<HTMLButtonElement>(
      `button[aria-label^="${copy.reaction.scoreDelivery}"]`,
    );
    expect(Array.from(delivery, b => b.textContent)).toEqual(['1', '2', '3']);
    expect(Array.from(fact, b => b.dataset['filled'] ?? null)).toEqual(['true', 'true', null]);
    expect(fact[1]?.getAttribute('aria-label')).toBe(
      fill(copy.reaction.scoreCell, { label: copy.reaction.scoreFact, n: 2, max: 3 }),
    );
    expect(container.textContent).toContain(copy.reaction.scorePairHint);
    act(() => fact[0]!.click());
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, scoreFact: 1 });
  });

  it('익명 방식은 안내 한 줄(바꾸기 없음), 문구만 판은 닫기만', () => {
    render(<ReactionSheet {...sheetProps({ identity: { kind: 'anonymous', audience: 'everyone' } })} />);
    expect(container.textContent).toContain(copy.reaction.anonymousEveryone);
    expect(container.querySelector('[data-testid="nickname-change"]')).toBeNull();

    const onClose = vi.fn();
    render(<ReactionSheet {...sheetProps({ notice: '가상의 알림', onClose })} />);
    expect(container.textContent).toContain('가상의 알림');
    expect(container.querySelector('[data-sticker]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="reaction-close"]')!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc: 별명 고치기 중이면 그것만 접고, 아니면 닫는다', () => {
    const onClose = vi.fn();
    const onNicknameCancel = vi.fn();
    render(
      <ReactionSheet
        {...sheetProps({
          onClose,
          onNicknameCancel,
          nicknameEdit: { value: '하늘', busy: false, error: null },
        })}
      />,
    );
    const sheet = container.querySelector('[data-testid="reaction-sheet"]')!;
    act(() => sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onNicknameCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    render(<ReactionSheet {...sheetProps({ onClose })} />);
    act(() =>
      container
        .querySelector('[data-testid="reaction-sheet"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PublicReactions(모양)', () => {
  it('스티커별 수는 0을 숨기고, 평가 평균은 소수 한 자리', () => {
    render(
      <PublicReactions
        stickers={{ MOVED: 3, LEARNED: 0, CURIOUS: 1 }}
        score={{ factAvg: 7 / 3, deliveryAvg: 2.25 }}
        memos={[]}
      />,
    );
    const chips = container.querySelectorAll('[data-sticker]');
    expect(Array.from(chips, c => c.getAttribute('data-sticker'))).toEqual(['MOVED', 'CURIOUS']);
    // 아이콘이 있으면 칩은 아이콘(읽기 도구에는 스티커 이름) + 숫자
    expect(chips[0]?.textContent).toBe('3');
    expect(chips[0]?.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe(
      copy.reaction.stickers.MOVED,
    );
    expect(container.querySelector('[data-testid="public-score-fact"]')?.textContent).toBe(
      fill(copy.reaction.average, { label: copy.reaction.scoreFact, avg: '2.3' }),
    );
    expect(container.querySelector('[data-testid="public-score-delivery"]')?.textContent).toBe(
      fill(copy.reaction.average, { label: copy.reaction.scoreDelivery, avg: '2.3' }),
    );
    expect(container.querySelector('[data-testid="public-memos-toggle"]')).toBeNull();
    expect([formatAverage(1), formatAverage(2.666), formatAverage(2.04)]).toEqual(['1.0', '2.7', '2.0']);
  });

  it('보일 것이 없으면 그리지 않는다', () => {
    render(<PublicReactions stickers={{ MOVED: 0 }} score={null} memos={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('`더 보기` 안에 고른 메모 다섯 개 + `더 보기`, 별명이 없으면 익명', () => {
    const memos = Array.from({ length: 7 }, (_, i) => ({
      nickname: i === 0 ? null : `가상 별명 ${i}`,
      memo: `가상 메모 ${i}`,
    }));
    render(<PublicReactions stickers={{}} score={null} memos={memos} />);
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="public-memos-toggle"]')!;
    expect(toggle.textContent).toBe(copy.viewer.more);
    expect(container.querySelectorAll('li')).toHaveLength(0);
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(5);
    expect(items[0]?.textContent).toBe(`${copy.reaction.anonymous}가상 메모 0`);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="public-memos-more"]')!.click());
    expect(container.querySelectorAll('li')).toHaveLength(7);
    expect(container.querySelector('[data-testid="public-memos-more"]')).toBeNull();
    act(() => toggle.click());
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('메모는 글자로만 보인다(HTML을 해석하지 않음)', () => {
    render(<PublicReactions stickers={{}} score={null} memos={[{ nickname: null, memo: '<b>가상</b>' }]} />);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="public-memos-toggle"]')!.click());
    expect(container.querySelector('li b')).toBeNull();
    expect(container.querySelector('li')?.textContent).toContain('<b>가상</b>');
  });
});
