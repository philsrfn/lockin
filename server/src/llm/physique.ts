/**
 * Looking at four photographs and saying what changed.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * No numbers. Not an estimated body fat percentage, not a weight, not a
 * measurement in centimetres, not a percentage of anything. §1 keeps every
 * figure that matters out of the model, and a figure guessed from a
 * photograph is the worst instance of it — it is not a measurement, it moves
 * with the bathroom light and the time of day, and printed beside a weight
 * from a scale it would look exactly as solid as the weight does.
 *
 * The schema cannot forbid a number, so the instruction says it four times
 * and the service checks the output. What the model is genuinely good at is
 * noticing that the line of somebody's shoulder is not where it was a month
 * ago, and saying so in a sentence. That is the whole job.
 *
 * WHAT ARRIVES AND WHAT DOES NOT
 *
 * The images are inline base64 and are gone from this process when the call
 * returns. Nothing here writes a file, and the only thing that reaches
 * Postgres is the prose that comes back. See migration 034.
 */
import type { Ctx } from '../db';
import { generateFor } from './metered';
import { LlmError } from './provider';
import { languageInstruction } from '../domain/language';

export type PhysiquePhoto = {
  /** Base64, no data-URL prefix. */
  data: string;
  mimeType: string;
  /** The athlete's day the photograph was taken on. */
  takenOn: string;
};

export type WrittenCheckin = {
  headline: string;
  assessment: string;
  change: string | null;
  model: string;
};

const SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description:
        'One short line, read on a lock screen. Under 60 characters. What stands out, plainly. Never a greeting, never a question, never a number.',
    },
    assessment: {
      type: 'string',
      description:
        'Two or three sentences describing what you can actually see in the most recent photograph: posture, where the body carries its weight, how it is lit. Describe, do not grade.',
    },
    change: {
      type: 'string',
      description:
        'What is different from the earlier photographs, and in which direction. Name the body part and what changed about it. Leave empty when there is only one photograph, or when the pictures are too different in pose or lighting to compare honestly — saying so is a real answer.',
    },
  },
  required: ['headline', 'assessment'],
};

const INSTRUCTION = `You are the athlete's trainer, looking at their weekly progress photographs.

The most recent photograph is first; older ones follow, newest to oldest, and each
is labelled with the day it was taken.

NEVER GIVE A NUMBER. No body fat percentage, no weight, no measurement, no
percentage of anything, not even as a range and not even hedged. You cannot
measure any of those from a picture, and the athlete has a scale and a tape
measure that can. If they want a number, that is where it comes from. A guess
dressed as a figure is the one thing that would make this feature worth deleting.

Describe what you can see and how it differs from before. "Shoulders read wider
and the waist narrower than four weeks ago" is the register. Name the body part.

Be honest about what you cannot tell. Different pose, different light, different
distance from the camera, a photograph too dark to read — say so instead of
producing a comparison the pictures do not support. Nothing that has gone
unchanged has to be dressed up as progress: "this looks much the same as last
week" is a legitimate and useful answer, and a month of it is information.

You are not a doctor. Say nothing about health, disease, eating or anybody's
relationship with their body. If a photograph worries you, the only thing you say
is that a doctor is the right person to ask.

Direct and warm. Short sentences — this is read on a phone. No moralising, no
exclamation marks, no compliments on appearance as such: you are commenting on
training, not on how somebody looks.`;

export async function compareProgressPhotos(
  ctx: Ctx,
  photos: readonly PhysiquePhoto[],
  context: { locale: string | null; weightNote: string | null },
): Promise<WrittenCheckin> {
  if (photos.length === 0) throw new LlmError('No photograph to look at', false);

  const lines = [
    photos.length === 1
      ? 'This is their first progress photograph. There is nothing to compare it against yet.'
      : `Photograph 1 was taken on ${photos[0]?.takenOn}. ${photos
          .slice(1)
          .map((photo, index) => `Photograph ${index + 2} on ${photo.takenOn}`)
          .join(', ')}.`,
  ];

  /**
   * The scale's answer, handed over as a fact rather than left to be guessed
   * at from the picture. It is the difference between "you look leaner" and
   * "you are 2kg down and it shows in the waist" — the second is grounded in
   * something that was actually measured, which is the only reason the first
   * sentence is worth anything.
   */
  if (context.weightNote) lines.push(context.weightNote);

  const output = await generateFor(ctx, {
    purpose: 'physique_checkin',
    systemInstruction: `${INSTRUCTION}\n\n${languageInstruction(context.locale)}`,
    history: [
      {
        role: 'user',
        text: lines.join('\n'),
        images: photos.map((photo) => ({ data: photo.data, mimeType: photo.mimeType })),
      },
    ],
    responseSchema: SCHEMA,
    model: 'fast',
    // Four images and a thinking model. The session report was lost to a
    // budget that looked generous and was eaten by reasoning before a word
    // was written; this one has more to look at, so it gets more room.
    maxOutputTokens: 6000,
    temperature: 0.4,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output.text) as Record<string, unknown>;
  } catch {
    throw new LlmError('The check-in came back malformed', true);
  }

  const change = String(parsed.change ?? '').trim();

  return {
    headline: String(parsed.headline ?? '').trim(),
    assessment: String(parsed.assessment ?? '').trim(),
    change: change || null,
    model: output.model,
  };
}
