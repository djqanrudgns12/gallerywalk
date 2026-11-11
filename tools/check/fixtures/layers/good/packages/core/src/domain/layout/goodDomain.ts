import type { z } from 'zod';
import { type ZodType } from 'zod';
import { config } from '../../config.ts';
import type { Layout } from '../../types/layout.ts';

export type StringSchema = ZodType<string>;
export type Inferred<T extends z.ZodTypeAny> = z.infer<T>;

export function goodDomainFn(layout: Layout): number {
  return layout.schemaVersion * config().MODULE_UNIT_M;
}
