import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import sharp from 'sharp';
import { isWeakPin } from '../../apps/server/src/security/pin.ts';
import { config } from '../../packages/core/src/config.ts';
import {
  A4_SIZE,
  generateImage,
  generatePageMedia,
  generateTone,
  parseOptions,
  PDF_PAGE_COUNT,
  seedExhibition,
  TONE_SECONDS,
  validateTarget,
  WEBTOON_SIZE,
} from './seed-exhibition.mjs';

const options = { rooms: 2, perRoom: 1, text: 1, title: '합성 시험 전시' };
const json = (data, status = 200) => Response.json({ data, requestId: 'seed-test' }, { status });

// HTTP 경로가 받은 자료로 행을 만들며, 처리 중 → 숨김/게시 상태 전환도 흉내 낸다.
function fakeServer({ failure, processing = true } = {}) {
  const calls = [];
  const rooms = [];
  const artworks = [];
  let polls = 0;
  let exhibition;
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const method = init.method;
    const body = init.body instanceof FormData ? init.body : init.body && JSON.parse(init.body);
    calls.push({ path, method, body, headers: init.headers, redirect: init.redirect, signal: init.signal });
    if (failure?.path === path)
      return Response.json(
        { error: { code: failure.code, message: 'test', retryable: false } },
        { status: failure.status ?? 400 },
      );
    if (path === '/api/teacher/exhibitions') {
      exhibition = { id: body.exhibitionId, status: 'DRAFT' };
      return json({ exhibitionId: exhibition.id, entryCode: '654289', expiresAt: Date.now() });
    }
    const base = `/api/teacher/exhibitions/${exhibition.id}`;
    if (path === `${base}/rooms`) {
      rooms.push(body);
      return json(body);
    }
    if (path === `${base}/artworks`) {
      const meta = body instanceof FormData ? JSON.parse(body.get('meta')) : body;
      const art = {
        ...meta,
        // PDF는 쪽을 다 받고 complete할 때까지 처리 중이다(서버 `completePdfArtwork`).
        status: meta.kind === 'PDF' || (body instanceof FormData && processing) ? 'PROCESSING' : 'PUBLISHED',
        failCode: null,
        pages: meta.kind === 'PDF' ? new Set() : undefined,
      };
      artworks.push(art);
      return json(art);
    }
    const page = /^\/api\/teacher\/artworks\/([0-9a-f-]{36})\/pages\/(\d+)$/.exec(path);
    if (page && method === 'PUT') {
      const art = artworks.find(item => item.id === page[1]);
      assert.ok(art?.kind === 'PDF' && Number(page[2]) >= 1 && Number(page[2]) <= art.pageCount);
      art.pages.add(Number(page[2]));
      return new Response(null, { status: 204 });
    }
    const complete = /^\/api\/teacher\/artworks\/([0-9a-f-]{36})\/complete$/.exec(path);
    if (complete && method === 'POST') {
      const art = artworks.find(item => item.id === complete[1]);
      assert.equal(art?.pages.size, art?.pageCount);
      art.status = 'PUBLISHED';
      return json(art);
    }
    if (path === base && method === 'GET') {
      polls++;
      if (polls > 1) {
        for (const art of artworks) if (art.status === 'PROCESSING') art.status = 'HIDDEN';
      }
      return json({ artworks });
    }
    if (path === '/api/teacher/artworks/batch') {
      assert.equal(body.action, 'PUBLISH');
      for (const id of body.ids) {
        const art = artworks.find(item => item.id === id);
        assert.ok(art && art.status !== 'PROCESSING');
        art.status = 'PUBLISHED';
      }
      return json({ changed: body.ids.length });
    }
    if (path === `${base}/open`) {
      assert.ok(artworks.every(art => art.status === 'PUBLISHED'));
      exhibition.status = 'OPEN';
      return json(exhibition);
    }
    assert.fail(`예상하지 않은 요청 ${method} ${path}`);
  };
  return { fetchImpl, calls, rooms, artworks };
}

