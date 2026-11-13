import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decorationBoundsProblems } from './decorationBounds.mjs';

test('장식 외곽 검사는 봉 받침이 보행 영역에 들어가면 거부한다', () => {
  const size = { w: 1.6, h: 0.72, d: 0.24 };
  assert.deepEqual(
    decorationBoundsProblems('barrier', { min: [-0.8, 0, -0.12], max: [0.8, 0.72, 0.12] }, size, 0.3),
    [],
  );
  assert.deepEqual(
    decorationBoundsProblems('barrier', { min: [-0.8, 0, -0.12], max: [0.8, 0.72, 0.18] }, size, 0.3),
    ['barrier: 장식 깊이 계약 밖'],
  );
});

test('천장 밖·바닥 아래와 계약 자체가 보행 여유보다 큰 경우도 거부한다', () => {
  assert.deepEqual(
    decorationBoundsProblems(
      'artPlinth',
      { min: [-0.4, -0.01, -0.12], max: [0.4, 0.8, 0.12] },
      { w: 0.8, h: 0.72, d: 0.24 },
      0.3,
    ),
    ['artPlinth: 장식 높이 계약 밖'],
  );
  assert.deepEqual(
    decorationBoundsProblems(
      'barrier',
      { min: [-0.8, 0, -0.2], max: [0.8, 0.72, 0.2] },
      { w: 1.6, h: 0.72, d: 0.4 },
      0.3,
    ),
    ['barrier: 장식 계약이 보행 여유 밖'],
  );
});
