import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../../packages/core/src/config.ts';
import {
  countTogether,
  firstMediaUrls,
  parseOptions,
  planLoad,
  summarize,
  validateTarget,
} from './admission.mjs';

test('첫 관 미디어는 소리의 cover 변형을 한 번 받고 표지 없는 소리·다른 관·줌은 구분한다', () => {
  const variant = (name, ext = 'webp') => ({ name, ext, w: 512, h: 512, bytes: 20 });
  const picture = { assetId: 'picture', variants: ['thumb', 'wall', 'wall-lo', 'zoom'].map(n => variant(n)) };
  const sound = {
    asset: { assetId: 'sound', variants: [variant('audio', 'mp3')] },
    cover: { assetId: 'sound', variants: [variant('cover')] },
  };
  const view = {
    exhibition: { id: 'exhibition', poster: null },
    rooms: [
      { id: 'first', bgm: null },
      { id: 'second', bgm: null },
    ],
    layout: { parts: [{ roomId: 'first' }, { roomId: 'second' }] },
    artworks: [
      { roomId: 'first', image: { asset: picture } },
      { roomId: 'first', audio: sound },
      { roomId: 'first', audio: sound },
      {
        roomId: 'first',
        audio: { asset: { assetId: 'no-cover', variants: [variant('audio', 'mp3')] }, cover: null },
      },
      { roomId: 'second', audio: { ...sound, cover: { assetId: 'later', variants: [variant('cover')] } } },
    ],
  };
  assert.deepEqual(firstMediaUrls(view), [
    '/assets/g/m/exhibition/picture/thumb.webp',
    '/assets/g/m/exhibition/picture/wall.webp',
    '/assets/g/m/exhibition/picture/wall-lo.webp',
    '/assets/g/m/exhibition/sound/cover.webp',
    '/assets/g/m/exhibition/sound/audio.mp3',
    '/assets/g/m/exhibition/no-cover/audio.mp3',
  ]);
});

test('기본은 21대 dry-run이며 네트워크를 실행하지 않는 계획을 만든다', () => {
  const plan = planLoad(parseOptions([]));
  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.clients, 21);
  assert.deepEqual(plan.stages, [
    'HTTP 전시 조회',
    'HTTP 방문자 등록',
    '웹소켓 hello·위치·관람객 확인',
    '첫 관 미디어 받기',
  ]);
  assert.equal(plan.target, 'http://127.0.0.1:4521');
});

test('판정 기준은 요청한 전원·오류 0과 기존 시간 제한을 쓰고 학교망 목표는 미측정으로 표시한다', () => {
  for (const clients of ['21', '30']) {
    const plan = planLoad(parseOptions(['--clients', clients, '--entry-code', '654289']));
    assert.deepEqual(plan.criteria.protocol, {
      completed: Number(clients),
      together: Number(clients),
      errors: 0,
      note: '모든 기기의 HTTP 입장·첫 관 미디어 받기·웹소켓 연결과 상호 위치 수신이 성공해야 합니다.',
    });
    assert.deepEqual(plan.criteria.timeoutsMs, {
      http: config().API_TIMEOUT_MS,
      websocketHello: config().LIVE_HELLO_TIMEOUT_MS,
    });
    assert.deepEqual(plan.criteria.schoolTarget, {
      source: 'PRD §10.1·§15.5 / PLAN §14.5',
      status: '미측정',
      note: '학교 와이파이에서 21대가 동시에 입장해 첫 관람까지 4초 이내. 별도 실기기 확인이 필요합니다.',
    });
    assert.equal(JSON.stringify(plan).includes('654289'), false);
  }
});

test('30대 실행은 입장 코드를 요구하며, 21·30 이외의 수와 긴 실행은 거절한다', () => {
  assert.equal(parseOptions(['--clients', '30']).clients, 30);
  assert.throws(() => parseOptions(['--execute']), /입장 코드/);
  for (const value of ['0', '22', '30.1', '300']) assert.throws(() => parseOptions(['--clients', value]));
  assert.throws(() => parseOptions(['--duration-seconds', '999999']));
  assert.throws(() => parseOptions(['--unknown']));
});

test('운영·다른 앱·URL 정규화 우회 주소는 dry-run에서도 거절한다', () => {
  for (const target of [
    'http://127.0.0.1:4520',
    'http://localhost:4521',
    'http://127.1:4521',
    'http://127.0.0.1:4521@evil.example',
    'http://127.0.0.1:4521/api',
    'https://gallery.ssamuniverse.com',
  ])
    assert.throws(() => validateTarget(target));
});

test('요청 오류를 지연 표본에서 숨기지 않고 p95·오류율·수신량을 함께 기록한다', () => {
  const summary = summarize([
    { stage: 'entry', ok: true, ms: 4, bytes: 10 },
    { stage: 'entry', ok: false, ms: 30, bytes: 8 },
    { stage: 'media', ok: true, ms: 2, bytes: 100 },
    { stage: 'entry', ok: true, ms: 10, bytes: 20 },
  ]);
  assert.deepEqual(summary.entry, {
    requests: 3,
    errors: 1,
    errorRate: 1 / 3,
    p50Ms: 10,
    p95Ms: 30,
    bytes: 38,
  });
  assert.deepEqual(summary.media, { requests: 1, errors: 0, errorRate: 0, p50Ms: 2, p95Ms: 2, bytes: 100 });
});

test('기존 관람객 수만 많아도 이번 기기나 그 위치가 빠지면 함께 관람 성공으로 세지 않는다', () => {
  const left = {
    sid: 'left',
    welcomed: true,
    unexpectedClose: false,
    protocolErrors: 0,
    peers: new Set(['old-1', 'old-2']),
    posePeers: new Set(['old-1', 'old-2']),
  };
  const right = {
    sid: 'right',
    welcomed: true,
    unexpectedClose: false,
    protocolErrors: 0,
    peers: new Set(['left']),
    posePeers: new Set(['left']),
  };
  assert.equal(countTogether([left, right]), 1);
  left.peers.add('right');
  assert.equal(countTogether([left, right]), 1);
  left.posePeers.add('right');
  assert.equal(countTogether([left, right]), 2);
  right.unexpectedClose = true;
  assert.equal(countTogether([left, right]), 1);
});
