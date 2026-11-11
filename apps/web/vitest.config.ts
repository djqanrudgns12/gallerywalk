import { defaultClientConditions } from 'vite';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['@gallery/source', ...defaultClientConditions] },
  test: { name: 'web', environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
