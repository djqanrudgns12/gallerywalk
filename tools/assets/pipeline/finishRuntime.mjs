// Mac mini는 실제 보호기 아래에서만 실행한다. 명시적으로 허용한 GitHub 호스트 macOS만 별도 취급한다.
export const finishRuntime = (env = process.env) => {
  const hosted =
    env.ASSETS_GITHUB_HOSTED === '1' &&
    env.GITHUB_ACTIONS === 'true' &&
    env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    env.RUNNER_OS === 'macOS';
  if (env.RESOURCE_GUARD_ACTIVE !== '1' && !hosted)
    throw new Error('resource-guard run --profile build 아래에서 실행하세요.');
  return {
    blender: env.BLENDER_BIN ?? '/Applications/Blender.app/Contents/MacOS/Blender',
    rebuildAll: env.ASSETS_REBUILD_ALL === '1',
  };
};
