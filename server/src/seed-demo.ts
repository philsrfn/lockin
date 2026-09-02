/**
 * Fills a LOCAL database with a believable training history, for showing the
 * app to someone.
 *
 * Refuses to run against anything but localhost. Phil's production database
 * holds his real training history, and fabricated lifts in there would corrupt
 * his weight trend, his progression and every weekly review afterwards.
 *
 *   npm run seed:demo
 */
import { pool } from './db';
import { env } from './env';

const WEEKS = 9;
const TEMPLATES = ['A', 'B', 'C'] as const;

/**
 * Starting load, per-session step, and the grid the weight must land on.
 * A dumbbell press at 25.25kg is a number no gym can produce, and anyone who
 * lifts spots it instantly.
 */
const LIFTS: Record<string, { start: number; step: number; reps: number; grid: number }> = {
  'Back Squat': { start: 60, step: 2.5, reps: 8, grid: 2.5 },
  'Chest Press Machine': { start: 40, step: 1.25, reps: 10, grid: 2.5 },
  'Lat Pulldown': { start: 50, step: 1.25, reps: 10, grid: 2.5 },
  'Seated Leg Curl': { start: 35, step: 1.25, reps: 11, grid: 2.5 },
  'Seated Cable Row': { start: 45, step: 1.25, reps: 10, grid: 2.5 },
  'Lateral Raise': { start: 8, step: 0.5, reps: 12, grid: 2 },
  'Romanian Deadlift': { start: 60, step: 2.5, reps: 9, grid: 2.5 },
  'Incline Dumbbell Press': { start: 20, step: 0.75, reps: 9, grid: 2 },
  'Chest-Supported Row': { start: 40, step: 1.25, reps: 10, grid: 2.5 },
  'Bulgarian Split Squat': { start: 12, step: 0.75, reps: 10, grid: 2 },
  'Face Pull': { start: 15, step: 0.75, reps: 12, grid: 2.5 },
  'Dumbbell Biceps Curl': { start: 10, step: 0.4, reps: 10, grid: 2 },
  'Hack Squat': { start: 60, step: 3, reps: 9, grid: 5 },
  'Overhead Press': { start: 30, step: 1, reps: 8, grid: 2.5 },
  'Pull-up': { start: 0, step: 0, reps: 5, grid: 1 },
  'Hip Thrust': { start: 60, step: 3, reps: 10, grid: 5 },
  'Cable Fly': { start: 12, step: 0.6, reps: 12, grid: 2.5 },
  'Cable Triceps Pushdown': { start: 20, step: 1, reps: 11, grid: 2.5 },
};

const TEMPLATE_MOVEMENTS: Record<string, string[]> = {
  A: ['Back Squat', 'Chest Press Machine', 'Lat Pulldown', 'Seated Leg Curl', 'Seated Cable Row', 'Lateral Raise'],
  B: ['Romanian Deadlift', 'Incline Dumbbell Press', 'Chest-Supported Row', 'Bulgarian Split Squat', 'Face Pull', 'Dumbbell Biceps Curl'],
  C: ['Hack Squat', 'Overhead Press', 'Pull-up', 'Hip Thrust', 'Cable Fly', 'Cable Triceps Pushdown'],
};

const MEALS = [
  { slot: 'breakfast', description: 'Skyr breakfast (500g Skyr, berries, 40g oats)', kcal: 520, protein: 55, fat: 6, carbs: 62 },
  { slot: 'lunch', description: 'Soy chunk bowl', kcal: 620, protein: 52, fat: 14, carbs: 65 },
  { slot: 'lunch', description: 'Hähnchen mit Reis und Brokkoli', kcal: 560, protein: 54, fat: 9, carbs: 58 },
  { slot: 'dinner', description: "Mom's dinner (half) + 200g Magerquark", kcal: 600, protein: 45, fat: 18, carbs: 55 },
  { slot: 'dinner', description: 'Lachs mit Kartoffeln', kcal: 680, protein: 44, fat: 26, carbs: 52 },
  { slot: 'snack', description: 'Magerquark mit Beeren', kcal: 180, protein: 26, fat: 1, carbs: 14 },
  { slot: 'snack', description: 'Proteinshake', kcal: 160, protein: 30, fat: 2, carbs: 5 },
];

function iso(daysAgo: number, hour = 18): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function dateOnly(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString('sv-SE');
}

/** Deterministic jitter, so a re-seed looks the same. */
function wobble(seed: number, spread: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return ((x - Math.floor(x)) - 0.5) * 2 * spread;
}

