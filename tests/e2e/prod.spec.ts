import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';
import { makeTaggedMp3, makeWorkspace } from '../../apps/server/test/fixtures/make.ts';
import { config } from '../../packages/core/src/config.ts';
import { copy } from '../../packages/core/src/copy/ko.ts';
import { okEnvelope } from '../../packages/core/src/types/api.ts';
import { ArtworkTeacherSchema, CreateFileArtworkMetaSchema } from '../../packages/core/src/types/artwork.ts';
import { mediaPath, type AssetRef } from '../../packages/core/src/types/media.ts';
import {
  TeacherExhibitionViewSchema,
  type ExhibitionView,
} from '../../packages/core/src/types/exhibition.ts';
import { readStudentExhibition, seedStudentExhibition, type SeededExhibition } from './support/exhibition.ts';
import { measureReceivedBytes } from './support/receivedBytes.ts';

// 방문자 본문·교사 저장 값에 토큰이 있으므로 자동 기록·storageState를 남기지 않는다.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.setTimeout(480_000);
test.skip(process.env['GALLERY_PROD_E2E'] !== '1', 'run-prod.mjs로 운영 웹 빌드를 준비한 경우에만 실행');
const READY_MS = 60_000;
const WALK_MS = 90_000;
// PRD 10.1의 고정 완료 기준. 1MB = 1,000,000B이며 음악도 합계에서 빼지 않는다.
const FIRST_RECEIVE_BUDGET_BYTES = 6_000_000;
const SHOTS = '.local/screens/prod';

/** 미리 받기 구현을 호출하지 않고 공개 전시 자료에서 전 관의 필수 파일을 모은다. */
function wholeMedia(view: ExhibitionView): string[] {
  const urls = new Set<string>();
  const append = (asset: AssetRef | null | undefined, names: readonly string[]): void => {
    for (const variant of asset?.variants ?? [])
      if (names.includes(variant.name)) urls.add(mediaPath(view.exhibition.id, asset!.assetId, variant));
  };
  const poster = view.exhibition.poster;
  const posterVariant = ['wall', 'wall-lo', 'thumb'].find(name =>
    poster?.variants.some(v => v.name === name),
  );
  if (posterVariant) append(poster, [posterVariant]);
  for (const frame of view.layout.frames) {
    const art = view.artworks.find(art => art.id === frame.artworkId);
    append(art?.image?.asset ?? art?.pages?.[0]?.asset, ['thumb', 'wall', 'wall-lo']);
    append(art?.audio?.cover, ['cover']);
    append(art?.audio?.asset, ['audio']);
  }
  for (const room of view.rooms) append(room.bgm?.asset, ['audio']);
  return [...urls].sort();
}