const dependencies = server => ({
  fetchImpl: server.fetchImpl,
  createImage: async () => Buffer.from('합성 그림 시험 대역'),
  createPageMedia: async () => ({
    webtoon: Buffer.from('합성 웹툰 대역'),
    document: Buffer.from('합성 A4 대역'),
    pdfPages: Array.from({ length: PDF_PAGE_COUNT }, (_, i) => Buffer.from(`합성 쪽 대역 ${i + 1}`)),
    tone: Buffer.from('합성 소리 대역'),
  }),
  sleep: async () => {},
});

const hash = buffer => createHash('sha256').update(buffer).digest('hex');

test('합성 그림은 짧은 변 1600px 이상인 가로·세로·정사각 PNG이고 서로 다르다', async () => {
  const shapes = [];
  const hashes = new Set();
  for (let index = 0; index < 4; index++) {
    const image = await generateImage(index);
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.format, 'png');
    assert.ok(Math.min(metadata.width, metadata.height) >= 1600);
    shapes.push(Math.sign(metadata.width - metadata.height));
    hashes.add(createHash('sha256').update(image).digest('hex'));
  }
  assert.deepEqual(shapes, [1, -1, 0, 1]);
  assert.equal(hashes.size, 4);
});

test('쪽 나눔 자료는 웹툰 800×20000·A4 2480×3508·A4 비율 PDF 5쪽 PNG와 짧은 사인파 WAV다', async () => {
  const media = await generatePageMedia();
  const webtoon = await sharp(media.webtoon).metadata();
  assert.deepEqual([webtoon.format, webtoon.width, webtoon.height], ['png', ...WEBTOON_SIZE]);
  const document = await sharp(media.document).metadata();
  assert.deepEqual([document.format, document.width, document.height], ['png', ...A4_SIZE]);
  assert.equal(media.pdfPages.length, 5);
  for (const page of media.pdfPages) {
    const metadata = await sharp(page).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.height, config().PDF_RENDER_PX);
    assert.ok(Math.abs(metadata.width / metadata.height - A4_SIZE[0] / A4_SIZE[1]) < 0.001);
  }
  // 서버는 같은 전시의 같은 파일을 E_DUPLICATE로 거절하므로 일곱 그림이 모두 달라야 한다.
  assert.equal(new Set([media.webtoon, media.document, ...media.pdfPages].map(hash)).size, 7);
  assert.equal(hash(await generatePageMedia().then(again => again.document)), hash(media.document));

  const tone = media.tone;
  assert.equal(tone.toString('ascii', 0, 4), 'RIFF');
  assert.equal(tone.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(tone.readUInt32LE(4), tone.length - 8);
  const [channels, sampleRate, bits] = [tone.readUInt16LE(22), tone.readUInt32LE(24), tone.readUInt16LE(34)];
  assert.deepEqual([channels, sampleRate, bits], [1, 44_100, 16]);
  const dataBytes = tone.readUInt32LE(40);
  assert.equal(dataBytes / (sampleRate * 2), TONE_SECONDS);
  let peak = 0;
  for (let at = 44; at < tone.length; at += 2) peak = Math.max(peak, Math.abs(tone.readInt16LE(at)));
  assert.ok(peak > 0.25 * 32767 && peak <= 0.3 * 32767 + 1);
  assert.equal(generateTone(1).readUInt32LE(40), 44_100 * 2);
});

