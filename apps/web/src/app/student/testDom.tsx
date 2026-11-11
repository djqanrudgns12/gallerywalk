import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { createDeviceStore } from '../../adapters/deviceStore.ts';
import { createTokenTools } from '../../adapters/tokens.ts';
import { AppRoutes } from '../App.tsx';
import { ServicesContext, type AppServices } from '../services.ts';
import {
  fakeStudentApi,
  memoryStorage,
  unusedTeacherApi,
  type FakeStudentOptions,
} from '../../dev/studentFixtures.ts';
import { createVisitorPrefs } from './visitorPrefs.ts';

/** 화면 시험 도구(시험 파일에서만 가져온다). 관람 화면은 각 시험 파일이 `vi.mock`으로 바꿔 끼운다. */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

export const SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export const KAKAO_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5';

export const makeServices = (
  extra: Omit<FakeStudentOptions, 'device' | 'tokens'> = {},
  userAgent: string = SAFARI_UA,
) => {
  const storage = memoryStorage();
  const device = createDeviceStore({ storage: () => storage });
  const tokens = createTokenTools();
  const fake = fakeStudentApi({ device, tokens, ...extra });
  const services: AppServices = {
    api: { student: fake.student, teacher: unusedTeacherApi() },
    device,
    tokens,
    prefs: createVisitorPrefs(() => storage),
    userAgent,
  };
  return { services, ...fake, device, tokens };
};

export const mountAt = (path: string, services: AppServices) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <ServicesContext value={services}>
          <AppRoutes />
        </ServicesContext>
      </MemoryRouter>,
    );
  });
  return {
    container,
    q: <E extends Element = HTMLElement>(sel: string): E | null => container.querySelector<E>(sel),
    text: (): string => container.textContent ?? '',
    unmount: (): void => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

/** 약속·지연 로드가 끝날 때까지 몇 번 돌린다 */
export const flush = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
};

/** React가 알아채는 방식으로 입력 칸 값을 바꾼다 */
export const typeInto = (el: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

export const click = (el: HTMLElement | null): void => {
  if (!el) throw new Error('click: element not found');
  act(() => {
    el.click();
  });
};

/** 글자로 단추 찾기 */
export const buttonByText = (root: ParentNode, text: string): HTMLButtonElement | null =>
  Array.from(root.querySelectorAll('button')).find(b => b.textContent?.trim() === text) ?? null;