/** 기존 합성 MP3 자료를 실제 처리 경로에 넣는다. 교사 자격은 Node fetch 메모리에서만 쓴다. */
async function addCoveredAudio(
  baseURL: string,
  seed: SeededExhibition,
  view: ExhibitionView,
): Promise<string> {
  const roomId = view.layout.parts[0]!.roomId;
  const id = randomUUID();
  const path = join(await makeWorkspace(), 'synthetic-covered.mp3');
  await makeTaggedMp3(path);
  const deviceId = randomUUID();
  const request = async <T>(route: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${baseURL}${route}`, {
      ...init,
      redirect: 'error',
      headers: { Authorization: `Bearer ${seed.teacherToken}`, 'X-Device-Id': deviceId, ...init.headers },
      signal: AbortSignal.timeout(config().API_TIMEOUT_MS),
    });
    expect(response.status).toBe(200);
    const wire: unknown = await response.json();
    return okEnvelope(schema).parse(wire).data;
  };
  const form = new FormData();
  form.set(
    'meta',
    JSON.stringify(
      CreateFileArtworkMetaSchema.parse({
        id,
        roomId,
        order: Math.max(...view.artworks.filter(art => art.roomId === roomId).map(art => art.order)) + 1,
        title: '표지 있는 합성 소리',
        kind: 'AUDIO',
      }),
    ),
  );
  form.set(
    'file',
    new Blob([new Uint8Array(readFileSync(path))], { type: 'audio/mpeg' }),
    'synthetic-covered.mp3',
  );
  const base = `/api/teacher/exhibitions/${seed.exhibitionId}`;
  const uploaded = await request(`${base}/artworks`, ArtworkTeacherSchema, { method: 'POST', body: form });
  expect(uploaded.id).toBe(id);
  await expect
    .poll(
      async () => {
        const teacher = await request(base, TeacherExhibitionViewSchema);
        return teacher.artworks.find(art => art.id === id);
      },
      { timeout: READY_MS },
    )
    .toMatchObject({
      status: 'HIDDEN',
      audio: { cover: { variants: [{ name: 'cover', ext: 'webp' }] } },
    });
  const published = await request('/api/teacher/artworks/batch', z.object({ changed: z.literal(1) }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'PUBLISH', ids: [id] }),
  });
  expect(published.changed).toBe(1);
  return id;
}

async function enter(page: Page): Promise<void> {
  await expect(page.getByTestId('enter-plaza-btn')).toBeEnabled({ timeout: READY_MS });
  await page.getByTestId('enter-plaza-btn').click();
  await expect(page.getByTestId('visit-screen')).toHaveAttribute('data-entered', '1');
  await expect(page.getByTestId('entry-poster')).toBeHidden();
  await expect(page.getByTestId('walk-nav')).toBeVisible();
  await page.waitForFunction(
    () => Number(document.querySelector('[data-testid="walk-perf"]')?.getAttribute('data-frames')) > 0,
  );
}

test('운영 빌드 · 첫 받기 6MB · 전체 미리 받기 · 연결 없이 새 탭에서 포스터와 첫 관', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'prod', 'prod 프로젝트에서만 실행');
  expect(info.project.name).toBe('prod');
  expect(baseURL).toBe('http://127.0.0.1:4521');
  // 개발 HTML이 우연히 성공하는 것을 막는다. SW 실제 빌드와 /@vite/client 부재를 본다.
  const workerResponse = await fetch(`${baseURL}/sw.js`);
  expect(workerResponse.status).toBe(200);
  expect(workerResponse.headers.get('content-type')).toMatch(/javascript/);
  const workerBody = await workerResponse.arrayBuffer();
  const workerSource = Buffer.from(workerBody).toString('utf8');
  const workerHeaderBytes = Buffer.byteLength(
    `HTTP/1.1 ${workerResponse.status} ${workerResponse.statusText}\r\n` +
      [...workerResponse.headers].map(([key, value]) => `${key}: ${value}\r\n`).join('') +
      '\r\n',
  );
  expect(workerSource).not.toContain('__GALLERY_SW_MANIFEST__');
  const shell = await (await fetch(`${baseURL}/`)).text();
  expect(shell).not.toContain('/@vite/client');
  const buildHash = createHash('sha256').update(workerSource).digest('hex');
  const seed = await seedStudentExhibition();
  const coveredAudioId = await addCoveredAudio(baseURL!, seed, await readStudentExhibition(seed.entryCode));
  const view = await readStudentExhibition(seed.entryCode);
  const expectedMedia = wholeMedia(view);
  const cover = view.artworks.find(art => art.id === coveredAudioId)?.audio?.cover;
  expect(cover?.variants.map(variant => variant.name)).toEqual(['cover']);
  expect(view.layout.frames.some(frame => frame.artworkId === coveredAudioId)).toBe(true);
  const coverPath = mediaPath(view.exhibition.id, cover!.assetId, cover!.variants[0]!);
  expect(expectedMedia).toContain(coverPath);
  expect(view.rooms.length).toBeGreaterThan(1);
  expect(expectedMedia.length).toBeGreaterThan(0);
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync('.local/perf', { recursive: true });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const meter = measureReceivedBytes(context);
  let socketBytes = 0;
  page.on('websocket', socket =>
    socket.on('framereceived', frame => {
      socketBytes +=
        typeof frame.payload === 'string' ? Buffer.byteLength(frame.payload) : frame.payload.byteLength;
    }),
  );
  // 운영 CSP 안에서만 깨지는 것(ADR-069: 변환기의 문자열 실행으로 캐릭터·템플릿 glb가 끝내 안 읽힘)을 잡는다
  const cspProblems: string[] = [];
  const isCspProblem = (text: string): boolean => /Content Security Policy|EvalError/.test(text);
  page.on('console', message => {
    if (message.type() === 'error' && isCspProblem(message.text()))
      cspProblems.push(message.text().slice(0, 300));
  });
  page.on('pageerror', error => {
    if (isCspProblem(String(error))) cspProblems.push(String(error).slice(0, 300));
  });
  const isGet = (method: string): boolean => method === 'GET';
  const characterGlb = page.waitForResponse(
    response =>
      /\/assets\/g\/chr-\d+\/[\w-]+\.glb$/.test(response.url()) && isGet(response.request().method()),
    { timeout: READY_MS },
  );
  const transcoderWasm = page.waitForResponse(response => response.url().endsWith('/basis_transcoder.wasm'), {
    timeout: READY_MS,
  });
  await page.goto(`/${seed.entryCode}`);
  await expect(page.getByTestId('entry-poster')).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: READY_MS });
  const enteredAt = Date.now();
  await enter(page);
  expect((await characterGlb).status()).toBe(200);
  expect((await transcoderWasm).status()).toBe(200);
  const entranceMs = Date.now() - enteredAt;
  const entranceSocketBytes = socketBytes;
  const received = await meter.stop();
  // Chromium이 SW 주 스크립트 자체의 요청을 사건으로 내주지 않는 경우도 누락하지 않는다.
  // 사전 읽은 동일 응답의 본문·머리를 보수적으로 더한다. worker.fetch 요청들은 meter가 따로 센다.
  const workerScriptFallbackBytes =
    received.workerScriptRequests === 0 ? workerBody.byteLength + workerHeaderBytes : 0;
  const firstReceive = {
    at: new Date().toISOString(),
    buildHash,
    viewport: page.viewportSize(),
    ...received,
    workerScriptFallbackBytes,
    websocketPayloadBytes: entranceSocketBytes,
    totalWithWebsocketBytes: received.totalBytes + workerScriptFallbackBytes + entranceSocketBytes,
    entranceMs,
    budgetBytes: FIRST_RECEIVE_BUDGET_BYTES,
    method: '새 context·HTTP 캐시 끔. 입장 완료 전 시작한 HTTP 응답은 끝까지 합산. SW 전달 응답 중복 제외.',
  };
  appendFileSync('.local/perf/prod-first-receive.jsonl', `${JSON.stringify(firstReceive)}\n`);
  console.log('운영 첫 받기', JSON.stringify(firstReceive));
  expect(received.errors).toEqual([]);
  // 변환기 일꾼이 wasm을 받은 뒤 시작할 때 위반이 찍힌다. 정지 화면은 다시 그리지 않으므로(프레임 수로 기다릴 수 없음) 잠깐 둔다
  await page.waitForTimeout(2_000);
  expect(cspProblems).toEqual([]);
  expect(received.failedRequests).toBe(0);
  expect(received.workerRequests).toBeGreaterThan(0);
  expect(received.bodyBytes).toBeGreaterThan(0);
  expect(firstReceive.totalWithWebsocketBytes).toBeLessThanOrEqual(FIRST_RECEIVE_BUDGET_BYTES);

  // 같은 기기의 교사 화면에서 실제 메뉴를 눌러 전체를 받는다. 인증은 메모리에만 있고 trace는 꺼져 있다.
  await page.evaluate(
    ({ id, token }) =>
      localStorage.setItem(
        `gw:teacher:${id}`,
        JSON.stringify({
          kind: 'LINK',
          token,
          linkToken: token,
          pendingLinkToken: null,
        }),
      ),
    { id: seed.exhibitionId, token: seed.teacherToken },
  );
  await page.goto(`/t/e/${seed.exhibitionId}`);
  await expect(page.getByTestId('teacher-manage')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('manage-menu-trigger').click();
  await page.getByTestId('menu-preload').click();
  await expect(page.getByTestId('preload-ready')).toBeVisible({ timeout: READY_MS });
  await expect(page.getByTestId('preload-ready')).toContainText(copy.teacher.preload.ready.split('{')[0]!);
  await expect(page.getByTestId('preload-progress')).toHaveAttribute('data-kind', 'READY');
  const cacheState = await page.evaluate(async id => {
    const media = await caches.open(`gallery-exhibition-${id}`);
    const mediaKeys = (await media.keys()).map(req => new URL(req.url).pathname).sort();
    const shellNames = (await caches.keys()).filter(name => name.startsWith('gallery-shell-'));
    const shellKeys: string[] = [];
    for (const name of shellNames)
      for (const req of await (await caches.open(name)).keys()) shellKeys.push(new URL(req.url).pathname);
    return { mediaKeys, shellKeys };
  }, seed.exhibitionId);
  for (const path of expectedMedia) expect(cacheState.mediaKeys).toContain(path);
  for (const model of ['core', 'exterior', 'fixtures'])
    expect(cacheState.shellKeys.some(path => new RegExp(`/${model}-[^/]+\\.glb$`).test(path))).toBe(true);

  // SW가 공개 API도 저장한 뒤 실제 탭을 닫는다. 새 탭은 JS 메모리와 관람 상태를 재사용할 수 없다.
  await page.goto(`/${seed.entryCode}`);
  await expect(page.getByTestId('enter-plaza-btn')).toBeEnabled({ timeout: READY_MS });
  const cachedApi = await page.evaluate(
    async ({ id, code }) =>
      (await (await caches.open(`gallery-exhibition-${id}`)).match(`/api/e/${code}`))?.status,
    { id: seed.exhibitionId, code: seed.entryCode },
  );
  expect(cachedApi).toBe(200);
  await page.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  try {
    await offline.goto(`/${seed.entryCode}`);
    await expect(offline.getByTestId('entry-poster')).toBeVisible();
    await offline.screenshot({ path: `${SHOTS}/offline-poster.png`, animations: 'disabled' });
    await enter(offline);
    const firstArtwork = view.layout.stops.findIndex(stop => stop.kind === 'artwork');
    expect(firstArtwork).toBeGreaterThan(0);
    for (let index = 1; index <= firstArtwork; index++) {
      await offline.getByTestId('walk-nav').getByRole('button', { name: copy.viewer.nextArtwork }).click();
      await expect(offline.getByTestId('walk-perf')).toHaveAttribute('data-stop', String(index));
      await expect(offline.getByTestId('walk-perf')).toHaveAttribute('data-mode', 'view', {
        timeout: WALK_MS,
      });
    }
    await expect(offline.getByTestId('near-card')).toBeVisible();
    await expect(offline.locator('canvas').first()).toBeVisible();
    // 전 관의 필수 미디어를 연결 없이 실제로 읽는다. 빈 캐시·빈 응답을 성공으로 세지 않는다.
    const mediaResults = await offline.evaluate(
      async paths =>
        Promise.all(
          paths.map(async path => {
            const response = await fetch(path);
            return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
          }),
        ),
      expectedMedia,
    );
    for (const response of mediaResults) {
      expect(response.status).toBe(200);
      expect(response.bytes).toBeGreaterThan(0);
    }
    await offline.screenshot({ path: `${SHOTS}/offline-first-room.png`, animations: 'disabled' });
    console.log(
      '운영 연결 끊김 검증',
      JSON.stringify({
        buildHash,
        mediaFiles: expectedMedia.length,
        cachedMediaFiles: cacheState.mediaKeys.length,
        firstArtworkStop: firstArtwork,
      }),
    );
  } finally {
    await context.setOffline(false);
  }
});
