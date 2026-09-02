/**
 * Mirrors the server's response shapes. Hand-written rather than generated:
 * one user, a dozen endpoints, and a generator is one more thing to keep alive.
 */

export type TemplateId = 'A' | 'B' | 'C';

export type Profile = {
  heightCm: number;
  birthYear: number | null;
  goalWeightKg: number | null;
  calorieTarget: number;
  proteinTargetG: number;
  fatFloorG: number;
};

export type Context = {
  id: number;
  name: string;
  equipment: Record<string, unknown>;
  foodProfile: Record<string, unknown>;
  isActive: boolean;
};

export type SetRecord = {
  id: number;
  exerciseId: number;
  exerciseName: string;
  setIndex: number;
  weightKg: number;
  reps: number;
  rir: number | null;
};

export type Session = {
  id: number;
  performedAt: string;
  contextId: number | null;
  contextName: string | null;
  template: TemplateId | null;
  rpe: number | null;
  notes: string | null;
  jointPain: boolean;
  finished: boolean;
  sets: SetRecord[];
};

export type PerformedSet = { weightKg: number; reps: number; rir: number | null };

export type PrescriptionReason =
  | 'first_time'
  | 'increase_load'
  | 'increase_reps'
  | 'hold'
  | 'deload'
  | 'joint_pain';

export type ExercisePrescription = {
  exerciseId: number;
  name: string;
  pattern: string;
  sets: number;
  targetReps: number;
  weightKg: number | null;
  reason: PrescriptionReason;
  restSeconds: number;
  incrementKg: number;
  range: { min: number; max: number };
  last: { performedAt: string; sets: PerformedSet[] } | null;
  substitutes: { id: number; name: string; pattern: string }[];
};

export type WorkoutPlan = {
  template: TemplateId;
  rampIn: { active: boolean; maxWorkingSets: number | null; minRir: number };
  jointPain: {
    consecutiveFlags: number;
    holdLoad: boolean;
    reduceLoadPct: number;
    recommendDoctor: boolean;
  };
  exercises: ExercisePrescription[];
};

export type TrendPoint = { date: string; weightKg: number | null; avgKg: number | null };

export type WeightSummary = {
  latest: { measuredOn: string; weightKg: number } | null;
  average7: { avgKg: number; sampleCount: number; windowDays: number } | null;
  changeKg: number | null;
  goalWeightKg: number | null;
  series: TrendPoint[];
};

export type CoachSwap = { from: string; to: string; reason: string };

export type CoachNote = {
  forDate: string;
  sessionType: 'strength' | 'cardio' | 'rest';
  template: TemplateId | null;
  headline: string;
  body: string;
  swaps: CoachSwap[];
};

export type ChatMessage = {
  id: number;
  role: 'user' | 'model';
  createdAt: string;
  text: string;
  toolCalls?: { name: string; ok: boolean }[];
};

export type ChatReply = {
  text: string;
  ranTools: { name: string; ok: boolean }[];
  usage: { promptTokens: number; outputTokens: number; totalTokens: number };
};

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type Food = {
  id: number;
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number | null;
  carbsG: number | null;
  quickAdd: boolean;
  defaultSlot: MealSlot | null;
  timesUsed: number;
  lastUsedAt: string | null;
};

export type Meal = {
  id: number;
  eatenAt: string;
  slot: MealSlot;
  description: string | null;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  foodId: number | null;
  source: string | null;
};

export type BarcodeCandidate = {
  barcode: string;
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number | null;
  carbsG: number | null;
  known: boolean;
  basis: string;
  brand: string | null;
};

export type FoodEstimate = {
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  confidence: 'low' | 'medium' | 'high';
  assumptions: string;
};

export type ExerciseProgress = {
  exerciseId: number;
  name: string;
  pattern: string;
  points: { date: string; weightKg: number; reps: number; estimated1rm: number }[];
};

export type Progress = {
  sessionCount: number;
  setCount: number;
  totalVolumeKg: number;
  exercises: ExerciseProgress[];
};

export type WeeklyReview = {
  weekEnding: string;
  trend: string;
  wentWell: string;
  oneChange: string;
  targetsNote: string | null;
  calorieTarget: number;
  calorieChanged: boolean;
  model: string;
};

export type RuleTier = 'hard' | 'soft' | 'never';

export type Rule = {
  id: number;
  tier: RuleTier;
  text: string;
  scope: string | null;
  /** Non-null when a validator enforces this in code, not just in the prompt. */
  code: string | null;
  active: boolean;
};

export type Today = {
  date: string;
  profile: Profile;
  context: Context | null;
  openSession: Session | null;
  completedToday: Session[];
  plan: WorkoutPlan;
  weight: WeightSummary;
  macros: {
    targets: { kcal: number; proteinG: number; fatFloorG: number };
    consumed: { kcal: number; proteinG: number; fatG: number; carbsG: number };
    remaining: {
      kcal: number;
      proteinG: number;
      fatToFloorG: number;
      kcalPct: number;
      proteinPct: number;
    };
    meals: Meal[];
  };
  week: { strengthSessions: { done: number; target: number } };
  coach: CoachNote | null;
};
