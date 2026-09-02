/**
 * Request shapes. One definition per payload, shared by the REST routes and the
 * offline sync queue, so the two paths can never drift apart.
 */
import { z } from 'zod';

/**
 * A programme day code — 'A', 'U1', 'Push'. Free text at this layer: which
 * codes are valid depends on the programme the athlete is running, and only
 * the service knows that.
 */
export const TemplateIdSchema = z.string().min(1).max(16);

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

/**
 * Settings. Only the timezone for now — the targets are deliberately not
 * editable from a form, because §7's floors have to sit between any change and
 * the database.
 */
export const UpdateProfileSchema = z
  .object({
    timezone: z.string().min(1).max(64).optional(),
    /** null follows the device. */
    locale: z.string().min(2).max(35).nullish(),
  })
  .refine((body) => body.timezone !== undefined || body.locale !== undefined, {
    message: 'Nothing to change',
  });

/**
 * The questionnaire. Targets are computed from these in code (§1) — the body
 * is described here, never the numbers.
 */
export const OnboardingSchema = z.object({
  name: z.string().min(1).max(80).nullish(),
  sex: z.enum(['male', 'female']),
  birthYear: z.number().int().min(1900).max(2100),
  heightCm: z.number().min(120).max(250),
  weightKg: z.number().min(30).max(300),
  goal: z.enum(['lose', 'maintain', 'gain']),
  goalWeightKg: z.number().min(30).max(300).nullish(),
  trainingDaysPerWeek: z.number().int().min(0).max(7),
  activity: z.enum(['sedentary', 'light', 'moderate', 'active']).optional(),
  weeklyRateKg: z.number().min(0).max(2).optional(),
  timezone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(35).optional(),
});

/** A place he trains. The jsonb blobs are free-form — the trainer reads them. */
const jsonObject = z.record(z.string(), z.unknown());

export const SaveContextSchema = z.object({
  name: z.string().min(1).max(60),
  equipment: jsonObject.optional(),
  foodProfile: jsonObject.optional(),
});

export const UpdateContextSchema = SaveContextSchema.partial().refine(
  (body) => Object.keys(body).length > 0,
  { message: 'Nothing to change' },
);

export const CardioKindSchema = z.enum(['zone2', 'intervals', 'sport', 'walk', 'other']);

export const LogCardioSchema = z.object({
  kind: CardioKindSchema,
  minutes: z.number().int().min(1).max(600),
  description: z.string().max(200).nullish(),
  distanceKm: z.number().min(0).max(500).nullish(),
  avgHr: z.number().int().min(30).max(240).nullish(),
  rpe: z.number().int().min(1).max(10).nullish(),
  performedAt: z.string().datetime({ offset: true }).optional(),
});

export const ChooseProgramSchema = z.object({
  programId: z.number().int().positive(),
});

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

export const FridgePhotoSchema = z.object({
  // Base64, ~8MB of encoded data at most. The photo is never stored.
  imageBase64: z.string().min(100).max(11_000_000),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

export const FridgeItemSchema = z.object({
  name: z.string().min(1).max(80),
  estimatedQty: z.string().max(40).default(''),
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const MealPlanSchema = z.object({
  items: z.array(FridgeItemSchema).min(1).max(40),
  /** The list must have been through his hands — §9 step 3. */
  confirmed: z.literal(true),
});
