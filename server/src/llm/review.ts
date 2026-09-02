/**
 * The Sunday review (§8): "the most important job in the app". Reads the last
 * 14 days in full and produces a trend assessment, one thing that went well,
 * one concrete change, and updated targets.
 *
 * The numbers are computed here, in code, and handed to the model as facts —
 * 7-day averages, week-over-week change, adherence counts, protein averages.
 * The model reads them and writes the assessment. It never does the arithmetic,
 * and it cannot set a target directly: any change it proposes goes through
 * safeCalorieTarget, so §7's floors hold whatever it says.
 */
import { LlmError } from './provider';
import { geminiProvider } from './gemini';
import type { Ctx } from '../db';
import { MAX_WEEKLY_LOSS_KG, checkCalorieTarget } from '../domain/safety';
import { addDays, movingAverage, weeklyChangeKg } from '../domain/trend';
import { dayIn, daySpanIn } from '../domain/time';
import { listEntries } from '../services/bodyweight';
import { getProfile } from '../services/profile';
import { recentSessions } from '../services/sessions';

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

const SCHEMA = {
  type: 'object',
  properties: {
    trend: {
      type: 'string',
      description:
        'Two or three sentences on where the weight trend actually is, using the numbers given. Name the rate, say whether it is on track for the goal.',
    },
    wentWell: {
      type: 'string',
      description: 'One specific thing he did well this week. Concrete, from the data, not flattery.',
    },
    oneChange: {
      type: 'string',
      description:
        'Exactly one concrete change for next week. Something he can act on Monday, not a list.',
    },
    calorieTarget: {
      type: 'integer',
      description:
        'The daily calorie target for next week. Keep it unchanged unless the trend data justifies moving it.',
    },
    targetsNote: {
      type: 'string',
      description:
        'One sentence explaining the calorie decision, whether you changed it or not. Empty if there is nothing to say.',
    },
  },
  required: ['trend', 'wentWell', 'oneChange', 'calorieTarget', 'targetsNote'],
};

const INSTRUCTION = `You are Phil's trainer, writing his Sunday review.

You have worked with him for months. Direct and warm, no cheerleading, no
moralising about food. He reads this on his phone, so keep it tight — this is
four short paragraphs, not an essay.

Every number you need is given to you. Do not calculate anything yourself and
do not invent figures that are not in the brief; if something was not logged,
say it was not logged rather than guessing.

On calories: the target moves for a reason or not at all. Losing faster than
${MAX_WEEKLY_LOSS_KG}kg a week for two weeks running means eating more, not
less. Stalling for two weeks on good adherence means eating less. A single
flat week is noise — say so and leave it alone.

Pick ONE change. A list of five is a list he will ignore.`;

type Brief = {
  weekEnding: string;
  lines: string[];
  calorieTarget: number;
};

/** Assembles the facts. All arithmetic happens here, never in the model. */
async function buildBrief(ctx: Ctx): Promise<Brief> {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  // The week the review is filed under is his week, not the server's.
  const asOf = dayIn(zone);

  const [entries, sessions] = await Promise.all([
    listEntries(ctx, 35, zone),
    recentSessions(ctx, 14),
  ]);

  const thisWeek = movingAverage(entries, asOf, 7);
  const lastWeek = movingAverage(entries, addDays(asOf, -7), 7);
  const change = weeklyChangeKg(entries, asOf, 7);
  const priorChange = weeklyChangeKg(entries, addDays(asOf, -7), 7);

  const fortnight = daySpanIn(zone, addDays(asOf, -13), asOf);
  const { rows: mealRows } = await ctx.db.query<{ day: string; kcal: number; protein: number }>(
    `select to_char(eaten_at at time zone $4, 'YYYY-MM-DD') as day,
            coalesce(sum(kcal), 0)::int as kcal,
            coalesce(sum(protein_g), 0)::int as protein
     from meals
     where user_id = $1 and eaten_at >= $2 and eaten_at < $3
     group by 1 order by 1`,
    [ctx.userId, fortnight.from, fortnight.until, zone],
  );

  const loggedDays = mealRows.length;
  const avgKcal = loggedDays
    ? Math.round(mealRows.reduce((sum, row) => sum + row.kcal, 0) / loggedDays)
    : null;
  const avgProtein = loggedDays
    ? Math.round(mealRows.reduce((sum, row) => sum + row.protein, 0) / loggedDays)
    : null;
  const proteinHitDays = mealRows.filter((row) => row.protein >= profile.proteinTargetG).length;

  const finished = sessions.filter((session) => session.finished);
  // performedAt is an ISO instant; slicing it would give the UTC date, which
  // is not the day he trained.
  const lastSeven = finished.filter(
    (session) => dayIn(zone, new Date(session.performedAt)) >= addDays(asOf, -6),
  );
  const jointPainDays = finished.filter((session) => session.jointPain).length;
  const rpes = finished.map((session) => session.rpe).filter((rpe): rpe is number => rpe != null);

  const lines = [
    `Height ${profile.heightCm}cm. Goal ${profile.goalWeightKg ?? '—'}kg.`,
    `Current daily targets: ${profile.calorieTarget} kcal, ${profile.proteinTargetG}g protein, ${profile.fatFloorG}g fat floor.`,
    thisWeek
      ? `7-day average weight: ${thisWeek.avgKg.toFixed(2)}kg from ${thisWeek.sampleCount} weigh-ins.`
      : 'No weigh-ins in the last 7 days.',
    lastWeek
      ? `Previous week average: ${lastWeek.avgKg.toFixed(2)}kg from ${lastWeek.sampleCount} weigh-ins.`
      : 'No weigh-ins the week before.',
    change != null
      ? `Week-over-week change: ${change >= 0 ? '+' : ''}${change.toFixed(2)}kg.`
      : 'Not enough weigh-ins to compute a week-over-week change.',
    priorChange != null
      ? `The week before that changed ${priorChange >= 0 ? '+' : ''}${priorChange.toFixed(2)}kg.`
      : 'No change figure available for the week before.',
    `Safe loss ceiling is ${MAX_WEEKLY_LOSS_KG}kg per week.`,
    `Strength sessions finished in the last 7 days: ${lastSeven.length} (target 3).`,
    `Strength sessions in the last 14 days: ${finished.length}.`,
    rpes.length ? `Session RPEs: ${rpes.join(', ')}.` : 'No RPEs recorded.',
    jointPainDays > 0
      ? `Joint pain was flagged on ${jointPainDays} of those sessions.`
      : 'No joint pain flagged.',
    loggedDays
      ? `Food logged on ${loggedDays} of the last 14 days, averaging ${avgKcal} kcal and ${avgProtein}g protein on the days he logged.`
      : 'No food logged in the last 14 days, so nothing can be said about intake.',
    loggedDays
      ? `He hit the ${profile.proteinTargetG}g protein target on ${proteinHitDays} of ${loggedDays} logged days.`
      : '',
  ].filter(Boolean);

  return { weekEnding: asOf, lines, calorieTarget: profile.calorieTarget };
}

