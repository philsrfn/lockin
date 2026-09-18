// @ts-check
/**
 * Vendors the movement thumbnails, and writes the map the picker reads.
 *
 * WHY THE IMAGES ARE IN THE REPOSITORY
 *
 * They could be fetched. free-exercise-db is on a CDN, `expo-image` caches,
 * and the whole thing would be four lines instead of this file. It is wrong
 * for this app for two reasons and both of them are §11's.
 *
 * The logger is used "one-handed, sweaty, between sets, on bad wifi" — and in
 * a basement with no signal at all. A picker whose thumbnails are blank in
 * exactly the place it is opened most is worse than a picker with no
 * thumbnails, because it looks broken rather than plain. And an image fetched
 * per movement is somebody's phone announcing to a third party, once a set,
 * which exercises they are looking at. The app sends photographs of food and
 * of a body to exactly one place and keeps nothing; leaking the exercise
 * library over the same session would be a strange place to stop caring.
 *
 * So: vendored, at thumbnail size, once. The cost is about a megabyte in the
 * bundle, paid at install rather than in the gym.
 *
 * THE LICENCE
 *
 * yuhonas/free-exercise-db is released under the Unlicense — public domain,
 * no attribution required, redistribution explicitly allowed. That is the
 * reason it was chosen over wger (CC-BY-SA, so a share-alike obligation on a
 * closed-source app) and over ExerciseDB (an API key, a rate limit, and terms
 * that can change under us).
 *
 * RUNNING IT
 *
 *   node scripts/exercise-images.mjs
 *
 * Needs network and macOS `sips`. It is not part of any build: the outputs are
 * committed, and a movement without one simply has no thumbnail.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets', 'exercises');
const generated = join(root, 'src', 'lib', 'exerciseImages.ts');

const SOURCE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main';
/** Wide enough to read on a 3x screen at the 48pt the picker draws it. */
const WIDTH = 160;

/**
 * Our movement name → the name it has in free-exercise-db.
 *
 * Kept as a literal map rather than matched by string distance, because the
 * near misses are the dangerous ones: "Front Squat" fuzzy-matches "Front
 * Squats With Two Kettlebells" perfectly well, and a wrong picture is worse
 * than none. Every line here was looked at.
 *
 * A name with no entry gets no thumbnail, which is the same thing that
 * happens to an exercise somebody created themselves.
 */