test('대상 주소는 127.0.0.1 개발 포트 4521만 받는다', () => {
  assert.equal(validateTarget('http://127.0.0.1:4521'), 'http://127.0.0.1:4521');
  assert.equal(validateTarget('http://127.0.0.1:4521/'), 'http://127.0.0.1:4521');
  for (const target of [
    'http://127.0.0.1:4520',
    'http://localhost:4521',
    'https://127.0.0.1:4521',
    'http://example.com:4521',
    'http://127.0.0.1:4521/api',
    'http://127.0.0.1:4521/?next=4520',
    'http://127.0.0.1:4521/#fragment',
    'http://name@127.0.0.1:4521',
    'http://127.1:4521',
    'http://2130706433:4521',
    'http://127.0.0.1:04521',
    ' http://127.0.0.1:4521',
    '',
    null,
  ])
    assert.throws(
      () => validateTarget(target),
      error => error.stage === '대상 주소 검사',
    );
});

test('명령 옵션을 읽고 잘못된 개수·제목·알 수 없는 옵션을 거절한다', () => {
  const parsed = parseOptions(['--rooms', '3', '--per-room', '6', '--text', '1', '--title', '시험']);
  assert.equal(parsed.rooms, 3);
  assert.equal(parsed.perRoom, 6);
  assert.equal(parsed.text, 1);
  assert.equal(parsed.title, '시험');
  assert.equal(parsed.save, false);
  assert.equal(parseOptions(['--save']).save, true);
  assert.equal(parsed.withPages, false);
  assert.equal(parseOptions(['--with-pages']).withPages, true);
  assert.equal(parseOptions(['--per-room', '0', '--text', '0', '--with-pages']).withPages, true);
  assert.equal(parseOptions(['--per-room', '0', '--text', '1']).perRoom, 0);
  for (const argv of [
    ['--rooms', '0'],
    ['--rooms', '-1'],
    ['--rooms', '1.5'],
    ['--rooms', '1e2'],
    ['--rooms', '9007199254740992'],
    ['--text', '-1'],
    ['--per-room', '0', '--text', '0'],
    ['--title', '   '],
    ['--title', '가'.repeat(41)],
    ['--unknown'],
  ])
    assert.throws(() => parseOptions(argv));
});

test('전시 → 모든 전시실 → 그림 → 글 → 처리 대기 → 게시 → 열기 순서로 요청한다', async () => {
  const server = fakeServer();
  let waits = 0;
  const result = await seedExhibition(options, {
    ...dependencies(server),
    sleep: async () => waits++,
  });
  const base = `/api/teacher/exhibitions/${result.exhibitionId}`;
  assert.deepEqual(
    server.calls.map(({ method, path }) => `${method} ${path}`),
    [
      'POST /api/teacher/exhibitions',
      `POST ${base}/rooms`,
      `POST ${base}/rooms`,
      `POST ${base}/artworks`,
      `POST ${base}/artworks`,
      `POST ${base}/artworks`,
      `GET ${base}`,
      `GET ${base}`,
      'POST /api/teacher/artworks/batch',
      `POST ${base}/open`,
    ],
  );
  assert.equal(waits, 1);
  assert.equal(result.artworks, 3);
  assert.equal(result.entryCode, '654289');
  assert.equal(new Set(server.artworks.map(art => art.id)).size, 3);
  assert.deepEqual(
    server.artworks.map(art => [art.roomId, art.order, art.kind]),
    [
      [server.rooms[0].id, 0, 'IMAGE'],
      [server.rooms[1].id, 0, 'IMAGE'],
      [server.rooms[0].id, 1, 'TEXT'],
    ],
  );
  const uploaded = server.calls.filter(call => call.body instanceof FormData);
  assert.equal(uploaded.length, 2);
  for (const call of uploaded) {
    assert.deepEqual([...call.body.keys()].sort(), ['file', 'meta']);
    assert.equal(call.body.get('file').type, 'image/png');
  }
  const create = server.calls[0];
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(result.teacherToken));
  assert.ok(/^\d{8}$/.test(result.pin) && !isWeakPin(result.pin));
  assert.ok(create.body.linkTokenHash === createHash('sha256').update(result.teacherToken).digest('hex'));
  assert.ok(!JSON.stringify(create.body).includes(result.teacherToken));
  assert.equal(create.headers.has('Authorization'), false);
  for (const call of server.calls) {
    assert.equal(call.redirect, 'error');
    assert.ok(call.signal instanceof AbortSignal);
    assert.match(call.headers.get('X-Device-Id'), /^[0-9a-f-]{36}$/);
  }
  assert.ok(
    server.calls
      .slice(1)
      .every(call => call.headers.get('Authorization') === `Bearer ${result.teacherToken}`),
  );
});

