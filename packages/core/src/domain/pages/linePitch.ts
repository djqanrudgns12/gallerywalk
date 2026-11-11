import { config } from '../../config.ts';

/**
 * 글 줄 간격 추정(PLAN §5.4·§5.6, P2-4). 원해상도의 긴 축 줄 활동 배열(이웃 화소 밝기 차의 합)을 받아
 * 자기상관의 첫 큰 봉우리를 기본 주기(줄 간격, 배열 칸 단위)로 낸다. 서버 분석(`apps/server/src/media/analyze.ts`)이 쓰고,
 * 기기·시험에서도 같은 함수를 쓴다(Codex 구현을 도메인으로 옮김).
 *
 * - 최소 3주기가 들어 있어야 한다(탐색 상한 = n/3, 그리고 `LINE_PITCH_MAX_SHORT_PX`).
 * - 봉우리 신뢰도가 `LINE_PITCH_MIN_CONFIDENCE` 미만이면 null. 가장 높은 봉우리의 `LINE_PITCH_PEAK_RATIO` 이상인
 *   **첫** 봉우리를 고르고, 그 절반 근처에 기준을 넘는 봉우리가 있으면 그리로 내려간다 — 배수 주기(두 줄마다 같은 무늬)를
 *   줄 간격으로 잘못 고르지 않게(줄 간격을 2배로 읽으면 글자가 크다고 보고 덜 확대한다).
 */
/** 평균을 뺀 정규 자기상관. 가장 높은 봉우리와 비슷한 첫 봉우리가 기본 주기다. */
export function estimateLinePitch(activity: ArrayLike<number>): {
  pitch: number | null;
  confidence: number;
} {
  const n = activity.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += activity[i]!;
  const mean = sum / n;
  const centered = Float64Array.from({ length: n }, (_, i) => activity[i]! - mean);
  const total = centered.reduce((acc, value) => acc + value * value, 0);
  if (n < 3 || total <= Number.EPSILON * n) return { pitch: null, confidence: 0 };

  // 최소 3주기를 요구한다. 공용 설정의 분석 해상도를 탐색 상한으로 삼는다.
  const maxLag = Math.min(Math.floor(n / 3), config().LINE_PITCH_MAX_SHORT_PX);
  const scores = new Float64Array(maxLag + 1);
  let leftEnergy = total;
  let rightEnergy = total;
  for (let lag = 1; lag <= maxLag; lag++) {
    leftEnergy -= centered[n - lag]! ** 2;
    rightEnergy -= centered[lag - 1]! ** 2;
    let product = 0;
    for (let i = lag; i < n; i++) product += centered[i]! * centered[i - lag]!;
    const denominator = Math.sqrt(Math.max(0, leftEnergy * rightEnergy));
    scores[lag] = denominator > Number.EPSILON ? Math.max(0, Math.min(1, product / denominator)) : 0;
  }
  const peaks: { pitch: number; confidence: number }[] = [];
  for (let lag = 2; lag <= maxLag; lag++) {
    const score = scores[lag]!;
    if (score > scores[lag - 1]! && score >= (scores[lag + 1] ?? 0)) {
      peaks.push({ pitch: lag, confidence: score });
    }
  }
  const best = peaks.reduce((value, peak) => Math.max(value, peak.confidence), 0);
  const first = peaks.find(
    peak =>
      peak.confidence >= Math.max(config().LINE_PITCH_MIN_CONFIDENCE, best * config().LINE_PITCH_PEAK_RATIO),
  );
  if (!first) return { pitch: null, confidence: best };
  // 배수 주기 내려가기: 고른 간격의 절반 근처에 기준을 넘는 봉우리가 있으면 그것이 기본 주기다
  // (두 줄마다 진하기가 다른 글은 2배 간격이 더 높게 나온다. 글 줄은 절반 간격에서 음의 상관이라 우연히 생기지 않음)
  let chosen = first;
  for (;;) {
    const half = chosen.pitch / 2;
    const sub = peaks.find(
      peak =>
        Math.abs(peak.pitch - half) <= Math.max(1, half * 0.05) &&
        peak.confidence >= config().LINE_PITCH_MIN_CONFIDENCE,
    );
    if (!sub) break;
    chosen = sub;
  }
  return chosen;
}
