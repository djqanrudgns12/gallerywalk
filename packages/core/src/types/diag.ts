import { z } from 'zod';
import { UuidSchema } from './common.ts';

/**
 * 기기 보고(G-24·G-25, FIELD_PLAN HW-02·HR, ADR-070): `POST /api/e/{code}/diag`.
 *
 * - `fail`: 3D를 띄우지 못하고 가벼운 화면(2D)으로 들어간 까닭 하나. 서버는 전시·까닭별 **수만** 메모리에 모아
 *   교사 화면에 "가벼운 화면으로 들어온 학생 n명"으로 보인다.
 * - `report`: 관람 한 번의 실기기 반응성(걸린 시간·fps·누름 반응·받은 양). 서버는 날마다 한 파일에 한 줄씩 남기고
 *   `DEVICE_REPORT_KEEP_DAYS`가 지나면 지운다. 실기기(iOS·안드로이드) 측정을 모으는 통로다.
 *
 * 누구 것인지 알 수 없게: 토큰·별명·IP·기기 ID·UA 원문·GPU 이름 원문을 싣지 않는다. 기기·브라우저·GPU는 몇 갈래로만 묶는다.
 * 전시 ID는 서버가 입장 코드로 찾는다(보고에 싣지 않음).
 */

export const DIAG_REASONS = [
  /** 포스터 뒤 3D 준비가 `VISIT_READY_TIMEOUT_MS` 안에 끝나지 않아 가벼운 화면을 골랐다 */
  'ready_timeout',
  /** 3D 공간 조각 파일을 하나도 받지 못함(멈춤·실패) */
  'module_fail',
  /** 3D 화면 묶음(JS)을 받지 못함 */
  'chunk_fail',
  /** WebGL2를 만들 수 없음 */
  'webgl_none',
  /** 짧은 시간 안 그림 바탕(컨텍스트) 손실이 거듭됨 */
  'context_lost',
  /** '낮음' 단계에서도 계속 느림 */
  'fps_low',
] as const;
export const DiagReasonSchema = z.enum(DIAG_REASONS);
export type DiagReason = z.infer<typeof DiagReasonSchema>;

export const REPORT_PLATFORMS = ['ios', 'android', 'desktop', 'other'] as const;
export const REPORT_BROWSERS = [
  'safari',
  'chrome',
  'samsung',
  'firefox',
  'edge',
  'whale',
  'inapp',
  'other',
] as const;
export const REPORT_GPUS = [
  'apple',
  'mali',
  'adreno',
  'powervr',
  'intel',
  'nvidia',
  'amd',
  'software',
  'other',
  'unknown',
] as const;
export const REPORT_DEVICES = ['phone', 'tablet', 'desktop'] as const;
export const REPORT_TIERS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const REPORT_NETS = ['slow-2g', '2g', '3g', '4g'] as const;

/** 화면을 연 때(탐색 시작)부터 잰 ms. 10분 넘으면 버린다(null) */
const MS_MAX = 600_000;
const sinceOpen = z.number().int().min(0).max(MS_MAX).nullable();
const rate = (max: number) => z.number().min(0).max(max).nullable();

export const DeviceReportSchema = z
  .object({
    v: z.literal(1),
    platform: z.enum(REPORT_PLATFORMS),
    /** OS 큰 판(iOS 17 → 17, 안드로이드 14 → 14). 모르면 null */
    osMajor: z.number().int().min(0).max(99).nullable(),
    browser: z.enum(REPORT_BROWSERS),
    device: z.enum(REPORT_DEVICES),
    gpu: z.enum(REPORT_GPUS),
    /** `navigator.deviceMemory`(GB, Chromium만) */
    memGb: rate(64),
    /** `navigator.connection.effectiveType`(Chromium만) */
    net: z.enum(REPORT_NETS).nullable(),
    mode: z.enum(['3d', '2d']),
    /** 가벼운 화면으로 내려간 까닭(3D로 봤으면 null) */
    fallback: DiagReasonSchema.nullable(),
    tierStart: z.enum(REPORT_TIERS).nullable(),
    tierEnd: z.enum(REPORT_TIERS).nullable(),
    /** 포스터가 보임 · 입장 단추가 풀림 · 입장을 누름 · 입장 뒤 첫 그림 */
    posterMs: sinceOpen,
    readyMs: sinceOpen,
    enterMs: sinceOpen,
    firstFrameMs: sinceOpen,
    /** 관람 중 그린 프레임의 fps 가운데값·하위 10%(움직인 구간만) */
    fpsP50: rate(240),
    fpsP10: rate(240),
    /** 그린 프레임 간격 p95(ms) */
    frameP95Ms: rate(5000),
    /** 누름 → 다음 그림까지(ms) p50·p95와 잰 누름 수 */
    inputP50Ms: rate(5000),
    inputP95Ms: rate(5000),
    inputCount: z.number().int().min(0).max(100_000),
    /** 50ms 넘은 긴 작업 수(Chromium만, 없으면 null) */
    longTasks: z.number().int().min(0).max(100_000).nullable(),
    /** 함께 관람: 이어졌는가 · 받은 양(KB/초) · 한 번에 보인 사람 최대 */
    liveOk: z.boolean().nullable(),
    liveKbps: rate(10_000),
    peersMax: z.number().int().min(0).max(500).nullable(),
    /** 관람한 시간(초) */
    durSec: z.number().int().min(0).max(86_400),
  })
  .strict();
export type DeviceReport = z.infer<typeof DeviceReportSchema>;

export const DiagBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fail'), reason: DiagReasonSchema }).strict(),
  z.object({ kind: z.literal('report'), report: DeviceReportSchema }).strict(),
]);
export type DiagBody = z.infer<typeof DiagBodySchema>;

/** 수업 지도(HT-16): 전시실 하나에 지금 있는 학생 수(관으로 나뉜 전시실은 합쳐서) */
export const LiveRoomCountSchema = z.object({ roomId: UuidSchema, count: z.number().int().min(0) }).strict();
export type LiveRoomCount = z.infer<typeof LiveRoomCountSchema>;

/**
 * 교사 화면용 지금 관람 수(`GET /api/teacher/exhibitions/{id}/live`, FIELD_PLAN HT-07의 서버 쪽):
 * 함께 관람에 이어진 학생·교사 수와, 최근 `DIAG_COUNT_WINDOW_MIN`분 동안 가벼운 화면으로 들어온 수(까닭별).
 * 수업 지도 칸(HT-16, ADR-074, 선택): 전시실별 학생 수 `rooms`, 전시실 밖(홀·광장·복도) `elsewhere`, 위치를 아직 보내지 않은
 * 연결 `noPose`. 개인 위치·토큰·별명은 싣지 않는다. 학생 기기의 배치 판이 최신과 다를 수 있어 근사치다.
 */
export const LiveStatsSchema = z
  .object({
    visitors: z.number().int().min(0),
    teachers: z.number().int().min(0),
    light: z.number().int().min(0),
    reasons: z.partialRecord(DiagReasonSchema, z.number().int().min(0)),
    rooms: z.array(LiveRoomCountSchema).optional(),
    elsewhere: z.number().int().min(0).optional(),
    noPose: z.number().int().min(0).optional(),
  })
  .strict();
export type LiveStats = z.infer<typeof LiveStatsSchema>;