async function main() {
  if (!/localhost|127\.0\.0\.1|@db:/.test(env.databaseUrl)) {
    throw new Error(
      `Refusing to seed: DATABASE_URL is not local (${env.databaseUrl.replace(/:[^:@]*@/, ':***@')}). ` +
        'This script fabricates training history and must never touch real data.',
    );
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    console.log('clearing transactional tables (local only)');
    await client.query(
      'truncate sessions, sets, bodyweight, meals, coach_notes, weekly_reviews, job_runs, sync_log restart identity cascade',
    );
    await client.query("delete from foods where name not in (select name from foods where quick_add)");

    const { rows: exerciseRows } = await client.query<{ id: number; name: string }>(
      'select id, name from exercises',
    );
    const exerciseId = new Map(exerciseRows.map((r) => [r.name, r.id]));

    const { rows: contextRows } = await client.query<{ id: number; name: string }>(
      'select id, name from contexts order by id',
    );
    const homeId = contextRows.find((c) => c.name === 'Home')?.id ?? 1;
    const munsterId = contextRows.find((c) => c.name === 'Münster')?.id ?? homeId;

    // --- training: three sessions a week, one week missed to look human
    let sessionIndex = 0;
    const totalDays = WEEKS * 7;
    for (let day = totalDays; day >= 0; day -= 1) {
      const dow = new Date(Date.now() - day * 86_400_000).getDay();
      const isLiftDay = dow === 1 || dow === 3 || dow === 5; // Mon/Wed/Fri
      if (!isLiftDay) continue;

      // Week 4 he travelled and only trained once.
      const weeksAgo = Math.floor(day / 7);
      if (weeksAgo === 4 && dow !== 3) continue;
      // Nothing logged for today yet — the app should have something to do.
      if (day === 0) continue;

      const template = TEMPLATES[sessionIndex % 3]!;
      const context = weeksAgo === 4 ? munsterId : homeId;
      // One isolated joint-pain flag: shows the feature without tripping the
      // two-consecutive rule that cuts load and sends him to a doctor.
      const jointPain = day === 26;

      const { rows } = await client.query<{ id: number }>(
        `insert into sessions (performed_at, context_id, template, rpe, notes, joint_pain)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          iso(day),
          context,
          template,
          7 + Math.round(Math.abs(wobble(day, 1.4))),
          jointPain ? 'Left knee grumbling on the last set.' : null,
          jointPain,
        ],
      );
      const sessionId = rows[0]!.id;

      const movements = TEMPLATE_MOVEMENTS[template]!;
      for (const name of movements) {
        const lift = LIFTS[name]!;
        const id = exerciseId.get(name);
        if (!id) continue;

        // Ramp-in: two working sets for the first fortnight, three after.
        const sets = day > totalDays - 14 ? 2 : 3;
        const progressed = lift.start + lift.step * Math.floor(sessionIndex / 3);
        const weight = Math.round(progressed / lift.grid) * lift.grid;

        for (let setIndex = 1; setIndex <= sets; setIndex += 1) {
          await client.query(
            `insert into sets (session_id, exercise_id, set_index, weight_kg, reps, rir)
             values ($1, $2, $3, $4, $5, $6)`,
            [
              sessionId,
              id,
              setIndex,
              weight,
              // Reps drop slightly across sets, as they do.
              Math.max(4, lift.reps - (setIndex - 1) + Math.round(wobble(day + setIndex, 1))),
              setIndex === sets ? 1 : 2,
            ],
          );
        }
      }
      sessionIndex += 1;
    }

    // --- bodyweight: 100.4 down to ~96, with the daily noise that makes the
    // 7-day average worth having. A few days missed.
    for (let day = totalDays; day >= 0; day -= 1) {
      if (day % 11 === 3) continue; // missed weigh-ins
      const trend = 100.4 - (totalDays - day) * (4.4 / totalDays);
      const weight = Math.round((trend + wobble(day, 0.45)) * 10) / 10;
      await client.query(
        `insert into bodyweight (measured_on, weight_kg) values ($1, $2)
         on conflict (measured_on) do update set weight_kg = excluded.weight_kg`,
        [dateOnly(day), weight],
      );
    }

    // --- food: logged on most days, protein usually landing
    for (let day = totalDays; day >= 1; day -= 1) {
      if (day % 9 === 2) continue; // days he did not log
      // Four meals most days, three on a few, so protein usually lands and
      // occasionally does not — which is what the strip is there to show.
      const picks = [MEALS[0]!, MEALS[1 + (day % 2)]!, MEALS[3 + (day % 2)]!];
      if (day % 7 !== 4) picks.push(MEALS[5 + (day % 2)]!);
      if (day % 5 === 0) picks.push(MEALS[6]!);
      for (const meal of picks) {
        await client.query(
          `insert into meals (eaten_at, slot, description, kcal, protein_g, fat_g, carbs_g, source)
           values ($1, $2, $3, $4, $5, $6, $7, 'own')`,
          [
            iso(day, meal.slot === 'breakfast' ? 8 : meal.slot === 'lunch' ? 13 : meal.slot === 'dinner' ? 19 : 16),
            meal.slot,
            meal.description,
            meal.kcal,
            meal.protein,
            meal.fat,
            meal.carbs,
          ],
        );
      }
    }

    // Today, partly logged: breakfast in, the rest still to do.
    await client.query(
      `insert into meals (eaten_at, slot, description, kcal, protein_g, fat_g, carbs_g, source)
       values (now() - interval '4 hours', 'breakfast', $1, 520, 55, 6, 62, 'own')`,
      [MEALS[0]!.description],
    );

    // --- a few more foods in his library, as it grows by use
    for (const [name, kcal, protein, fat, carbs] of [
      ['Hähnchenbrust 200g', 330, 62, 7, 0],
      ['Magerquark 250g', 180, 33, 1, 10],
      ['Proteinshake', 160, 30, 2, 5],
      ['Haferflocken 80g', 300, 11, 6, 50],
    ] as [string, number, number, number, number][]) {
      await client.query(
        `insert into foods (name, kcal, protein_g, fat_g, carbs_g, times_used, last_used_at)
         values ($1, $2, $3, $4, $5, $6, now() - ($7 || ' days')::interval)
         on conflict (lower(name)) where not archived do nothing`,
        [name, kcal, protein, fat, carbs, 4 + (kcal % 7), (kcal % 5) + 1],
      );
    }

    await client.query('update contexts set is_active = (id = $1)', [homeId]);

    await client.query('commit');

    const counts = await client.query<{ sessions: string; sets: string; weights: string; meals: string }>(
      `select (select count(*) from sessions) as sessions,
              (select count(*) from sets) as sets,
              (select count(*) from bodyweight) as weights,
              (select count(*) from meals) as meals`,
    );
    const c = counts.rows[0]!;
    console.log(
      `seeded ${c.sessions} sessions, ${c.sets} sets, ${c.weights} weigh-ins, ${c.meals} meals over ${WEEKS} weeks`,
    );
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
