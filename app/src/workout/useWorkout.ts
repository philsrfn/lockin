import { useCallback, useEffect, useMemo, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { api } from '../api/client';
import { t } from '../lib/locale';
import { isAbandoned } from '../lib/sessionAge';
import type { ExercisePrescription, Today, WorkoutPlan } from '../api/types';
import {
  type LocalSession,
  cacheRead,
  cacheWrite,
  deleteSet as deleteLocalSet,
  findSessionByServerId,
  insertSession,
  insertSet,
  markSessionFinished,
  openLocalSession,
  sessionServerId,
  setsForSession,
} from '../db/local';
import { type QueueSnapshot, drain, enqueue, snapshot, subscribe } from '../sync/queue';

export type SetSyncState = 'synced' | 'queued' | 'failed';

export type LoggedSet = {
  clientId: string;
  exerciseId: number;
  setIndex: number;
  weightKg: number;
  reps: number;
  rir: number | null;
  sync: SetSyncState;
};

export type Workout = {
  loading: boolean;
  error: string | null;
  plan: WorkoutPlan | null;
  /** True when the plan came from cache because the network was unreachable. */
  stale: boolean;
  pending: number;
  /** Writes the server permanently rejected. Still on the phone. */
  failed: number;
  sets: LoggedSet[];
  setsFor: (exerciseId: number) => LoggedSet[];
  logSet: (input: { exerciseId: number; weightKg: number; reps: number; rir: number | null }) => void;
  undoLastSet: (exerciseId: number) => void;
  swap: (fromExerciseId: number, toExerciseId: number) => Promise<void>;
  addExercise: (exerciseId: number) => Promise<void>;
  /**
   * Closes the session and answers with the id the server knows it by, or
   * `null` when the finish is still sitting in the queue. The screen needs
   * that id to ask for *this* session's write-up: sending it to "the latest
   * report" instead showed the previous session's one, which reads as a
   * write-up of the session just finished and is not.
   */
  finish: (input: { rpe: number; jointPain: boolean; notes?: string }) => Promise<number | null>;
};

// Same key useResource writes under, so Today and the logger share one cache.
const PLAN_CACHE_KEY = '/today';

/**
 * A chosen day's plan, cached under its own key.
 *
 * The rotation's plan arrives with /today; any other day has to be asked for.
 * Cached per day so that a session picked once works in the same basement the
 * second time — the logger's whole promise is that it does not need signal.
 */
const planCacheKey = (template: string) => `/workouts/next?template=${template}`;

/** The free session's shell has one key, because there is only one of it. */
const FREE_PLAN_CACHE_KEY = '/workouts/free';

/**
 * Local-first. A set is written to SQLite and rendered before the network is
 * touched at all; the queue carries it to the backend whenever it can.
 *
 * The screen above this hook does not know or care whether there is signal.
 */
/**
 * @param chosenTemplate a day the athlete picked instead of the one the
 *   rotation proposed. Applied only when starting a *new* session — an
 *   already-open one keeps the day it was started with, because changing it
 *   underneath logged sets would re-file work that has already happened.
 *
 *   `null` is an explicit choice too: a free session, belonging to no
 *   programme day. `undefined` means "whatever the rotation says".
 */
export function useWorkout(chosenTemplate?: string | null): Workout {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [stale, setStale] = useState(false);
  const [session, setSession] = useState<LocalSession | null>(null);
  const [sets, setSets] = useState<LoggedSet[]>([]);
  const [queue, setQueue] = useState<QueueSnapshot>(() => snapshot());

  useEffect(() => subscribe(setQueue), []);

  const reloadSets = useCallback((sessionClientId: string) => {
    const current = snapshot();
    setSets(
      setsForSession(sessionClientId).map((set) => ({
        clientId: set.clientId,
        exerciseId: set.exerciseId,
        setIndex: set.setIndex,
        weightKg: set.weightKg,
        reps: set.reps,
        rir: set.rir,
        sync: syncStateOf(set.clientId, current),
      })),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let today: Today | null = null;

      try {
        today = await api<Today>('/today');
        cacheWrite(PLAN_CACHE_KEY, today);
      } catch {
        // No signal. Fall back to the last plan we saw — a stale plan beats a
        // blank screen when he is already standing at the rack.
        today = cacheRead<Today>(PLAN_CACHE_KEY);
        if (!cancelled) setStale(true);
      }

      if (cancelled) return;

      if (!today) {
        setError('No plan cached yet — connect once and it will work offline after that.');
        setLoading(false);
        return;
      }

      let current = openLocalSession();

      // Every day the current programme actually has. A session whose day is
      // not on this list belongs to a programme that has since been left.
      const dayCodes = today.plan.days.map((day) => day.code);
      const belongsToProgramme = (session: LocalSession) =>
        session.template === null || dayCodes.includes(session.template);

      /**
       * A session left open under a programme that has since been swapped.
       *
       * This is the bug that put "this phone has never loaded that day" on
       * screen with full signal: the session said 'B', the new programme has
       * Push/Pull/Legs, the logger asked for day B by name and the server
       * answered 404 — correctly, because that day no longer exists. The
       * phone then looked in its cache, found nothing under that key, and
       * reported it as an offline problem.
       *
       * Dropped locally rather than finished over the wire. Closing it would
       * need an RPE, and inventing one would be putting a number into the
       * history that nobody said. Its sets stay exactly where they are, and
       * the server counts a session with sets and no RPE as finished once it
       * is old enough — which is what walking away from one is.
       */
      if (current && !belongsToProgramme(current)) {
        markSessionFinished(current.clientId);
        current = null;
      }

      /**
       * Left open for longer than the server counts as live, which is what
       * walking away from a session is. Closed the same way as the one above
       * and for the same reason: locally, with no RPE invented and nothing sent
       * over the wire, because the server already counts it by the same rule.
       * Anything still queued for it drains as normal. See lib/sessionAge.ts.
       */
      if (current && isAbandoned(current.performedAt)) {
        markSessionFinished(current.clientId);
        current = null;
      }

      // The server knows about a session this device has not seen: adopt it
      // rather than starting a second one.
      if (!current && today.openSession) {
        const adopted = findSessionByServerId(today.openSession.id) ?? {
          clientId: randomUUID(),
          serverId: today.openSession.id,
          template: today.openSession.template ?? today.plan.template,
          performedAt: today.openSession.performedAt,
          finished: false,
        };

        // Not ours to adopt, for the same reason as above. Left untouched on
        // the server, where it is history.
        if (belongsToProgramme(adopted) && !isAbandoned(adopted.performedAt)) {
          insertSession(adopted);
          for (const set of today.openSession.sets) {
            insertSet({
              clientId: `server-${set.id}`,
              sessionClientId: adopted.clientId,
              exerciseId: set.exerciseId,
              setIndex: set.setIndex,
              weightKg: set.weightKg,
              reps: set.reps,
              rir: set.rir,
            });
          }
          current = adopted;
        }
      }

      if (!current) {
        current = {
          clientId: randomUUID(),
          serverId: null,
          // `undefined` means the rotation decides; `null` is a deliberate
          // free session and must survive the fallback.
          template: chosenTemplate === undefined ? today.plan.template : chosenTemplate,
          performedAt: new Date().toISOString(),
          finished: false,
        };
        insertSession(current);
        // Queued, not posted. Starting a workout must work with no signal.
        enqueue(current.clientId, {
          op: 'create_session',
          payload: { template: current.template, performedAt: current.performedAt },
        });
      }

      /**
       * The plan follows the session, never the other way round.
       *
       * A session already open keeps the day its logged sets belong to — a
       * choice made on the home screen cannot re-file work that has already
       * happened. Only a session started now takes the chosen day. Getting
       * this backwards showed one day's exercises while writing them into
       * another day's session, which is worse than not offering the choice.
       */
      if (current.template === null) {
        // A free session starts empty on purpose: what it contains is decided
        // one exercise at a time, by somebody standing in the gym.
        try {
          const free = await api<WorkoutPlan>('/workouts/free');
          cacheWrite(FREE_PLAN_CACHE_KEY, free);
          if (!cancelled) setPlan(free);
        } catch {
          const cached = cacheRead<WorkoutPlan>(FREE_PLAN_CACHE_KEY);
          if (!cached) {
            if (!cancelled) {
              setError(t('freeSessionUnavailable'));
              setLoading(false);
            }
            return;
          }
          if (!cancelled) {
            setPlan(cached);
            setStale(true);
          }
        }
      } else if (current.template === today.plan.template) {
        setPlan(today.plan);
      } else {
        const key = planCacheKey(current.template);
        try {
          const forSession = await api<WorkoutPlan>(
            `/workouts/next?template=${encodeURIComponent(current.template)}`,
          );
          cacheWrite(key, forSession);
          if (!cancelled) setPlan(forSession);
        } catch {
          const cached = cacheRead<WorkoutPlan>(key);
          if (!cached) {
            if (!cancelled) {
              setError(t('chosenDayUnavailable'));
              setLoading(false);
            }
            return;
          }
          if (!cancelled) {
            setPlan(cached);
            setStale(true);
          }
        }
      }

      if (cancelled) return;

      setSession(current);
      reloadSets(current.clientId);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadSets]);

  const setsFor = useCallback(
    (exerciseId: number) =>
      sets
        .filter((set) => set.exerciseId === exerciseId)
        .sort((a, b) => a.setIndex - b.setIndex)
        .map((set) => ({ ...set, sync: syncStateOf(set.clientId, queue) })),
    [sets, queue],
  );

  const logSet = useCallback(
    (input: { exerciseId: number; weightKg: number; reps: number; rir: number | null }) => {
      if (!session) return;

      const setIndex = sets.filter((set) => set.exerciseId === input.exerciseId).length + 1;
      const clientId = randomUUID();

      // Disk first, screen second, network whenever. Nothing here can block on
      // a request, so a set is never lost to a dead bar of signal.
      insertSet({ clientId, sessionClientId: session.clientId, setIndex, ...input });
      setSets((current) => [...current, { clientId, setIndex, sync: 'queued', ...input }]);

      enqueue(clientId, {
        op: 'record_set',
        payload: {
          // A session adopted from the server has an id the backend already
          // knows. Referencing it by client uuid would look up a create_session
          // op that never existed, and the write would be rejected outright.
          ...sessionReference(session),
          exerciseId: input.exerciseId,
          setIndex,
          weightKg: input.weightKg,
          reps: input.reps,
          rir: input.rir,
        },
      });
    },
    [session, sets],
  );

  const undoLastSet = useCallback(
    (exerciseId: number) => {
      const forExercise = sets
        .filter((set) => set.exerciseId === exerciseId)
        .sort((a, b) => a.setIndex - b.setIndex);
      const last = forExercise[forExercise.length - 1];
      if (!last || !session) return;

      deleteLocalSet(last.clientId);
      setSets((current) => current.filter((set) => set.clientId !== last.clientId));

      // If it already reached the server it needs deleting there too. If it did
      // not, it is still in the queue and will fail harmlessly as a duplicate.
      if (last.sync === 'synced' && last.clientId.startsWith('server-')) {
        void api(`/sets/${last.clientId.replace('server-', '')}`, { method: 'DELETE' }).catch(
          () => undefined,
        );
      }
    },
    [session, sets],
  );

  const swap = useCallback(
    async (fromExerciseId: number, toExerciseId: number) => {
      const query = session?.serverId ? `?excludeSessionId=${session.serverId}` : '';
      const result = await api<{ prescription: ExercisePrescription }>(
        `/exercises/${toExerciseId}/prescription${query}`,
      );

      setPlan((current) =>
        current
          ? {
              ...current,
              exercises: current.exercises.map((exercise) =>
                exercise.exerciseId === fromExerciseId ? result.prescription : exercise,
              ),
            }
          : current,
      );
    },
    [session],
  );

  /**
   * Adds a movement to what is on screen, load and all.
   *
   * The same prescription endpoint the swap button uses, so an exercise added
   * halfway through a free session arrives with the weight this athlete's own
   * history says it should carry — not an empty field. Appending rather than
   * replacing is the only difference between this and `swap`.
   */
  const addExercise = useCallback(
    async (exerciseId: number) => {
      const query = session?.serverId ? `?excludeSessionId=${session.serverId}` : '';
      const result = await api<{ prescription: ExercisePrescription }>(
        `/exercises/${exerciseId}/prescription${query}`,
      );

      setPlan((current) => {
        if (!current) return current;
        // Already there — scroll to it rather than list it twice.
        if (current.exercises.some((exercise) => exercise.exerciseId === exerciseId)) return current;
        return { ...current, exercises: [...current.exercises, result.prescription] };
      });
    },
    [session],
  );

  const finish = useCallback(
    async (input: { rpe: number; jointPain: boolean; notes?: string }) => {
      if (!session) return null;

      markSessionFinished(session.clientId);
      enqueue(randomUUID(), {
        op: 'finish_session',
        payload: {
          ...sessionReference(session),
          rpe: input.rpe,
          jointPain: input.jointPain,
          notes: input.notes ?? null,
        },
      });

      // Best effort: if there is signal, land it now so Today is right when he
      // gets back to it.
      await drain();

      // After the drain, because that is when a session started offline is
      // given its id.
      return sessionServerId(session.clientId);
    },
    [session],
  );

  // The plan came from cache while the network was down. Once writes start
  // landing again the connection is back, so refresh it and drop the banner —
  // leaving "offline" on screen after the signal returns is its own small lie.
  useEffect(() => {
    if (!stale || queue.pending.size > 0) return;
    let cancelled = false;

    void (async () => {
      try {
        const today = await api<Today>('/today');
        if (cancelled) return;
        cacheWrite(PLAN_CACHE_KEY, today);
        // Only when the session on screen is the rotation's own day. A free
        // session, or one picked off the day list, has a different plan
        // entirely, and overwriting it here would swap the exercises out from
        // under sets that are already logged against them.
        if (session && session.template === today.plan.template) setPlan(today.plan);
        setStale(false);
      } catch {
        // Still offline. The banner is correct; try again on the next drain.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stale, queue.pending.size, session]);

  // Each set's state is read from the queue itself. Deriving it from "the
  // queue is empty" was wrong: a rejected write also empties the queue, and
  // the screen then claimed a lost set had been saved.
  const decorated = useMemo(
    () => sets.map((set) => ({ ...set, sync: syncStateOf(set.clientId, queue) })),
    [sets, queue],
  );

  return useMemo(
    () => ({
      loading,
      error,
      plan,
      stale,
      pending: queue.pending.size,
      failed: queue.dead.size,
      sets: decorated,
      setsFor,
      logSet,
      undoLastSet,
      swap,
      addExercise,
      finish,
    }),
    [
      loading,
      error,
      plan,
      stale,
      queue,
      decorated,
      setsFor,
      logSet,
      undoLastSet,
      swap,
      addExercise,
      finish,
    ],
  );
}

function syncStateOf(clientId: string, queue: QueueSnapshot): SetSyncState {
  if (queue.dead.has(clientId)) return 'failed';
  if (queue.pending.has(clientId)) return 'queued';
  return 'synced';
}

/**
 * How a queued op should point at its session: by server id once the backend
 * knows about it, otherwise by the client uuid of the create_session op that is
 * queued ahead of it.
 */
function sessionReference(session: LocalSession): { sessionId: number } | { sessionClientId: string } {
  return session.serverId != null
    ? { sessionId: session.serverId }
    : { sessionClientId: session.clientId };
}
