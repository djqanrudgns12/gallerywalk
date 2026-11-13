import { config } from '@gallery/core/config';

/**
 * 학교망 점검 `/check`(FIELD_PLAN HW-00)의 시간 상한·느림 문턱. 값은 `config.ts`의 `CHECK_*`·`MODULE_LOAD_STALL_MS`.
 */
export interface CheckLimits {
  /** ① 서버 응답 상한(ms). 작은 JSON 하나라 이보다 늦으면 닿지 않은 것으로 친다 */
  readonly serverTimeoutMs: number;
  /** ⑥ 함께 관람 웹소켓이 열리기까지 상한(ms) */
  readonly liveTimeoutMs: number;
  /** ②③④⑤ 파일 단계 하나의 상한(ms): 학생 화면이 조각 파일 하나를 못 받은 것으로 치는 시간과 같다 */
  readonly fileTimeoutMs: number;
  /** ①·⑥이 됐어도 이보다 오래 걸리면 느림(ms) */
  readonly slowLatencyMs: number;
  /** ⑦ 받는 빠르기가 이보다 낮으면 느림(Mbps) */
  readonly slowMbps: number;
}

export const checkLimits = (): CheckLimits => ({
  serverTimeoutMs: config().CHECK_SERVER_TIMEOUT_MS,
  liveTimeoutMs: config().CHECK_LIVE_TIMEOUT_MS,
  fileTimeoutMs: config().MODULE_LOAD_STALL_MS,
  slowLatencyMs: config().CHECK_SLOW_LATENCY_MS,
  slowMbps: config().CHECK_SLOW_MBPS,
});
