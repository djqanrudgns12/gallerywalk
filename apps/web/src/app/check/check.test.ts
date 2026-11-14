import { config } from '@gallery/core/config';
import { copy } from '@gallery/core/copy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyRequest } from '../../sw/routes.ts';
import { TRANSCODER_PATH } from '../../viewer/scene/gltf.ts';
import { CHECK_TRANSCODER_PATH, checkUrls, SW_BYPASS_HEADERS } from './browserDeps.ts';
import { checkLimits } from './limits.ts';
import { deviceLabelOf, requestText, summaryOf } from './report.ts';
import { entryScriptOf, mbpsOf, runCheck, type CheckDeps, type StepId, type StepResult } from './steps.ts';
import {
  BLOCK_PAGE,
  CODE,
  enc,
  fakeDeps,
  GLB_BODY,
  okRoutes,
  THUMB_URL,
  URLS,
  type FakeOptions,
} from './testFakes.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** 가짜 시계를 끝까지 돌려 점검을 마친다 */
const run = async (deps: CheckDeps, code: string | null = null): Promise<readonly StepResult[]> => {
  const done = runCheck(deps, { code });
  await vi.runAllTimersAsync();
  return done;
};

const byId = (results: readonly StepResult[], id: StepId): StepResult => {
  const r = results.find(x => x.id === id);
  if (!r) throw new Error(`step missing: ${id}`);
  return r;
};

const states = (results: readonly StepResult[]): Record<StepId, string> =>
  Object.fromEntries(results.map(r => [r.id, r.state])) as Record<StepId, string>;

const runWith = async (opts: FakeOptions, code: string | null = CODE) => {
  const f = fakeDeps(opts);
  const results = await run(f.deps, code);
  return { ...f, results };
};

