import { expect, test as base, type Page } from '@playwright/test';
import { config } from '../../packages/core/src/config.ts';
import { copy, fill } from '../../packages/core/src/copy/ko.ts';
import { EntryCodeSchema, UuidSchema } from '../../packages/core/src/types/common.ts';
import { readStudentExhibition } from './support/exhibition.ts';
import {
  captureTeacher,
  createTeacherExhibition,
  enterTeacherPin,
  keepTeacherPageVersion,
  TEACHER_READY_MS,
  uploadTeacherArtworks,
  type TeacherExhibition,
} from './support/teacher.ts';

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const WALK_MS = 90_000;
const OBSERVE_MS = 3_000;

const test = base.extend<object, { secondary: TeacherExhibition }>({
  secondary: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4522', viewport: DESKTOP });
      let exhibition: TeacherExhibition;
      try {
        const page = await context.newPage();
        await keepTeacherPageVersion(page);
        exhibition = await createTeacherExhibition(page, '다른 기기 합성 전시');
        await uploadTeacherArtworks(page);
      } finally {
        await context.close();
      }
      await use(exhibition);
    },
    { scope: 'worker', timeout: 180_000 },
  ],
});

// 교사·방문자 토큰과 PIN이 요청·기기 저장에 들어간다. 자동 추적·영상·캡처는 모두 끈다.
test.use({ viewport: DESKTOP, trace: 'off', video: 'off', screenshot: 'off' });
test.setTimeout(360_000);

test.beforeEach(async ({ page }) => {
  await keepTeacherPageVersion(page);
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    await captureTeacher(page, `failure-${info.title.includes('휴대폰') ? 'phone' : 'desktop'}`);
  }
});

async function expectClosedForStudent(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByRole('heading', { name: copy.closed.title, exact: true })).toBeVisible();
  await expect(page.getByTestId('enter-plaza-btn')).toHaveCount(0);
}

