import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { copy, fill } from '../../packages/core/src/copy/ko.ts';
import type { ExhibitionView } from '../../packages/core/src/types/exhibition.ts';
import {
  closeStudentExhibition,
  createDraftExhibition,
  readStudentExhibition,
  seedStudentExhibition,
  type SeededExhibition,
} from './support/exhibition.ts';

/** P4-12: 실제 개발 API·WebGL·DOM 조작으로 학생 입장부터 출구까지 확인한다. */
const SIZES = [
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'desktop', width: 1440, height: 900, touch: false },
] as const;
const SHOTS = '.local/screens/p4-12';
const READY_TIMEOUT = 60_000;
const WALK_TIMEOUT = 90_000;
const IDLE_OBSERVATION_MS = 10_000;
const CounterSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative());
const PerfSchema = z.object({
  frames: CounterSchema,
  mark: CounterSchema,
  calls: CounterSchema,
  triangles: CounterSchema,
  stop: CounterSchema,
  mode: z.enum(['free', 'guiding', 'view', 'zoom']),
});

let seed: SeededExhibition;
let view: ExhibitionView;

// 방문자 등록 본문·응답과 localStorage에도 토큰이 있어 이 spec의 자동 기록을 끈다.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
// 안내 걷기는 광장부터 각 정지 지점을 실제로 이동한다. 소프트웨어 그리기에서도 전 과정을 기다린다.
test.setTimeout(480_000);

/** 함께 작업하는 개발 서버의 HMR 연결을 이 시험 페이지에서만 받지 않는다. */
const keepPageVersion = (page: Page): Promise<void> =>
  page.routeWebSocket(
    url => url.port === '4522' && url.pathname === '/',
    () => {},
  );

const capture = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' });

test.beforeEach(async ({ page }) => {
  await keepPageVersion(page);
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  if ((await page.getByTestId('walk-perf').count()) === 1) {
    console.log('관람 상태', await snap(page));
  }
  await capture(page, `failure-${page.viewportSize()?.width ?? 'unknown'}`);
});

test.beforeAll(async () => {
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  seed = await seedStudentExhibition();
  view = await readStudentExhibition(seed.entryCode);
  expect(view.rooms).toHaveLength(2);
  expect(view.artworks.filter(art => art.kind === 'IMAGE')).toHaveLength(6);
  expect(view.artworks.filter(art => art.kind === 'TEXT')).toHaveLength(1);
});

const snap = async (page: Page) => {
  const values = await page.getByTestId('walk-perf').evaluate(el => ({
    frames: el.getAttribute('data-frames'),
    mark: el.getAttribute('data-idle-mark'),
    calls: el.getAttribute('data-calls'),
    triangles: el.getAttribute('data-triangles'),
    stop: el.getAttribute('data-stop'),
    mode: el.getAttribute('data-mode'),
  }));
  return PerfSchema.parse(values);
};

/** 두 번 읽은 값이 같고 멈춘 순간의 표시와도 같을 때까지 기다린다. */
async function settle(page: Page): Promise<z.infer<typeof PerfSchema>> {
  let previous = -1;
  await expect
    .poll(
      async () => {
        const state = await snap(page);
        const idle = state.frames > 0 && state.frames === previous && state.mark === state.frames;
        previous = state.frames;
        return idle;
      },
      { timeout: 30_000, intervals: [400] },
    )
    .toBe(true);
  return snap(page);
}

async function expectEntered(page: Page): Promise<void> {
  await expect(page.getByTestId('visit-screen')).toHaveAttribute('data-entered', '1');
  await expect(page.getByTestId('entry-poster')).toBeHidden();
  await expect(page.getByTestId('consent-sheet')).toBeHidden();
  await expect(page.getByTestId('walk-nav')).toBeVisible();
}

async function walkTo(page: Page, index: number): Promise<void> {
  await page.getByTestId('walk-nav').getByRole('button', { name: copy.viewer.nextArtwork }).click();
  await expect(page.getByTestId('walk-perf')).toHaveAttribute('data-stop', String(index));
  await expect(page.getByTestId('walk-perf')).toHaveAttribute('data-mode', 'view', {
    timeout: WALK_TIMEOUT,
  });
  await expect(page.getByTestId('walk-nav')).toContainText(
    fill(copy.viewer.pageOf, { page: index + 1, total: view.layout.stops.length }),
  );
}