const SOURCE_NAMES = {
  'Back Squat': 'Barbell Squat',
  'Leg Press': 'Leg Press',
  'Hack Squat': 'Barbell Hack Squat',
  'Smith Machine Squat': 'Smith Machine Squat',
  'Goblet Squat': 'Goblet Squat',
  'Bulgarian Split Squat': 'Split Squats',
  'Romanian Deadlift': 'Romanian Deadlift',
  'Hip Thrust': 'Barbell Hip Thrust',
  'Back Extension': 'Hyperextensions (Back Extensions)',
  'Chest Press Machine': 'Machine Bench Press',
  'Incline Dumbbell Press': 'Incline Dumbbell Press',
  'Flat Dumbbell Bench Press': 'Dumbbell Bench Press',
  'Barbell Bench Press': 'Barbell Bench Press - Medium Grip',
  'Overhead Press': 'Standing Military Press',
  'Seated Dumbbell Shoulder Press': 'Dumbbell Shoulder Press',
  'Machine Shoulder Press': 'Machine Shoulder (Military) Press',
  'Seated Cable Row': 'Seated Cable Rows',
  'Chest-Supported Row': 'Leverage Iso Row',
  'Barbell Row': 'Bent Over Barbell Row',
  'Single-Arm Dumbbell Row': 'One-Arm Dumbbell Row',
  'Lat Pulldown': 'Wide-Grip Lat Pulldown',
  'Pull-up': 'Pullups',
  'Assisted Pull-up': 'Band Assisted Pull-Up',
  'Seated Leg Curl': 'Seated Leg Curl',
  'Leg Extension': 'Leg Extensions',
  'Lateral Raise': 'Side Lateral Raise',
  'Cable Lateral Raise': 'Cable Seated Lateral Raise',
  'Face Pull': 'Face Pull',
  'Rear Delt Fly': 'Seated Bent-Over Rear Delt Raise',
  'Dumbbell Biceps Curl': 'Dumbbell Bicep Curl',
  'Barbell Curl': 'Barbell Curl',
  'Cable Triceps Pushdown': 'Triceps Pushdown',
  'Overhead Cable Triceps Extension': 'Cable Rope Overhead Triceps Extension',
  'Cable Fly': 'Cable Crossover',
  'Pec Deck': 'Butterfly',
  'Bodyweight Squat': 'Bodyweight Squat',
  'Walking Lunge': 'Bodyweight Walking Lunge',
  'Dumbbell Squat': 'Dumbbell Squat',
  'Step-up': 'Dumbbell Step Ups',
  'Glute Bridge': 'Butt Lift (Bridge)',
  'Dumbbell Romanian Deadlift': 'Stiff-Legged Dumbbell Deadlift',
  'Nordic Curl': 'Natural Glute Ham Raise',
  'Push-up': 'Pushups',
  'Incline Push-up': 'Incline Push-Up',
  'Dumbbell Floor Press': 'Dumbbell Floor Press',
  'Pike Push-up': 'Handstand Push-Ups',
  'Inverted Row': 'Inverted Row',
  'Chin-up': 'Chin-Up',
  'Band Pull-apart': 'Band Pull Apart',
  'Dumbbell Hammer Curl': 'Hammer Curls',
  'Dumbbell Skull Crusher': 'Lying Dumbbell Tricep Extension',
  'Bench Dip': 'Bench Dips',

  'Front Squat': 'Front Barbell Squat',
  'Reverse Lunge': 'Dumbbell Rear Lunge',
  'Barbell Lunge': 'Barbell Lunge',
  'Box Squat': 'Box Squat',
  'Sissy Squat': 'Weighted Sissy Squat',

  'Conventional Deadlift': 'Barbell Deadlift',
  'Sumo Deadlift': 'Sumo Deadlift',
  'Trap Bar Deadlift': 'Trap Bar Deadlift',
  'Good Morning': 'Good Morning',
  'Stiff-Legged Deadlift': 'Stiff-Legged Barbell Deadlift',
  'Single-Leg Romanian Deadlift': 'Kettlebell One-Legged Deadlift',
  'Kettlebell Swing': 'One-Arm Kettlebell Swings',

  'Incline Barbell Bench Press': 'Barbell Incline Bench Press - Medium Grip',
  'Decline Barbell Bench Press': 'Decline Barbell Bench Press',
  'Close-Grip Bench Press': 'Close-Grip Barbell Bench Press',
  'Chest Dip': 'Dips - Chest Version',
  'Smith Machine Bench Press': 'Smith Machine Bench Press',
  'Decline Dumbbell Press': 'Decline Dumbbell Bench Press',

  'Seated Barbell Overhead Press': 'Seated Barbell Military Press',
  'Arnold Press': 'Arnold Dumbbell Press',
  'Push Press': 'Push Press',
  'Single-Arm Dumbbell Shoulder Press': 'Dumbbell One-Arm Shoulder Press',
  'Smith Machine Shoulder Press': 'Smith Machine Overhead Shoulder Press',

  'T-Bar Row': 'T-Bar Row with Handle',
  'Machine Row': 'Leverage High Row',
  'Single-Arm Cable Row': 'Seated One-arm Cable Pulley Rows',
  'Reverse-Grip Barbell Row': 'Reverse Grip Bent-Over Rows',
  'Smith Machine Row': 'Smith Machine Bent Over Row',
  'Incline Dumbbell Row': 'Dumbbell Incline Row',

  'Close-Grip Lat Pulldown': 'Close-Grip Front Lat Pulldown',
  'Neutral-Grip Lat Pulldown': 'V-Bar Pulldown',
  'Single-Arm Lat Pulldown': 'One Arm Lat Pulldown',
  'Underhand Lat Pulldown': 'Underhand Cable Pulldowns',
  'Wide-Grip Pull-up': 'Wide-Grip Rear Pull-Up',

  'Front Raise': 'Front Dumbbell Raise',
  'Upright Row': 'Upright Barbell Row',
  'Reverse Pec Deck': 'Reverse Machine Flyes',
  'Barbell Shrug': 'Barbell Shrug',
  'Dumbbell Shrug': 'Dumbbell Shrug',

  'Preacher Curl': 'Preacher Curl',
  'Incline Dumbbell Curl': 'Incline Dumbbell Curl',
  'Cable Biceps Curl': 'Standing Biceps Cable Curl',
  'Concentration Curl': 'Concentration Curls',
  'Reverse Curl': 'Reverse Barbell Curl',
  'Machine Biceps Curl': 'Machine Bicep Curl',
  'Spider Curl': 'Spider Curl',

  'Overhead Dumbbell Triceps Extension': 'Standing Dumbbell Triceps Extension',
  'Lying Barbell Triceps Extension': 'Lying Triceps Press',
  'Triceps Dip': 'Dips - Triceps Version',
  'Rope Triceps Pushdown': 'Triceps Pushdown - Rope Attachment',
  'Machine Triceps Extension': 'Machine Triceps Extension',
  'Close-Grip Push-up': 'Push-Ups - Close Triceps Position',
  'Triceps Kickback': 'Tricep Dumbbell Kickback',

  'Dumbbell Fly': 'Dumbbell Flyes',
  'Incline Dumbbell Fly': 'Incline Dumbbell Flyes',

  'Straight-Arm Pulldown': 'Straight-Arm Pulldown',
  'Dumbbell Pullover': 'Bent-Arm Dumbbell Pullover',

  'Lying Leg Curl': 'Lying Leg Curls',
  'Standing Calf Raise': 'Standing Calf Raises',
  'Seated Calf Raise': 'Seated Calf Raise',
  'Leg Press Calf Raise': 'Calf Press On The Leg Press Machine',
  'Hip Abduction': 'Thigh Abductor',
  'Hip Adduction': 'Thigh Adductor',
  'Glute Kickback': 'Glute Kickback',

  'Cable Crunch': 'Cable Crunch',
  'Hanging Leg Raise': 'Hanging Leg Raise',
  Plank: 'Plank',
  'Side Plank': 'Side Bridge',
  'Ab Wheel Rollout': 'Ab Roller',
  Crunch: 'Crunches',
  'Decline Sit-up': 'Decline Crunch',
  'Russian Twist': 'Russian Twist',
  'Ab Crunch Machine': 'Ab Crunch Machine',
  'Bicycle Crunch': 'Air Bike',

  'Wrist Curl': 'Palms-Up Barbell Wrist Curl Over A Bench',
  "Farmer's Walk": "Farmer's Walk",
};