test('데스크톱 · 만들기 → 그림·제목 → 열기 → 학생 반응 → 숨기기 → 닫기·삭제', async ({ page, browser }) => {
  const exhibition = await createTeacherExhibition(page, '교사 흐름 합성 전시');
  await captureTeacher(page, 'desktop-01-created');
  await uploadTeacherArtworks(page);
  await captureTeacher(page, 'desktop-02-uploaded');

  // 글 붙여넣기(V-01, PRD G-10·15.3-5): 놓기 띠 아래 링크 → 시트 → 같은 올리기 줄 → 격자 끝에 글 카드
  await page.getByTestId('paste-open').click();
  const paste = page.getByTestId('paste-sheet');
  await expect(paste).toBeVisible();
  await paste.getByTestId('paste-title').fill('가상 감상 글');
  await paste.getByTestId('paste-body').fill('첫째 줄 가상 감상\n둘째 줄 가상 감상');
  await paste.getByTestId('paste-save').click();
  await expect(paste).toHaveCount(0);
  await expect(page.getByTestId('upload-row')).toHaveCount(3);
  await expect(page.getByTestId('upload-row').nth(2)).toHaveAttribute('data-phase', 'done', {
    timeout: TEACHER_READY_MS,
  });
  await expect(page.getByTestId('cell-2').locator('[data-form="TEXTCARD"]')).toHaveCount(1);
  await expect(page.getByTestId('cell-2').getByRole('heading')).toHaveText('가상 감상 글');

  const card = page.getByTestId('cell-0');
  const artworkId = UuidSchema.parse(await card.getAttribute('data-cell-id'));
  const title = '다시 만난 상상의 산';
  await card.getByRole('heading').click();
  const input = card.getByTestId('inline-title');
  const renamed = page.waitForResponse(
    response =>
      new URL(response.url()).pathname.endsWith(`/artworks/${artworkId}`) &&
      response.request().method() === 'PATCH',
  );
  const typedAt = Date.now();
  await input.fill(title);
  await expect(input.locator('xpath=../..')).toHaveAttribute('data-save-state', 'pending');
  const saved = await renamed;
  expect(saved.status()).toBe(200);
  expect(Date.now() - typedAt).toBeGreaterThanOrEqual(config().AUTOSAVE_DELAY_MS);
  await expect(input).toBeFocused();
  await expect(input.locator('xpath=../..')).toHaveAttribute('data-save-state', 'idle');
  await page.reload();
  await expect(page.getByTestId('teacher-manage')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('cell-0').getByRole('heading')).toHaveText(title);
  await captureTeacher(page, 'desktop-03-renamed');

  await page.getByRole('button', { name: copy.teacher.manage.open, exact: true }).click();
  const open = page.getByTestId('open-sheet');
  await expect(open).toBeVisible();
  await open.getByRole('button', { name: copy.teacher.open.open, exact: true }).click();
  await expect(page.getByTestId('exhibition-status')).toHaveAttribute('data-status', 'OPEN');
  await expect(open.getByTestId('qr-code')).toBeVisible();
  await expect(open.locator('[data-testid="qr-code"] svg path')).toHaveAttribute('d', /M/);
  await expect(open.getByTestId('entry-code')).toBeVisible();
  await expect(open.getByTestId('entry-code')).toHaveText(/^\d{6}$/);
  const code = EntryCodeSchema.parse(await open.getByTestId('entry-code').textContent());
  await expect(open.getByTestId('short-url')).toContainText(code);
  await captureTeacher(page, 'desktop-04-open-qr');
  await open.getByRole('button', { name: copy.viewer.close, exact: true }).click();

  const studentContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:4522',
    viewport: DESKTOP,
    hasTouch: false,
  });
  try {
    const student = await studentContext.newPage();
    await keepTeacherPageVersion(student);
    await student.goto('/');
    await student.getByRole('textbox', { name: fill(copy.entry.codeLabel, { n: 6 }) }).fill(code);
    await expect(student).toHaveURL(`/${code}`);
    await expect(student.getByTestId('entry-poster')).toBeVisible();
    await expect(student.getByRole('textbox', { name: copy.poster.nicknameLabel })).toHaveValue('');
    await expect(student.getByTestId('enter-plaza-btn')).toBeEnabled({ timeout: TEACHER_READY_MS });
    await student.getByTestId('enter-plaza-btn').click();
    await expect(student.getByTestId('visit-screen')).toHaveAttribute('data-entered', '1');
    await expect(student.getByTestId('consent-sheet')).toHaveCount(0);
    const view = await readStudentExhibition(code);
    const first = view.layout.stops.findIndex(stop => stop.kind === 'artwork');
    expect(first).toBeGreaterThan(0);
    expect(view.layout.stops[first]?.artworkId).toBe(artworkId);
    for (let index = 1; index <= first; index++) {
      await student.getByTestId('walk-nav').getByRole('button', { name: copy.viewer.nextArtwork }).click();
      await expect(student.getByTestId('walk-perf')).toHaveAttribute('data-stop', String(index));
      await expect(student.getByTestId('walk-perf')).toHaveAttribute('data-mode', 'view', {
        timeout: WALK_MS,
      });
    }
    await student.getByTestId('near-card').getByRole('button', { name: copy.viewer.zoomIn }).click();
    const caption = student.getByRole('dialog', { name: title, exact: true });
    await expect(caption).toBeVisible();
    await caption.getByRole('button', { name: copy.viewer.react, exact: true }).click();
    // 별명 없이 입장한 관람객은 첫 반응에서 동의를 확인한다(기본 별명 방식).
    const consent = student.getByTestId('reaction-consent');
    await expect(consent).toBeVisible();
    await consent.getByRole('textbox', { name: copy.consent.nickname }).fill('상상관람객');
    await consent.getByRole('checkbox', { name: copy.consent.agree }).check();
    await consent.getByRole('button', { name: copy.consent.start, exact: true }).click();
    const reaction = student.getByTestId('reaction-sheet');
    await expect(reaction).toBeVisible();
    await reaction.getByRole('button', { name: copy.reaction.stickers.GREAT, exact: true }).click();
    const memo = '산의 색이 따뜻해서 오래 보고 싶어요';
    await reaction.getByRole('textbox', { name: copy.reaction.memoLabel }).fill(memo);
    const submitted = student.waitForResponse(
      response =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname.endsWith(`/reactions/${artworkId}`),
    );
    await reaction.getByRole('button', { name: copy.reaction.submit, exact: true }).click();
    expect((await submitted).status()).toBe(200);
    await expect(reaction).toBeHidden();
    await captureTeacher(student, 'desktop-05-student-reaction');

    await page.getByRole('tab', { name: copy.teacher.manage.tabReactions, exact: true }).click();
    const row = page.getByTestId('reaction-row').filter({ hasText: title });
    await expect(row).toHaveAttribute('data-id', artworkId);
    await expect(row.locator('[data-sticker="GREAT"]')).toHaveAttribute('data-count', '1');
    await expect(row.locator('[data-sticker]:not([data-sticker="GREAT"])')).toHaveCount(3);
    for (const other of await row.locator('[data-sticker]:not([data-sticker="GREAT"])').all()) {
      await expect(other).toHaveAttribute('data-count', '0');
    }
    await expect(row.locator('[data-stat="memo"]')).toHaveText(
      fill(copy.teacher.reactionsTab.memoCount, { n: 1 }),
    );
    await row.getByRole('button', { expanded: false }).click();
    const savedMemo = row.getByTestId('memo');
    await expect(savedMemo).toHaveCount(1);
    await expect(savedMemo).toContainText(memo);
    await savedMemo.getByRole('button', { name: copy.teacher.reactionsTab.hide, exact: true }).click();
    await expect(savedMemo).toHaveAttribute('data-hidden', '1');
    await expect(savedMemo.getByTestId('memo-hide')).toHaveText(copy.teacher.reactionsTab.unhide);
    await captureTeacher(page, 'desktop-06-hidden-memo');

    // 열린 전시의 3D 미리 보기는 함께 관람에 "선생님"으로 들어간다(PRD 15.8, V-05) — 학생 화면 인원이 늘었다 준다
    await page.getByTestId('open-preview').click();
    await expect(page.getByTestId('preview-layer').getByTestId('visit-screen')).toHaveAttribute(
      'data-ready',
      '1',
      {
        timeout: TEACHER_READY_MS,
      },
    );
    await expect(student.getByTestId('live-count')).toHaveAccessibleName(
      fill(copy.viewer.liveCount, { n: 2 }),
      {
        timeout: 15_000,
      },
    );
    await page.getByTestId('preview-layer').getByTestId('overlay-close').click();
    // 선생님이 나가면 다시 혼자 — 인원 표시가 사라진다(V-54)
    await expect(student.getByTestId('live-count')).toHaveCount(0, { timeout: 15_000 });

    await page.getByTestId('manage-menu-trigger').click();
    await page.getByRole('menuitem', { name: copy.teacher.menu.close, exact: true }).click();
    await expect(page.getByTestId('exhibition-status')).toHaveAttribute('data-status', 'CLOSED');
    await expectClosedForStudent(student);
    await captureTeacher(student, 'desktop-07-closed');
  } finally {
    await studentContext.close();
  }

  await page.getByTestId('manage-menu-trigger').click();
  const lockedAt = Date.now();
  await page.getByRole('menuitem', { name: copy.teacher.menu.deleteNow, exact: true }).click();
  const confirm = page.getByTestId('delete-confirm');
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText(fill(copy.teacher.menu.deleteWait, { n: config().DELETE_CONFIRM_SEC }));
  // 마지막 대기 초에도 잠겨 있는지 관측하고 실제로 풀리는 시각을 확인한다.
  await expect(confirm).toHaveText(fill(copy.teacher.menu.deleteWait, { n: 1 }));
  await expect(confirm).toBeDisabled();
  await expect(confirm).toBeEnabled();
  expect(Date.now() - lockedAt).toBeGreaterThanOrEqual(config().DELETE_CONFIRM_SEC * 1000);
  await captureTeacher(page, 'desktop-08-delete-confirm');
  await confirm.click();
  await expect(page).toHaveURL('/t');
  await expect(page.getByTestId('teacher-home')).toBeVisible();
  await expect(page.getByTestId('recent-card').filter({ hasText: exhibition.title })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('recent-empty')).toBeVisible();
  await captureTeacher(page, 'desktop-09-deleted');
});

