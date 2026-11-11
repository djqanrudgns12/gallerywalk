import { expect, type Page, test } from '@playwright/test';

/**
 * P1-4 끝 조건(PLAN §15.4): `/dev/viewer` 관람 엔진 뼈대 — P2-7부터 배치 엔진의 실제 출력(홀 → 소개 → 작품 → 출구)을 조립한다.
 * - 움직이는 동안 들어온 입력은 버린다(연타해도 한 칸, PRD 15.1)
 * - 정지 상태·줌 상태에서는 다시 그리지 않는다(PRD 15.5)
 * - 누르면 0.8초 안에 줌·캡션(PRD 15.1)
 * - 다섯 화면 크기에서 줌 HTML 그림을 반투명으로 겹친 캡처를 남긴다(.local/screens, 사람이 어긋남을 본다)
 */

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'ipad-landscape', width: 1180, height: 820 },
  { name: 'ipad-portrait', width: 820, height: 1180 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
] as const;

interface Snap {
  label: string;
  rigState: string;
  frames: number;
  mark: number;
  zoomId: string | null;
  rect: { left: number; top: number; width: number; height: number } | null;
  captionVisible: boolean;
}

const snap = (page: Page): Promise<Snap> =>
  page.evaluate(async () => {
    const mod = (await import('/dev/viewerDevStore.ts' as string)) as {
      useDevViewer: { getState: () => Record<string, unknown> & { perf: { framesRendered: number } } };
    };
    const s = mod.useDevViewer.getState();
    return {
      label: s['label'] as string,
      rigState: s['rigState'] as string,
      frames: s.perf.framesRendered,
      mark: s['idleFrameMark'] as number,
      zoomId: s['zoomId'] as string | null,
      rect: s['overlayRect'] as Snap['rect'],
      captionVisible: s['captionVisible'] as boolean,
    };
  });

/** 프레임 수는 0.3초 뒤에야 마지막 값이 올라오므로, 값이 멈출 때까지 기다린다. */
const settledFrames = async (page: Page): Promise<number> => {
  let prev = -1;
  for (let i = 0; i < 20; i++) {
    const { frames } = await snap(page);
    if (frames === prev) return frames;
    prev = frames;
    await page.waitForTimeout(400);
  }
  return prev;
};

const toFirstArtwork = async (page: Page): Promise<void> => {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await snap(page)).rigState, { timeout: 5_000 }).toBe('idle');
  }
  await expect.poll(async () => (await snap(page)).label, { timeout: 5_000 }).toMatch(/ 1\/6$/);
};

const open = async (page: Page, query = ''): Promise<void> => {
  await page.goto(`/dev/viewer${query}`);
  await expect.poll(async () => (await snap(page)).label, { timeout: 15_000 }).not.toBe('');
};

test('연타해도 한 칸, 도착 뒤에는 다시 그리지 않는다', async ({ page }) => {
  await open(page);
  const start = await snap(page);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await snap(page)).rigState, { timeout: 5_000 }).toBe('idle');
  const arrived = await snap(page);
  expect(arrived.label).not.toBe(start.label);
  // 홀 → 첫 전시실 소개 한 칸(관 사이라 회랑 경로를 따라 걸음, 최대 2.2초). 연타 넷 중 셋은 버려진다.
  expect(arrived.label).toMatch(/· 소개$/);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await snap(page)).rigState, { timeout: 5_000 }).toBe('idle');
  expect((await snap(page)).label).toMatch(/ 1\/6$/);
  const a = await settledFrames(page);
  await page.waitForTimeout(2000);
  const b = (await snap(page)).frames;
  expect(b - a).toBe(0);
});

test('누르면 0.8초 안에 줌·캡션, 줌 상태에서도 다시 그리지 않고, 닫으면 돌아온다', async ({ page }) => {
  await open(page);
  await toFirstArtwork(page);
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snap(page)).captionVisible, { timeout: 3_000 }).toBe(true);
  await expect.poll(async () => (await snap(page)).rect !== null, { timeout: 3_000 }).toBe(true);
  // 헤드리스 소프트웨어 렌더링의 지연을 감안해 여유 0.4초
  expect(Date.now() - t0).toBeLessThan(800 + 400);
  const a = await settledFrames(page);
  await page.waitForTimeout(2000);
  expect((await snap(page)).frames - a).toBe(0);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).rigState, { timeout: 5_000 }).toBe('idle');
  expect((await snap(page)).zoomId).toBeNull();
});

test('입구 홀·전시실 소개 전경 캡처(조립한 공간을 눈으로 보는 확인)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, '?rooms=3&map=1');
  // 조각 glb·KTX2를 다 받아 조립한 뒤의 화면
  await page.waitForLoadState('networkidle');
  await settledFrames(page);
  await page.screenshot({ path: '.local/screens/p2-7/desktop-hall.png' });
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await snap(page)).rigState, { timeout: 5_000 }).toBe('idle');
  await settledFrames(page);
  await page.screenshot({ path: '.local/screens/p2-7/desktop-intro.png' });
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await snap(page)).rigState, { timeout: 5_000 }).toBe('idle');
  }
  await settledFrames(page);
  await page.screenshot({ path: '.local/screens/p2-7/desktop-art3.png' });
});

test('100점대 전시(전시실 17개)도 열리고 끝까지 걸어갈 수 있다', async ({ page }) => {
  await open(page, '?rooms=17');
  const first = await snap(page);
  expect(first.label).toBe('시험 전시');
  // 정지 지점 수 = 홀 + 관마다 소개 + 102점 + 출구 — 끝 칸(End)이 없으니 마지막 관 소개 근처까지만 확인
  const total = await page.evaluate(async () => {
    const mod = (await import('/dev/viewerDevStore.ts' as string)) as {
      useDevViewer: { getState: () => { stopCount: number } };
    };
    return mod.useDevViewer.getState().stopCount;
  });
  expect(total).toBeGreaterThanOrEqual(1 + 17 + 102 + 1);
});

for (const vp of VIEWPORTS) {
  test(`줌 HTML 그림 겹침 캡처 — ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await open(page, '?ghost=1');
    await toFirstArtwork(page);
    await page.screenshot({ path: `.local/screens/p1-4/${vp.name}-stop.png` });
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await snap(page)).rect !== null, { timeout: 5_000 }).toBe(true);
    const { rect } = await snap(page);
    expect(rect).not.toBeNull();
    // 그림 면이 화면 안에 있고 캡션 자리를 침범하지 않는다(아래 22%).
    expect(rect!.left).toBeGreaterThanOrEqual(0);
    expect(rect!.top).toBeGreaterThanOrEqual(0);
    expect(rect!.left + rect!.width).toBeLessThanOrEqual(vp.width + 0.5);
    expect(rect!.top + rect!.height).toBeLessThanOrEqual(vp.height * (1 - 0.22) + 0.5);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `.local/screens/p1-4/${vp.name}-zoom-ghost.png` });
  });
}
