import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { copy, fill } from '../../packages/core/src/copy/ko.ts';

/**
 * R-1 끝 조건(PLAN §15.11a, ADR-057): `/dev/walk` 자유 관람 — 휴대폰·태블릿·데스크톱 세 크기에서
 * 광장 → 계단 → 홀 → 관 → 작품 앞 보기 → 크게 보기, 키보드·조이스틱으로 걷기, 벽을 뚫지 않음, 멈추면 다시 그리기 0.
 * 캡처는 `.local/screens/r1/`(사람이 화면을 본다).
 */

const SIZES = [
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'desktop', width: 1440, height: 900, touch: false },
] as const;

const SHOTS = '.local/screens/r1';

interface Snap {
  mode: string;
  stopIndex: number;
  stopCount: number;
  place: string;
  near: string | null;
  frames: number;
  mark: number;
  calls: number;
  triangles: number;
  me: { x: number; y: number; z: number; yaw: number };
}

const snap = (page: Page): Promise<Snap> =>
  page.evaluate(() => {
    const w = (
      window as unknown as { __walk: { getState: () => Record<string, unknown> } }
    ).__walk.getState();
    const perf = w['perf'] as { framesRendered: number; calls: number; triangles: number };
    return {
      mode: w['mode'] as string,
      stopIndex: w['stopIndex'] as number,
      stopCount: w['stopCount'] as number,
      place: w['place'] as string,
      near: w['nearArtworkId'] as string | null,
      frames: perf.framesRendered,
      mark: w['idleFrameMark'] as number,
      calls: perf.calls,
      triangles: perf.triangles,
      me: w['me'] as Snap['me'],
    };
  });

const callApi = (page: Page, name: string, ...args: unknown[]): Promise<void> =>
  page.evaluate(
    ([n, a]) => {
      const w = (
        window as unknown as {
          __walk: { getState: () => { api: Record<string, (...x: unknown[]) => void> } };
        }
      ).__walk;
      w.getState().api[n as string]!(...(a as unknown[]));
    },
    [name, args] as const,
  );

/** 멈출 때까지(그린 수가 늘지 않음) */
const settle = async (page: Page): Promise<Snap> => {
  let prev = -1;
  for (let i = 0; i < 60; i++) {
    const s = await snap(page);
    if (s.frames > 0 && s.frames === prev && s.mark === s.frames) return s;
    prev = s.frames;
    await page.waitForTimeout(400);
  }
  throw new Error(`관람 장면이 정지하지 않았습니다: ${JSON.stringify(await snap(page))}`);
};

const waitMode = async (page: Page, mode: string, timeout = 40_000): Promise<void> => {
  await expect.poll(async () => (await snap(page)).mode, { timeout, intervals: [300] }).toBe(mode);
};

// 광장 → 계단 → 홀 → 작품 앞을 실제로 걷는 긴 흐름(기다림 20초·40초가 이어짐) — 기본 30초로는 들어갈 수 없다
test.setTimeout(180_000);