for (const size of SIZES) {
  test.describe(`학생 흐름 · ${size.name} ${size.width}×${size.height}`, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      screen: { width: size.width, height: size.height },
      hasTouch: size.touch,
    });

    test('코드 → 준비 → 별명·동의 → 안내 걷기 → 크게 보기 → 정지 → 출구', async ({ page }) => {
      // 실제 GLB 요청을 잠시 기다리게 해서 준비 전 상태를 관측한다.
      // Vite의 ?import&url 모듈은 통과시켜 관람 화면 코드가 먼저 붙게 한다.
      let release!: () => void;
      let heldRequests = 0;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      await page.route(
        url =>
          url.pathname.endsWith('.glb') && !url.searchParams.has('import') && !url.searchParams.has('url'),
        async route => {
          heldRequests++;
          await gate;
          await route.continue();
        },
      );
      try {
        await page.goto('/');
        await expect(page.getByTestId('entry-home')).toBeVisible();
        await capture(page, `${size.name}-01-home`);
        await page.getByRole('textbox', { name: fill(copy.entry.codeLabel, { n: 6 }) }).fill(seed.entryCode);
        await expect(page).toHaveURL(`/${seed.entryCode}`);
        await expect(page.getByTestId('entry-poster')).toBeVisible();
        await expect.poll(() => heldRequests, { timeout: READY_TIMEOUT }).toBeGreaterThan(0);
        await expect(page.getByTestId('visit-screen')).toHaveAttribute('data-ready', '0');
        await expect(page.getByTestId('enter-plaza-btn')).toBeDisabled();
        await expect(page.getByRole('progressbar', { name: copy.poster.preparing })).toBeVisible();
        await capture(page, `${size.name}-02-preparing`);
      } finally {
        release();
      }

      await expect(page.getByTestId('visit-screen')).toHaveAttribute('data-ready', '1', {
        timeout: READY_TIMEOUT,
      });
      const poster = page.getByTestId('entry-poster');
      await expect(page.getByTestId('enter-plaza-btn')).toBeEnabled();
      await expect(page.getByTestId('prepare-progress')).toBeHidden();
      await poster.getByRole('textbox', { name: copy.poster.nicknameLabel }).fill('상상고래');
      await poster.getByRole('radio', { name: copy.poster.studentFemale }).click();
      await expect(poster.getByTestId('char-student-f')).toHaveAttribute('aria-checked', 'true');
      await expect(poster.getByTestId('char-student-m')).toHaveAttribute('aria-checked', 'false');
      await capture(page, `${size.name}-03-poster`);
      await page.getByTestId('enter-plaza-btn').click();

      const consent = page.getByRole('dialog', { name: copy.consent.titleEnter });
      await expect(consent).toBeVisible();
      await expect(page.getByTestId('visit-screen')).toHaveAttribute('data-entered', '0');
      await expect(consent.getByRole('button', { name: copy.consent.start })).toBeDisabled();
      await expect(consent.getByRole('checkbox', { name: copy.consent.agree })).not.toBeChecked();
      await capture(page, `${size.name}-04-consent`);
      await consent.getByRole('checkbox', { name: copy.consent.agree }).check();
      await expect(consent.getByRole('button', { name: copy.consent.start })).toBeEnabled();
      await consent.getByRole('button', { name: copy.consent.start }).click();
      await expectEntered(page);
      await expect(page.getByTestId('top-bar')).toContainText(copy.live.alone);
      await capture(page, `${size.name}-05-plaza`);

      const firstArtwork = view.layout.stops.findIndex(stop => stop.kind === 'artwork');
      expect(firstArtwork).toBeGreaterThan(0);
      for (let index = 1; index <= firstArtwork; index++) await walkTo(page, index);
      await expect(page.getByTestId('near-card')).toBeVisible();
      const artworkId = view.layout.stops[firstArtwork]?.artworkId;
      const artwork = view.artworks.find(art => art.id === artworkId);
      expect(artwork).toBeDefined();
      const room = view.rooms.find(candidate => candidate.id === artwork!.roomId);
      expect(room).toBeDefined();
      await expect(page.getByTestId('place')).toHaveText(room!.title);
      await expect(page.getByTestId('near-card')).toContainText(artwork!.title);
      await settle(page);
      await capture(page, `${size.name}-06-artwork`);

      await page.getByTestId('near-card').getByRole('button', { name: copy.viewer.zoomIn }).click();
      await expect(page.getByTestId('walk-perf')).toHaveAttribute('data-mode', 'zoom');
      const caption = page.getByRole('dialog', { name: artwork!.title, exact: true });
      await expect(caption).toBeVisible();
      await expect(caption).toContainText(artwork!.title);
      await settle(page);
      await capture(page, `${size.name}-07-zoom`);
      await caption.getByRole('button', { name: copy.viewer.close, exact: true }).click();
      await expect(caption).toBeHidden();
      await expect(page.getByTestId('walk-perf')).toHaveAttribute('data-mode', 'view');

      const idle = await settle(page);
      expect(idle.frames).toBe(idle.mark);
      await page.waitForTimeout(IDLE_OBSERVATION_MS);
      const after = await snap(page);
      expect(after.frames).toBe(idle.frames);
      expect(after.mark).toBe(idle.mark);

      const exitIndex = view.layout.stops.findIndex(stop => stop.kind === 'exit');
      expect(exitIndex).toBeGreaterThan(firstArtwork);
      for (let index = firstArtwork + 1; index <= exitIndex; index++) await walkTo(page, index);
      const exit = page.getByTestId('exit-panel');
      await expect(exit).toBeVisible();
      await expect(exit).toContainText(copy.viewer.exitThanks);
      await expect(exit).toContainText(fill(copy.viewer.exitCount, { n: view.artworks.length }));
      await expect(exit.getByRole('button', { name: copy.viewer.restart })).toBeVisible();
      await settle(page);
      await capture(page, `${size.name}-08-exit`);
      await exit.getByRole('button', { name: copy.closed.home, exact: true }).click();
      await expect(page).toHaveURL('/');
      await expect(page.getByTestId('entry-home')).toBeVisible();
    });
  });
}

