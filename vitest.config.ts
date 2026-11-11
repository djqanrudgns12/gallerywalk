import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/core', 'apps/server', 'apps/web', 'ops'],
    // 아직 시험이 없는 묶음이 있어도 실패로 치지 않는다(P1 기반 단계).
    passWithNoTests: true,
  },
});
