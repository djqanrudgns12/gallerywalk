import { copy, fill } from '@gallery/core/copy';
import type { TeacherReaction } from '@gallery/core/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeacherApi } from '../../../ports/index.ts';
import { click, flush } from '../../student/testDom.tsx';
import {
  fakeTeacher,
  mountTeacher,
  T_EX_A,
  T_MEMO_1,
  T_MEMO_2,
  T_NICK,
  teacherArtwork,
  teacherReaction,
  teacherServices,
  teacherView,
  withReactions,
} from '../../../dev/teacherShellFixtures.tsx';
import { ReactionsTab } from './ReactionsTab.tsx';

let mounted: ReturnType<typeof mountTeacher> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

const artworks = [teacherArtwork(0), teacherArtwork(1), teacherArtwork(2, { deletedAt: 1 })];

const sample = (): TeacherReaction[] => [
  teacherReaction(0, {
    sticker: 'MOVED',
    memo: T_MEMO_1,
    nickname: T_NICK,
    scoreFact: 3,
    scoreDelivery: 2,
    updatedAt: 2,
  }),
  teacherReaction(0, { sticker: 'MOVED', scoreFact: 2, scoreDelivery: 1 }),
  teacherReaction(0, { sticker: 'GREAT', memo: T_MEMO_2, updatedAt: 1 }),
  // 지운 작품의 반응은 줄을 만들지 않는다
  teacherReaction(2, { sticker: 'CURIOUS' }),
];

const mount = (over: Partial<TeacherApi>, settings = withReactions({})) => {
  const t = teacherServices(fakeTeacher({ exhibition: vi.fn(async () => teacherView(settings)), ...over }));
  mounted = mountTeacher(<ReactionsTab exhibitionId={T_EX_A} artworks={artworks} />, t.services);
};

const rows = () => mounted?.all('[data-testid="reaction-row"]') ?? [];

describe('반응 탭', () => {
  it('작품별 한 줄: 스티커별 수 · 메모 수 · 평가 평균(지운 작품 빼고)', async () => {
    mount({ reactions: vi.fn(async () => sample()) });
    await flush();
    const [first, second] = rows();
    expect(rows()).toHaveLength(2);
    expect(first?.querySelector('[data-sticker="MOVED"]')?.getAttribute('data-count')).toBe('2');
    expect(first?.querySelector('[data-sticker="GREAT"]')?.getAttribute('data-count')).toBe('1');
    expect(first?.querySelector('[data-sticker="LEARNED"]')?.getAttribute('data-count')).toBe('0');
    expect(first?.querySelector('[data-stat="memo"]')?.textContent).toBe(
      fill(copy.teacher.reactionsTab.memoCount, { n: 2 }),
    );
    expect(first?.querySelector('[data-stat="score"]')?.textContent).toBe(
      fill(copy.teacher.reactionsTab.scoreAvg, { fact: '2.5', delivery: '1.5' }),
    );
    expect(second?.querySelector('[data-stat="score"]')).toBeNull();
  });

  it('누르면 메모 목록(별명 또는 익명, 최신 순), `숨기기` → patchReaction', async () => {
    const list = sample();
    const patchReaction = vi.fn<TeacherApi['patchReaction']>(async (_e, rid, patch) => {
      const r = list.find(x => x.id === rid);
      if (!r) throw new Error('no reaction');
      return { ...r, ...patch } as TeacherReaction;
    });
    mount({ reactions: vi.fn(async () => list), patchReaction });
    await flush();
    click(rows()[0]?.querySelector('button') ?? null);
    const memos = mounted?.all('[data-testid="memo"]') ?? [];
    expect(memos.map(m => m.textContent ?? '')).toEqual([
      expect.stringContaining(T_NICK),
      expect.stringContaining(copy.teacher.csv.anonymous),
    ]);
    expect(memos[0]?.textContent).toContain(T_MEMO_1);
    // 공개가 '교사만'이면 고르기 단추는 없다
    expect(mounted?.q('[data-testid="memo-select"]')).toBeNull();

    click(memos[0]?.querySelector<HTMLButtonElement>('[data-testid="memo-hide"]') ?? null);
    await flush();
    expect(patchReaction).toHaveBeenCalledWith(T_EX_A, list[0]?.id, { hidden: true });
    const hidden = mounted?.all('[data-testid="memo"]')[0];
    expect(hidden?.dataset.hidden).toBe('1');
    expect(hidden?.querySelector('[data-testid="memo-hide"]')?.textContent).toBe(
      copy.teacher.reactionsTab.unhide,
    );
  });

  it("메모 공개가 '고른 것만'이면 `모두에게 보이기`", async () => {
    const list = sample();
    const patchReaction = vi.fn<TeacherApi['patchReaction']>(
      async (_e, rid, patch) => ({ ...list.find(x => x.id === rid), ...patch }) as TeacherReaction,
    );
    mount(
      { reactions: vi.fn(async () => list), patchReaction },
      withReactions({ memoVisibility: 'SELECTED' }),
    );
    await flush();
    click(rows()[0]?.querySelector('button') ?? null);
    const select = mounted?.q<HTMLButtonElement>('[data-testid="memo-select"]') ?? null;
    expect(select?.textContent).toBe(copy.teacher.reactionsTab.select);
    click(select);
    await flush();
    expect(patchReaction).toHaveBeenCalledWith(T_EX_A, list[0]?.id, { publicSelected: true });
    expect(mounted?.q('[data-testid="memo-select"]')?.textContent).toBe(copy.teacher.reactionsTab.unselect);
  });

  it('`내려받기` → reactionsCsv를 받아 a[download]로 저장', async () => {
    const blob = new Blob(['x'], { type: 'text/csv' });
    const reactionsCsv = vi.fn<TeacherApi['reactionsCsv']>(async () => ({ blob, filename: 'reactions.csv' }));
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    mount({ reactions: vi.fn(async () => []), reactionsCsv });
    await flush();
    expect(mounted?.q('[data-testid="reactions-empty"]')).not.toBeNull();
    click(mounted?.q('[data-testid="reactions-download"]') ?? null);
    await flush();
    expect(reactionsCsv).toHaveBeenCalledWith(T_EX_A);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('reactions.csv');
    expect(clicked[0]?.getAttribute('href')).toBe('blob:test');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