test('--with-pages는 웹툰·A4·PDF 5쪽(쪽 올리기 → 마치기)·소리를 글 다음 자리에 전시실마다 돌아가며 놓는다', async () => {
  const server = fakeServer();
  const result = await seedExhibition({ ...options, withPages: true }, dependencies(server));
  assert.equal(result.artworks, 7);
  assert.deepEqual(result.kinds, { IMAGE: 4, TEXT: 1, PDF: 1, AUDIO: 1 });
  const [r0, r1] = server.rooms.map(room => room.id);
  assert.deepEqual(
    server.artworks.map(art => [art.roomId, art.order, art.kind]),
    [
      [r0, 0, 'IMAGE'],
      [r1, 0, 'IMAGE'],
      [r0, 1, 'TEXT'],
      [r0, 2, 'IMAGE'],
      [r1, 2, 'IMAGE'],
      [r0, 3, 'PDF'],
      [r1, 3, 'AUDIO'],
    ],
  );
  const pdf = server.artworks.find(art => art.kind === 'PDF');
  assert.equal(pdf.pageCount, PDF_PAGE_COUNT);
  const base = `/api/teacher/exhibitions/${result.exhibitionId}`;
  const sequence = server.calls.map(({ method, path }) => `${method} ${path}`);
  const pdfCalls = sequence.slice(sequence.indexOf(`POST ${base}/artworks`) + 5);
  assert.deepEqual(pdfCalls.slice(0, 7), [
    `POST ${base}/artworks`,
    ...[1, 2, 3, 4, 5].map(idx => `PUT /api/teacher/artworks/${pdf.id}/pages/${idx}`),
    `POST /api/teacher/artworks/${pdf.id}/complete`,
  ]);
  assert.ok(
    sequence.indexOf(`POST /api/teacher/artworks/${pdf.id}/complete`) < sequence.indexOf(`GET ${base}`),
  );
  const pageForms = server.calls.filter(call => call.method === 'PUT');
  assert.equal(pageForms.length, PDF_PAGE_COUNT);
  for (const call of pageForms) {
    assert.deepEqual([...call.body.keys()], ['file']);
    assert.equal(call.body.get('file').type, 'image/png');
  }
  const files = server.calls
    .filter(call => call.method === 'POST' && call.body instanceof FormData)
    .map(call => [
      JSON.parse(call.body.get('meta')).kind,
      call.body.get('file').type,
      call.body.get('file').name,
    ]);
  assert.deepEqual(files.slice(2), [
    ['IMAGE', 'image/png', 'synthetic-webtoon.png'],
    ['IMAGE', 'image/png', 'synthetic-report-a4.png'],
    ['AUDIO', 'audio/wav', 'synthetic-tone.wav'],
  ]);
  const batch = server.calls.find(call => call.path === '/api/teacher/artworks/batch');
  assert.deepEqual(
    batch.body.ids,
    server.artworks.map(art => art.id),
  );
  assert.ok(server.artworks.every(art => art.status === 'PUBLISHED'));
});

test('글만 있는 전시를 만들고 글을 여러 전시실에 고르게 나눈다', async () => {
  const server = fakeServer({ processing: false });
  const result = await seedExhibition({ ...options, perRoom: 0, text: 5 }, dependencies(server));
  assert.equal(result.artworks, 5);
  assert.deepEqual(
    server.artworks.map(art => art.order),
    [0, 0, 1, 1, 2],
  );
  assert.deepEqual(
    server.artworks.map(art => art.roomId),
    [server.rooms[0].id, server.rooms[1].id, server.rooms[0].id, server.rooms[1].id, server.rooms[0].id],
  );
});

