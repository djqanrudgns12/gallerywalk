import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { createDeviceStore } from '../adapters/deviceStore.ts';
import { createTokenTools } from '../adapters/tokens.ts';
import { ServicesContext, type AppServices } from '../app/services.ts';
import { createVisitorPrefs } from '../app/student/visitorPrefs.ts';
import { ManageExhibition } from '../app/teacher/manage/ManageExhibition.tsx';
import type { TeacherApi } from '../ports/index.ts';
import { memoryStorage, unusedTeacherApi } from './studentFixtures.ts';
import { T_EX } from './teacherFixtures.ts';

/** 관리 화면 시험 도구(시험 파일에서만). `/t/e/{id}`에 관리 화면만 띄운다(StrictMode) */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

export const mountManage = (teacher: TeacherApi, exhibitionId: string = T_EX, navState?: unknown) => {
  const storage = memoryStorage();
  const device = createDeviceStore({ storage: () => storage });
  const services: AppServices = {
    api: {
      student: new Proxy({} as AppServices['api']['student'], {
        get: () => () => Promise.reject(new Error('x')),
      }),
      teacher: teacher ?? unusedTeacherApi(),
    },
    device,
    tokens: createTokenTools(),
    prefs: createVisitorPrefs(() => storage),
    userAgent: 'test',
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      // 앱(`main.tsx`)과 같이 StrictMode — 효과가 두 번 돌아도 올리기 줄이 살아 있어야 한다
      <StrictMode>
        <MemoryRouter initialEntries={[{ pathname: `/t/e/${exhibitionId}`, state: navState }]}>
          <ServicesContext value={services}>
            <Routes>
              <Route path="/t/e/:id" element={<ManageExhibition />} />
              <Route path="/t" element={<div data-testid="teacher-home" />} />
            </Routes>
          </ServicesContext>
        </MemoryRouter>
      </StrictMode>,
    );
  });
  const q = <E extends Element = HTMLElement>(sel: string): E | null => container.querySelector<E>(sel);
  return {
    container,
    device,
    q,
    all: <E extends Element = HTMLElement>(sel: string): E[] =>
      Array.from(container.querySelectorAll<E>(sel)),
    text: (): string => container.textContent ?? '',
    unmount: (): void => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

/** 약속·타이머(0ms)가 끝날 때까지 몇 번 돌린다 */
export const flush = async (times = 6): Promise<void> => {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
};

/** 실제 시간으로 기다린다(자동 저장 0.6초 등) */
export const wait = async (ms: number): Promise<void> => {
  await act(async () => {
    await new Promise(r => setTimeout(r, ms));
  });
  await flush();
};

/** React가 알아채는 방식으로 입력 칸 값을 바꾼다 */
export const typeInto = (el: HTMLInputElement | HTMLTextAreaElement | null, value: string): void => {
  if (!el) throw new Error('typeInto: element not found');
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

export const click = (el: Element | null, init: MouseEventInit = {}): void => {
  if (!el) throw new Error('click: element not found');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  });
};

export const key = (el: Element | null, keyName: string, init: KeyboardEventInit = {}): void => {
  if (!el) throw new Error('key: element not found');
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init }),
    );
  });
};

export const blur = (el: HTMLElement | null): void => {
  if (!el) throw new Error('blur: element not found');
  act(() => {
    el.focus();
    el.blur();
  });
};

export const buttonByText = (root: ParentNode, text: string): HTMLButtonElement | null =>
  Array.from(root.querySelectorAll('button')).find(b => b.textContent?.trim() === text) ?? null;

/** 파일 고르기 칸에 파일을 넣고 change */
export const pickFiles = (input: HTMLInputElement | null, files: readonly File[]): void => {
  if (!input) throw new Error('pickFiles: input not found');
  const list = Object.assign([...files], { item: (i: number) => files[i] ?? null }) as unknown as FileList;
  Object.defineProperty(input, 'files', { configurable: true, get: () => list });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
