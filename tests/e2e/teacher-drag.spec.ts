import { expect, test, type Locator, type Page } from '@playwright/test';
import { config } from '../../packages/core/src/config.ts';
import { copy, fill } from '../../packages/core/src/copy/ko.ts';
import { seedManageExhibition, type ManageSeed } from './support/exhibition.ts';
import { captureTeacher, keepTeacherPageVersion, TEACHER_READY_MS } from './support/teacher.ts';

/**
 * 교사 작업 화면 v3 끌어 놓기(PRD G-32, FIELD_PLAN §5.5·§5.6 끌기 시험 9칸의 e2e 3칸, HT-12).
 * 합성 전시(전시실 5·그림 40)에서 다른 판 n번째로 옮기기를 데스크톱 마우스·태블릿 터치 흉내·키보드로 한 번씩.
 * 잰 값(지도 반영 시간·끄는 중 프레임 간격)은 시험 기록(annotations)에 남긴다. 프레임은 헤드리스라 참고값이다.
 */

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 820, height: 1180 };
/** 놓은 뒤 지도 반영 상한(ms, 개발 서버 기준 — PRD 15.9 G-32) */
const MAP_REFLECT_MS = 1000;
/** 터치 흉내 CPU 감속(태블릿 흉내, FIELD_PLAN §5.7 잴 것) */
const CPU_SLOWDOWN = 4;
const STEPS = 12;

// 교사 토큰과 PIN이 요청·기기 저장에 들어간다. 자동 추적·영상·캡처는 모두 끈다.
test.use({ viewport: DESKTOP, trace: 'off', video: 'off', screenshot: 'off' });
test.setTimeout(360_000);

let seed: ManageSeed;
test.beforeAll(async () => {
  test.setTimeout(480_000);
  seed = await seedManageExhibition();
});

/** 새 기기 PIN 재입장(숫자 키보드) → 작품 탭 */
async function openBoard(page: Page): Promise<void> {
  await keepTeacherPageVersion(page);
  await page.goto('/t');
  await page.getByTestId('pin-open').click();
  try {
    await page.keyboard.type(seed.pin);
    await page.getByTestId('pin-submit').click();
    await expect(page).toHaveURL(`/t/e/${seed.id}`);
  } catch {
    throw new Error('끌기 시험 준비 중 PIN 재입장 실패. 원본 호출 로그는 기록하지 않습니다.');
  }
  await expect(page.getByTestId('teacher-manage')).toHaveAttribute('data-state', 'ready', {
    timeout: TEACHER_READY_MS,
  });
  await page.getByTestId('tab-artworks').click();
  await expect(page.getByTestId('room-boards').locator('[data-cell-id]')).toHaveCount(seed.artworks);
}

const boards = (page: Page) => page.locator('[data-testid^="room-board-"]');
const wallIds = async (board: Locator): Promise<string[]> =>
  board.locator('[data-cell-id]').evaluateAll(els => els.map(el => el.getAttribute('data-cell-id') ?? ''));
const center = async (el: Locator): Promise<{ x: number; y: number }> => {
  const box = await el.boundingBox();
  if (!box) throw new Error('자리를 잴 수 없음');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const arranged = (page: Page) =>
  page.waitForResponse(
    r => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/arrangement'),
    { timeout: TEACHER_READY_MS },
  );

/** 끄는 동안 rAF 간격 모으기(참고값) */
const startFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __stop: boolean };
    w.__gaps = [];
    w.__stop = false;
    let last = performance.now();
    const tick = (t: number) => {
      w.__gaps.push(t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const stopFrames = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __stop: boolean };
    w.__stop = true;
    const gaps = [...w.__gaps].sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)] ?? 0;
  });

