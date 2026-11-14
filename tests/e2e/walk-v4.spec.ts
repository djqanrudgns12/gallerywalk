import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

/**
 * 공간 v4(ADR-071, `/dev/walk?algo=4`) 걷기 확인 — PRD_V2 M3·W-12.
 * 광장 → 홀 → 전시실 소개 자리 → 첫 작품 앞을 안내로 걷고, 자리마다 캡처(`.local/screens/v4/`, 사람이 본다)·그리기 예산·
 * 전시실 밝기(W-12 완료 기준 "작품/벽 밝기 비 ≥ 3": 작품이 여전히 가장 밝게)를 잰다. 잰 값은 `light.json`으로 남긴다.
 */

type Rect = readonly [number, number, number, number];

/**
 * 잴 자리(화면 비율 x0, y0, x1, y1): 이 시험 전시(`?algo=4&rooms=2`) 첫 전시실 소개 자리 캡처에서 —
 * 작품 그림 안쪽 · 작품과 같은 높이에서 빛 웅덩이 밖의 왼쪽·오른쪽 벽 · 벽 위쪽 와시 띠(코브 아래).
 * 작품 앞 근접 캡처는 빛 웅덩이가 화면을 거의 덮어 벽을 잴 수 없다(2026-11-14 첫 실행에서 웅덩이를 벽으로 잼).
 */
const SIZES: readonly {
  name: string;
  width: number;
  height: number;
  touch: boolean;
  art: Rect;
  walls: readonly [Rect, Rect];
  wash: Rect;
}[] = [
  {
    name: 'phone',
    width: 390,
    height: 844,
    touch: true,
    art: [0.42, 0.47, 0.58, 0.52],
    walls: [
      [0.02, 0.45, 0.26, 0.5],
      [0.74, 0.45, 0.98, 0.5],
    ],
    wash: [0.02, 0.36, 0.98, 0.42],
  },
  {
    name: 'desktop',
    width: 1440,
    height: 900,
    touch: false,
    art: [0.44, 0.42, 0.56, 0.56],
    walls: [
      [0.05, 0.4, 0.3, 0.52],
      [0.7, 0.4, 0.95, 0.52],
    ],
    wash: [0.05, 0.13, 0.95, 0.25],
  },
];

const SHOTS = '.local/screens/v4';

interface Snap {
  mode: string;
  stopIndex: number;
  stopCount: number;
  near: string | null;
  frames: number;
  mark: number;
  calls: number;
  triangles: number;
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
      near: w['nearArtworkId'] as string | null,
      frames: perf.framesRendered,
      mark: w['idleFrameMark'] as number,
      calls: perf.calls,
      triangles: perf.triangles,
    };
  });

const goTo = (page: Page, index: number): Promise<void> =>
  page.evaluate(i => {
    const w = (window as unknown as { __walk: { getState: () => { api: { goTo: (n: number) => void } } } })
      .__walk;
    w.getState().api.goTo(i);
  }, index);

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

const arrive = async (page: Page, index: number): Promise<Snap> => {
  await goTo(page, index);
  // v4 공간은 홀·날개가 길어 안내 걷기가 v3보다 오래 걸린다(헤드리스 소프트웨어 렌더링, 프레임당 0.1초 상한)
  await expect
    .poll(
      async () => {
        const s = await snap(page);
        return s.mode === 'view' && s.stopIndex === index;
      },
      { timeout: 90_000, intervals: [400] },
    )
    .toBe(true);
  return settle(page);
};

/** 캡처 PNG의 사각형(화면 비율 0~1)마다 평균 상대 휘도(선형 sRGB, Rec.709) — 브라우저에서 풀어 잰다(추가 의존성 없음) */
const lumaOf = (page: Page, png: Buffer, rects: readonly (readonly [number, number, number, number])[]) =>
  page.evaluate(
    async ({ b64, rs }) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const g = canvas.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      const lin = (v: number): number => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return rs.map(([x0, y0, x1, y1]) => {
        const x = Math.round(x0 * bmp.width);
        const y = Math.round(y0 * bmp.height);
        const w = Math.max(1, Math.round((x1 - x0) * bmp.width));
        const h = Math.max(1, Math.round((y1 - y0) * bmp.height));
        const d = g.getImageData(x, y, w, h).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4)
          sum += 0.2126 * lin(d[i]!) + 0.7152 * lin(d[i + 1]!) + 0.0722 * lin(d[i + 2]!);
        return sum / (d.length / 4);
      });
    },
    { b64: png.toString('base64'), rs: rects.map(r => [...r]) },
  );

