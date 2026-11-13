import { config } from '@gallery/core/config';
import { ApiErrorSchema, AssetRefSchema, mediaPath, okEnvelope, UuidSchema } from '@gallery/core/types';
import { z } from 'zod';
import type { CheckLimits } from './limits.ts';

/**
 * 학교망 점검 단계(FIELD_PLAN HW-00). 브라우저 없이 도는 순수 판정 — 망·소켓·시계·WebGL은 `CheckDeps`로 받는다
 * (실제 것은 `browserDeps.ts`, 시험은 가짜). 단계마다 상태·걸린 시간·기술 이름(`detail`)을 남기고, 서버에는 아무것도 보내지 않는다.
 *
 * 차례: ① 서버 → ② 화면 파일 → ③ 3D 공간 파일 → ④ 3D 변환 도구 → ⑤ 작품 그림(입장 코드가 있을 때만) → ⑥ 함께 관람 연결 →
 * ⑦ 받는 빠르기(③의 크기·시간으로, 따로 받지 않음) → ⑧ 이 기기의 3D 그리기.
 * ①이 막히면 ②~⑦은 건너뛴다. ⑧은 망을 쓰지 않는 기기 안 확인이라 그래도 잰다.
 */

export const STEP_IDS = ['server', 'app', 'space', 'decoder', 'artwork', 'live', 'speed', 'webgl'] as const;
export type StepId = (typeof STEP_IDS)[number];
export type StepState = 'waiting' | 'running' | 'ok' | 'slow' | 'fail' | 'skip';

export interface StepResult {
  readonly id: StepId;
  readonly state: StepState;
  /** 걸린 시간(ms). 재지 않았으면 null */
  readonly ms: number | null;
  /** `자세히`·요청 글에 쓰는 기술 이름(경로·상태 코드·바이트·ms). 화면 문구가 아니다 */
  readonly detail: string;
  /** ⑦ 받는 빠르기(Mbps, 소수 한 자리). 그 밖의 단계는 null */
  readonly mbps: number | null;
}

/** 받은 응답(본문까지 다 받은 것) */
export interface Fetched {
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
  /** 망을 지난 바이트(Resource Timing `encodedBodySize`). 모르면 null — 그때는 `body.byteLength` */
  readonly wireBytes: number | null;
  /** 다른 출처로 넘겨졌으면 그 출처(학교 필터의 차단 안내 쪽 등), 아니면 null */
  readonly redirectedTo: string | null;
}

/** 웹소켓에서 점검이 쓰는 것만 */
export interface SocketProbe {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: ((ev: { readonly code: number }) => void) | null;
  close(code?: number): void;
}

export interface CheckUrls {
  readonly health: string;
  /** 앱 껍데기(`index.html`) — 여기 적힌 첫 묶음(module script)을 이어 받는다 */
  readonly shell: string;
  /** 3D 공간 조각 glb 하나. 템플릿이 없으면 null */
  readonly space: string | null;
  /** KTX2 변환기 파일들(js·wasm) */
  readonly decoder: readonly string[];
  readonly exhibition: (code: string) => string;
  readonly live: (code: string) => string;
}

export interface CheckDeps {
  /** 걸린 시간 재기(ms, 단조) */
  readonly now: () => number;
  /** `ms` 뒤 `fn` 한 번. 돌려준 함수를 부르면 취소 */
  readonly after: (ms: number, fn: () => void) => () => void;
  /** 본문까지 받는다. 망 오류는 던진다. `signal`이 끊기면 그만둔다 */
  readonly fetch: (url: string, signal: AbortSignal) => Promise<Fetched>;
  readonly openSocket: (url: string) => SocketProbe;
  /** WebGL2 컨텍스트를 만들 수 있는지(만들고 바로 놓는다) */
  readonly webgl2: () => boolean;
  readonly urls: CheckUrls;
  readonly limits: CheckLimits;
}