test('데스크톱 마우스 · 다른 판 n번째 → 요청 하나 · 놓을 판 안내 · 지도 1초 안에 반영', async ({ page }) => {
  await openBoard(page);
  const [first, second] = [boards(page).nth(0), boards(page).nth(1)];
  const before1 = await wallIds(first);
  const before2 = await wallIds(second);
  const moved = before1[2]!;
  const mapMark = page.getByTestId('drop-map').locator(`[data-artwork-id="${moved}"]`);
  const markBefore = await mapMark.getAttribute('points');

  const from = await center(first.locator(`[data-cell-id="${moved}"]`));
  const target = second.locator('[data-cell-id]').nth(1);
  const to = await center(target);
  const box = (await target.boundingBox())!;
  await startFrames(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.25, to.y, { steps: STEPS });
  await expect(second.getByTestId('drop-hint')).toHaveText(fill(copy.teacher.dnd.dropHint, { n: 2 }));
  // 지도에서도 놓일 전시실이 밝아진다
  await expect(page.getByTestId('floor-plan')).toHaveAttribute(
    'data-drop-room',
    (await second.getAttribute('data-room-id')) ?? '',
  );
  await captureTeacher(page, 'v3-drag-desktop');
  const response = arranged(page);
  await page.mouse.up();
  const medianGap = await stopFrames(page);
  expect((await response).status()).toBe(200);
  const answeredAt = Date.now();
  await expect
    .poll(async () => mapMark.getAttribute('points'), { timeout: MAP_REFLECT_MS * 3 })
    .not.toBe(markBefore);
  const reflectMs = Date.now() - answeredAt;
  test
    .info()
    .annotations.push(
      { type: '지도 반영(ms)', description: String(reflectMs) },
      { type: '끄는 중 rAF 가운데값(ms, 참고)', description: medianGap.toFixed(1) },
    );
  expect(reflectMs).toBeLessThanOrEqual(MAP_REFLECT_MS);
  expect(await wallIds(first)).toEqual(before1.filter(id => id !== moved));
  expect(await wallIds(second)).toEqual([before2[0], moved, ...before2.slice(1)]);
  // 되돌리기 토스트 → ⌘Z/Ctrl+Z로 제자리
  await expect(page.getByTestId('teacher-toast')).toContainText(copy.teacher.undo.action);
  const undone = arranged(page);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await undone).status()).toBe(200);
  await expect.poll(async () => wallIds(first)).toEqual(before1);
});

test('태블릿 터치 흉내 · 길게 눌러 다른 판 n번째(CPU 감속)', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4522',
    viewport: TABLET,
    screen: TABLET,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await openBoard(page);
    const cdp = await context.newCDPSession(page);
    const [first, second] = [boards(page).nth(0), boards(page).nth(1)];
    const before1 = await wallIds(first);
    const before2 = await wallIds(second);
    const moved = before1[0]!;
    await second.scrollIntoViewIfNeeded();
    await first.scrollIntoViewIfNeeded();
    const from = await center(first.locator(`[data-cell-id="${moved}"]`));
    const target = second.locator('[data-cell-id]').nth(2);
    const box = (await target.boundingBox())!;
    const to = { x: box.x + box.width * 0.25, y: box.y + box.height / 2 };
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at: { x: number; y: number }) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(at.x), y: Math.round(at.y) }],
      });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    await startFrames(page);
    await touch('touchStart', from);
    await page.waitForTimeout(config().LONG_PRESS_MS + 150);
    for (let i = 1; i <= STEPS; i++)
      await touch('touchMove', {
        x: from.x + ((to.x - from.x) * i) / STEPS,
        y: from.y + ((to.y - from.y) * i) / STEPS,
      });
    await expect(second.getByTestId('drop-hint')).toHaveText(fill(copy.teacher.dnd.dropHint, { n: 3 }));
    await expect(page.getByTestId('drop-at')).toBeVisible();
    await captureTeacher(page, 'v3-drag-tablet');
    const response = arranged(page);
    await touch('touchEnd', to);
    const medianGap = await stopFrames(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect((await response).status()).toBe(200);
    test
      .info()
      .annotations.push({ type: '태블릿 흉내 rAF 가운데값(ms, 참고)', description: medianGap.toFixed(1) });
    await expect
      .poll(async () => wallIds(second))
      .toEqual([before2[0], before2[1], moved, ...before2.slice(2)]);
    expect(await wallIds(first)).toEqual(before1.slice(1));
  } finally {
    await context.close();
  }
});

test('키보드 · M으로 집고 ↓로 아래 판 → Space로 놓기 → 초점은 옮긴 액자', async ({ page }) => {
  await openBoard(page);
  const [first, second] = [boards(page).nth(0), boards(page).nth(1)];
  const before1 = await wallIds(first);
  const moved = before1[before1.length - 1]!;
  const cell = first.locator(`[data-cell-id="${moved}"]`);
  await cell.focus();
  await page.keyboard.press('m');
  await page.keyboard.press('ArrowDown');
  await expect(second.getByTestId('drop-hint')).toBeVisible();
  const response = arranged(page);
  await page.keyboard.press('Space');
  expect((await response).status()).toBe(200);
  await expect.poll(async () => (await wallIds(second)).includes(moved)).toBe(true);
  expect(await wallIds(first)).toEqual(before1.slice(0, -1));
  await expect(page.locator(`[data-cell-id="${moved}"]`)).toBeFocused();
  await captureTeacher(page, 'v3-drag-keyboard');
});