const L = checkLimits();
const GALAXY_TAB_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('학교망 점검 단계 판정(가짜 망·가짜 소켓·가짜 시계)', () => {
  it('모두 되면 단계마다 됨, 걸린 시간은 가짜 시계 그대로, 요약은 ok', async () => {
    const { results, calls, socket } = await runWith({});
    expect(states(results)).toEqual({
      server: 'ok',
      app: 'ok',
      space: 'ok',
      decoder: 'ok',
      artwork: 'ok',
      live: 'ok',
      speed: 'ok',
      webgl: 'ok',
    });
    expect(byId(results, 'server').ms).toBe(100);
    expect(byId(results, 'app').ms).toBe(200);
    expect(byId(results, 'space').ms).toBe(200);
    expect(byId(results, 'live').ms).toBe(80);
    // 1MB를 0.2초에 → 40Mbps(따로 큰 파일을 또 받지 않음)
    expect(byId(results, 'speed').mbps).toBe(40);
    expect(summaryOf(results)).toBe('ok');
    // 차례대로, 껍데기에 적힌 첫 묶음 주소를 이어 받는다
    expect(calls).toEqual([
      '/api/health',
      '/',
      '/assets/g/app-abc123.js',
      '/assets/g/exterior-abc.glb',
      ...URLS.decoder,
      `/api/e/${CODE}`,
      THUMB_URL,
    ]);
    // 함께 관람: 입장 코드 주소로 열고, 열리자마자 정상 닫기(hello를 보내지 않음)
    expect(socket.opened).toEqual([URLS.live(CODE)]);
    expect(socket.closes).toEqual([1000]);
  });

  it('①이 시간 상한을 넘으면 ②~⑦은 건너뛰고(받지 않음) 요약은 unreachable, ⑧은 기기 안에서 잰다', async () => {
    const { results, calls, socket } = await runWith({ routes: { ...okRoutes(), '/api/health': 'hang' } });
    expect(byId(results, 'server').state).toBe('fail');
    expect(byId(results, 'server').detail).toContain(`timeout ${L.serverTimeoutMs} ms`);
    for (const id of ['app', 'space', 'decoder', 'artwork', 'live', 'speed'] as const)
      expect(byId(results, id).state).toBe('skip');
    expect(byId(results, 'webgl').state).toBe('ok');
    expect(calls).toEqual(['/api/health']);
    expect(socket.opened).toEqual([]);
    expect(summaryOf(results)).toBe('unreachable');
  });

  it('①에 학교 필터 안내 페이지(200 HTML)가 오면 전시관 응답이 아니므로 막힘', async () => {
    const block = { type: 'text/html', body: enc(BLOCK_PAGE), delayMs: 30 };
    const { results } = await runWith({ routes: { ...okRoutes(), '/api/health': block } });
    expect(byId(results, 'server').state).toBe('fail');
    expect(byId(results, 'server').detail).toContain('not a gallery response');
    expect(summaryOf(results)).toBe('unreachable');
  });

  it('③만 막히면(glb 자리에 안내 HTML) ③ 막힘·⑦ 건너뜀, 나머지는 됨, 요약은 blocked', async () => {
    const block = { type: 'text/html', body: enc(BLOCK_PAGE), delayMs: 30 };
    const { results } = await runWith({ routes: { ...okRoutes(), [URLS.space ?? '']: block } });
    expect(byId(results, 'space').state).toBe('fail');
    expect(byId(results, 'space').detail).toContain('not glb');
    expect(byId(results, 'speed').state).toBe('skip');
    for (const id of ['server', 'app', 'decoder', 'artwork', 'live', 'webgl'] as const)
      expect(byId(results, id).state).toBe('ok');
    expect(summaryOf(results)).toBe('blocked');
  });

  it('④ wasm이 망 오류면 막힘(blocked)', async () => {
    const { results } = await runWith({ routes: { ...okRoutes(), [URLS.decoder[1] ?? '']: 'neterr' } });
    expect(byId(results, 'decoder').state).toBe('fail');
    expect(byId(results, 'decoder').detail).toContain('network error (TypeError)');
    expect(summaryOf(results)).toBe('blocked');
  });

  it('⑥만 막히면(열리기 전에 닫힘) blocked — 닫힘 코드를 기술 이름에 남긴다', async () => {
    const { results } = await runWith({ live: { closeCode: 1006 } });
    expect(byId(results, 'live').state).toBe('fail');
    expect(byId(results, 'live').detail).toContain('closed before open (code 1006)');
    expect(summaryOf(results)).toBe('blocked');
  });

  it('⑥이 열리지도 닫히지도 않으면 시간 상한에서 막힘', async () => {
    const { results, socket } = await runWith({ live: 'hang' });
    expect(byId(results, 'live').state).toBe('fail');
    expect(byId(results, 'live').detail).toContain(`timeout ${L.liveTimeoutMs} ms`);
    expect(socket.closes).toHaveLength(1);
  });

  it('입장 코드가 없으면 ⑤ 건너뜀, ⑥은 형식만 맞는 자리 코드로 연다', async () => {
    const { results, calls, socket } = await runWith({}, null);
    expect(byId(results, 'artwork').state).toBe('skip');
    expect(calls).not.toContain(THUMB_URL);
    expect(socket.opened).toEqual([URLS.live('0'.repeat(config().ENTRY_CODE_DIGITS))]);
    expect(summaryOf(results)).toBe('ok');
  });

  it('⑤ 입장 코드의 전시가 없으면(404 봉투) 망 문제가 아니라 건너뜀', async () => {
    const { results } = await runWith({}, '999999');
    expect(byId(results, 'artwork').state).toBe('skip');
    expect(byId(results, 'artwork').detail).toContain('HTTP 404 E_NOT_FOUND');
    expect(summaryOf(results)).toBe('ok');
  });

  it('⑧ WebGL2를 만들 수 없으면 no3d', async () => {
    const { results } = await runWith({ webgl: false });
    expect(byId(results, 'webgl').state).toBe('fail');
    expect(summaryOf(results)).toBe('no3d');
  });
});

describe('느림 문턱', () => {
  const glb = (delayMs: number, wireBytes: number | null = null) => ({
    routes: {
      ...okRoutes(),
      [URLS.space ?? '']: { type: 'model/gltf-binary', body: GLB_BODY, delayMs, wireBytes },
    },
  });

  it(`⑦ 받는 빠르기가 ${L.slowMbps}Mbps 아래면 느림, 그 값 이상이면 됨`, async () => {
    // 1MB = 8Mbit
    const atLimitMs = (GLB_BODY.byteLength * 8) / (L.slowMbps * 1000);
    const fast = await runWith(glb(atLimitMs));
    expect(byId(fast.results, 'speed').mbps).toBe(L.slowMbps);
    expect(byId(fast.results, 'speed').state).toBe('ok');
    const slow = await runWith(glb(atLimitMs * 1.25));
    expect(byId(slow.results, 'speed').state).toBe('slow');
    expect(summaryOf(slow.results)).toBe('slow');
  });

  it('⑦ 망을 지난 크기(압축된 크기)를 알면 그것으로 잰다', async () => {
    const { results } = await runWith(glb(400, 500_000));
    expect(byId(results, 'speed').mbps).toBe(mbpsOf(500_000, 400));
    expect(byId(results, 'speed').state).toBe('slow');
  });

  it(`① 응답이 ${L.slowLatencyMs}ms보다 늦으면 닿기는 해도 느림`, async () => {
    const health = okRoutes()['/api/health'];
    if (health === undefined || typeof health === 'string') throw new Error('fixture');
    const { results } = await runWith({
      routes: { ...okRoutes(), '/api/health': { ...health, delayMs: L.slowLatencyMs + 1 } },
    });
    expect(byId(results, 'server').state).toBe('slow');
    expect(summaryOf(results)).toBe('slow');
  });
});

