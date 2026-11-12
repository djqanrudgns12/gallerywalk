import { copy, errorCopy } from '@gallery/core/copy';
import type { ExhibitionTeacher } from '@gallery/core/types';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeacherApi } from '../../../ports/index.ts';
import { click, flush } from '../../student/testDom.tsx';
import {
  fakeTeacher,
  mountTeacher,
  T_ENTRY,
  teacherExhibition,
  teacherServices,
  withReactions,
} from '../../../dev/teacherShellFixtures.tsx';
import { OpenSheet } from './OpenSheet.tsx';

let mounted: ReturnType<typeof mountTeacher> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

/** 관리 화면처럼 전시 행을 들고 `onChanged`로 바꾼다 */
const Harness = ({
  start,
  published,
  onClose,
}: {
  readonly start: ExhibitionTeacher;
  readonly published: number;
  readonly onClose: () => void;
}) => {
  const [ex, setEx] = useState(start);
  return <OpenSheet exhibition={ex} publishedCount={published} onChanged={setEx} onClose={onClose} />;
};

const mount = (teacher: TeacherApi, start: ExhibitionTeacher, published = 3) => {
  const onClose = vi.fn();
  const t = teacherServices(teacher);
  mounted = mountTeacher(<Harness start={start} published={published} onClose={onClose} />, t.services);
  return { onClose };
};

describe('전시 열기 시트', () => {
  it('게시한 작품이 0이면 `열기`가 잠기고 까닭을 보인다', () => {
    const changeStatus = vi.fn<TeacherApi['changeStatus']>();
    mount(fakeTeacher({ changeStatus }), teacherExhibition(), 0);
    const open = mounted?.q<HTMLButtonElement>('[data-testid="open-submit"]');
    expect(open?.disabled).toBe(true);
    expect(mounted?.q('[data-testid="open-locked"]')?.textContent).toBe(errorCopy.E_NOTHING_PUBLISHED);
    click(open ?? null);
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it('반응 설정 한 줄 요약(별점이 꺼져 있으면 끝에 표시)', () => {
    mount(fakeTeacher(), teacherExhibition());
    const rs = copy.teacher.reactionSettings;
    expect(mounted?.q('[data-testid="reaction-summary"]')?.textContent).toBe(
      `${rs.summary.replace('{items}', `${rs.summarySticker}·${rs.summaryMemo}`)} · ${rs.summaryScoreOff}`,
    );
    mounted?.unmount();
    mount(fakeTeacher(), withReactions({ enabled: false }));
    expect(mounted?.q('[data-testid="reaction-summary"]')?.textContent).toBe(rs.summaryOff);
  });

  it('`바꾸기` → 별점을 켜고 저장하면 `patchExhibition`(rev와 함께)', async () => {
    const start = teacherExhibition();
    const patchExhibition = vi.fn<TeacherApi['patchExhibition']>(async (_id, _rev, patch) => ({
      ...start,
      rev: start.rev + 1,
      settings: patch.settings as ExhibitionTeacher['settings'],
    }));
    mount(fakeTeacher({ patchExhibition }), start);
    click(mounted?.q('[data-testid="summary-change"]') ?? null);
    click(mounted?.q('[data-testid="collect-score"]') ?? null);
    click(mounted?.q('[data-testid="settings-save"]') ?? null);
    await flush();
    expect(patchExhibition).toHaveBeenCalledWith(start.id, start.rev, {
      settings: {
        ...start.settings,
        reactions: { ...start.settings.reactions, collect: { sticker: true, memo: true, score: true } },
      },
    });
    expect(mounted?.q('[data-testid="reaction-summary"]')?.textContent).not.toContain(
      copy.teacher.reactionSettings.summaryScoreOff,
    );
  });

  it('`열기` → 열린 뒤 QR 자리 · 짧은 주소 · 입장 코드, `QR 크게 띄우기`는 전체 화면', async () => {
    const start = teacherExhibition();
    const changeStatus = vi.fn<TeacherApi['changeStatus']>(async () => ({
      ...start,
      status: 'OPEN',
      rev: 4,
    }));
    mount(fakeTeacher({ changeStatus }), start);
    click(mounted?.q('[data-testid="open-submit"]') ?? null);
    await flush();

    expect(changeStatus).toHaveBeenCalledWith(start.id, 'open');
    expect(mounted?.q('[data-testid="qr-code"]')?.dataset.value).toBe(`${location.origin}/${T_ENTRY}`);
    expect(mounted?.q('[data-testid="short-url"]')?.textContent).toBe(`${location.host}/${T_ENTRY}`);
    expect(mounted?.q('[data-testid="entry-code"]')?.textContent).toBe(T_ENTRY);

    click(mounted?.q('[data-testid="open-big"]') ?? null);
    expect(mounted?.q('[data-testid="open-sheet-big"]')).not.toBeNull();
    expect(mounted?.q('[data-testid="open-sheet"]')).toBeNull();
    expect(mounted?.q('[data-testid="big-entry-code"]')?.textContent).toBe(T_ENTRY);
    expect(mounted?.q('[data-testid="big-short-url"]')?.textContent).toBe(`${location.host}/${T_ENTRY}`);
  });

  it('닫힌 전시는 `다시 열기`(reopen)', async () => {
    const start = teacherExhibition({ status: 'CLOSED' });
    const changeStatus = vi.fn<TeacherApi['changeStatus']>(async () => ({ ...start, status: 'OPEN' }));
    mount(fakeTeacher({ changeStatus }), start);
    expect(mounted?.q('[data-testid="open-submit"]')?.textContent).toBe(copy.teacher.menu.reopen);
    click(mounted?.q('[data-testid="open-submit"]') ?? null);
    await flush();
    expect(changeStatus).toHaveBeenCalledWith(start.id, 'reopen');
  });
});
