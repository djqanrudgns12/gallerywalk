import { EpochMsSchema, UuidSchema } from '@gallery/core/types';
import { z } from 'zod';

export const WorkerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('APP_START') }),
  z.object({ type: z.literal('SCREEN_RESUME') }),
  z.object({ type: z.literal('REMEMBER_EXHIBITION'), exhibitionId: UuidSchema, expiresAt: EpochMsSchema }),
  z.object({ type: z.literal('PRELOAD_URL'), url: z.string().min(1) }),
]);
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;
export const WorkerReplySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DONE') }),
  z.object({ kind: z.literal('CACHED'), bytes: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('NO_SPACE') }),
  z.object({ kind: z.literal('FAILED') }),
]);
export type WorkerReply = z.infer<typeof WorkerReplySchema>;
