// node --test tools/assets/pipeline/seamCheck.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SEAM_BAND_PX,
  SEAM_GAP_PX,
  SEAM_MAX_REL,
  columnLuminance,
  seamJump,
  seamLimit,
  srgbToLinear,
} from './seamCheck.mjs';

const HALF = SEAM_BAND_PX + SEAM_GAP_PX;
const WIDTH = 2 * HALF + 1;

/** 열마다 회색 값(0..255)을 정해 RGBA 자르기를 만든다 */
const crop = (grayAt, height = 6) => {
  const data = new Uint8ClampedArray(WIDTH * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      const g = grayAt(x);
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = 255;
    }
  return data;
};

/** 선형 밝기 비율 ratio만큼 오른쪽이 밝은 회색 값 */
const grayForLinear = lin => {
  let lo = 0;
  let hi = 255;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (srgbToLinear(mid) < lin) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

test('고른 면은 차가 0', () => {
  const p = columnLuminance(
    crop(() => 150),
    WIDTH,
    6,
  );
  assert.equal(seamJump(p, HALF).rel, 0);
});

test('경계 바로 옆 ±1px의 어두운 선은 재지 않는다', () => {
  const p = columnLuminance(
    crop(x => (Math.abs(x - HALF) <= SEAM_GAP_PX ? 20 : 150)),
    WIDTH,
    6,
  );
  assert.equal(seamJump(p, HALF).rel, 0);
});

test('3% 계단은 걸리고 1% 계단은 지난다', () => {
  // 회색 값을 실수로 직접 넣어 반올림 오차 없이 계단 크기를 맞춘다.
  const base = 0.3;
  const profile = step =>
    Float64Array.from({ length: WIDTH }, (_, x) => (x > HALF ? base * (1 + step) : base));
  assert.ok(seamJump(profile(0.03), HALF).rel > SEAM_MAX_REL);
  assert.ok(seamJump(profile(0.01), HALF).rel < SEAM_MAX_REL);
});

test('화소 경로로도 계단 크기를 거의 그대로 잰다(8비트 반올림 0.5% 안)', () => {
  const lo = grayForLinear(0.3);
  const hi = grayForLinear(0.3 * 1.03);
  const p = columnLuminance(
    crop(x => (x > HALF ? hi : lo)),
    WIDTH,
    6,
  );
  assert.ok(Math.abs(seamJump(p, HALF).rel - 0.03) < 0.005);
});

test('밝기는 선형 공간 평균', () => {
  const p = columnLuminance(
    crop(() => 128),
    WIDTH,
    6,
  );
  assert.ok(Math.abs(p[0] - srgbToLinear(128)) < 1e-12);
});

test('띠가 배열을 벗어나면 알린다', () => {
  assert.throws(() => seamJump(new Float64Array(5), 2));
});

test('seamLimit: 고른 띠는 2% 그대로, 무늬가 있는 띠는 조각 한가운데 흔들림이 상한(ADR-058)', () => {
  assert.equal(seamLimit([0.001, 0.004]), SEAM_MAX_REL);
  assert.equal(seamLimit([]), SEAM_MAX_REL);
  assert.equal(seamLimit([0.0189, 0.046, 0.0276]), 0.046);
});

test('seamLimit 근거: 어두운 띠에서는 8비트 한 단계가 이미 선형 밝기 2%를 넘는다', () => {
  // 판벽 밝기(선형 약 0.04 ≈ sRGB 56) 근처에서 한 단계(56 → 57) 차
  const rel = (srgbToLinear(57) - srgbToLinear(56)) / ((srgbToLinear(57) + srgbToLinear(56)) / 2);
  assert.ok(rel > SEAM_MAX_REL, `한 단계 차 ${rel}`);
  // 회반죽 밝기(선형 약 0.17 ≈ sRGB 115)에서는 한 단계가 2% 아래(약 1.85%) — 고른 띠는 2% 기준을 그대로 쓸 수 있다
  const rel2 = (srgbToLinear(116) - srgbToLinear(115)) / ((srgbToLinear(116) + srgbToLinear(115)) / 2);
  assert.ok(rel2 < SEAM_MAX_REL, `한 단계 차 ${rel2}`);
});
