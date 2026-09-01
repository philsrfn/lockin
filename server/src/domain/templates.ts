/**
 * The training program: three full-body days on rotation.
 *
 * Deliberately not a program builder (§14). Three hardcoded templates plus
 * swap_exercise covers everything he needs, and this file is readable at a
 * glance after three weeks away.
 *
 * Exercises are referenced by name and resolved against the database once at
 * startup, which fails loudly if a name drifts out of the seed.
 */

import { DEFAULT_REP_RANGE, type RepRange } from './progression';

export type TemplateId = 'A' | 'B' | 'C';

export type TemplateSlot = {
  exerciseName: string;
  sets: number;
  /** Smallest sensible jump on this movement. Isolations move in halves. */
  incrementKg: number;
  restSeconds: number;
  range: RepRange;
};

const R = DEFAULT_REP_RANGE;

export const TEMPLATE_ROTATION = ['A', 'B', 'C'] as const;

export const TEMPLATES: Record<TemplateId, readonly TemplateSlot[]> = {
  A: [
    { exerciseName: 'Back Squat',              sets: 3, incrementKg: 2.5,  restSeconds: 180, range: R },
    { exerciseName: 'Chest Press Machine',     sets: 3, incrementKg: 2.5,  restSeconds: 150, range: R },
    { exerciseName: 'Lat Pulldown',            sets: 3, incrementKg: 2.5,  restSeconds: 150, range: R },
    { exerciseName: 'Seated Leg Curl',         sets: 3, incrementKg: 2.5,  restSeconds: 90,  range: R },
    { exerciseName: 'Seated Cable Row',        sets: 3, incrementKg: 2.5,  restSeconds: 120, range: R },
    { exerciseName: 'Lateral Raise',           sets: 3, incrementKg: 1.25, restSeconds: 60,  range: R },
  ],
  B: [
    { exerciseName: 'Romanian Deadlift',       sets: 3, incrementKg: 2.5,  restSeconds: 180, range: R },
    { exerciseName: 'Incline Dumbbell Press',  sets: 3, incrementKg: 2.5,  restSeconds: 150, range: R },
    { exerciseName: 'Chest-Supported Row',     sets: 3, incrementKg: 2.5,  restSeconds: 150, range: R },
    { exerciseName: 'Bulgarian Split Squat',   sets: 3, incrementKg: 2.5,  restSeconds: 120, range: R },
    { exerciseName: 'Face Pull',               sets: 3, incrementKg: 1.25, restSeconds: 60,  range: R },
    { exerciseName: 'Dumbbell Biceps Curl',    sets: 3, incrementKg: 1.25, restSeconds: 60,  range: R },
  ],
  C: [
    { exerciseName: 'Hack Squat',              sets: 3, incrementKg: 5,    restSeconds: 180, range: R },
    { exerciseName: 'Overhead Press',          sets: 3, incrementKg: 2.5,  restSeconds: 150, range: R },
    { exerciseName: 'Pull-up',                 sets: 3, incrementKg: 2.5,  restSeconds: 150, range: R },
    { exerciseName: 'Hip Thrust',              sets: 3, incrementKg: 5,    restSeconds: 120, range: R },
    { exerciseName: 'Cable Fly',               sets: 3, incrementKg: 1.25, restSeconds: 60,  range: R },
    { exerciseName: 'Cable Triceps Pushdown',  sets: 3, incrementKg: 1.25, restSeconds: 60,  range: R },
  ],
};

export function isTemplateId(value: unknown): value is TemplateId {
  return value === 'A' || value === 'B' || value === 'C';
}

/** A → B → C → A. Rotation, not a weekday schedule — travel breaks weekdays. */
export function nextTemplate(lastTemplate: TemplateId | null): TemplateId {
  if (!lastTemplate) return 'A';
  const index = TEMPLATE_ROTATION.indexOf(lastTemplate);
  return TEMPLATE_ROTATION[(index + 1) % TEMPLATE_ROTATION.length] ?? 'A';
}

/** Every exercise name the program references, for the startup check. */
export function templateExerciseNames(): string[] {
  const names = new Set<string>();
  for (const id of TEMPLATE_ROTATION) {
    for (const slot of TEMPLATES[id]) names.add(slot.exerciseName);
  }
  return [...names];
}

/** §4: weekly targets, not fixed weekdays. */
export const WEEKLY_TARGETS = {
  strengthSessions: 3,
  zone2Sessions: 2,
  zone2Minutes: 35,
  stepsPerDay: 9500,
} as const;
