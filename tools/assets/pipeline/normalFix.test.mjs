// node --test tools/assets/pipeline/normalFix.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRule, inRule, NORMAL_FIXES, tilt } from './normalFix.mjs';

const rule = {
  what: '시험',
  uv: [0.1, 0.1, 0.2, 0.2],
  pos: [
    [-1, -1, 0],
    [1, 1, 1],
  ],
  toward: [0, 0, 2],
  blend: 1,
};

test('UV 상자와 위치 상자 둘 다 안이어야 고른다', () => {
  assert.equal(inRule([0, 0, 0.5], [0.15, 0.15], rule), true);
  assert.equal(inRule([0, 0, 0.5], [0.25, 0.15], rule), false, 'UV 밖');
  assert.equal(inRule([0, 0, -0.5], [0.15, 0.15], rule), false, '위치 밖(뒤통수 쪽 같은 UV)');
});

test('blend 1이면 toward 방향 단위 벡터, 0이면 그대로(정규화)', () => {
  assert.deepEqual(tilt([0, 0, -1], rule), [0, 0, 1]);
  const keep = tilt([0, 3, 4], { ...rule, blend: 0 });
  assert.ok(Math.abs(keep[1] - 0.6) < 1e-9 && Math.abs(keep[2] - 0.8) < 1e-9);
  const half = tilt([1, 0, 0], { ...rule, blend: 0.5 });
  assert.ok(Math.abs(Math.hypot(...half) - 1) < 1e-9);
  assert.ok(half[2] > 0 && half[0] > 0);
});

test('정반대 법선을 반만 기울여 0이 되면 toward로', () => {
  assert.deepEqual(tilt([0, 0, -1], { ...rule, blend: 0.5 }), [0, 0, 1]);
});

test('applyRule: 상자 안 꼭짓점만 고치고 개수를 센다', () => {
  const pos = [
    [0, 0, 0.5],
    [0, 0, -0.5],
    [0, 0, 0.5],
  ];
  const uv = [
    [0.15, 0.15],
    [0.15, 0.15],
    [0.5, 0.5],
  ];
  const nor = [
    [0, 0, -1],
    [0, 0, -1],
    [0, 0, -1],
  ];
  const n = applyRule(
    i => pos[i],
    i => uv[i],
    i => nor[i],
    (i, v) => {
      nor[i] = v;
    },
    3,
    rule,
  );
  assert.equal(n, 1);
  assert.deepEqual(nor, [
    [0, 0, 1],
    [0, 0, -1],
    [0, 0, -1],
  ]);
});

test('student-m-01 앞니 규칙: 그림 세션이 잰 섬(1024px x 8~42·y 418~462)과 위치 범위를 감싼다', () => {
  const [r] = NORMAL_FIXES['student-m-01'];
  assert.ok(r);
  assert.ok(inRule([-0.035, 0.657, 0.14], [8 / 1024, 418 / 1024], r));
  assert.ok(inRule([0.016, 0.673, 0.169], [42 / 1024, 462 / 1024], r));
  assert.ok(!inRule([0, 0.66, 0.15], [50 / 1024, 440 / 1024], r), '섬 밖 UV');
  assert.deepEqual(r.toward, [0, 0, 1]);
});
