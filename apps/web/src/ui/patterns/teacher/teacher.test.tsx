import { copy, errorCopy } from '@gallery/core/copy';
import type { ArtworkForm } from '@gallery/core/types';
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtworkCard, type ArtworkCardProps, ArtworkGrid, TeacherCharacterDialog } from './index.ts';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('ui/patterns/teacher 부품', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (ui: JSX.Element): void => {
    act(() => {
      root.render(ui);
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('ArtworkCard: 7가지 형태별 액자 미리 보기와 대표작·상태·경고·선택·끌기 상태를 그린다', () => {
    const forms: readonly ArtworkForm[] = [
      'LANDSCAPE',
      'PORTRAIT',
      'SQUARE',
      'PANORAMA',
      'TALL',
      'TEXTCARD',
      'SOUND',
    ];
    const onSelect = vi.fn();

    render(
      <div>
        {forms.map((form, idx) => (
          <ArtworkCard
            key={form}
            id={`card-${idx}`}
            title={`작품-${form}`}
            author="학생"
            form={form}
            pageCount={idx + 1}
            status={idx === 6 ? 'FAILED' : idx === 4 ? 'PROCESSING' : 'PUBLISHED'}
            featured={idx === 0}
            selected={idx === 0}
            dragging={idx === 1}
            warnings={idx === 2 ? ['LOW_RES'] : undefined}
            failCode={idx === 6 ? 'E_FILE_BROKEN' : undefined}
            onSelect={onSelect}
          />
        ))}
      </div>,
    );

    for (const form of forms) {
      expect(container.querySelector(`[data-testid="mini-frame-${form}"]`)).not.toBeNull();
    }

    // TALL 형태는 이어서 보기 안내 띠를 포함한다
    expect(container.textContent).toContain(copy.viewer.continueReading);
    // 대표작 배지·경고 문구·실패 문구가 copy/errorCopy에서 온다
    expect(container.textContent).toContain(copy.viewer.featuredBadge);
    expect(container.textContent).toContain(errorCopy.E_FILE_TOO_SMALL);
    expect(container.textContent).toContain(errorCopy.E_FILE_BROKEN);

    const firstCard = container.querySelector('[data-testid="artwork-card-card-0"]') as HTMLElement | null;
    expect(firstCard?.getAttribute('data-selected')).toBe('true');
    expect(firstCard?.getAttribute('aria-label')).toBe('작품-LANDSCAPE');

    const secondCard = container.querySelector('[data-testid="artwork-card-card-1"]') as HTMLElement | null;
    expect(secondCard?.getAttribute('data-dragging')).toBe('true');

    act(() => {
      firstCard?.click();
    });
    expect(onSelect).toHaveBeenCalledWith('card-0');
  });

  it('ArtworkGrid: 카드 목록과 끝의 작품 더 올리기 카드를 그리고 콜백을 호출한다', () => {
    const onAddMore = vi.fn();
    const onSelectCard = vi.fn();
    const items: readonly ArtworkCardProps[] = [
      { id: 'a1', title: '첫 작품', form: 'LANDSCAPE', status: 'PUBLISHED' },
      { id: 'a2', title: '둘째 작품', form: 'PORTRAIT', status: 'HIDDEN' },
    ];

    render(<ArtworkGrid items={items} onAddMore={onAddMore} onSelectCard={onSelectCard} />);

    const grid = container.querySelector('[data-testid="artwork-grid"]');
    expect(grid?.getAttribute('aria-label')).toBe(copy.viewer.collection);
    expect(container.querySelectorAll('article').length).toBe(2);

    const addBtn = container.querySelector('[data-testid="add-artwork-card"]') as HTMLButtonElement | null;
    expect(addBtn?.textContent).toContain(copy.viewer.more);

    act(() => {
      addBtn?.click();
    });
    expect(onAddMore).toHaveBeenCalledTimes(1);
  });

  it('TeacherCharacterDialog: 선생님 남·여 고르기와 이름표 입력·저장·닫기 콜백이 동작한다', () => {
    const onCharacterChange = vi.fn();
    const onDisplayNameChange = vi.fn();
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(
      <TeacherCharacterDialog
        character="teacher-m"
        onCharacterChange={onCharacterChange}
        displayName="김서연 선생님"
        onDisplayNameChange={onDisplayNameChange}
        onSave={onSave}
        onClose={onClose}
      />,
    );

    const dialog = container.querySelector('[data-testid="teacher-character-dialog"]');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.textContent).toContain(copy.poster.characterLabel);
    expect(dialog?.textContent).toContain(copy.live.teacher);

    const femaleBtn = container.querySelector('[data-testid="char-teacher-f"]') as HTMLButtonElement | null;
    expect(femaleBtn?.getAttribute('aria-checked')).toBe('false');
    act(() => {
      femaleBtn?.click();
    });
    expect(onCharacterChange).toHaveBeenCalledWith('teacher-f');

    const saveBtn = container.querySelector(
      '[data-testid="teacher-character-save"]',
    ) as HTMLButtonElement | null;
    act(() => {
      saveBtn?.click();
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    const closeBtn = container.querySelector(
      '[data-testid="teacher-dialog-close"]',
    ) as HTMLButtonElement | null;
    expect(closeBtn?.getAttribute('aria-label')).toBe(copy.viewer.close);
    act(() => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
