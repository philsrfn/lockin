/**
 * The proactive schedule from §8.
 *
 * Every handler is written so that having nothing useful to say is a valid
 * outcome: it returns 'skipped' rather than sending a notification for the sake
 * of the schedule. A trainer that pings you at 20:00 to say nothing is a
 * trainer you turn off.
 */
import { pool } from '../db';
import { type JobResult } from './scheduler';
import { sendPush } from '../push';
import { generateWeeklyReview } from '../llm/review';
import { generateNote } from '../llm/coach';
import { activeContext } from '../services/contexts';
import { openSession } from '../services/sessions';
import { macrosToday } from '../services/meals';
import { getProfile } from '../services/profile';
import { today as todayDate } from '../services/bodyweight';

/**
 * 07:30 — the day's plan, the city to confirm, and the Skyr. Generating the
 * coach note here means it is already warm when he opens the app.
 */
async function morningCheckin(): Promise<JobResult> {
  const context = await activeContext();
  let headline = 'Morning. Open up and let me know how you slept.';

  try {
    const note = await generateNote(todayDate());
    if (note) headline = note.headline;
  } catch {
    // A model outage must not cost him the check-in.
  }

  const result = await sendPush({
    title: headline,
    body: `${context ? `Still in ${context.name}? ` : ''}Skyr, berries, 40g oats. Then weigh in.`,
    data: { screen: 'today' },
  });

  return { status: result.sent > 0 ? 'sent' : 'no_devices', detail: { ...result, headline } };
}

/** 20:00 — dinner logging, but only if the day actually looks unfinished. */
async function dinnerPrompt(): Promise<JobResult> {
  const [profile, consumed] = await Promise.all([getProfile(), macrosToday()]);
  const proteinLeft = profile.proteinTargetG - consumed.proteinG;

  // He has already hit protein and logged a real day. Nothing to say.
  if (proteinLeft <= 10 && consumed.kcal > profile.calorieTarget * 0.7) {
    return { status: 'skipped', detail: { reason: 'day already logged and on target' } };
  }

  const body =
    consumed.kcal === 0
      ? 'Nothing logged today. What did you eat?'
      : `${proteinLeft}g protein still to go. What was dinner?`;

  const result = await sendPush({ title: 'Dinner', body, data: { screen: 'food' } });
  return { status: result.sent > 0 ? 'sent' : 'no_devices', detail: { ...result, proteinLeft } };
}

/** Sunday 18:00 — the most important job in the app (§8). */
async function weeklyReview(): Promise<JobResult> {
  const review = await generateWeeklyReview();

  const result = await sendPush({
    title: 'Your week',
    body: review.oneChange,
    data: { screen: 'today', review: review.weekEnding },
  });

  return {
    status: 'sent',
    detail: {
      model: review.model,
      calorieTarget: review.calorieTarget,
      calorieChanged: review.calorieChanged,
      push: result,
    },
  };
}

/**
 * Not on a clock: a session left open for 90 minutes with nothing logged. He
 * started, got distracted, and the sets are sitting in his head. Capped at one
 * a day by the (job, ran_for) key, because nagging twice is worse than not
 * nagging at all.
 */
export async function logNudge(): Promise<JobResult> {
  // retry:true throughout — none of these mean "nothing will happen today",
  // they mean "not yet", and the day's slot must stay open.
  const open = await openSession();
  if (!open) return { status: 'skipped', retry: true, detail: { reason: 'no open session' } };
  if (open.sets.length > 0) {
    return { status: 'skipped', retry: true, detail: { reason: 'already logging' } };
  }

  const startedMinutes = (Date.now() - new Date(open.performedAt).getTime()) / 60_000;
  if (startedMinutes < 90) return { status: 'skipped', retry: true, detail: { startedMinutes } };

  const result = await sendPush({
    title: 'Still training?',
    body: 'You started a session but nothing is logged yet. Tap to catch up.',
    data: { screen: 'workout' },
  });
  return { status: result.sent > 0 ? 'sent' : 'no_devices', detail: result };
}

export const jobHandlers = {
  morning_checkin: morningCheckin,
  dinner_prompt: dinnerPrompt,
  weekly_review: weeklyReview,
  log_nudge: logNudge,
};

export type JobName = keyof typeof jobHandlers;

export async function recentRuns(limit = 20) {
  const { rows } = await pool.query<{
    job: string;
    ran_for: string;
    ran_at: Date;
    status: string;
    detail: Record<string, unknown>;
  }>(
    `select job, to_char(ran_for, 'YYYY-MM-DD') as ran_for, ran_at, status, detail
     from job_runs order by ran_at desc limit $1`,
    [limit],
  );
  return rows.map((row) => ({
    job: row.job,
    ranFor: row.ran_for,
    ranAt: row.ran_at.toISOString(),
    status: row.status,
    detail: row.detail,
  }));
}