for (const size of SIZES) {
  test.describe(`자유 관람 · ${size.name} ${size.width}×${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });

    test('광장에서 시작 → 안내로 홀 → 첫 작품 앞 → 크게 보기 → 닫기, 멈추면 다시 그리지 않음', async ({
      page,
    }) => {
      mkdirSync(SHOTS, { recursive: true });
      await page.goto('/dev/walk?rooms=2');
      await expect.poll(async () => (await snap(page)).stopCount, { timeout: 20_000 }).toBeGreaterThan(4);
      const start = await settle(page);
      expect(start.mode).toBe('free');
      expect(start.me.y).toBeLessThan(-0.5); // 광장 땅(계단 아래)
      await page.screenshot({ path: `${SHOTS}/${size.name}-01-plaza.png` });

      // 홀까지 안내 걷기(계단을 올라 정문을 지난다). 연타(두 번 누르기)해도 한 칸만(PRD 15.1-2)
      await page
        .getByTestId('walk-nav')
        .getByRole('button', { name: /다음 작품으로/ })
        .dblclick();
      await waitMode(page, 'view');
      const hall = await settle(page);
      expect(hall.stopIndex).toBe(1);
      expect(Math.abs(hall.me.y)).toBeLessThan(0.01);
      await page.screenshot({ path: `${SHOTS}/${size.name}-02-hall.png` });

      // 첫 작품까지(소개 다음)
      const stops = await page.evaluate(() => {
        const w = (window as unknown as { __walk: { getState: () => { stopCount: number } } }).__walk;
        return w.getState().stopCount;
      });
      expect(stops).toBeGreaterThan(3);
      await callApi(page, 'goTo', 3);
      await waitMode(page, 'view');
      const art = await settle(page);
      expect(art.near).not.toBeNull();
      await expect(page.getByTestId('near-card')).toBeVisible();
      // PRD 10.1·15.5: 멈춘 뒤 2초 동안 다시 그리지 않는다. 캡처는 측정 뒤에 한다.
      // CI trace에서 캡처 자체가 약 5초 걸렸다. 캡처의 화면 준비 작업을 정지 구간에 끼우지 않는다.
      await page.waitForTimeout(2000);
      expect((await snap(page)).frames).toBe(art.frames);
      await page.screenshot({ path: `${SHOTS}/${size.name}-03-artwork.png` });

      await page.getByTestId('near-card').getByRole('button').click();
      await waitMode(page, 'zoom', 10_000);
      await settle(page);
      await page.screenshot({ path: `${SHOTS}/${size.name}-04-zoom.png` });
      await page.keyboard.press('Escape');
      await waitMode(page, 'view', 10_000);

      // 예산(ADR-057): 그리기 호출 휴대폰·태블릿 120·데스크톱 160, 삼각형 30만
      const perf = await snap(page);
      expect(perf.calls).toBeLessThanOrEqual(size.touch ? 120 : 160);
      expect(perf.triangles).toBeLessThanOrEqual(300_000);
    });

    test('직접 걷기: 앞으로 가면 움직이고, 벽으로 밀어도 걸을 수 있는 곳 안에 남는다', async ({ page }) => {
      await page.goto('/dev/walk');
      await expect.poll(async () => (await snap(page)).stopCount, { timeout: 20_000 }).toBeGreaterThan(2);
      const before = await settle(page);
      if (size.touch) {
        // 조이스틱을 위로 밀고 1.5초
        const box = (await page.getByTestId('joystick').boundingBox())!;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx, cy - 50, { steps: 4 });
        await page.waitForTimeout(1500);
        await page.mouse.up();
      } else {
        await page.keyboard.down('KeyW');
        await page.waitForTimeout(1500);
        await page.keyboard.up('KeyW');
      }
      const after = await settle(page);
      expect(after.me.z - before.me.z).toBeGreaterThan(1);

      // 오른쪽으로 오래(광장 옆 울타리 쪽) — 울타리 안에서 멈춘다
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(9000);
      await page.keyboard.up('KeyD');
      const edge = await settle(page);
      const inside = await page.evaluate(
        me =>
          (window as unknown as { __walkCheck: (x: number, z: number) => boolean }).__walkCheck(me.x, me.z),
        edge.me,
      );
      expect(inside).toBe(true);
      expect(Math.abs(edge.me.x)).toBeGreaterThan(5);
    });
  });
}

test.describe('함께 관람 · 가짜 관람객 30명(태블릿 820×1180)', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

  test('사람 수와 상관없이 그리기 호출이 예산 안(몸은 종류마다·이름표는 한 번)', async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    await page.goto('/dev/walk?rooms=2');
    await expect.poll(async () => (await snap(page)).stopCount, { timeout: 20_000 }).toBeGreaterThan(4);
    await callApi(page, 'goTo', 1);
    await waitMode(page, 'view');
    const alone = await settle(page);

    await page.goto('/dev/walk?rooms=2&peers=30');
    // 가짜 관람객은 Canvas의 LiveDriver가 붙을 때 시작한다. DOM 위 줄만 먼저 뜬 상태와 구분한다.
    await expect.poll(async () => (await snap(page)).stopCount, { timeout: 20_000 }).toBeGreaterThan(4);
    const count = page.getByTestId('top-bar').getByTestId('live-count');
    await expect(count).toBeVisible();
    await expect(count).toHaveText(fill(copy.viewer.liveCount, { n: 31 }));
    await callApi(page, 'goTo', 1);
    // 헤드리스 소프트웨어 렌더링에서 30명을 그리면 프레임이 낮아 걷기가 실시간보다 느리다(프레임당 0.1초 상한) — 도착만 넉넉히 기다린다
    await waitMode(page, 'view', 90_000);
    await page.waitForTimeout(1500);
    const crowd = await snap(page);
    await page.screenshot({ path: `${SHOTS}/tablet-05-crowd.png` });
    // 몸 4종 + 이름표 1 + 발밑 그늘 1(2026-11-12 사용자 의견으로 더함, ADR-057 보충) = 사람이 늘어도 +6 이하
    expect(crowd.calls - alone.calls).toBeLessThanOrEqual(6);
    expect(crowd.calls).toBeLessThanOrEqual(120);
    expect(crowd.triangles).toBeLessThanOrEqual(300_000);
  });
});
