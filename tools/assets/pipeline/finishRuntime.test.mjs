import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishRuntime } from './finishRuntime.mjs';

test('로컬 실행은 CI 허용 표시만으로 자원 보호를 건너뛸 수 없다', () => {
  for (const env of [{}, { ASSETS_GITHUB_HOSTED: '1' }, { CI: 'true', ASSETS_GITHUB_HOSTED: '1' }])
    assert.throws(() => finishRuntime(env), /resource-guard/);
});

test('자원 보호 아래의 기본 실행과 Blender 경로 지정은 계속 허용한다', () => {
  assert.equal(finishRuntime({ RESOURCE_GUARD_ACTIVE: '1' }).rebuildAll, false);
  const runtime = finishRuntime({ RESOURCE_GUARD_ACTIVE: '1', BLENDER_BIN: '/tmp/Blender' });
  assert.equal(runtime.blender, '/tmp/Blender');
});

const hosted = {
  ASSETS_GITHUB_HOSTED: '1',
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  RUNNER_OS: 'macOS',
};

test('명시적으로 허용한 GitHub 호스트 macOS에서만 보호기 확인을 생략한다', () => {
  const before = { ...hosted };
  assert.doesNotThrow(() => finishRuntime(hosted));
  assert.deepEqual(hosted, before);
  for (const key of Object.keys(hosted)) {
    const missing = { ...hosted };
    delete missing[key];
    assert.throws(() => finishRuntime(missing), /resource-guard/);
  }
  assert.throws(() => finishRuntime({ ...hosted, RUNNER_ENVIRONMENT: 'self-hosted' }), /resource-guard/);
  assert.throws(() => finishRuntime({ ...hosted, RUNNER_OS: 'Linux' }), /resource-guard/);
});

test('전체 원본 사용은 별도 선택이며 CI 허용만으로 켜지지 않는다', () => {
  assert.equal(finishRuntime(hosted).rebuildAll, false);
  assert.equal(finishRuntime({ ...hosted, ASSETS_REBUILD_ALL: '1' }).rebuildAll, true);
  assert.equal(finishRuntime({ ...hosted, ASSETS_REBUILD_ALL: 'true' }).rebuildAll, false);
});
