import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { measureReceivedBytes } from './receivedBytes.ts';

const request = ({ bytes = 100, worker = false, forwarded = false, fail = false } = {}) => ({
  url: () => 'http://127.0.0.1:4521/assets/g/sample.js',
  serviceWorker: () => (worker ? {} : null),
  response: async () => ({ fromServiceWorker: () => forwarded, status: () => 200 }),
  sizes: async () => {
    if (fail) throw new Error('읽기 실패');
    return { responseBodySize: bytes, responseHeadersSize: 20 };
  },
});

test('서비스 워커의 실제 받기는 포함하고 화면으로 전달한 같은 응답은 중복 계산하지 않는다', async () => {
  const context = new EventEmitter();
  const meter = measureReceivedBytes(context);
  for (const req of [request(), request({ bytes: 200, worker: true }), request({ forwarded: true })]) {
    context.emit('request', req);
    context.emit('requestfinished', req);
  }
  const result = await meter.stop();
  assert.equal(result.bodyBytes, 300);
  assert.equal(result.headerBytes, 40);
  assert.equal(result.totalBytes, 340);
  assert.equal(result.networkRequests, 2);
  assert.equal(result.workerRequests, 1);
  assert.equal(result.forwardedResponses, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(context.listenerCount('request'), 0);
});

test('입장 완료 때 진행 중인 요청도 끝까지 세며, 그 뒤 시작된 요청은 제외한다', async () => {
  const context = new EventEmitter();
  const meter = measureReceivedBytes(context);
  const pending = request({ bytes: 321 });
  context.emit('request', pending);
  const stopping = meter.stop();
  const late = request({ bytes: 999 });
  context.emit('request', late);
  context.emit('requestfinished', late);
  context.emit('requestfinished', pending);
  assert.equal((await stopping).bodyBytes, 321);
});

test('크기를 못 읽거나 요청이 실패하면 0바이트 성공으로 숨기지 않는다', async () => {
  const context = new EventEmitter();
  const meter = measureReceivedBytes(context);
  const unreadable = request({ fail: true });
  const failed = request();
  context.emit('request', unreadable);
  context.emit('request', failed);
  context.emit('requestfinished', unreadable);
  context.emit('requestfailed', failed);
  const result = await meter.stop();
  assert.equal(result.failedRequests, 1);
  assert.equal(result.errors.length, 1);
});

test('CDP가 음수 본문 크기를 주면 응답의 인코딩된 Content-Length로 보수적으로 센다', async () => {
  const context = new EventEmitter();
  const meter = measureReceivedBytes(context);
  const req = {
    ...request({ bytes: -20, worker: true }),
    response: async () => ({
      fromServiceWorker: () => false,
      status: () => 200,
      statusText: () => 'OK',
      headersArray: async () => [
        { name: 'Content-Length', value: '123' },
        { name: 'Content-Encoding', value: 'gzip' },
      ],
    }),
  };
  context.emit('request', req);
  context.emit('requestfinished', req);
  const result = await meter.stop();
  assert.equal(result.bodyBytes, 123);
  assert.ok(result.headerBytes >= 20);
  assert.equal(result.workerRequests, 1);
  assert.equal(result.sizeFallbacks, 1);
  assert.deepEqual(result.errors, []);
});

test('CDP 크기도 Content-Length도 없으면 압축 본문을 0으로 세지 않고 실패한다', async () => {
  const context = new EventEmitter();
  const meter = measureReceivedBytes(context);
  const req = {
    ...request({ bytes: -20 }),
    response: async () => ({
      fromServiceWorker: () => false,
      status: () => 200,
      headersArray: async () => [{ name: 'Content-Encoding', value: 'gzip' }],
    }),
  };
  context.emit('request', req);
  context.emit('requestfinished', req);
  assert.equal((await meter.stop()).errors.length, 1);
});

test('종료된 응답의 CDP 크기 약속이 멎어도 Content-Length로 세고 요청 종료 시간 초과와 구별한다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const context = new EventEmitter();
  const meter = measureReceivedBytes(context);
  const req = {
    ...request(),
    sizes: () => new Promise(() => {}),
    response: async () => ({
      fromServiceWorker: () => false,
      status: () => 200,
      statusText: () => 'OK',
      headers: () => ({ 'content-length': '123' }),
      headersArray: async () => [{ name: 'Content-Length', value: '123' }],
    }),
  };
  context.emit('request', req);
  context.emit('requestfinished', req);
  // response()를 거쳐 sizes() 대기에 들어간 뒤 stop의 종료 제한을 시작한다.
  await new Promise(resolve => setImmediate(resolve));
  const stopping = meter.stop();
  t.mock.timers.tick(7_500);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(7_500);
  const result = await stopping;
  assert.equal(result.bodyBytes, 123);
  assert.equal(result.sizeFallbacks, 1);
  assert.deepEqual(result.errors, []);
});

test('끝나지 않은 요청은 제외하지 않고 식별 가능한 비밀값 없는 진단과 함께 실패한다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const context = new EventEmitter();
  const meter = measureReceivedBytes(context);
  const req = { ...request(), url: () => 'http://127.0.0.1:4521/api/e/private-code?token=private-token' };
  context.emit('request', req);
  const stopping = meter.stop();
  t.mock.timers.tick(15_000);
  const result = await stopping;
  assert.equal(result.errors.length, 1);
  assert.equal(result.diagnostics?.[0]?.phase, 'request');
  assert.equal(result.diagnostics?.[0]?.kind, 'api');
  assert.doesNotMatch(JSON.stringify(result), /private-code|private-token/);
});

test('requestfinished 뒤 응답 메타데이터가 없으면 네트워크 종료 대기와 구별해 실패한다', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const context = new EventEmitter();
  const meter = measureReceivedBytes(context);
  const req = {
    ...request({ worker: true }),
    url: () => 'http://127.0.0.1:4521/sw.js',
    response: () => new Promise(() => {}),
  };
  context.emit('request', req);
  context.emit('requestfinished', req);
  const stopping = meter.stop();
  t.mock.timers.tick(3_750);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(11_250);
  const result = await stopping;
  assert.deepEqual(result.errors, ['종료된 HTTP 요청의 응답 메타데이터 확인 실패']);
  assert.equal(result.diagnostics[0].kind, 'worker-script');
  assert.equal(result.diagnostics[0].worker, true);
  assert.equal(result.diagnostics[0].phase, 'response');
  assert.equal(typeof result.diagnostics[0].finishedMs, 'number');
  assert.equal(result.networkRequests, 0);
});
