import { defineConfig, devices } from '@playwright/test';

/**
 * 화면 시험(PLAN §14.4). 무거운 실행이라 `resource-guard run --profile test -- npx playwright test --workers=1`로 돌린다.
 * 헤드리스에서도 requestAnimationFrame이 돌아 3D 이동·줌을 확인할 수 있다(숨긴 내장 브라우저 창과 다름).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: '.local/test-results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4522',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev -w @gallery/server',
      url: 'http://127.0.0.1:4521/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -w @gallery/web',
      url: 'http://127.0.0.1:4522/dev/viewer',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
