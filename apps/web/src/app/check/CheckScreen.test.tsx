import { copy } from '@gallery/core/copy';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesContext } from '../services.ts';
import { buttonByText, click, flushUntil, makeServices, mountAt } from '../student/testDom.tsx';
import type { CheckEnv } from './browserDeps.ts';
import { CheckScreen } from './CheckScreen.tsx';
import { fakeDeps } from './testFakes.ts';

const t = copy.check;

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** 가짜 망·소켓·글 복사로 점검 화면만 그린다(실제 시계 — 가짜 망이 수백 ms 안에 답한다) */
const mountScreen = (writeClipboard: (text: string) => Promise<void>) => {
  const env: CheckEnv = {
    deps: fakeDeps().deps,
    host: 'gallery.test',
    device: 'Android tablet',
    clock: () => Date.UTC(2026, 10, 13, 0, 5),
    writeClipboard,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/check']}>
        <ServicesContext value={makeServices().services}>
          <CheckScreen env={() => env} />
        </ServicesContext>
      </MemoryRouter>,
    );
  });
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { q: <E extends Element = HTMLElement>(sel: string): E | null => container.querySelector<E>(sel) };
};

const runToEnd = async (m: ReturnType<typeof mountScreen>) => {
  click(m.q('[data-testid="check-start"]'));
  expect(m.q('[data-testid="check-steps"]')?.getAttribute('aria-busy')).toBe('true');
  expect(await flushUntil(() => m.q('[data-testid="check-summary"]') !== null, 5000)).toBe(true);
};

describe('학교망 점검 화면 `/check`', () => {
  it('지연 로드로 열리고, 단계 8개가 기다려요로 시작한다(학생 첫 화면 없음)', async () => {
    const m = mountAt('/check', makeServices().services);
    cleanups.push(m.unmount);
    expect(await flushUntil(() => m.q('[data-testid="check-screen"]') !== null)).toBe(true);
    expect(m.q('h1')?.textContent).toBe(t.title);
    expect(m.q('[data-testid="check-start"]')?.textContent).toBe(t.start);
    const steps = Array.from(m.container.querySelectorAll('[data-testid="check-step"]'));
    expect(steps).toHaveLength(Object.keys(t.steps).length);
    for (const step of steps) expect(step.getAttribute('data-state')).toBe('waiting');
    expect(m.q('[data-testid="check-summary"]')).toBeNull();
    expect(m.q('[data-testid="entry-home"]')).toBeNull();
    expect(m.text()).toContain(t.privacyNote);
  });

  it('점검을 마치면 결과 한 줄·자세히(기술 이름)를 보이고, 결과 복사하기는 요청 글을 복사한다', async () => {
    const writes: string[] = [];
    const m = mountScreen(async text => {
      writes.push(text);
    });
    await runToEnd(m);
    expect(m.q('[data-testid="check-summary"]')?.textContent).toBe(t.summary.ok);
    const states = Array.from(document.querySelectorAll('[data-testid="check-step"]')).map(s =>
      s.getAttribute('data-state'),
    );
    // 입장 코드를 적지 않아 ⑤만 건너뜀
    expect(states).toEqual(['ok', 'ok', 'ok', 'ok', 'skip', 'ok', 'ok', 'ok']);
    expect(m.q('[data-testid="check-start"]')?.textContent).toBe(t.again);
    const details = m.q<HTMLDetailsElement>('[data-testid="check-details"]');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe(t.details);
    expect(details?.textContent).toContain('GET /api/health -> HTTP 200');

    click(buttonByText(document.body, t.copy));
    expect(await flushUntil(() => m.q('[data-testid="check-copied"]') !== null)).toBe(true);
    expect(m.q('[data-testid="check-copied"]')?.textContent).toBe(t.copied);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain(t.request[0]);
    expect(writes[0]).toContain('https://gallery.test');
    expect(writes[0]).toContain('Android tablet');
    expect(m.q('[data-testid="check-request"]')).toBeNull();
  });

  it('복사하지 못하면 안내와 함께 길게 눌러 복사할 글 상자를 보인다', async () => {
    const write = vi.fn(async () => {
      throw new Error('denied');
    });
    const m = mountScreen(write);
    await runToEnd(m);
    click(m.q('[data-testid="check-copy"]'));
    expect(await flushUntil(() => m.q('[data-testid="check-copy-failed"]') !== null)).toBe(true);
    expect(m.q('[data-testid="check-copy-failed"]')?.textContent).toBe(t.copyFailed);
    const box = m.q<HTMLTextAreaElement>('[data-testid="check-request"]');
    expect(box?.readOnly).toBe(true);
    expect(box?.value).toContain('https://gallery.test');
    expect(box?.value).toContain(`1. ${t.steps.server}: ${t.state.ok}`);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('`학교망 점검` 링크 자리', () => {
  it('선생님 첫 화면 아래에 있고 /check로 간다', async () => {
    const m = mountAt('/t', makeServices().services);
    cleanups.push(m.unmount);
    await flushUntil(() => m.q('[data-testid="teacher-home"]') !== null);
    const link = m.q<HTMLAnchorElement>('[data-testid="teacher-home"] [data-testid="check-link"]');
    expect(link?.getAttribute('href')).toBe('/check');
    expect(link?.textContent).toBe(t.link);
    click(link);
    expect(await flushUntil(() => m.q('[data-testid="check-screen"]') !== null)).toBe(true);
  });

  it('학생 첫 화면에는 없다', () => {
    const m = mountAt('/', makeServices().services);
    cleanups.push(m.unmount);
    expect(m.q('[data-testid="entry-home"]')).not.toBeNull();
    expect(m.q('[data-testid="check-link"]')).toBeNull();
  });
});
