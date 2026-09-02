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

export const MealSlotSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);

export const SaveFoodSchema = z.object({
  name: z.string().min(1).max(120),
  kcal: z.number().int().min(0).max(5000),
  proteinG: z.number().int().min(0).max(500),
  fatG: z.number().int().min(0).max(500).nullish(),
  carbsG: z.number().int().min(0).max(1000).nullish(),
  quickAdd: z.boolean().optional(),
  defaultSlot: MealSlotSchema.nullish(),
});

export const UpdateFoodSchema = SaveFoodSchema.partial();

export const LogMealSchema = z.object({
  slot: MealSlotSchema,
  description: z.string().min(1).max(300),
  kcal: z.number().int().min(0).max(5000).nullish(),
  proteinG: z.number().int().min(0).max(500).nullish(),
  fatG: z.number().int().min(0).max(500).nullish(),
  carbsG: z.number().int().min(0).max(1000).nullish(),
  foodId: z.number().int().positive().nullish(),
  source: z.enum(['moms_food', 'own', 'other']).nullish(),
  eatenAt: z.string().datetime({ offset: true }).optional(),
});

/** Logging a quick-add tile: one id, everything else comes from the library. */
export const LogFoodSchema = z.object({
  foodId: z.number().int().positive(),
  slot: MealSlotSchema.optional(),
});

export const BarcodeQuerySchema = z.object({
  barcode: z.string().regex(/^\d{6,14}$/, 'Not a barcode'),
});

export const SaveScannedSchema = z.object({
  barcode: z.string().regex(/^\d{6,14}$/),
  name: z.string().min(1).max(120),
  kcal: z.number().int().min(0).max(5000),
  proteinG: z.number().int().min(0).max(500),
  fatG: z.number().int().min(0).max(500).nullish(),
  carbsG: z.number().int().min(0).max(1000).nullish(),
});

export const EstimateFoodSchema = z.object({
  text: z.string().min(2).max(400),
});

export const RuleTierSchema = z.enum(['hard', 'soft', 'never']);

export const AddRuleSchema = z.object({
  tier: RuleTierSchema,
  text: z.string().min(3).max(300),
  scope: z.string().max(60).nullish(),
});

export const UpdateRuleSchema = z.object({
  tier: RuleTierSchema.optional(),
  text: z.string().min(3).max(300).optional(),
  scope: z.string().max(60).nullish(),
  active: z.boolean().optional(),
});

export const RegisterPushSchema = z.object({
  token: z.string().min(10).max(200),
  platform: z.string().max(20).nullish(),
});

export const JobNameSchema = z.enum([
  'morning_checkin',
  'dinner_prompt',
  'weekly_review',
  'log_nudge',
]);
