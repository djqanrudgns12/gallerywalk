import { config } from '@gallery/core/config';
import { copy, fill } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import type { ExhibitionTeacher } from '@gallery/core/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeacherApi } from '../../../ports/index.ts';
import { click, flush, typeInto } from '../../../dev/teacherDom.tsx';
import {
  fakeTeacher,
  mountTeacher,
  T_EX_A,
  teacherExhibition,
  teacherServices,
  teacherView,
} from '../../../dev/teacherShellFixtures.tsx';
import { SettingsSheet } from './SettingsSheet.tsx';

let mounted: ReturnType<typeof mountTeacher> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const mount = (teacher: TeacherApi, start: ExhibitionTeacher = teacherExhibition()) => {
  const t = teacherServices(teacher);
  const onChanged = vi.fn();
  const onSaved = vi.fn();
  const onClose = vi.fn();
  mounted = mountTeacher(
    <SettingsSheet exhibition={start} onChanged={onChanged} onSaved={onSaved} onClose={onClose} />,
    t.services,
  );
  return { onChanged, onSaved, onClose };
};
const el = <E extends Element = HTMLElement>(sel: string): E | null => mounted?.q<E>(sel) ?? null;
const option = (group: string, value: string) =>
  el<HTMLButtonElement>(`[data-testid="${group}"] [data-value="${value}"]`);

describe('반응·투어 설정 시트(V-17, PRD G-07 "언제든"·G-16)', () => {
  it('지금 값을 보이고, 반응·투어 시간을 바꿔 저장하면 settings를 고쳐 보낸다', async () => {
    const start = teacherExhibition({ status: 'OPEN', rev: 4 });
    const saved = teacherExhibition({ status: 'OPEN', rev: 5 });
    const patchExhibition = vi.fn<TeacherApi['patchExhibition']>(async () => saved);
    const h = mount(fakeTeacher({ patchExhibition }), start);

    expect(el('[data-testid="settings-sheet"]')).not.toBeNull();
    expect(el('[data-testid="collect-score"]')?.getAttribute('aria-checked')).toBe(
      String(start.settings.reactions.collect.score),
    );
    expect(option('settings-tour-mode', start.settings.tour.timeMode)?.getAttribute('aria-checked')).toBe(
      'true',
    );

    click(el('[data-testid="collect-score"]'));
    click(option('settings-tour-mode', 'FIXED'));
    typeInto(el<HTMLInputElement>('[data-testid="settings-tour-seconds"]'), '60');
    click(el('[data-testid="settings-save"]'));
    await flush();

    expect(patchExhibition).toHaveBeenCalledWith(T_EX_A, 4, {
      settings: {
        ...start.settings,
        reactions: {
          ...start.settings.reactions,
          collect: { ...start.settings.reactions.collect, score: !start.settings.reactions.collect.score },
        },
        tour: { timeMode: 'FIXED', secondsPerRoom: 60 },
      },
    });
    expect(h.onChanged).toHaveBeenCalledWith(saved);
    expect(h.onSaved).toHaveBeenCalledWith(
      fill(copy.teacher.menu.settingsSavedOpen, { sec: config().CHANGE_POLL_SEC }),
    );
  });

  it('정한 초가 범위 밖이면 보내지 않고 범위를 알린다', async () => {
    const patchExhibition = vi.fn<TeacherApi['patchExhibition']>();
    mount(fakeTeacher({ patchExhibition }));
    click(option('settings-tour-mode', 'FIXED'));
    typeInto(el<HTMLInputElement>('[data-testid="settings-tour-seconds"]'), '5');
    click(el('[data-testid="settings-save"]'));
    await flush();
    expect(patchExhibition).not.toHaveBeenCalled();
    const cfg = config();
    expect(el('[data-testid="settings-sheet"]')?.textContent).toContain(
      fill(copy.teacher.create.tourRange, {
        min: cfg.TOUR_MIN_SECONDS_PER_PART,
        max: cfg.TOUR_MUSIC_MAX_SEC,
      }),
    );
  });

  it('받을 것을 모두 끄면 저장할 수 없다', () => {
    mount(fakeTeacher());
    const r = teacherExhibition().settings.reactions;
    for (const k of ['sticker', 'memo', 'score'] as const)
      if (r.collect[k]) click(el(`[data-testid="collect-${k}"]`));
    expect(el<HTMLButtonElement>('[data-testid="settings-save"]')?.disabled).toBe(true);
  });

  it('rev가 어긋나면 알리고 새로 받아 넘긴다', async () => {
    const fresh = teacherView(teacherExhibition({ rev: 9 }));
    const patchExhibition = vi.fn<TeacherApi['patchExhibition']>(async () => {
      throw new AppError('E_CONFLICT');
    });
    const h = mount(fakeTeacher({ patchExhibition, exhibition: vi.fn(async () => fresh) }));
    click(el('[data-testid="collect-memo"]'));
    click(el('[data-testid="settings-save"]'));
    await flush();
    expect(el('[data-testid="settings-error"]')).not.toBeNull();
    expect(h.onChanged).toHaveBeenCalledWith(fresh.exhibition);
    expect(h.onSaved).not.toHaveBeenCalled();
  });
});