export interface CheckInput {
  /** 형식이 맞는 입장 코드만(아니면 null — ⑤ 건너뜀) */
  readonly code: string | null;
}

// ── 모양 확인: 학교 필터는 막을 때 200 + 안내 HTML을 주기도 해서 상태 코드만으로는 모른다 ──

export type Shape = 'json' | 'html' | 'js' | 'glb' | 'wasm' | 'webp';

const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46] as const; // 'glTF'
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d] as const; // '\0asm'
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46] as const; // 'RIFF'
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50] as const; // 'WEBP'
/** WebP 파일에서 'WEBP' 표시가 놓이는 자리(RIFF 머리 8바이트 뒤) */
const WEBP_MAGIC_AT = 8;

const hasBytes = (body: Uint8Array, magic: readonly number[], at = 0): boolean =>
  body.byteLength >= at + magic.length && magic.every((b, i) => body[at + i] === b);

/** 받은 것이 기대한 종류인지(파일은 앞 바이트, 글은 Content-Type) */
export const shapeOk = (shape: Shape, res: Fetched): boolean => {
  const type = res.contentType.toLowerCase();
  switch (shape) {
    case 'glb':
      return hasBytes(res.body, GLB_MAGIC);
    case 'wasm':
      return hasBytes(res.body, WASM_MAGIC);
    case 'webp':
      return hasBytes(res.body, RIFF_MAGIC) && hasBytes(res.body, WEBP_MAGIC, WEBP_MAGIC_AT);
    case 'js':
      return type.includes('javascript');
    case 'html':
      return type.includes('text/html');
    case 'json':
      return type.includes('json');
  }
};

