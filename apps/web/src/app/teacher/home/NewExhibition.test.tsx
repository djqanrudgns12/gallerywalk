import { config } from '@gallery/core/config';
import { copy, errorCopy, fill } from '@gallery/core/copy';
import { AppError } from '@gallery/core/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeacherApi } from '../../../ports/index.ts';
import { click, flush, typeInto } from '../../student/testDom.tsx';
import {
  fakeTeacher,
  mountTeacher,
  T_CLASS,
  T_ENTRY,
  T_NOW,
  T_SCHOOL,
  T_TITLE_A,
  teacherExhibition,
  teacherServices,
  teacherView,
} from '../../../dev/teacherShellFixtures.tsx';
import { NewExhibition } from './NewExhibition.tsx';

let mounted: ReturnType<typeof mountTeacher> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const mount = (teacher: TeacherApi, passed = true) => {
  const t = teacherServices(teacher);
  t.device.setStartCodePassed(passed);
  mounted = mountTeacher(<NewExhibition />, t.services, '/t/new', '/t/new');
  return t;
};

const input = (id: string): HTMLInputElement => {
  const el = mounted?.q<HTMLInputElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`no ${id}`);
  return el;
};

const fillForm = (pin = '583920'): void => {
  typeInto(input('new-title'), T_TITLE_A);
  typeInto(input('new-pin'), pin);
};

const submit = async (): Promise<void> => {
  click(mounted?.q('[data-testid="new-submit"]') ?? null);
  await flush();
};

const created = () =>
  vi.fn<TeacherApi['createExhibition']>(async input => ({
    exhibitionId: input.exhibitionId,
    entryCode: T_ENTRY,
    expiresAt: T_NOW + config().EXHIBITION_TTL_DAYS * 86_400_000,
  }));

describe('새 전시 만들기 — 칸', () => {
  it('보이는 것은 이름·템플릿·소개·PIN 넷이고 `더 설정하기`는 접혀 있다', () => {
    mount(fakeTeacher());
    expect(input('new-title')).not.toBeNull();
    expect(mounted?.q('[data-testid="template-modern-history"]')?.getAttribute('aria-checked')).toBe('true');
    expect(input('new-subtitle')).not.toBeNull();
    expect(input('new-pin')).not.toBeNull();
    expect(mounted?.q('[data-testid="reaction-settings"]')).toBeNull();
    expect(mounted?.q('[data-testid="new-more"]')?.getAttribute('aria-expanded')).toBe('false');
    click(mounted?.q('[data-testid="new-more"]') ?? null);
    expect(mounted?.q('[data-testid="reaction-settings"]')).not.toBeNull();
  });

  it('전시 이름은 필수, 글자 수 한도가 칸에 걸린다', async () => {
    const createExhibition = created();
    mount(fakeTeacher({ createExhibition }));
    expect(input('new-title').maxLength).toBe(config().EXHIBITION_TITLE_MAX_CHARS);
    expect(input('new-subtitle').maxLength).toBe(config().SUBTITLE_MAX_CHARS);
    typeInto(input('new-pin'), '583920');
    await submit();
    expect(mounted?.q('[data-testid="new-title-error"]')?.textContent).toBe(copy.teacher.create.nameRequired);
    expect(createExhibition).not.toHaveBeenCalled();
  });

  it('PIN은 숫자만, 최소 자리보다 짧으면 칸 아래 안내', async () => {
    const createExhibition = created();
    mount(fakeTeacher({ createExhibition }));
    typeInto(input('new-title'), T_TITLE_A);
    typeInto(input('new-pin'), '12a34');
    expect(input('new-pin').value).toBe('1234');
    await submit();
    expect(mounted?.q('[data-testid="new-pin-error"]')?.textContent).toBe(
      fill(copy.teacher.pin.format, { min: config().PIN_MIN_LENGTH, max: config().PIN_MAX_LENGTH }),
    );
    expect(createExhibition).not.toHaveBeenCalled();
  });

  it('시작 코드 칸은 이 기기가 아직 통과하지 않았을 때만', () => {
    mount(fakeTeacher(), false);
    expect(mounted?.q('[data-testid="new-start-code"]')).not.toBeNull();
    mounted?.unmount();
    mount(fakeTeacher(), true);
    expect(mounted?.q('[data-testid="new-start-code"]')).toBeNull();
  });
});

