import { useCallback, useEffect, useMemo, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { api } from '../api/client';
import { t } from '../lib/locale';
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
  finish: (input: { rpe: number; jointPain: boolean; notes?: string }) => Promise<void>;
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
 */
export function useWorkout(chosenTemplate?: string): Workout {
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

      if (!current) {
        current = {
          clientId: randomUUID(),
          serverId: null,
          template: chosenTemplate ?? today.plan.template,
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
      if (current.template === today.plan.template) {
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

  const finish = useCallback(
    async (input: { rpe: number; jointPain: boolean; notes?: string }) => {
      if (!session) return;

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
        setPlan(today.plan);
        setStale(false);
      } catch {
        // Still offline. The banner is correct; try again on the next drain.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stale, queue.pending.size]);

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
      finish,
    }),
    [loading, error, plan, stale, queue, decorated, setsFor, logSet, undoLastSet, swap, finish],
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
