import { defineProject } from 'vitest/config';
import { defaultServerConditions } from 'vite';

export default defineProject({
  ssr: { resolve: { conditions: ['@gallery/source', ...defaultServerConditions] } },
  test: { name: 'server', environment: 'node', include: ['test/**/*.test.ts', 'src/**/*.test.ts'] },
});