export async function generateWeeklyReview(ctx: Ctx): Promise<WeeklyReview> {
  const brief = await buildBrief(ctx);

  const output = await geminiProvider.generate({
      purpose: 'weekly_review',
    systemInstruction: INSTRUCTION,
    history: [{ role: 'user', text: `This week's numbers:\n\n${brief.lines.join('\n')}` }],
    responseSchema: SCHEMA,
    // Pro if the key can reach it; the provider falls back and reports which
    // model actually answered, so a downgrade is never silent.
    model: 'smart',
    maxOutputTokens: 4000,
    temperature: 0.4,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output.text) as Record<string, unknown>;
  } catch {
    throw new LlmError('The weekly review came back malformed', true);
  }

  // §7 holds regardless of what the model asked for.
  const proposed = Number(parsed.calorieTarget);
  const safe = checkCalorieTarget(Number.isFinite(proposed) ? proposed : brief.calorieTarget);
  const calorieTarget = safe.value;
  const calorieChanged = calorieTarget !== brief.calorieTarget;

  if (calorieChanged) {
    await ctx.db.query(
      'update profile set calorie_target = $2, updated_at = now() where user_id = $1',
      [ctx.userId, calorieTarget],
    );
  }

  const review: WeeklyReview = {
    weekEnding: brief.weekEnding,
    trend: String(parsed.trend ?? '').trim(),
    wentWell: String(parsed.wentWell ?? '').trim(),
    oneChange: String(parsed.oneChange ?? '').trim(),
    targetsNote:
      [String(parsed.targetsNote ?? '').trim(), safe.ok ? '' : safe.reason]
        .filter(Boolean)
        .join(' ') || null,
    calorieTarget,
    calorieChanged,
    model: output.model,
  };

  await ctx.db.query(
    `insert into weekly_reviews
       (user_id, week_ending, trend, went_well, one_change, targets_note, model)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id, week_ending) do update
       set trend = excluded.trend, went_well = excluded.went_well,
           one_change = excluded.one_change, targets_note = excluded.targets_note,
           model = excluded.model, created_at = now()`,
    [
      ctx.userId,
      review.weekEnding,
      review.trend,
      review.wentWell,
      review.oneChange,
      review.targetsNote,
      review.model,
    ],
  );

  return review;
}

export async function latestReview(ctx: Ctx): Promise<WeeklyReview | null> {
  const { rows } = await ctx.db.query<{
    week_ending: string;
    trend: string;
    went_well: string;
    one_change: string;
    targets_note: string | null;
    model: string;
  }>(
    `select to_char(week_ending, 'YYYY-MM-DD') as week_ending, trend, went_well, one_change,
            targets_note, model
     from weekly_reviews where user_id = $1 order by week_ending desc limit 1`,
    [ctx.userId],
  );
  const row = rows[0];
  if (!row) return null;

  const { rows: profileRows } = await ctx.db.query<{ calorie_target: number }>(
    'select calorie_target from profile where user_id = $1',
    [ctx.userId],
  );

  return {
    weekEnding: row.week_ending,
    trend: row.trend,
    wentWell: row.went_well,
    oneChange: row.one_change,
    targetsNote: row.targets_note,
    calorieTarget: profileRows[0]?.calorie_target ?? 0,
    calorieChanged: false,
    model: row.model,
  };
}
