/**
 * The gate in front of the trainer.
 *
 * Deliberately narrow. It guards the routes that reach a model — the chat, the
 * daily read, the Sunday review, estimating food from a line or a photograph,
 * and the fridge. Everything else stays open for ever: logging a set, logging
 * a meal, reading a history, taking an export, deleting an account.
 *
 * That line is a product decision and also a practical one. What costs money
 * to run is the model. What somebody paid for with months of their own
 * attention is the data, and taking that away to force a renewal is how an app
 * gets renewed once and never trusted again.
 *
 * 402 rather than 403: the answer is not "you may not", it is "not yet". The
 * app branches on the code either way.
 */
import type { FastifyRequest } from 'fastify';
import { paymentRequired } from './errors';
import { accessForAthlete } from './services/entitlements';

export async function requireCoach(request: FastifyRequest): Promise<void> {
  const access = await accessForAthlete(request.ctx);
  if (access.coach) return;

  throw paymentRequired(
    'The trainer needs an active subscription. Everything you have logged stays ' +
      'where it is, and you can keep logging.',
    'subscription_required',
  );
}
