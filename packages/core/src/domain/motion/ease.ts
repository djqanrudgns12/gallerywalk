/**
 * CSS `cubic-bezier(x1, y1, x2, y2)`와 같은 감속 곡선. GSAP의 `ease`에 함수로 넘긴다(플러그인 등록 없이).
 * 출발 가속 짧게·도착 감속 길게 = `MOVE_EASE` (PLAN §4.8).
 */
export const cubicBezier = (x1: number, y1: number, x2: number, y2: number): ((t: number) => number) => {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number): number => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;

  const solveS = (x: number): number => {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(s) - x;
      if (Math.abs(err) < 1e-6) return s;
      const d = slopeX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    // 뉴턴법이 멈추면 이분법으로 마무리한다.
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 30; i++) {
      const v = sampleX(s);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return s;
  };

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveS(t));
  };
};

/** 두 소리 사이 등전력 교차(투어 페이드, ADR-046). p: 0 → 1 */
export const equalPowerIn = (p: number): number => Math.sin((Math.min(1, Math.max(0, p)) * Math.PI) / 2);
export const equalPowerOut = (p: number): number => Math.cos((Math.min(1, Math.max(0, p)) * Math.PI) / 2);
