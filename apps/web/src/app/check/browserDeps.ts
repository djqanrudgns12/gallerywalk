import { sameOriginLiveUrl } from '../../adapters/live/socket.ts';
import { templateAssets } from '../../viewer/scene/templateAssets.ts';
import { checkLimits } from './limits.ts';
import { deviceLabelOf } from './report.ts';
import type { CheckDeps, CheckUrls, Fetched, SocketProbe } from './steps.ts';

/**
 * 점검의 브라우저 쪽(망·소켓·시계·WebGL). 3D 엔진(three·R3F)은 가져오지 않는다 — 템플릿 조각은 주소 글만
 * (`templateAssets`는 `?url` 주소와 사인 자리 표만 담는다), 변환기 경로는 아래 같은 값을 따로 둔다.
 */

/**
 * `viewer/scene/gltf.ts`의 `TRANSCODER_PATH`와 같은 값. 그 파일은 three를 가져와 점검 묶음에 넣을 수 없어 따로 둔다
 * (`check.test.ts`가 두 값이 같은지 본다). KTX2Loader는 이 폴더에서 아래 두 파일을 받는다.
 */
export const CHECK_TRANSCODER_PATH = '/assets/g/basis-r187-csp1/';
export const TRANSCODER_FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'] as const;

/**
 * 서비스 워커를 건너뛰는 표시. SW는 `Authorization`이 붙은 요청을 맡지 않는다(`sw/routes.ts` `classifyRequest` → `pass`).
 * 그러지 않으면 전에 관람한 기기는 껍데기·묶음·glb를 기기 저장본으로 받아 망이 막혀도 "됨"으로 보인다.
 * 값은 아무 뜻 없는 표시다(토큰 아님). 서버는 `Bearer` 모양이 아니면 보지 않고, 이 경로들은 인증을 묻지 않는다.
 */
export const SW_BYPASS_HEADERS: Readonly<Record<string, string>> = { Authorization: 'gallery-check' };

/** 첫 템플릿의 첫 조각(광장에서 먼저 받는 외관 조각) */
const firstModule = (): string | null => Object.values(templateAssets)[0]?.modules[0] ?? null;

export const checkUrls = (): CheckUrls => ({
  health: '/api/health',
  shell: '/',
  space: firstModule(),
  decoder: TRANSCODER_FILES.map(name => `${CHECK_TRANSCODER_PATH}${name}`),
  exhibition: code => `/api/e/${encodeURIComponent(code)}`,
  live: sameOriginLiveUrl,
});

/** 망을 지난 바이트(압축된 크기). 같은 출처라 Resource Timing이 알려 준다. 모르면 null */
const wireBytesOf = (url: string): number | null => {
  try {
    const entries = performance.getEntriesByName(new URL(url, window.location.href).href, 'resource');
    const last = entries[entries.length - 1];
    return last instanceof PerformanceResourceTiming && last.encodedBodySize > 0
      ? last.encodedBodySize
      : null;
  } catch {
    return null;
  }
};

/** 캐시·서비스 워커를 거치지 않고 본문까지 받는다 */
const fetchNoStore = async (url: string, signal: AbortSignal): Promise<Fetched> => {
  const res = await fetch(url, { cache: 'no-store', signal, headers: SW_BYPASS_HEADERS });
  const body = new Uint8Array(await res.arrayBuffer());
  const here = window.location.origin;
  const finalOrigin = res.url ? new URL(res.url).origin : here;
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    body,
    wireBytes: wireBytesOf(url),
    redirectedTo: res.redirected && finalOrigin !== here ? finalOrigin : null,
  };
};

const openSocket = (url: string): SocketProbe => {
  const ws = new WebSocket(url);
  const probe: SocketProbe = {
    onopen: null,
    onerror: null,
    onclose: null,
    close: code => ws.close(code),
  };
  ws.onopen = () => probe.onopen?.();
  ws.onerror = () => probe.onerror?.();
  ws.onclose = ev => probe.onclose?.({ code: ev.code });
  return probe;
};

/** WebGL2 컨텍스트를 만들어 보고 곧바로 놓는다(3D 관람은 WebGL2가 있어야 한다) */
const webgl2 = (): boolean => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
};

/** 점검 화면이 쓰는 바깥 것 한 묶음(시험은 가짜를 넣는다) */
export interface CheckEnv {
  readonly deps: CheckDeps;
  /** 전시관 주소(요청 글 `{host}`) */
  readonly host: string;
  /** 기기 갈래(요청 글 `{device}`, 원문 UA 아님) */
  readonly device: string;
  /** 지금 시각(epoch ms, 요청 글 `{date}`) */
  readonly clock: () => number;
  /** 글 복사. 못 하면(보안 연결이 아님·권한 없음) 거절 */
  readonly writeClipboard: (text: string) => Promise<void>;
}

export const browserCheckEnv = (userAgent: string): CheckEnv => ({
  deps: browserCheckDeps(),
  host: window.location.host,
  device: deviceLabelOf(
    userAgent,
    navigator.maxTouchPoints,
    Math.min(window.screen.width, window.screen.height),
  ),
  clock: () => Date.now(),
  // 보안 연결이 아니면 `navigator.clipboard`가 없다 → 여기서 던져 거절로 바뀐다
  writeClipboard: async text => {
    await navigator.clipboard.writeText(text);
  },
});

export const browserCheckDeps = (): CheckDeps => ({
  now: () => performance.now(),
  after: (ms, fn) => {
    const id = window.setTimeout(fn, ms);
    return () => window.clearTimeout(id);
  },
  fetch: fetchNoStore,
  openSocket,
  webgl2,
  urls: checkUrls(),
  limits: checkLimits(),
});
