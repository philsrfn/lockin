/**
 * The proactive schedule from §8.
 *
 * Every handler is written so that having nothing useful to say is a valid
 * outcome: it returns 'skipped' rather than sending a notification for the sake
 * of the schedule. A trainer that pings you at 20:00 to say nothing is a
 * trainer you turn off.
 */
import type { Ctx } from '../db';
import { engagement } from '../domain/engagement';
import { type JobResult } from './scheduler';
import { sendPush } from '../push';
import { generateWeeklyReview } from '../llm/review';
import { generateNote } from '../llm/coach';
import { activeContext } from '../services/contexts';
import { openSession } from '../services/sessions';
import { macrosToday } from '../services/meals';
import { getProfile } from '../services/profile';

/**
 * 07:30 — the day's plan, the city to confirm, and the Skyr. Generating the
 * coach note here means it is already warm when he opens the app.
 */
async function morningCheckin(ctx: Ctx): Promise<JobResult> {
  const here = await stillHere(ctx);
  if (!here.push) {
    return { status: 'skipped', detail: { reason: 'gone quiet', daysAway: here.daysAway } };
  }

  const context = await activeContext(ctx);
  let headline = 'Morning. Open up and let me know how you slept.';

  // The note is the expensive half. Somebody who has not opened the app in
  // days is not reading it, and writing it anyway is the bill nobody notices.
  if (here.writeCoachNote) {
    try {
      const note = await generateNote(ctx);
      if (note) headline = note.headline;
    } catch {
      // A model outage must not cost him the check-in.
    }
  }

  const result = await sendPush(ctx, {
    title: headline,
    body: `${context ? `Still in ${context.name}? ` : ''}Skyr, berries, 40g oats. Then weigh in.`,
    data: { screen: 'today' },
  });

  return {
    status: result.sent > 0 ? 'sent' : 'no_devices',
    detail: { ...result, headline, coached: here.writeCoachNote },
  };
}

/** 20:00 — dinner logging, but only if the day actually looks unfinished. */
async function dinnerPrompt(ctx: Ctx): Promise<JobResult> {
  const here = await stillHere(ctx);
  if (!here.push) {
    return { status: 'skipped', detail: { reason: 'gone quiet', daysAway: here.daysAway } };
  }

  const [profile, consumed] = await Promise.all([getProfile(ctx), macrosToday(ctx)]);
  const proteinLeft = profile.proteinTargetG - consumed.proteinG;

  // He has already hit protein and logged a real day. Nothing to say.
  if (proteinLeft <= 10 && consumed.kcal > profile.calorieTarget * 0.7) {
    return { status: 'skipped', detail: { reason: 'day already logged and on target' } };
  }

  const body =
    consumed.kcal === 0
      ? 'Nothing logged today. What did you eat?'
      : `${proteinLeft}g protein still to go. What was dinner?`;

  const result = await sendPush(ctx, { title: 'Dinner', body, data: { screen: 'food' } });
  return { status: result.sent > 0 ? 'sent' : 'no_devices', detail: { ...result, proteinLeft } };
}

/** Sunday 18:00 — the most important job in the app (§8). */
async function weeklyReview(ctx: Ctx): Promise<JobResult> {
  const review = await generateWeeklyReview(ctx);

  const result = await sendPush(ctx, {
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
/** Reads when the app was last opened. See domain/engagement.ts. */
async function stillHere(ctx: Ctx) {
  const { rows } = await ctx.db.query<{ last_seen_at: Date | null }>(
    'select last_seen_at from profile where user_id = $1',
    [ctx.userId],
  );
  return engagement(rows[0]?.last_seen_at ?? null);
}

export async function logNudge(ctx: Ctx): Promise<JobResult> {
  // retry:true throughout — none of these mean "nothing will happen today",
  // they mean "not yet", and the day's slot must stay open.
  const open = await openSession(ctx);
  if (!open) return { status: 'skipped', retry: true, detail: { reason: 'no open session' } };
  if (open.sets.length > 0) {
    return { status: 'skipped', retry: true, detail: { reason: 'already logging' } };
  }

  const startedMinutes = (Date.now() - new Date(open.performedAt).getTime()) / 60_000;
  if (startedMinutes < 90) return { status: 'skipped', retry: true, detail: { startedMinutes } };

  const result = await sendPush(ctx, {
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

export async function recentRuns(ctx: Ctx, limit = 20) {
  const { rows } = await ctx.db.query<{
    job: string;
    ran_for: string;
    ran_at: Date;
    status: string;
    detail: Record<string, unknown>;
  }>(
    `select job, to_char(ran_for, 'YYYY-MM-DD') as ran_for, ran_at, status, detail
     from job_runs where user_id = $1 order by ran_at desc limit $2`,
    [ctx.userId, limit],
  );
  return rows.map((row) => ({
    job: row.job,
    ranFor: row.ran_for,
    ranAt: row.ran_at.toISOString(),
    status: row.status,
    detail: row.detail,
  }));
}
