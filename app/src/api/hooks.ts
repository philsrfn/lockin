import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ApiError, api } from './client';

export type Resource<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
  /** Replace the cached value after a write, without a round trip. */
  set: (value: T) => void;
};

/**
 * Fetch on mount, refetch on focus, and expose a pull-to-refresh handler.
 * Keeps the last good value on the screen when a refresh fails — a stale plan
 * beats a spinner when the gym wifi drops.
 */
export function useResource<T>(path: string): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      try {
        setData(await api<T>(path));
        setError(null);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Something went wrong');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [path],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load('refresh');
    }, [load]),
  );

  return {
    data,
    error,
    loading,
    refreshing,
    reload: () => load('refresh'),
    set: setData,
  };
}
