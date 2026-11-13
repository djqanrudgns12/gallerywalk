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
  },
  projects: [
    // 운영 웹 빌드는 support/run-prod.mjs가 한 번 만든 뒤 4521에서 낸다. 평소 개발 시험에서는 켜지 않는다.
    ...(process.env['GALLERY_PROD_E2E'] === '1'
      ? [
          {
            name: 'prod',
            testMatch: 'prod.spec.ts',
            use: {
              ...devices['Desktop Chrome'],
              baseURL: 'http://127.0.0.1:4521',
              serviceWorkers: 'allow' as const,
              trace: 'retain-on-failure' as const,
              launchOptions: {
                args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
              },
            },
          },
        ]
      : []),
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
    // Safari 엔진(U-22 승인, V-33): 배치 해시가 Node와 같은지 + 학생 흐름 데스크톱 한 크기만(무거워서 최소로).
    // `npx playwright test --project=webkit`으로 따로 돌린다
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: ['layout-hash.spec.ts', 'student.spec.ts'],
      grep: /배치 해시|학생 흐름 · desktop/,
    },
  ],
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