test.describe('학생 상태 · desktop 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false });

  test('별명 없이 동의 시트를 건너뛰고, 다른 맥락의 관람객과 함께 관람 2명', async ({ page, browser }) => {
    await page.goto(`/${seed.entryCode}`);
    await expect(page.getByTestId('enter-plaza-btn')).toBeEnabled({ timeout: READY_TIMEOUT });
    await expect(page.getByRole('textbox', { name: copy.poster.nicknameLabel })).toHaveValue('');
    let consentSeen = false;
    await page.exposeFunction('studentConsentAppeared', () => {
      consentSeen = true;
    });
    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-testid="consent-sheet"]')) {
          void (
            window as unknown as { studentConsentAppeared: () => Promise<void> }
          ).studentConsentAppeared();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await page.getByTestId('enter-plaza-btn').click();
    await expectEntered(page);
    expect(consentSeen).toBe(false);
    await expect(page.getByTestId('top-bar')).toContainText(copy.live.alone);

    const peerContext = await browser.newContext({
      baseURL: 'http://127.0.0.1:4522',
      viewport: { width: 1440, height: 900 },
      hasTouch: false,
    });
    try {
      const peer = await peerContext.newPage();
      await keepPageVersion(peer);
      await peer.goto(`/${seed.entryCode}`);
      await expect(peer.getByTestId('enter-plaza-btn')).toBeEnabled({ timeout: READY_TIMEOUT });
      await peer.getByTestId('enter-plaza-btn').click();
      await expectEntered(peer);
      const label = fill(copy.viewer.liveCount, { n: 2 });
      await expect(page.getByTestId('top-bar')).toContainText(label);
      await expect(peer.getByTestId('top-bar')).toContainText(label);
      await capture(page, 'desktop-09-together');
    } finally {
      await peerContext.close();
    }
  });

  test('막 내린 전시는 안내와 처음으로를 보여 준다', async ({ page }) => {
    await closeStudentExhibition(seed);
    await page.goto(`/${seed.entryCode}`);
    await expect(page.getByRole('heading', { name: copy.closed.title, exact: true })).toBeVisible();
    await capture(page, 'desktop-10-closed');
    await page.getByRole('button', { name: copy.closed.home, exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('entry-home')).toBeVisible();
  });

  test('DRAFT 전시는 준비 중 안내와 처음으로를 보여 준다', async ({ page }) => {
    const code = await createDraftExhibition();
    await page.goto(`/${code}`);
    await expect(page.getByRole('heading', { name: copy.closed.draft, exact: true })).toBeVisible();
    await capture(page, 'desktop-11-draft');
    await page.getByRole('button', { name: copy.closed.home, exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('entry-home')).toBeVisible();
  });
});
