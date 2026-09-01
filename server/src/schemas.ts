/**
 * Request shapes. One definition per payload, shared by the REST routes and the
 * offline sync queue, so the two paths can never drift apart.
 */
import { z } from 'zod';

export const TemplateIdSchema = z.enum(['A', 'B', 'C']);

export const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const CreateSessionSchema = z.object({
  performedAt: z.string().datetime({ offset: true }).optional(),
  contextId: z.number().int().positive().optional(),
  template: TemplateIdSchema,
});

export const FinishSessionSchema = z.object({
  rpe: z.number().int().min(1).max(10).nullish(),
  notes: z.string().max(2000).nullish(),
  jointPain: z.boolean().optional(),
});

export const RecordSetSchema = z.object({
  sessionId: z.number().int().positive(),
  exerciseId: z.number().int().positive(),
  setIndex: z.number().int().min(1).max(20),
  weightKg: z.number().min(0).max(1000),
  reps: z.number().int().min(0).max(100),
  rir: z.number().int().min(0).max(10).nullish(),
});

export const LogWeightSchema = z.object({
  measuredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weightKg: z.number().positive(),
});

/**
 * Offline variants. A queued set may reference a session the server has never
 * seen — one created on the phone moments earlier — so it can point at either a
 * server id or the client uuid of the queued create_session op.
 */
const sessionReference = {
  sessionId: z.number().int().positive().optional(),
  sessionClientId: z.string().uuid().optional(),
};

export const SyncRecordSetSchema = RecordSetSchema.omit({ sessionId: true }).extend(
  sessionReference,
);

export const SyncFinishSessionSchema = FinishSessionSchema.extend(sessionReference);

export const SyncOpSchema = z.discriminatedUnion('op', [
  z.object({
    clientId: z.string().uuid(),
    op: z.literal('create_session'),
    payload: CreateSessionSchema,
  }),
  z.object({
    clientId: z.string().uuid(),
    op: z.literal('record_set'),
    payload: SyncRecordSetSchema,
  }),
  z.object({
    clientId: z.string().uuid(),
    op: z.literal('finish_session'),
    payload: SyncFinishSessionSchema,
  }),
  z.object({
    clientId: z.string().uuid(),
    op: z.literal('log_weight'),
    payload: LogWeightSchema,
  }),
]);

export const SyncBatchSchema = z.object({
  ops: z.array(SyncOpSchema).max(200),
});

export type SyncOp = z.infer<typeof SyncOpSchema>;
