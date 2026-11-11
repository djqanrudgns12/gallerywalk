import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'ops', environment: 'node', include: ['**/*.test.ts'] },
});