test.setTimeout(300_000);

for (const size of SIZES) {
  test.describe(`공간 v4 · ${size.name} ${size.width}×${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });

    test('광장 → 홀 → 전시실 → 작품 앞: 캡처·그리기 예산·작품이 벽보다 3배 이상 밝고 벽 위쪽 와시가 보인다', async ({
      page,
    }) => {
      mkdirSync(SHOTS, { recursive: true });
      await page.goto('/dev/walk?algo=4&rooms=2');
      await expect.poll(async () => (await snap(page)).stopCount, { timeout: 30_000 }).toBeGreaterThan(4);
      const limit = size.touch ? 120 : 160;
      const plaza = await settle(page);
      await page.screenshot({ path: `${SHOTS}/${size.name}-01-plaza.png` });
      const hall = await arrive(page, 1);
      await page.screenshot({ path: `${SHOTS}/${size.name}-02-hall.png` });
      const room = await arrive(page, 2);
      const shot = await page.screenshot({ path: `${SHOTS}/${size.name}-03-room.png` });
      const art = await arrive(page, 3);
      expect(art.near).not.toBeNull();
      await page.screenshot({ path: `${SHOTS}/${size.name}-04-artwork.png` });

      for (const s of [plaza, hall, room, art]) {
        expect(s.calls).toBeLessThanOrEqual(limit);
        expect(s.triangles).toBeLessThanOrEqual(300_000);
      }

      // 전시실 소개 자리 캡처에서 작품 · 같은 높이의 벽(빛 웅덩이 밖) · 벽 위쪽 와시 띠
      const [artLuma, left, right, wash] = await lumaOf(page, shot, [size.art, ...size.walls, size.wash]);
      const wall = (left! + right!) / 2;
      writeFileSync(
        `${SHOTS}/${size.name}-light.json`,
        JSON.stringify(
          {
            art: artLuma,
            wall,
            wash,
            ratio: artLuma! / wall,
            calls: [plaza, hall, room, art].map(s => s.calls),
          },
          null,
          2,
        ),
      );
      // W-12 완료 기준: 작품이 여전히 가장 밝게 — 작품/벽 ≥ 3, 벽 위쪽 와시 띠는 같은 높이의 벽보다 밝다(코브 빛이 보임)
      expect(artLuma! / wall).toBeGreaterThanOrEqual(3);
      expect(wash!).toBeGreaterThan(wall);
    });
  });
}

/**
 * 품질 낮음(`?tier=LOW`) + 동작 줄이기(`prefers-reduced-motion: reduce`) — PRD_V2 M6-1, PRD 8.4.
 * 광장 → 홀 → 전시실을 걷고 자리마다 멈추면 다시 그리지 않는지(`settle`: 정지 표시 = 그린 프레임 수), 그리기·삼각형 예산 안인지
 * 본다. 장면별 그리기 수는 `low-light.json`으로 남겨 높음 단계(`desktop-light.json`)와 비교한다.
 */
test.describe('공간 v4 · 품질 낮음 + 동작 줄이기 · desktop 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, reducedMotion: 'reduce' });

  test('광장 → 홀 → 전시실: 자리마다 멈추면 다시 그리지 않고 그리기·삼각형 예산 안', async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    await page.goto('/dev/walk?algo=4&rooms=2&tier=LOW');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await expect.poll(async () => (await snap(page)).stopCount, { timeout: 30_000 }).toBeGreaterThan(4);
    const plaza = await settle(page);
    await page.screenshot({ path: `${SHOTS}/low-01-plaza.png` });
    const hall = await arrive(page, 1);
    await page.screenshot({ path: `${SHOTS}/low-02-hall.png` });
    const room = await arrive(page, 2);
    await page.screenshot({ path: `${SHOTS}/low-03-room.png` });
    const shots = [plaza, hall, room];
    writeFileSync(
      `${SHOTS}/low-light.json`,
      JSON.stringify({ calls: shots.map(s => s.calls), triangles: shots.map(s => s.triangles) }, null, 2),
    );
    for (const s of shots) {
      // 멈춘 뒤에는 그린 프레임 수가 그대로(정지 상태에서 다시 그리지 않음)
      expect(s.mark).toBe(s.frames);
      expect(s.calls).toBeLessThanOrEqual(160);
      expect(s.triangles).toBeLessThanOrEqual(300_000);
    }
    // 멈춘 뒤 잠시 기다려도 새 프레임이 없다
    await page.waitForTimeout(1500);
    expect((await snap(page)).frames).toBe(room.frames);
  });
});

/**
 * 머리 위 말풍선(PRD_V2 W-02 완료 기준 "관람객 30명이 동시에 보내도 그리기 증가 ≤ 2") — 휴대폰 390×844.
 * 가짜 관람객 30명이 서 있는 광장(`?peerStill=1` — 걸어 다니면 사람 쪽 그리기 수가 1~3회씩 흔들려 +2를 가릴 수 없음,
 * 2026-11-14 첫 실행 83 → 82)에서 말풍선 없이 잰 그리기 수와, 30명 모두 + 나에게 말풍선(스티커·말·짧은 글)을 띄운 뒤의 그리기
 * 수를 비교한다. 1.5초 동안 여러 번 재어 흔들리지 않는지도 본다. 캡처는 `bubbles-phone.png`.
 */
test.describe('공간 v4 · 말풍선 30명 · phone 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  /** 1.5초 동안 잰 그리기 수의 가장 작은·큰 값 */
  const callsOver = async (page: Page, ms: number): Promise<{ min: number; max: number }> => {
    let min = Infinity;
    let max = 0;
    for (let t = 0; t < ms; t += 250) {
      const c = (await snap(page)).calls;
      min = Math.min(min, c);
      max = Math.max(max, c);
      await page.waitForTimeout(250);
    }
    return { min, max };
  };

  test('30명 + 나에게 한꺼번에 띄워도 그리기는 1~2회만 늘고, 화면 오류가 없다', async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/dev/walk?algo=4&rooms=2&peers=30&peerStill=1&bubbles=manual');
    await expect.poll(async () => (await snap(page)).stopCount, { timeout: 30_000 }).toBeGreaterThan(4);
    // 시작 자리(광장, 따라오는 카메라라 내 머리 위가 보임)에서 잰다 — 서 있는 사람들이 정지 지점 옆 자리를 차지해 안내 걷기로는
    // 작품 자리에 닿지 못한다(2026-11-14 두 번째 실행). 조각·질감이 다 받아져 그리기 수가 멎을 때까지 기다린다
    let before = await callsOver(page, 1500);
    for (let i = 0; i < 20 && (before.min !== before.max || before.max === 0); i++)
      before = await callsOver(page, 1500);
    await page.evaluate(() => {
      type B = { k: 's'; i: number } | { k: 'p'; i: number } | { k: 'x'; text: string };
      const board = (window as unknown as { __bubbles: { put: (who: string, b: B, at: number) => void } })
        .__bubbles;
      const now = Date.now();
      // 나는 스티커(늘 보임) · 다른 사람은 스티커·말·글을 돌려 가며 — 두 묶음(스티커·말 글자)이 모두 그려지게
      board.put('me', { k: 's', i: 0 }, now);
      for (let i = 0; i < 30; i++) {
        const b: B =
          i % 3 === 0
            ? { k: 's', i: i % 12 }
            : i % 3 === 1
              ? { k: 'p', i: i % 12 }
              : { k: 'x', text: '이 그림 색이 좋아' };
        board.put(`fake${String(i).padStart(4, '0')}`, b, now);
      }
    });
    // 튀어 오름이 끝난 뒤(0.22초)부터 머무는 동안 잰다
    await page.waitForTimeout(400);
    const during = await callsOver(page, 1500);
    await page.screenshot({ path: `${SHOTS}/bubbles-phone.png` });
    writeFileSync(`${SHOTS}/bubbles.json`, JSON.stringify({ before, during }, null, 2));
    // 그린 것이 있어야 비교가 뜻이 있다(내 말풍선은 늘 보임)
    // 서 있는 사람만이라 재는 동안 그리기 수가 흔들리지 않아야 비교가 뜻이 있다
    expect(before.max).toBe(before.min);
    expect(during.max).toBe(during.min);
    expect(during.max - before.max).toBeGreaterThanOrEqual(1);
    expect(during.max - before.max).toBeLessThanOrEqual(2);
    expect(during.max).toBeLessThanOrEqual(120);
    expect(errors).toEqual([]);
  });
});