test('휴대폰 · 다른 전시 PIN 재입장 → 2열 격자 → 작품 아래 시트', async ({ browser, secondary }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4522',
    viewport: PHONE,
    screen: PHONE,
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await keepTeacherPageVersion(page);
    await enterTeacherPin(page, secondary);
    const board = page.getByTestId('artwork-board');
    await expect(board.locator('article')).toHaveCount(2);
    const columns = await board.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' '));
    expect(columns).toHaveLength(2);
    const left = await page.getByTestId('cell-0').boundingBox();
    const right = await page.getByTestId('cell-1').boundingBox();
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(right!.x).toBeGreaterThanOrEqual(left!.x + left!.width);
    expect(right!.y).toBe(left!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(PHONE.width);
    await captureTeacher(page, 'phone-01-grid');
    await page.getByTestId('cell-0').locator('img').tap();
    await expect(page.getByTestId('artwork-panel')).toBeVisible();
    const side = page.getByTestId('manage-side');
    await expect(side).toHaveCSS('position', 'fixed');
    const sheet = await side.boundingBox();
    expect(sheet).not.toBeNull();
    expect(sheet!.x).toBe(0);
    expect(sheet!.width).toBe(PHONE.width);
    expect(sheet!.y).toBeGreaterThan(0);
    expect(sheet!.y + sheet!.height).toBeCloseTo(PHONE.height, 0);
    await captureTeacher(page, 'phone-02-artwork-sheet');
    await page.getByTestId('artwork-panel').getByRole('button', { name: copy.teacher.panel.close }).tap();
    await expect(page.getByTestId('artwork-panel')).toBeHidden();
  } catch (error) {
    const phonePage = context.pages()[0];
    if (phonePage) await captureTeacher(phonePage, 'phone-failure');
    throw error;
  } finally {
    await context.close();
  }
});

