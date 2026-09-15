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
import { cachedNote, generateNote } from '../llm/coach';
import { activeContext } from '../services/contexts';
import { athleteToday } from '../services/clock';
import { checkinDue } from '../domain/physique';
import { accessForAthlete } from '../services/entitlements';
import { latestCheckin } from '../services/physique';
import { openSession } from '../services/sessions';
import { macrosToday } from '../services/meals';
import { getProfile } from '../services/profile';
import { getToday } from '../services/today';

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

/**
 * The fifth §8 trigger — today's session, and where to do it.
 *
 * §8 words this as "30 min before planned session", which the data model
 * cannot answer: nothing anywhere records when today's session is meant to
 * start, and that is deliberate. §5 makes the targets weekly rather than
 * weekday-shaped because travel breaks fixed days. So this fires at a time of
 * day like every other job, and earns its place by being quiet — it says
 * something only when today is a lifting day that has not happened yet.
 *
 * It spends no model call. The coach note it reads was written at 07:30; if
 * there is none, the week's own arithmetic answers the same question well
 * enough, and neither is worth a second call to say "you have not lifted yet".
 */
async function sessionReminder(ctx: Ctx): Promise<JobResult> {
  const here = await stillHere(ctx);
  if (!here.push) {
    return { status: 'skipped', detail: { reason: 'gone quiet', daysAway: here.daysAway } };
  }

  const today = await getToday(ctx);

  // Already done, or already under way. Nothing a reminder can add.
  if (today.completedToday.length > 0) {
    return { status: 'skipped', detail: { reason: 'already trained today' } };
  }
  if (today.openSession) {
    return { status: 'skipped', detail: { reason: 'session already open' } };
  }

  const note = await cachedNote(ctx, today.date);
  const lifting = note
    ? note.sessionType === 'strength'
    : // No note — the morning check-in has not run, or the model was
      // unreachable. The week's own arithmetic is a fair stand-in: if the
      // strength target is already met, today is not the day to push.
      today.week.strengthSessions.done < today.week.strengthSessions.target;

  if (!lifting) {
    return {
      status: 'skipped',
      detail: { reason: note ? `coach says ${note.sessionType}` : 'week already complete' },
    };
  }

  // The first few movements are enough to recognise the day. The whole list is
  // a notification nobody finishes reading.
  const movements = today.plan.exercises
    .slice(0, 3)
    .map((exercise) => exercise.name)
    .join(' · ');

  const result = await sendPush(ctx, {
    // Today always resolves a programme day, so the fallback is unreachable
    // in practice — it exists because the plan type also describes a free
    // session, and a notification with the word "null" in the title is the
    // kind of thing that ships when a type widens under a call site.
    title: today.plan.dayName ?? today.plan.programName,
    body: [movements, today.context?.name].filter(Boolean).join(' — '),
    data: { screen: 'workout' },
  });

  return {
    status: result.sent > 0 ? 'sent' : 'no_devices',
    detail: { ...result, template: today.plan.template, place: today.context?.name ?? null },
  };
}

/**
 * Sunday 09:00 — the weekly progress photograph.
 *
 * The one job in here that asks for something rather than telling them
 * something, and the only one that costs nothing to run: it sends no model
 * call, it just knocks on the door while the conditions for a comparable
 * photograph still hold. Morning, before breakfast, same light, same hour —
 * that is what makes this week's picture worth putting next to last week's,
 * and it is the entire reason this is not folded into the 18:00 review.
 *
 * It stays quiet when the check-in has already happened this week, and when
 * the trainer is out of reach: the analysis is behind the §17 gate, so a
 * reminder to somebody without access would be a nudge towards a locked door.
 */
async function physiqueCheckin(ctx: Ctx): Promise<JobResult> {
  const here = await stillHere(ctx);
  if (!here.push) {
    return { status: 'skipped', detail: { reason: 'gone quiet', daysAway: here.daysAway } };
  }

  const access = await accessForAthlete(ctx);
  if (!access.coach) return { status: 'skipped', detail: { reason: 'no trainer access' } };

  const [latest, today] = await Promise.all([latestCheckin(ctx), athleteToday(ctx)]);
  if (!checkinDue(latest?.takenOn ?? null, today)) {
    return { status: 'skipped', detail: { reason: 'already done this week', last: latest?.takenOn } };
  }

  const result = await sendPush(ctx, {
    title: 'Progress photo',
    body: latest
      ? 'Same spot, same light, before breakfast. I will tell you what changed.'
      : 'Take the first one now — everything after it is measured against today.',
    data: { screen: 'weight' },
  });

  return {
    status: result.sent > 0 ? 'sent' : 'no_devices',
    detail: { ...result, last: latest?.takenOn ?? null },
  };
}

export const jobHandlers = {
  morning_checkin: morningCheckin,
  dinner_prompt: dinnerPrompt,
  weekly_review: weeklyReview,
  log_nudge: logNudge,
  session_reminder: sessionReminder,
  physique_checkin: physiqueCheckin,
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
