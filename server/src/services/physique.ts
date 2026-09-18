/**
 * The weekly check-in: take the photographs, get the words, keep only the words.
 *
 * This is the single write path to `physique_checkins` (§16), and the only
 * place in the server that ever holds a photograph of somebody's body. It
 * holds it for the length of one model call, in memory, in a base64 string
 * that goes out of scope when this function returns. Nothing here writes a
 * file, nothing here logs the payload, and the row that lands in Postgres
 * contains prose and a date.
 *
 * WHY THE WEIGHT GOES WITH THE PICTURES
 *
 * Because the alternative is the model inferring it. Told nothing, a model
 * looking at two photographs will reach for "you look like you have lost a
 * couple of kilos", which is a guess about a quantity that was actually
 * measured that morning on a scale. Handing over the measured trend turns
 * that sentence into a description of something known — §1's rule applied to
 * a place where the number was never going to be computed in code, only
 * fabricated or supplied.
 *
 * WHY IT IS SYNCHRONOUS
 *
 * Unlike the session report, somebody is standing in front of a mirror with
 * the phone in their hand, having just taken the photograph, waiting. There is
 * no queue behind this and no retry: if the call fails they are told, and the
 * photograph is already saved on the phone either way.
 */
import type { Ctx } from '../db';
import { badRequest } from '../errors';
import { MAX_PHOTOS, checkinDue, daysSinceCheckin } from '../domain/physique';
import { type PhysiquePhoto, compareProgressPhotos } from '../llm/physique';
import { athleteToday } from './clock';
import { summary as weightSummary } from './bodyweight';
import { getProfile } from './profile';

export type PhysiqueCheckin = {
  takenOn: string;
  photoCount: number;
  headline: string;
  assessment: string;
  change: string | null;
  createdAt: string;
};

type Row = {
  taken_on: string;
  photo_count: number;
  headline: string;
  assessment: string;
  change: string | null;
  created_at: string;
};

const toCheckin = (row: Row): PhysiqueCheckin => ({
  takenOn: row.taken_on,
  photoCount: row.photo_count,
  headline: row.headline,
  assessment: row.assessment,
  change: row.change,
  createdAt: row.created_at,
});

export async function listCheckins(ctx: Ctx, limit = 12): Promise<PhysiqueCheckin[]> {
  const { rows } = await ctx.db.query<Row>(
    `select taken_on, photo_count, headline, assessment, change, created_at
     from physique_checkins
     where user_id = $1
     order by taken_on desc
     limit $2`,
    [ctx.userId, Math.min(Math.max(limit, 1), 52)],
  );
  return rows.map(toCheckin);
}

export async function latestCheckin(ctx: Ctx): Promise<PhysiqueCheckin | null> {
  const [first] = await listCheckins(ctx, 1);
  return first ?? null;
}

export type PhysiqueStatus = {
  checkins: PhysiqueCheckin[];
  /** Whether this week's photograph is still owed. */
  due: boolean;
  daysSince: number | null;
};

/**
 * Everything the screen needs in one round trip.
 *
 * `due` is decided here rather than on the phone, for the same reason the
 * scheduler works in the athlete's timezone: the phone's idea of today is the
 * device's, and a phone carried across a date line would otherwise start
 * disagreeing with the job that sent the notification.
 */
export async function checkinStatus(ctx: Ctx): Promise<PhysiqueStatus> {
  const [checkins, today] = await Promise.all([listCheckins(ctx), athleteToday(ctx)]);
  const last = checkins[0]?.takenOn ?? null;

  return {
    checkins,
    due: checkinDue(last, today),
    daysSince: daysSinceCheckin(last, today),
  };
}

/**
 * The trend as a sentence, or nothing.
 *
 * Nothing when the scale has not been used, which is the honest answer: a
 * week with two weigh-ins and a week with seven do not produce comparable
 * averages, and a made-up baseline would be worse than silence.
 */
async function weightNote(ctx: Ctx): Promise<string | null> {
  const summary = await weightSummary(ctx, 30);
  if (!summary.average7) return null;

  const parts = [
    `Their seven-day average weight is ${summary.average7.avgKg.toFixed(1)}kg.`,
  ];

  if (summary.changeKg != null && Math.abs(summary.changeKg) >= 0.1) {
    const direction = summary.changeKg < 0 ? 'down' : 'up';
    parts.push(
      `That is ${direction} ${Math.abs(summary.changeKg).toFixed(1)}kg on the week before.`,
    );
  } else if (summary.changeKg != null) {
    parts.push('That is unchanged on the week before.');
  }

  parts.push(
    'This is the measured figure. You may refer to it. You may not produce any other number.',
  );

  return parts.join(' ');
}

/**
 * Write this week's check-in.
 *
 * The photographs arrive newest first — the phone decides which ones to send
 * (`domain/physique.ts`), because the phone is the only place they exist.
 * Sending more than the cap is refused rather than silently trimmed: a client
 * that got the count wrong is a client that has misunderstood what it is
 * uploading, and that is worth a loud failure.
 */
export async function recordCheckin(
  ctx: Ctx,
  photos: readonly PhysiquePhoto[],
): Promise<PhysiqueCheckin> {
  if (photos.length === 0) throw badRequest('A check-in needs a photo', 'no_photo');
  if (photos.length > MAX_PHOTOS) {
    throw badRequest(`A check-in takes at most ${MAX_PHOTOS} photos`, 'too_many_photos');
  }

  const takenOn = await athleteToday(ctx);
  const [profile, note] = await Promise.all([getProfile(ctx), weightNote(ctx)]);

  const written = await compareProgressPhotos(ctx, photos, {
    locale: profile.locale ?? null,
    weightNote: note,
  });

  // Upsert on the day. Two photographs on the same Sunday are one check-in —
  // the second is somebody retaking a picture they were unhappy with, and the
  // newer reading is the one they meant.
  const { rows } = await ctx.db.query<Row>(
    `insert into physique_checkins
       (user_id, taken_on, photo_count, headline, assessment, change)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, taken_on) do update set
       photo_count = excluded.photo_count,
       headline    = excluded.headline,
       assessment  = excluded.assessment,
       change      = excluded.change,
       created_at  = now()
     returning taken_on, photo_count, headline, assessment, change, created_at`,
    [
      ctx.userId,
      takenOn,
      photos.length,
      written.headline,
      written.assessment,
      written.change,
    ],
  );

  return toCheckin(rows[0]!);
}