test('자동 투어 · 게시 작품 재생 → 진행 증가 → 멈춤 유지 → 관리 화면', async ({ page, secondary }) => {
  // 새 데스크톱 기기는 같은 PIN 키패드에 숫자 키보드로 들어간다.
  await page.goto('/t');
  await page.getByTestId('pin-open').click();
  try {
    await page.keyboard.type(secondary.pin);
    await page.getByTestId('pin-submit').click();
    await expect(page).toHaveURL(`/t/e/${secondary.id}`);
  } catch {
    throw new Error('자동 투어 준비 중 PIN 재입장 실패. 원본 호출 로그는 기록하지 않습니다.');
  }
  await page.goto(`/t/e/${secondary.id}/tour`);
  const start = page.getByRole('button', { name: copy.tour.start, exact: true });
  await expect(start).toBeVisible({ timeout: TEACHER_READY_MS });
  await captureTeacher(page, 'tour-01-ready');
  await start.click();
  const progress = page.getByRole('slider', { name: copy.tour.progress });
  await expect(progress).toBeVisible();
  const before = Number(await progress.inputValue());
  await expect
    .poll(async () => Number(await progress.inputValue()), { timeout: 15_000 })
    .toBeGreaterThan(before);
  await page.getByTestId('tour-toggle').click();
  await expect(page.getByTestId('tour-toggle')).toHaveAccessibleName(copy.tour.play);
  const paused = await progress.inputValue();
  await page.waitForTimeout(OBSERVE_MS);
  await expect(progress).toHaveValue(paused);
  await captureTeacher(page, 'tour-02-paused');
  await page.getByRole('button', { name: copy.tour.exit, exact: true }).click();
  await expect(page).toHaveURL(`/t/e/${secondary.id}`);
  await expect(page.getByTestId('teacher-manage')).toHaveAttribute('data-state', 'ready');
  await captureTeacher(page, 'tour-03-returned');
});

test('3D 미리 보기 · 열기 → 첫 작품까지 안내 걷기 → 작품을 누르면 그 작품 패널 → 닫기', async ({
  page,
  secondary,
}) => {
  await page.goto('/t');
  await page.getByTestId('pin-open').click();
  try {
    await page.keyboard.type(secondary.pin);
    await page.getByTestId('pin-submit').click();
    await expect(page).toHaveURL(`/t/e/${secondary.id}`);
  } catch {
    throw new Error('미리 보기 준비 중 PIN 재입장 실패. 원본 호출 로그는 기록하지 않습니다.');
  }
  await page.getByTestId('open-preview').click();
  const layer = page.getByTestId('preview-layer');
  await expect(layer.getByTestId('visit-screen')).toHaveAttribute('data-ready', '1', {
    timeout: TEACHER_READY_MS,
  });
  await expect(layer.getByTestId('preview-hint')).toBeVisible();
  await expect(layer.getByTestId('overlay-close')).toBeVisible();
  await captureTeacher(page, 'preview-01-plaza');

  const perf = layer.getByTestId('walk-perf');
  const next = layer.getByTestId('walk-nav').getByRole('button', { name: copy.viewer.nextArtwork });
  for (let i = 0; i < 6 && !(await layer.getByTestId('near-card').isVisible()); i++) {
    await next.click();
    await expect(perf).toHaveAttribute('data-mode', 'view', { timeout: WALK_MS });
  }
  await expect(layer.getByTestId('near-card')).toBeVisible();
  // 안내 걷기가 작품을 화면 가운데에 둔다 — 그 자리를 누르면 크게 보기 대신 그 작품 패널
  await page.mouse.click(DESKTOP.width / 2, DESKTOP.height / 2);
  await expect(page.getByTestId('artwork-panel')).toBeVisible();
  await expect(perf).not.toHaveAttribute('data-mode', 'zoom');
  await captureTeacher(page, 'preview-02-panel');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('artwork-panel')).toBeHidden();
  await layer.getByTestId('overlay-close').click();
  await expect(layer).toBeHidden();
  await expect(page.getByTestId('teacher-manage')).toHaveAttribute('data-state', 'ready');
});
