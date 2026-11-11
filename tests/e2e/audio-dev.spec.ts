import { expect, type Page, test } from '@playwright/test';

/**
 * P1-6 소리 관문의 데스크톱 부분(PLAN §8.4): 잠금 풀기 → 교차 페이드 → 배경 낮추기 → 끄기.
 * 이득 값은 Web Audio 자동화의 현재 값을 읽는다. 실기기(iOS 무음 스위치 등)는 관문 G1에서 사람이 확인한다.
 */

interface Snap {
  context: string;
  unlocked: boolean;
  master: number;
  duck: number;
  slots: { id: string | null; gain: number; paused: boolean }[];
  artwork: { id: string | null; paused: boolean };
}

const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => (window as unknown as { __gwAudio: { snapshot: () => Snap } }).__gwAudio.snapshot());

const slot = (s: Snap, id: string) => s.slots.find(x => x.id === id);

test('잠금 풀기 → 방 1 → 방 2 교차 페이드 → 작품 소리에 배경 낮추기 → 끄기', async ({ page }) => {
  await page.goto('/dev/audio');
  await page.getByTestId('unlock').click();
  await expect.poll(async () => (await snap(page)).context).toBe('running');
  // 문맥이 돈 뒤 소리 요소마다 무음을 한 번 재생해 보고서야 잠금이 풀린다(`AudioEngine.unlock`) — 그때까지 기다린다
  await expect.poll(async () => (await snap(page)).unlocked).toBe(true);

  await page.getByTestId('room1').click();
  await expect
    .poll(async () => slot(await snap(page), 'room1')?.gain ?? 0, { timeout: 4_000 })
    .toBeGreaterThan(0.95);
  expect(slot(await snap(page), 'room1')?.paused).toBe(false);

  // 교차 페이드 1.5초: 중간에는 둘 다 들리고, 끝나면 방 1은 멈추고 방 2만(−3dB → 이득 약 0.71)
  await page.getByTestId('room2').click();
  await page.waitForTimeout(700);
  const mid = await snap(page);
  expect(slot(mid, 'room1')?.gain ?? 0).toBeGreaterThan(0.2);
  expect(slot(mid, 'room2')?.gain ?? 0).toBeGreaterThan(0.2);
  await expect.poll(async () => slot(await snap(page), 'room1'), { timeout: 4_000 }).toBeUndefined();
  const after = await snap(page);
  expect(slot(after, 'room2')?.gain ?? 0).toBeCloseTo(10 ** (-3 / 20), 1);

  // 작품 소리: 배경 0.2로 낮추고, 2초 소리가 끝나면 되돌린다
  await page.getByTestId('artwork').click();
  await expect.poll(async () => (await snap(page)).duck, { timeout: 2_000 }).toBeLessThan(0.25);
  await expect.poll(async () => (await snap(page)).duck, { timeout: 5_000 }).toBeGreaterThan(0.95);

  await page.getByTestId('mute').click();
  await expect.poll(async () => (await snap(page)).master, { timeout: 2_000 }).toBeLessThan(0.01);
});
