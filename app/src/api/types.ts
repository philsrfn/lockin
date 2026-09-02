/**
 * Mirrors the server's response shapes. Hand-written rather than generated:
 * one user, a dozen endpoints, and a generator is one more thing to keep alive.
 */

/**
 * A programme day code — 'A', 'U1', 'Push'. Which codes exist depends on the
 * programme the athlete is running, so this is a string rather than an enum.
 */
export type TemplateId = string;

export type ProgramDay = {
  position: number;
  code: TemplateId;
  name: string;
};

export type Program = {
  id: number;
  slug: string;
  name: string;
  description: string;
  daysPerWeek: number;
  days: ProgramDay[];
};

export type Profile = {
  name: string | null;
  /** IANA zone. The server measures every "today" against this, not the device. */
  timezone: string;
  /** BCP 47, or null to follow the device. The athlete's choice, not the phone's. */
  locale: string | null;
  heightCm: number;
  birthYear: number | null;
  goalWeightKg: number | null;
  calorieTarget: number;
  proteinTargetG: number;
  fatFloorG: number;
  sex: Sex | null;
  activityLevel: ActivityLevel | null;
  goal: Goal | null;
  trainingDaysPerWeek: number | null;
  /** The rate the targets were sized from, after clamping. Negative is loss. */
  weeklyRateKg: number | null;
  /** False until the questionnaire is answered. */
  onboarded: boolean;
};

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';
export type Goal = 'lose' | 'maintain' | 'gain';

export type OnboardingAnswers = {
  name?: string | null;
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  goal: Goal;
  goalWeightKg?: number | null;
  trainingDaysPerWeek: number;
  timezone?: string;
  locale?: string;
};

export type OnboardingResult = {
  profile: Profile;
  explanation: {
    maintenanceKcal: number;
    weeklyRateKg: number;
    /** Anything that was clamped, in the trainer's words. */
    notes: string[];
  };
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
  /** What to call this day on screen: 'Full body A', 'Upper', 'Push'. */
  dayName: string;
  programName: string;
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

export type CardioKind = 'zone2' | 'intervals' | 'sport' | 'walk' | 'other';

export type CardioSession = {
  id: number;
  performedAt: string;
  kind: CardioKind;
  minutes: number;
  description: string | null;
  distanceKm: number | null;
  avgHr: number | null;
  rpe: number | null;
  contextName: string | null;
  /** Whether this one moves the weekly tally. A walk does not. */
  counts: boolean;
};

export type WeekDay = {
  date: string;
  /** @deprecated German. Use `weekdayShort(date)` — see lib/locale.ts. */
  weekday: string;
  isToday: boolean;
  isFuture: boolean;
  lifted: boolean;
  template: string | null;
  sets: number;
  weightKg: number | null;
  cardioMinutes: number;
  cardioSessions: number;
  proteinG: number;
  kcal: number;
  proteinPct: number | null;
};

export type Week = {
  days: WeekDay[];
  strength: { done: number; target: number };
  cardio: { done: number; target: number; minutes: number };
  weighIns: { done: number; target: number };
  proteinTargetG: number;
  avgProteinG: number | null;
  loggedDays: number;
};

export type FridgeItem = {
  name: string;
  estimatedQty: string;
  confidence: 'low' | 'medium' | 'high';
};

export type MealIdea = {
  name: string;
  slot: string;
  usesFromFridge: string[];
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  method: string;
};

export type MealPlan = { meals: MealIdea[]; note: string; reprompted: boolean };

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
  cardioToday: CardioSession[];
  week: {
    strengthSessions: { done: number; target: number };
    cardioSessions: { done: number; target: number; minutes: number };
  };
  coach: CoachNote | null;
};
