import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { measureReceivedBytes } from './receivedBytes.ts';

const request = ({ bytes = 100, worker = false, forwarded = false, fail = false } = {}) => ({
  url: () => 'http://127.0.0.1:4521/assets/g/sample.js',
  serviceWorker: () => (worker ? {} : null),
  response: async () => ({ fromServiceWorker: () => forwarded }),
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
