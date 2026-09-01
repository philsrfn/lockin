import { useCallback, useEffect, useMemo, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { ApiError, api } from '../api/client';
import type { ExercisePrescription, Session, Today, WorkoutPlan } from '../api/types';

export type LoggedSet = {
  clientId: string;
  exerciseId: number;
  setIndex: number;
  weightKg: number;
  reps: number;
  rir: number | null;
  synced: boolean;
};

export type Workout = {
  loading: boolean;
  error: string | null;
  plan: WorkoutPlan | null;
  sessionId: number | null;
  sets: LoggedSet[];
  setsFor: (exerciseId: number) => LoggedSet[];
  logSet: (input: Omit<LoggedSet, 'clientId' | 'synced' | 'setIndex'>) => Promise<void>;
  undoLastSet: (exerciseId: number) => Promise<void>;
  swap: (fromExerciseId: number, toExerciseId: number) => Promise<void>;
  finish: (input: { rpe: number; jointPain: boolean; notes?: string }) => Promise<void>;
};

/**
 * Everything the logger writes goes through here. Phase 1 slice 5 writes
 * straight to the API; slice 6 swaps the internals for local SQLite plus a sync
 * queue without the screen changing at all.
 */
export function useWorkout(): Workout {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sets, setSets] = useState<LoggedSet[]>([]);

  // Load the plan, and resume the session already in progress if there is one.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const today = await api<Today>('/today');
        if (cancelled) return;

        setPlan(today.plan);

        if (today.openSession) {
          setSessionId(today.openSession.id);
          setSets(
            today.openSession.sets.map((set) => ({
              clientId: `server-${set.id}`,
              exerciseId: set.exerciseId,
              setIndex: set.setIndex,
              weightKg: set.weightKg,
              reps: set.reps,
              rir: set.rir,
              synced: true,
            })),
          );
        } else {
          const created = await api<{ session: Session }>('/sessions', {
            method: 'POST',
            body: { template: today.plan.template },
          });
          if (cancelled) return;
          setSessionId(created.session.id);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'Could not start the workout');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setsFor = useCallback(
    (exerciseId: number) =>
      sets.filter((set) => set.exerciseId === exerciseId).sort((a, b) => a.setIndex - b.setIndex),
    [sets],
  );

  const logSet = useCallback(
    async (input: Omit<LoggedSet, 'clientId' | 'synced' | 'setIndex'>) => {
      if (sessionId == null) return;

      const setIndex = sets.filter((set) => set.exerciseId === input.exerciseId).length + 1;
      const optimistic: LoggedSet = {
        ...input,
        clientId: randomUUID(),
        setIndex,
        synced: false,
      };

      // On screen immediately. Never make him wait on the network mid-set.
      setSets((current) => [...current, optimistic]);

      try {
        await api('/sets', {
          method: 'POST',
          body: {
            sessionId,
            exerciseId: input.exerciseId,
            setIndex,
            weightKg: input.weightKg,
            reps: input.reps,
            rir: input.rir,
          },
        });
        setSets((current) =>
          current.map((set) => (set.clientId === optimistic.clientId ? { ...set, synced: true } : set)),
        );
      } catch {
        // Stays on screen unsynced. Slice 6 gives it a queue to drain from.
      }
    },
    [sessionId, sets],
  );

  const undoLastSet = useCallback(
    async (exerciseId: number) => {
      const forExercise = sets
        .filter((set) => set.exerciseId === exerciseId)
        .sort((a, b) => a.setIndex - b.setIndex);
      const last = forExercise[forExercise.length - 1];
      if (!last) return;

      setSets((current) => current.filter((set) => set.clientId !== last.clientId));

      if (last.clientId.startsWith('server-')) {
        try {
          await api(`/sets/${last.clientId.replace('server-', '')}`, { method: 'DELETE' });
        } catch {
          // Nothing to do — the next refresh reconciles.
        }
      }
    },
    [sets],
  );

  const swap = useCallback(
    async (fromExerciseId: number, toExerciseId: number) => {
      const query = sessionId ? `?excludeSessionId=${sessionId}` : '';
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
    [sessionId],
  );

  const finish = useCallback(
    async (input: { rpe: number; jointPain: boolean; notes?: string }) => {
      if (sessionId == null) return;
      await api(`/sessions/${sessionId}`, {
        method: 'PATCH',
        body: { rpe: input.rpe, jointPain: input.jointPain, notes: input.notes ?? null },
      });
    },
    [sessionId],
  );

  return useMemo(
    () => ({ loading, error, plan, sessionId, sets, setsFor, logSet, undoLastSet, swap, finish }),
    [loading, error, plan, sessionId, sets, setsFor, logSet, undoLastSet, swap, finish],
  );
}
