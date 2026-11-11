// 이음새 시험(PLAN §13.3): 이어 붙인 벽 조각의 화면 캡처에서 경계 ±8px 띠의 밝기 차 < 2%.
// 순수 함수만 둔다 — 캡처는 tests/e2e/seam.spec.ts가 `/dev/seam`에서 떠 온다. 시험: seamCheck.test.mjs(node --test).

export const SEAM_BAND_PX = 8;
/** 경계 바로 옆 ±1px은 안티에일리어싱·조각 끝 선이라 재지 않는다 */
export const SEAM_GAP_PX = 1;
export const SEAM_MAX_REL = 0.02;

/** sRGB 8비트 값 → 선형 */
export const srgbToLinear = v => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * RGBA 바이트 배열(폭 width × 높이 height) → 열마다 평균 선형 밝기(Rec. 709).
 * @param {ArrayLike<number>} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Float64Array}
 */
export const columnLuminance = (rgba, width, height) => {
  if (rgba.length !== width * height * 4)
    throw new Error(`화소 수가 맞지 않음: ${rgba.length} ≠ ${width}×${height}×4`);
  const out = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      sum +=
        0.2126 * srgbToLinear(rgba[i]) +
        0.7152 * srgbToLinear(rgba[i + 1]) +
        0.0722 * srgbToLinear(rgba[i + 2]);
    }
    out[x] = sum / height;
  }
  return out;
};

/**
 * 열 밝기 배열에서 경계 열 `center` 왼쪽·오른쪽 띠 평균의 상대 차.
 * @param {ArrayLike<number>} profile
 * @param {number} center
 * @returns {{ left: number, right: number, rel: number }}
 */
export const seamJump = (profile, center, band = SEAM_BAND_PX, gap = SEAM_GAP_PX) => {
  const a = center - gap - band;
  const b = center + gap + band;
  if (a < 0 || b >= profile.length) throw new Error(`띠가 배열 밖: ${a}..${b} / ${profile.length}`);
  const mean = (from, to) => {
    let s = 0;
    for (let x = from; x <= to; x++) s += profile[x];
    return s / (to - from + 1);
  };
  const left = mean(a, center - gap - 1);
  const right = mean(center + gap + 1, b);
  return { left, right, rel: Math.abs(left - right) / Math.max((left + right) / 2, 1e-9) };
};

/**
 * 한 띠(회반죽·판벽 등)의 경계 판정 상한(ADR-058): 같은 띠 조각 한가운데(대조)에서 잰 차 가운데 가장 큰 것과 `SEAM_MAX_REL` 중 큰 값.
 * 고르게 칠한 띠는 대조가 0.1% 남짓이라 2% 그대로, 나뭇결·판 테두리가 있는 어두운 판벽은 조각 안에서도 2%를 넘게 흔들리므로
 * 경계가 그 무늬보다 뚜렷하지 않으면 보이지 않는 것으로 본다.
 * @param {readonly number[]} controlRels 그 띠 대조 지점들의 상대 차
 */
export const seamLimit = controlRels => Math.max(SEAM_MAX_REL, ...controlRels);