describe('새 전시 만들기 — 서버 거절은 칸 아래', () => {
  it.each([
    ['E_PIN_TAKEN', 'new-pin-error'],
    ['E_PIN_WEAK', 'new-pin-error'],
  ] as const)('%s → PIN 칸 아래', async (code, where) => {
    mount(fakeTeacher({ createExhibition: vi.fn(async () => Promise.reject(new AppError(code))) }));
    fillForm();
    await submit();
    expect(mounted?.q(`[data-testid="${where}"]`)?.textContent).toBe(errorCopy[code]);
    expect(mounted?.location().path).toBe('/t/new');
  });

  it('E_START_CODE → 숨겨 둔 시작 코드 칸을 열고 그 아래', async () => {
    mount(
      fakeTeacher({ createExhibition: vi.fn(async () => Promise.reject(new AppError('E_START_CODE'))) }),
      true,
    );
    fillForm();
    await submit();
    expect(mounted?.q('[data-testid="new-start-code"]')).not.toBeNull();
    expect(mounted?.q('[data-testid="new-start-code-error"]')?.textContent).toBe(errorCopy.E_START_CODE);
  });

  it('E_VALIDATION은 서버가 가리킨 칸 아래, 모르는 칸이면 단추 아래', async () => {
    const createExhibition = vi
      .fn<TeacherApi['createExhibition']>()
      .mockRejectedValueOnce(new AppError('E_VALIDATION', { fields: { title: 'too_long' } }))
      .mockRejectedValueOnce(new AppError('E_VALIDATION', { fields: { _: 'json' } }));
    mount(fakeTeacher({ createExhibition }));
    fillForm();
    await submit();
    expect(mounted?.q('[data-testid="new-title-error"]')?.textContent).toBe(errorCopy.E_VALIDATION);
    await submit();
    expect(mounted?.q('[data-testid="new-form-error"]')?.textContent).toBe(errorCopy.E_VALIDATION);
  });
});

describe('새 전시 만들기 — 성공', () => {
  it('관리 화면으로 가며 "30일" 토스트를 넘기고, 다시 보내도 같은 전시 ID', async () => {
    const createExhibition = vi
      .fn<TeacherApi['createExhibition']>()
      .mockRejectedValueOnce(new AppError('E_OFFLINE'))
      .mockImplementation(created());
    const t = mount(fakeTeacher({ createExhibition }), false);
    fillForm();
    typeInto(input('new-start-code'), '7788');
    await submit();
    expect(mounted?.q('[data-testid="new-form-error"]')?.textContent).toBe(errorCopy.E_OFFLINE);
    await submit();

    expect(createExhibition).toHaveBeenCalledTimes(2);
    const [first] = createExhibition.mock.calls[0] ?? [];
    const [second] = createExhibition.mock.calls[1] ?? [];
    expect(second?.exhibitionId).toBe(first?.exhibitionId);
    expect(second).toMatchObject({
      title: T_TITLE_A,
      templateId: 'modern-history',
      pin: '583920',
      startCode: '7788',
      settings: { reactions: { enabled: true, stickerVisibility: 'TEACHER' }, tour: { timeMode: 'MUSIC' } },
    });
    expect(second).not.toHaveProperty('subtitle');
    const id = second?.exhibitionId ?? '';
    expect(mounted?.location()).toMatchObject({
      path: `/t/e/${id}`,
      state: { toast: fill(copy.teacher.create.createdToast, { days: config().EXHIBITION_TTL_DAYS }) },
    });
    expect(t.device.recentExhibitions().map(r => r.exhibitionId)).toEqual([id]);
  });

  it('학교·학급을 켜면 만든 뒤 고치기로 보낸다', async () => {
    const createExhibition = created();
    const exhibition = vi.fn<TeacherApi['exhibition']>(async id =>
      teacherView(teacherExhibition({ id, rev: 1 })),
    );
    const patchExhibition = vi.fn<TeacherApi['patchExhibition']>(async id =>
      teacherExhibition({ id, rev: 2 }),
    );
    mount(fakeTeacher({ createExhibition, exhibition, patchExhibition }));
    fillForm();
    click(mounted?.q('[data-testid="new-more"]') ?? null);
    const on = mounted?.all('[data-testid="new-school-toggle"] [role="radio"]')[0] ?? null;
    click(on);
    typeInto(input('new-school-name'), T_SCHOOL);
    typeInto(input('new-class-name'), T_CLASS);
    await submit();
    const id = createExhibition.mock.calls[0]?.[0].exhibitionId ?? '';
    expect(patchExhibition).toHaveBeenCalledWith(id, 1, {
      showSchool: true,
      schoolName: T_SCHOOL,
      className: T_CLASS,
    });
    expect(mounted?.location().path).toBe(`/t/e/${id}`);
  });
});