/** A filename that survives a case-insensitive filesystem and a git checkout. */
const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function main() {
  const catalogue = await fetch(`${SOURCE}/dist/exercises.json`).then((r) => r.json());
  const byName = new Map(catalogue.map((entry) => [entry.name, entry]));

  rmSync(assets, { recursive: true, force: true });
  mkdirSync(assets, { recursive: true });

  const written = [];
  for (const [ours, theirs] of Object.entries(SOURCE_NAMES)) {
    const entry = byName.get(theirs);
    if (!entry?.images?.length) {
      console.warn(`no source image: ${ours} -> ${theirs}`);
      continue;
    }

    const slug = slugify(ours);
    const temp = join(assets, `${slug}.src`);
    const out = join(assets, `${slug}.jpg`);

    const response = await fetch(`${SOURCE}/exercises/${entry.images[0]}`);
    if (!response.ok) {
      console.warn(`download failed: ${ours} (${response.status})`);
      continue;
    }
    writeFileSync(temp, Buffer.from(await response.arrayBuffer()));
    // The first frame is the start of the movement, which is the one that
    // reads as a recognisable shape at thumbnail size.
    execFileSync('sips', ['-Z', String(WIDTH), '-s', 'format', 'jpeg', '-s', 'formatOptions', '65', temp, '--out', out], {
      stdio: 'ignore',
    });
    rmSync(temp);
    written.push([ours, slug]);
  }

  written.sort(([a], [b]) => a.localeCompare(b));

  const lines = written.map(([name, slug]) => `  ${JSON.stringify(name)}: require('../../assets/exercises/${slug}.jpg'),`);
  writeFileSync(
    generated,
    `/**
 * Movement thumbnails, keyed by the name the catalogue uses.
 *
 * GENERATED by scripts/exercise-images.mjs — do not edit by hand.
 *
 * Keyed by name rather than by id because ids are per-database and this map
 * is compiled into the bundle: a fresh install and a two-year-old one assign
 * different serials to the same movement, and the picture must not depend on
 * which. Names are already the key the migrations resolve against.
 *
 * A movement with no entry — anything somebody created themselves, and the
 * handful the source dataset has no photograph for — renders without one.
 * Every caller has to handle that, so there is no fallback image to go stale.
 */
export const EXERCISE_IMAGES: Record<string, number> = {
${lines.join('\n')}
};

export const exerciseImage = (name: string): number | undefined => EXERCISE_IMAGES[name];
`,
  );

  const bytes = readdirSync(assets).reduce(
    (total, file) => total + statSync(join(assets, file)).size,
    0,
  );
  console.log(`wrote ${written.length} thumbnails, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

await main();