const SCRIPT_TAG = /<script\b[^>]*>/gi;
const MODULE_TYPE = /\btype\s*=\s*["']?module["']?/i;
const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i;

/**
 * 껍데기 HTML에서 첫 묶음 주소(같은 출처 `/…`의 module script, 여럿이면 마지막 — 개발 서버는 `/@vite/client`가 먼저 온다).
 * 빌드 결과 이름을 코드에 적지 않으려고 받은 `index.html`에서 읽는다.
 */
export const entryScriptOf = (html: string): string | null => {
  let found: string | null = null;
  for (const m of html.matchAll(SCRIPT_TAG)) {
    const tag = m[0];
    if (!MODULE_TYPE.test(tag)) continue;
    const src = SRC_ATTR.exec(tag)?.[1];
    if (src !== undefined && src.startsWith('/') && !src.startsWith('//')) found = src;
  }
  return found;
};

// ── 글 모양(기술 이름) ──

const KB = 1024;
const MB = KB * KB;
/** 비트/바이트 · Mbps 단위 */
const BITS_PER_BYTE = 8;
const BITS_PER_MBIT = 1_000_000;
const MS_PER_SEC = 1000;
const ONE_DECIMAL = 10;

export const formatBytes = (n: number): string =>
  n < KB ? `${n} B` : n < MB ? `${Math.round(n / KB)} KB` : `${(n / MB).toFixed(1)} MB`;

const round1 = (n: number): number => Math.round(n * ONE_DECIMAL) / ONE_DECIMAL;

/** 받은 크기·시간 → Mbps(소수 한 자리) */
export const mbpsOf = (bytes: number, ms: number): number =>
  round1((bytes * BITS_PER_BYTE) / (Math.max(1, ms) / MS_PER_SEC) / BITS_PER_MBIT);

/** 주소 → 보이는 경로(질의 없이). 상대 경로도 받는다 */
const pathOf = (url: string): string => {
  try {
    return new URL(url, 'http://check.invalid').pathname;
  } catch {
    return url;
  }
};

/** 입장 코드는 요청 글·`자세히`에 그대로 싣지 않는다(정보 담당에게 보내는 글이라) */
const maskedCode = (): string => '*'.repeat(config().ENTRY_CODE_DIGITS);
const typeOf = (res: Fetched): string => res.contentType.split(';')[0]?.trim() || 'no content-type';
const decode = (body: Uint8Array): string => new TextDecoder().decode(body);

const parseJson = (body: Uint8Array): unknown => {
  try {
    const value: unknown = JSON.parse(decode(body));
    return value;
  } catch {
    return undefined;
  }
};

// ── 시간 상한이 있는 받기 ──

type Got =
  | { readonly kind: 'ok'; readonly res: Fetched; readonly ms: number }
  | { readonly kind: 'timeout'; readonly ms: number; readonly limitMs: number }
  | { readonly kind: 'error'; readonly ms: number; readonly name: string };

const get = async (deps: CheckDeps, url: string, limitMs: number): Promise<Got> => {
  const ctrl = new AbortController();
  const start = deps.now();
  const limit = Math.max(0, limitMs);
  let cancel = (): void => {};
  const timeout = new Promise<'timeout'>(resolve => {
    cancel = deps.after(limit, () => {
      // 시간 상한을 먼저 알린다 — 멈추기(abort)가 받기를 먼저 실패시키면 '망 오류'로 잘못 적힌다
      resolve('timeout');
      ctrl.abort();
    });
  });
  try {
    const res = await Promise.race([deps.fetch(url, ctrl.signal), timeout]);
    if (res === 'timeout') return { kind: 'timeout', ms: deps.now() - start, limitMs: limit };
    return { kind: 'ok', res, ms: deps.now() - start };
  } catch (err) {
    return { kind: 'error', ms: deps.now() - start, name: err instanceof Error ? err.name : 'Error' };
  } finally {
    cancel();
  }
};

/** 받기 하나의 결과 */
interface FileOutcome {
  readonly ok: boolean;
  readonly ms: number;
  readonly bytes: number;
  /** 빠르기 계산에 쓰는 망을 지난 바이트 */
  readonly wire: number;
  readonly detail: string;
  readonly res: Fetched | null;
}

const failedGet = (label: string, got: Exclude<Got, { kind: 'ok' }>): FileOutcome => ({
  ok: false,
  ms: got.ms,
  bytes: 0,
  wire: 0,
  detail:
    got.kind === 'timeout'
      ? `${label} -> timeout ${got.limitMs} ms`
      : `${label} -> network error (${got.name}), ${got.ms} ms`,
  res: null,
});

/** 받아서 상태 코드·넘겨짐·모양을 본다 */
const getFile = async (
  deps: CheckDeps,
  url: string,
  shape: Shape,
  limitMs: number,
  label = `GET ${pathOf(url)}`,
): Promise<FileOutcome> => {
  const got = await get(deps, url, limitMs);
  if (got.kind !== 'ok') return failedGet(label, got);
  const { res, ms } = got;
  const bytes = res.body.byteLength;
  const base = { ms, bytes, wire: res.wireBytes ?? bytes, res };
  if (res.redirectedTo !== null)
    return { ...base, ok: false, detail: `${label} -> redirected to ${res.redirectedTo}` };
  if (res.status !== 200 && res.status !== 206)
    return { ...base, ok: false, detail: `${label} -> HTTP ${res.status} ${typeOf(res)}` };
  if (!shapeOk(shape, res))
    return {
      ...base,
      ok: false,
      detail: `${label} -> HTTP ${res.status} ${typeOf(res)}, ${formatBytes(bytes)}, not ${shape}`,
    };
  return { ...base, ok: true, detail: `${label} -> HTTP ${res.status}, ${formatBytes(bytes)}, ${ms} ms` };
};

type Patch = Omit<StepResult, 'id'>;

const done = (state: StepState, ms: number | null, detail: string, mbps: number | null = null): Patch => ({
  state,
  ms,
  detail,
  mbps,
});

// ── 단계 ──

const HealthEnvelope = okEnvelope(z.object({ ok: z.boolean() }));

/** ① `GET /api/health`: 전시관 서버가 낸 봉투인지까지 본다(필터 안내 페이지와 가르기) */
const checkServer = async (deps: CheckDeps): Promise<Patch> => {
  const L = deps.limits;
  const label = `GET ${pathOf(deps.urls.health)}`;
  const got = await get(deps, deps.urls.health, L.serverTimeoutMs);
  if (got.kind !== 'ok') {
    const f = failedGet(label, got);
    return done('fail', f.ms, f.detail);
  }
  const { res, ms } = got;
  if (res.redirectedTo !== null) return done('fail', ms, `${label} -> redirected to ${res.redirectedTo}`);
  const parsed = HealthEnvelope.safeParse(parseJson(res.body));
  if (!parsed.success)
    return done('fail', ms, `${label} -> HTTP ${res.status} ${typeOf(res)}, not a gallery response`);
  // 503(서버 점검 필요)이어도 닿기는 했다 — `ok=false`를 기술 이름에 남긴다
  const detail = `${label} -> HTTP ${res.status}, ok=${parsed.data.data.ok}, ${ms} ms`;
  return done(ms > L.slowLatencyMs ? 'slow' : 'ok', ms, detail);
};

/** ② 껍데기 HTML → 그 안의 첫 묶음 JS */
const checkApp = async (deps: CheckDeps): Promise<Patch> => {
  const start = deps.now();
  const left = (): number => deps.limits.fileTimeoutMs - (deps.now() - start);
  const shell = await getFile(deps, deps.urls.shell, 'html', left());
  if (!shell.ok || shell.res === null) return done('fail', deps.now() - start, shell.detail);
  const entry = entryScriptOf(decode(shell.res.body));
  if (entry === null) return done('fail', deps.now() - start, `${shell.detail}; no module script`);
  const js = await getFile(deps, entry, 'js', left());
  return done(js.ok ? 'ok' : 'fail', deps.now() - start, `${shell.detail}; ${js.detail}`);
};

/** ③ 3D 공간 조각 하나(⑦ 빠르기의 재료라 바깥에 결과를 돌려준다) */
const checkSpace = async (
  deps: CheckDeps,
): Promise<{ readonly patch: Patch; readonly file: FileOutcome | null }> => {
  if (deps.urls.space === null) return { patch: done('skip', null, 'no template file'), file: null };
  const file = await getFile(deps, deps.urls.space, 'glb', deps.limits.fileTimeoutMs);
  return { patch: done(file.ok ? 'ok' : 'fail', file.ms, file.detail), file };
};

/** ④ KTX2 변환기(js·wasm). meshopt 해독기는 화면 묶음 안에 들어 있어 따로 받는 파일이 없다 */
const checkDecoder = async (deps: CheckDeps): Promise<Patch> => {
  const start = deps.now();
  const details: string[] = [];
  let ok = true;
  for (const url of deps.urls.decoder) {
    const shape: Shape = url.endsWith('.wasm') ? 'wasm' : 'js';
    const file = await getFile(deps, url, shape, deps.limits.fileTimeoutMs - (deps.now() - start));
    details.push(file.detail);
    if (!file.ok) {
      ok = false;
      break;
    }
  }
  details.push('meshopt: bundled in app JS');
  return done(ok ? 'ok' : 'fail', deps.now() - start, details.join('; '));
};

/** 전시 응답에서 작품 그림 고르기에 쓰는 칸만(나머지 칸은 zod가 버린다) */
const ImageRef = z.object({ asset: AssetRefSchema });
const ThumbSourceEnvelope = okEnvelope(
  z.object({
    exhibition: z.object({ id: UuidSchema, poster: AssetRefSchema.nullable() }),
    artworks: z.array(z.object({ image: ImageRef.nullable(), pages: z.array(ImageRef).nullable() })),
  }),
);
type ThumbSource = z.infer<typeof ThumbSourceEnvelope>['data'];

/** 작은 그림 하나: 그림 작품 → 여러 쪽 작품 첫 쪽 → 포스터 순. `thumb`가 없으면 아무 webp */
export const thumbOf = (view: ThumbSource): { readonly url: string; readonly name: string } | null => {
  const assets = [
    ...view.artworks.flatMap(a => (a.image ? [a.image.asset] : [])),
    ...view.artworks.flatMap(a => {
      const first = a.pages?.[0];
      return first ? [first.asset] : [];
    }),
    ...(view.exhibition.poster ? [view.exhibition.poster] : []),
  ];
  for (const asset of assets) {
    const v =
      asset.variants.find(x => x.name === 'thumb' && x.ext === 'webp') ??
      asset.variants.find(x => x.ext === 'webp');
    if (v) return { url: mediaPath(view.exhibition.id, asset.assetId, v), name: `${v.name}.${v.ext}` };
  }
  return null;
};

/** ⑤ 입장 코드의 전시 → 작은 그림 하나. 코드가 틀렸거나 닫힌 전시면 건너뜀(망 문제가 아님), 속도 칸에 걸리면 막힘 */
const checkArtwork = async (deps: CheckDeps, code: string): Promise<Patch> => {
  const start = deps.now();
  const label = `GET /api/e/${maskedCode()}`;
  const got = await get(deps, deps.urls.exhibition(code), deps.limits.fileTimeoutMs);
  if (got.kind !== 'ok') {
    const f = failedGet(label, got);
    return done('fail', f.ms, f.detail);
  }
  const { res } = got;
  if (res.redirectedTo !== null) return done('fail', got.ms, `${label} -> redirected to ${res.redirectedTo}`);
  const json = parseJson(res.body);
  const view = ThumbSourceEnvelope.safeParse(json);
  if (!view.success) {
    const error = ApiErrorSchema.safeParse(json);
    if (!error.success)
      return done('fail', got.ms, `${label} -> HTTP ${res.status} ${typeOf(res)}, not a gallery response`);
    const errDetail = `${label} -> HTTP ${res.status} ${error.data.error.code}`;
    return done(error.data.error.code === 'E_RATE_LIMITED' ? 'fail' : 'skip', got.ms, errDetail);
  }
  const thumb = thumbOf(view.data.data);
  if (thumb === null) return done('skip', got.ms, `${label} -> HTTP ${res.status}, no artwork image`);
  const file = await getFile(
    deps,
    thumb.url,
    'webp',
    deps.limits.fileTimeoutMs - (deps.now() - start),
    `GET /assets/g/m/.../${thumb.name}`,
  );
  return done(file.ok ? 'ok' : 'fail', deps.now() - start, `${label} -> HTTP ${res.status}; ${file.detail}`);
};

/** 정상 닫기(RFC 6455) */
const NORMAL_CLOSE = 1000;

/**
 * ⑥ 함께 관람 웹소켓: 열리기까지만 잰다. 열리면 `hello`를 보내지 않고 곧바로 닫는다(서버는 기다리던 연결을 치울 뿐 거절로 세지 않음).
 * 입장 코드가 없으면 형식만 맞는 자리 코드로 연다(서버는 열 때 코드 형식만 본다).
 */
const checkLive = (deps: CheckDeps, code: string | null): Promise<Patch> => {
  const url = deps.urls.live(code ?? '0'.repeat(config().ENTRY_CODE_DIGITS));
  const scheme = url.startsWith('wss:') ? 'WSS' : 'WS';
  const label = `${scheme} /api/e/${maskedCode()}/live`;
  const start = deps.now();
  return new Promise<Patch>(resolve => {
    let socket: SocketProbe | null = null;
    let settled = false;
    let cancel = (): void => {};
    const finish = (patch: Patch): void => {
      if (settled) return;
      settled = true;
      cancel();
      if (socket) {
        socket.onopen = null;
        socket.onerror = null;
        socket.onclose = null;
      }
      resolve(patch);
    };
    cancel = deps.after(deps.limits.liveTimeoutMs, () => {
      try {
        socket?.close();
      } catch {
        // 이미 닫혔으면 그만
      }
      finish(done('fail', deps.now() - start, `${label} -> timeout ${deps.limits.liveTimeoutMs} ms`));
    });
    try {
      socket = deps.openSocket(url);
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      finish(done('fail', deps.now() - start, `${label} -> cannot open (${name})`));
      return;
    }
    const s = socket;
    s.onopen = () => {
      const ms = deps.now() - start;
      s.close(NORMAL_CLOSE);
      finish(done(ms > deps.limits.slowLatencyMs ? 'slow' : 'ok', ms, `${label} -> open, ${ms} ms`));
    };
    // 오류 다음에는 늘 close가 온다 — 닫힘 코드까지 남기려고 close에서 끝낸다
    s.onerror = () => {};
    s.onclose = ev =>
      finish(done('fail', deps.now() - start, `${label} -> closed before open (code ${ev.code})`));
  });
};

/** ⑦ ③에서 받은 크기·시간으로 */
const speedOf = (space: FileOutcome | null, L: CheckLimits): Patch => {
  if (space === null || !space.ok) return done('skip', null, 'space file not received');
  const mbps = mbpsOf(space.wire, space.ms);
  const detail = `${formatBytes(space.wire)} / ${space.ms} ms = ${mbps} Mbps (slow < ${L.slowMbps} Mbps)`;
  return done(mbps < L.slowMbps ? 'slow' : 'ok', null, detail, mbps);
};

const checkWebgl = (deps: CheckDeps): Patch => {
  const start = deps.now();
  let ok = false;
  try {
    ok = deps.webgl2();
  } catch {
    ok = false;
  }
  return done(
    ok ? 'ok' : 'fail',
    deps.now() - start,
    ok ? 'WebGL2 context: created' : 'WebGL2 context: unavailable',
  );
};

export const initialResults = (): readonly StepResult[] =>
  STEP_IDS.map(id => ({ id, state: 'waiting', ms: null, detail: '', mbps: null }));

/** 망이 필요한 단계(①이 막히면 나머지를 건너뜀) */
const AFTER_SERVER: readonly StepId[] = ['app', 'space', 'decoder', 'artwork', 'live', 'speed'];

/**
 * 점검 전체를 차례로 돈다. 상태가 바뀔 때마다 `onChange`(화면 다시 그리기), 끝나면 마지막 결과.
 */
export const runCheck = async (
  deps: CheckDeps,
  input: CheckInput,
  onChange: (results: readonly StepResult[]) => void = () => {},
): Promise<readonly StepResult[]> => {
  let results = initialResults();
  const set = (id: StepId, patch: Partial<Patch>): void => {
    results = results.map(r => (r.id === id ? { ...r, ...patch } : r));
    onChange(results);
  };
  const running = { state: 'running' } as const;

  set('server', running);
  const server = await checkServer(deps);
  set('server', server);
  if (server.state === 'fail') {
    for (const id of AFTER_SERVER) set(id, done('skip', null, 'server unreachable'));
  } else {
    set('app', running);
    set('app', await checkApp(deps));
    set('space', running);
    const space = await checkSpace(deps);
    set('space', space.patch);
    set('decoder', running);
    set('decoder', await checkDecoder(deps));
    if (input.code === null) set('artwork', done('skip', null, 'no entry code'));
    else {
      set('artwork', running);
      set('artwork', await checkArtwork(deps, input.code));
    }
    set('live', running);
    set('live', await checkLive(deps, input.code));
    set('speed', speedOf(space.file, deps.limits));
  }
  set('webgl', running);
  set('webgl', checkWebgl(deps));
  return results;
};
