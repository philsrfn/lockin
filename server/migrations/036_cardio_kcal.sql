-- What a workout from the watch says it burned.
--
-- The watch measures this — heart rate, motion, the athlete's own body — and
-- the history screen threw it away on import. Somebody who looks at last
-- Tuesday's run wants to see the number their wrist showed them at the end of
-- it, and an app that shows fewer facts than the watch it imported from reads
-- as having lost them.
--
-- Nullable, and only ever filled from Health. A session typed into the app has
-- no measurement behind it, and estimating one here would put a guessed number
-- next to measured ones in the same column — `domain/cardioBurn.ts` does its
-- own deliberately conservative estimate for the calorie target, and that is
-- a different question from "what did the watch say".
--
-- Additive. Existing rows stay null; the next sync fills the ones still inside
-- the phone's fourteen-day window, and older ones stay as they were.

alter table cardio_sessions
  add column if not exists active_kcal integer;

comment on column cardio_sessions.active_kcal is
  'Active energy the workout burned, as HealthKit measured it. Null for sessions logged in the app. Display only — nothing computes a target from it.';
