/**
 * 결정적 난수(PLAN §4.10): 시드 = exhibitionId의 FNV-1a(32비트), 생성기 = mulberry32.
 * 꾸밈(소품 종류·화분 자리)에만 쓴다 — 액자 위치는 난수와 무관하다.
 */

export const fnv1a32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** [0, 1) 균등 난수를 내는 함수 */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const rngFor = (exhibitionId: string): (() => number) => mulberry32(fnv1a32(exhibitionId));