test('같은 옵션을 다시 실행하면 새 UUID와 교사 자격을 만든다', async () => {
  const first = await seedExhibition(options, dependencies(fakeServer({ processing: false })));
  const second = await seedExhibition(options, dependencies(fakeServer({ processing: false })));
  assert.ok(first.exhibitionId !== second.exhibitionId);
  assert.ok(first.teacherToken !== second.teacherToken);
});

test('서버 실패는 단계·오류 코드만 담고 후속 게시·열기를 중단한다', async () => {
  const server = fakeServer({
    failure: { path: '/api/teacher/artworks/batch', code: 'E_BUSY', status: 503 },
    processing: false,
  });
  await assert.rejects(seedExhibition(options, dependencies(server)), error => {
    assert.equal(error.stage, '작품 게시');
    assert.equal(error.code, 'E_BUSY');
    assert.equal(error.httpStatus, 503);
    assert.match(error.exhibitionId, /^[0-9a-f-]{36}$/);
    assert.ok(!server.calls.some(call => call.path.endsWith('/open')));
    return true;
  });
});

test('처리 실패 작품의 서버 코드를 보고하고 게시 전에 멈춘다', async () => {
  const server = fakeServer({ processing: false });
  const wrapped = async (url, init) => {
    const response = await server.fetchImpl(url, init);
    if (init.method === 'GET') {
      server.artworks[0].status = 'FAILED';
      server.artworks[0].failCode = 'E_FILE_BROKEN';
      return json({ artworks: server.artworks });
    }
    return response;
  };
  await assert.rejects(
    seedExhibition(options, { ...dependencies(server), fetchImpl: wrapped }),
    error => error.stage === '작품 처리 대기' && error.code === 'E_FILE_BROKEN',
  );
  assert.ok(!server.calls.some(call => call.path.endsWith('/open')));
});

test('처리가 끝나지 않으면 제한 시간 뒤 멈춘다', async () => {
  const server = fakeServer();
  let clock = 0;
  const wrapped = async (url, init) => {
    if (init.method === 'GET') return json({ artworks: server.artworks });
    return server.fetchImpl(url, init);
  };
  await assert.rejects(
    seedExhibition(options, {
      ...dependencies(server),
      fetchImpl: wrapped,
      now: () => clock,
      sleep: async () => (clock += 1_000_000),
    }),
    error => error.stage === '작품 처리 대기' && error.code === 'E_BUSY',
  );
});

test('잘못된 응답과 연결 실패를 자격 노출 없이 보고한다', async () => {
  for (const fetchImpl of [
    async () => json({ exhibitionId: 'bad' }),
    async () => new Response('잘못된 JSON', { status: 502 }),
    async () => {
      throw new Error('시험용 연결 실패');
    },
  ])
    await assert.rejects(seedExhibition(options, { fetchImpl }), error => {
      assert.equal(error.stage, '전시 만들기');
      assert.ok(['E_SERVER', 'E_OFFLINE'].includes(error.code));
      assert.ok(!error.message.includes('시험용 연결 실패'));
      return true;
    });
});

test('허용되지 않은 대상은 fetch 호출 전에 거절한다', async () => {
  let called = false;
  await assert.rejects(
    seedExhibition(
      { ...options, baseUrl: 'http://127.0.0.1:4520' },
      {
        fetchImpl: async () => {
          called = true;
        },
      },
    ),
  );
  assert.equal(called, false);
});

test('CLI 입력 실패는 stdout 없이 끝 코드 1과 단계·코드를 출력한다', () => {
  const result = spawnSync(process.execPath, ['tools/dev/seed-exhibition.mjs', '--rooms', '0'], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr);
  assert.equal(error.stage, '옵션 검사');
  assert.equal(error.code, 'E_VALIDATION');
});
