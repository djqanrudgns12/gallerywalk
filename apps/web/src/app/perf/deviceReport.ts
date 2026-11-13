import {
  type DeviceReport,
  type REPORT_BROWSERS,
  type REPORT_GPUS,
  type REPORT_NETS,
  type REPORT_PLATFORMS,
} from '@gallery/core/types';

/**
 * 기기 보고의 갈래 나누기(G-24·G-25 실기기 반응성, ADR-070). 원문(UA·GPU 이름)은 보고에 싣지 않고 몇 갈래로만 묶는다.
 * 모두 순수 함수 — 시험이 UA 글로 바로 확인한다.
 */

type Platform = (typeof REPORT_PLATFORMS)[number];
type Browser = (typeof REPORT_BROWSERS)[number];
type Gpu = (typeof REPORT_GPUS)[number];
type Net = (typeof REPORT_NETS)[number];

/** iPadOS는 데스크톱 Safari처럼 보이므로 'Macintosh' + 터치를 iOS로(품질 단계 `osOf`와 같은 규칙) */
export const platformOf = (ua: string, touchPoints: number): Platform => {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows NT|Macintosh|CrOS|Linux x86_64|X11/.test(ua)) return 'desktop';
  return 'other';
};

/** OS 큰 판. iPadOS 데스크톱 UA는 OS 판이 없어 Safari `Version/`을 대신 쓴다(같은 판으로 나온다) */
export const osMajorOf = (ua: string, platform: Platform): number | null => {
  const num = (m: RegExpExecArray | null): number | null => {
    const n = m?.[1] === undefined ? Number.NaN : Number(m[1]);
    return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
  };
  if (platform === 'ios') return num(/OS (\d+)[_.]\d/.exec(ua)) ?? num(/Version\/(\d+)/.exec(ua));
  if (platform === 'android') return num(/Android (\d+)/.exec(ua));
  return null;
};

/** 앱 안 브라우저(카카오톡·네이버·인스타그램·페이스북·라인·밴드)를 먼저, 그다음 브라우저 갈래 */
export const browserOf = (ua: string): Browser => {
  if (/KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV|\bLine\/|BAND\//i.test(ua)) return 'inapp';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Whale\//.test(ua)) return 'whale';
  if (/Edg(A|iOS)?\//.test(ua)) return 'edge';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
};

/** `WEBGL_debug_renderer_info` 이름 → 갈래(빈 이름은 unknown) */
export const gpuOf = (renderer: string): Gpu => {
  const r = renderer.toLowerCase();
  if (r === '') return 'unknown';
  if (/swiftshader|llvmpipe|software|basic render/.test(r)) return 'software';
  if (/apple/.test(r)) return 'apple';
  if (/mali/.test(r)) return 'mali';
  if (/adreno/.test(r)) return 'adreno';
  if (/powervr|img /.test(r)) return 'powervr';
  if (/intel/.test(r)) return 'intel';
  if (/nvidia|geforce|quadro/.test(r)) return 'nvidia';
  if (/amd|radeon/.test(r)) return 'amd';
  return 'other';
};

const NETS: readonly string[] = ['slow-2g', '2g', '3g', '4g'];
export const netOf = (effectiveType: unknown): Net | null =>
  typeof effectiveType === 'string' && NETS.includes(effectiveType) ? (effectiveType as Net) : null;

/** 정렬한 배열의 p(0~1) 분위(가까운 순위). 비면 null */
export const quantile = (sorted: readonly number[], p: number): number | null => {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i]!;
};

/** 보고 칸 반올림(소수 1자리) — 스키마 범위 밖이면 null */
export const round1 = (n: number | null, max: number): number | null =>
  n === null || !Number.isFinite(n) || n < 0 || n > max ? null : Math.round(n * 10) / 10;

/** 화면을 연 때부터의 ms(정수, 10분 넘으면 null — `DeviceReportSchema`) */
export const sinceOpen = (n: number | null): number | null =>
  n === null || !Number.isFinite(n) || n < 0 || n > 600_000 ? null : Math.round(n);

export type DeviceBasics = Pick<
  DeviceReport,
  'platform' | 'osMajor' | 'browser' | 'device' | 'memGb' | 'net'
>;

/** 브라우저에서 읽는 갈래(UA 원문은 여기서만 보고 버린다) */
export const deviceBasics = (
  nav: {
    readonly userAgent: string;
    readonly maxTouchPoints: number;
    readonly deviceMemory?: unknown;
    readonly connection?: { readonly effectiveType?: unknown } | undefined;
  },
  shortSidePx: number,
): DeviceBasics => {
  const platform = platformOf(nav.userAgent, nav.maxTouchPoints);
  const mem = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
  return {
    platform,
    osMajor: osMajorOf(nav.userAgent, platform),
    browser: browserOf(nav.userAgent),
    device: nav.maxTouchPoints === 0 ? 'desktop' : shortSidePx < 600 ? 'phone' : 'tablet',
    memGb: round1(mem, 64),
    net: netOf(nav.connection?.effectiveType),
  };
};
