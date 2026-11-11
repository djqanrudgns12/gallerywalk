import { createHash } from 'node:crypto';

export function hashForTest(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
