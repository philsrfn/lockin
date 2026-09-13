/**
 * "What did I actually do?"
 *
 * Progress answers whether the numbers are going up. This answers what
 * happened, which is a different question and the one people ask more often:
 * a weight felt wrong on Thursday and you want to see Tuesday, or somebody
 * asks how the week went, or you simply want to look at the work.
 *
 * Lifts and cardio come back interleaved, because a week is three lifts and
 * two cardio sessions and a history that showed only half of it would be
 * quietly telling somebody they trained less than they did.
 */
import type { Ctx } from '../db';
import { type TrainingDay, groupTrainingByDay, summariseSets } from '../domain/history';
import { dayIn } from '../domain/time';
import type { SessionSummary } from '../domain/history';
import { type CardioSession, recentCardio } from './cardio';
import { athleteZone } from './clock';
import { type Session, recentSessions } from './sessions';
import { sessionState } from '../domain/session';

export type HistorySession = Session & { summary: SessionSummary };

export type TrainingHistory = {
  days: TrainingDay<HistorySession, CardioSession>[];
  /**
   * Today in the athlete's own zone. Sent because the screen labels the first
   * rows "Today" and "Yesterday", and a phone in another timezone would
   * disagree with the grouping this same function just did.
   */
  today: string;
  /** Over the window asked for, so the screen does not have to add it up. */
  totals: {
    sessions: number;
    cardioSessions: number;
    cardioMinutes: number;
    setCount: number;
    totalVolumeKg: number;
  };
};

export async function trainingHistory(ctx: Ctx, days: number): Promise<TrainingHistory> {
  const [zone, sessions, cardio] = await Promise.all([
    athleteZone(ctx),
    recentSessions(ctx, days),
    recentCardio(ctx, days),
  ]);

  /**
   * An unfinished session stays in, as long as something was logged against
   * it. Walking away without pressing finish is a thing that happens, and
   * hiding those would make the history disagree with the sets the person can
   * plainly remember doing.
   *
   * A session with nothing in it is different: Start pressed, phone pocketed,
   * gym never entered. Nobody remembers that as a training day, and printing
   * it as one turns the history into a list of intentions. One still in
   * progress is left alone — it is happening right now, and it is the screen
   * saying so.
   */
  const summarised: HistorySession[] = sessions
    .filter((session) => session.sets.length > 0 || sessionState({
      performedAt: new Date(session.performedAt),
      rpe: session.rpe,
      setCount: session.sets.length,
    }) === 'live')
    .map((session) => ({
      ...session,
      summary: summariseSets(session.sets),
    }));

  return {
    days: groupTrainingByDay(zone, summarised, cardio),
    today: dayIn(zone),
    totals: {
      sessions: summarised.length,
      cardioSessions: cardio.length,
      cardioMinutes: cardio.reduce((total, entry) => total + entry.minutes, 0),
      setCount: summarised.reduce((total, session) => total + session.summary.setCount, 0),
      totalVolumeKg: summarised.reduce(
        (total, session) => total + session.summary.totalVolumeKg,
        0,
      ),
    },
  };
}
