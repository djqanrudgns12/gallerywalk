import { expect, test } from '@playwright/test';
import { computeLayout } from '@gallery/core/layout';
import { hashFixtures } from '../../apps/web/dev/hashFixtures.ts';

/**
 * P2-3 끝 조건(PLAN §4.11): 고정 입력 20개의 배치 해시가 Node(이 시험 프로세스)와 브라우저에서 같다.
 * 서버(Node)가 계산해 저장한 배치를 기기가 같은 해시로 확인하려면 부동소수 끝자리 차이가 없어야 한다(§4.10).
 * 지금 프로젝트는 Chromium만 — WebKit은 브라우저를 받아야 해서 미실행(보고에 적음).
 */

test('배치 해시: Node와 브라우저가 같다(고정 입력 20개)', async ({ page }) => {
  const node = hashFixtures().map(input => computeLayout(input).hash);
  expect(new Set(node).size).toBe(20);
  await page.goto('/dev/hash');
  await expect
    .poll(() => page.evaluate(() => (window as { __layoutHashes?: string[] }).__layoutHashes?.length ?? 0), {
      timeout: 20_000,
    })
    .toBe(20);
  const browser = await page.evaluate(
    () => (window as unknown as { __layoutHashes: string[] }).__layoutHashes,
  );
  expect(browser).toEqual(node);
});
