// 캐릭터 원본의 부분 법선 고치기(`character.mjs` 준비 단계, PRD_V2 M4-5) — 순수 함수 + 사람별 규칙.
//
// Tripo 원본 가운데 일부 조각의 정점 법선이 뒤를 향해, 엔진 조명에서 그 조각이 회색으로 보인다(기본색은 흰색).
// 규칙에 맞는 꼭짓점(UV 상자 안 + 위치 상자 안)의 법선을 `toward` 쪽으로 `blend`만큼 기울인다. 면(감김)은 바꾸지 않는다.
// 좌표는 원본 그대로(키 맞춤 전, 원본 키 약 0.98m) — 규칙 수치는 그림 세션이 원본을 풀어 잰 값이다(`.local/art/m4/3d/LOG.md`).

/**
 * @typedef {object} NormalRule
 * @property {string} what 무엇을 고치는지(기록용)
 * @property {readonly [number, number, number, number]} uv UV 상자 [u0, v0, u1, v1](0~1, glTF UV — v는 그림 위에서 아래)
 * @property {readonly [readonly [number, number, number], readonly [number, number, number]]} pos 위치 상자 [최소, 최대](원본 좌표)
 * @property {readonly [number, number, number]} toward 기울일 방향(단위 벡터가 아니어도 됨)
 * @property {number} blend 0 = 그대로 · 1 = `toward`와 같게
 */

/** 1024px 그림 기준 픽셀 상자 → UV 상자 */
const px = (x0, y0, x1, y1) => /** @type {const} */ ([x0 / 1024, y0 / 1024, x1 / 1024, y1 / 1024]);

/** 사람별 규칙. 규칙마다 맞는 꼭짓점이 하나도 없으면 `character.mjs`가 실패로 끝낸다(원본이 바뀐 것) */
export const NORMAL_FIXES = /** @type {Readonly<Record<string, readonly NormalRule[]>>} */ ({
  'student-m-01': [
    {
      // 2026-11-14 사용자 결정 「메인세션에 고치게해.」 — 섬 꼭짓점 14개 중 9개 법선이 −z(그림 세션 측정)
      what: '앞니 UV 섬(1024px x 8~42·y 418~462, 위치 x −0.035~0.016·y 0.657~0.673·z 0.14~0.169)',
      uv: px(8, 418, 42, 462),
      pos: [
        [-0.045, 0.647, 0.13],
        [0.026, 0.683, 0.179],
      ],
      toward: [0, 0, 1],
      blend: 1,
    },
  ],
});

/** 꼭짓점이 규칙 상자(UV·위치) 안인가 */
export const inRule = (position, uv, rule) => {
  const [u0, v0, u1, v1] = rule.uv;
  if (uv[0] < u0 || uv[0] > u1 || uv[1] < v0 || uv[1] > v1) return false;
  const [lo, hi] = rule.pos;
  for (let k = 0; k < 3; k++) if (position[k] < lo[k] || position[k] > hi[k]) return false;
  return true;
};

/** 법선을 `toward` 쪽으로 기울인 단위 벡터 */
export const tilt = (normal, rule) => {
  const t = rule.toward;
  const tl = Math.hypot(t[0], t[1], t[2]) || 1;
  const b = Math.min(1, Math.max(0, rule.blend));
  const v = [0, 1, 2].map(k => (1 - b) * normal[k] + (b * t[k]) / tl);
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? v.map(x => x / l) : t.map(x => x / tl);
};

/**
 * 한 묶음(꼭짓점 배열)에 규칙 적용. `normals`를 고치고 고친 꼭짓점 수를 돌려준다.
 * @param {(i: number) => number[]} positionAt
 * @param {(i: number) => number[]} uvAt
 * @param {(i: number) => number[]} normalAt
 * @param {(i: number, n: number[]) => void} setNormal
 * @param {number} count
 * @param {NormalRule} rule
 */
export const applyRule = (positionAt, uvAt, normalAt, setNormal, count, rule) => {
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (!inRule(positionAt(i), uvAt(i), rule)) continue;
    setNormal(i, tilt(normalAt(i), rule));
    n++;
  }
  return n;
};
