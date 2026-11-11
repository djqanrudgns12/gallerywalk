import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {
  SEAM_BAND_PX,
  SEAM_GAP_PX,
  SEAM_MAX_REL,
  columnLuminance,
  seamJump,
  seamLimit,
} from '../../tools/assets/pipeline/seamCheck.mjs';

/**
 * P1-3 끝 조건(PLAN §15.4·§13.3): 이어 붙인 벽 조각 화면 캡처에서 경계 ±8px 밝기 차 < 2%.
 * 조각 한가운데(경계 아님)도 같은 방법으로 재어 띠마다 그 조각 자체의 흔들림을 잰다 — 경계는 그보다 뚜렷하면 안 된다
 * (`seamLimit`, ADR-058: 무늬 있는 어두운 판벽은 조각 안에서도 2%를 넘게 흔들린다. 고른 회반죽은 2% 그대로).
 */

interface Mark {
  kind: 'seam' | 'control';
  x: number;
  band: string;
  col: number;
  row0: number;
  row1: number;
}

const HALF = SEAM_BAND_PX + SEAM_GAP_PX;

test.use({ viewport: { width: 1440, height: 900 } });

test('이어 붙인 벽 조각: 경계 ±8px 밝기 차 < 2%', async ({ page }) => {
  await page.goto('/dev/seam');
  await expect
    .poll(() => page.evaluate(() => (window as { __seam?: { ready: boolean } }).__seam?.ready === true), {
      timeout: 30_000,
    })
    .toBe(true);

  const crops = await page.evaluate(half => {
    const probe = (window as unknown as { __seam: { marks: Mark[] } }).__seam;
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('캔버스 없음');
    const copyCanvas = document.createElement('canvas');
    copyCanvas.width = canvas.width;
    copyCanvas.height = canvas.height;
    const ctx = copyCanvas.getContext('2d');
    if (!ctx) throw new Error('2D 문맥 없음');
    ctx.drawImage(canvas, 0, 0);
    return probe.marks.map(m => {
      const x0 = Math.round(m.col) - half;
      const y0 = Math.ceil(m.row0);
      const height = Math.floor(m.row1) - y0;
      const width = 2 * half + 1;
      return { ...m, width, height, data: Array.from(ctx.getImageData(x0, y0, width, height).data) };
    });
  }, HALF);

  mkdirSync('.local/screens/p1-3', { recursive: true });
  await page.screenshot({ path: '.local/screens/p1-3/seam.png' });

  const results = crops.map(c => {
    const jump = seamJump(columnLuminance(c.data, c.width, c.height), HALF);
    return { kind: c.kind, x: c.x, band: c.band, rows: c.height, ...jump };
  });
  console.log(
    results
      .map(
        r =>
          `${r.kind.padEnd(7)} x=${String(r.x).padStart(4)} ${r.band.padEnd(16)} 행 ${String(r.rows).padStart(3)}  ` +
          `왼 ${r.left.toFixed(4)} 오 ${r.right.toFixed(4)}  차 ${(r.rel * 100).toFixed(2)}%`,
      )
      .join('\n'),
  );
  expect(results.filter(r => r.kind === 'seam').length).toBeGreaterThanOrEqual(4);
  for (const r of results) {
    expect(r.rows, `${r.kind} x=${r.x} ${r.band}: 잰 행 수`).toBeGreaterThan(20);
    // 띠가 배경(어두운 색)을 재고 있지 않은지 — 회반죽·판벽은 배경보다 훨씬 밝다
    expect(Math.min(r.left, r.right), `${r.kind} x=${r.x} ${r.band}: 벽을 재는가`).toBeGreaterThan(0.01);
  }
  // 회반죽 같은 고른 띠의 대조는 2% 아래여야 한다(재는 방법이 흔들리지 않는가)
  const bands = [...new Set(results.map(r => r.band))];
  for (const band of bands) {
    const controls = results.filter(r => r.kind === 'control' && r.band === band).map(r => r.rel);
    const limit = seamLimit(controls);
    for (const r of results.filter(x => x.kind === 'seam' && x.band === band))
      expect(r.rel, `seam x=${r.x} ${band} (상한 ${(limit * 100).toFixed(2)}%)`).toBeLessThan(limit);
  }
  const plaster = results.filter(r => r.kind === 'control' && r.band === 'plaster');
  expect(plaster.length).toBeGreaterThan(0);
  for (const r of plaster) expect(r.rel, `control x=${r.x} plaster`).toBeLessThan(SEAM_MAX_REL);
});