describe('정보 담당에게 보낼 글', () => {
  it('copy.check.request를 채우고, 기기는 갈래로만 적으며 원문 UA·입장 코드는 넣지 않는다', async () => {
    const { results } = await runWith({ routes: { ...okRoutes(), [URLS.space ?? '']: 'neterr' } });
    const device = deviceLabelOf(GALAXY_TAB_UA, 5, 800);
    expect(device).toBe('Android tablet');
    const text = requestText(results, { host: 'gallery.test', date: '2026-11-13 09:05', device });
    expect(text).toContain(copy.check.request[0]);
    expect(text).toContain('https://gallery.test');
    expect(text).toContain('2026-11-13 09:05');
    expect(text).toContain('Android tablet');
    // 단계마다 한 줄: 번호. 단계 이름: 상태
    expect(text).toContain(`3. ${copy.check.steps.space}: ${copy.check.state.fail}`);
    expect(text).toContain(`1. ${copy.check.steps.server}: ${copy.check.state.ok}`);
    expect(text).not.toMatch(/\{\w+\}/);
    for (const raw of ['Mozilla', 'SM-X200', 'AppleWebKit', 'Chrome/120', CODE])
      expect(text).not.toContain(raw);
  });

  it('기기 갈래: iPadOS(데스크톱 UA+터치)·안드로이드 휴대폰·터치 노트북', () => {
    const ipad =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    const phone =
      'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
    const win =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0';
    expect(deviceLabelOf(ipad, 5, 820)).toBe('iOS tablet');
    expect(deviceLabelOf(ipad, 0, 900)).toBe('desktop');
    expect(deviceLabelOf(phone, 5, 384)).toBe('Android phone');
    expect(deviceLabelOf(win, 10, 900)).toBe('desktop');
  });
});

describe('주소 고르기', () => {
  it('껍데기 HTML의 같은 출처 module script(여럿이면 마지막)를 첫 묶음으로', () => {
    expect(entryScriptOf('<script type="module" crossorigin src="/assets/g/app-x.js"></script>')).toBe(
      '/assets/g/app-x.js',
    );
    const dev =
      '<script type="module">import RefreshRuntime from "/@react-refresh"</script>' +
      '<script type="module" src="/@vite/client"></script><script type="module" src="/src/main.tsx"></script>';
    expect(entryScriptOf(dev)).toBe('/src/main.tsx');
    expect(
      entryScriptOf('<script src="/a.js"></script><script type="module" src="//cdn.test/x.js"></script>'),
    ).toBe(null);
  });

  it('변환기 경로는 3D 쪽(`gltf.ts`)과 같다', () => {
    expect(CHECK_TRANSCODER_PATH).toBe(TRANSCODER_PATH);
  });

  it('점검 요청은 서비스 워커를 거치지 않는다(기기 저장본으로 "됨"이 되지 않게)', () => {
    const origin = 'https://gallery.test';
    const urls = checkUrls();
    const targets = [
      urls.health,
      urls.shell,
      '/assets/g/app-abc123.js',
      ...(urls.space === null ? [] : [urls.space]),
      ...urls.decoder,
      urls.exhibition(CODE),
      THUMB_URL,
    ];
    for (const url of targets) {
      const req = new Request(new URL(url, origin), { headers: SW_BYPASS_HEADERS });
      expect(classifyRequest(req, origin).kind).toBe('pass');
    }
    // 표시가 없으면 껍데기·묶음·전시는 SW가 맡는다 — 우회 표시가 실제로 하는 일
    expect(classifyRequest(new Request(new URL('/', origin)), origin).kind).toBe('shell');
    expect(classifyRequest(new Request(new URL('/assets/g/app-abc123.js', origin)), origin).kind).toBe(
      'asset',
    );
    expect(classifyRequest(new Request(new URL(urls.exhibition(CODE), origin)), origin).kind).toBe(
      'exhibition',
    );
  });
});
