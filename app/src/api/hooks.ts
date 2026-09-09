import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ApiError, api } from '../api/client';
import { messageFor } from '../lib/apiError';
import { cacheRead, cacheWrite } from '../db/local';

export type Resource<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  /** Showing a cached copy because the network was unreachable. */
  stale: boolean;
  reload: () => Promise<void>;
  /** Replace the cached value after a write, without a round trip. */
  set: (value: T) => void;
};

/**
 * Fetch on mount, refetch on focus, pull to refresh.
 *
 * Every successful response is written to local SQLite, and a failed fetch
 * falls back to it. He should be able to open this app in a basement gym and
 * still see the session he is about to do.
 */
export function useResource<T>(path: string): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'refresh') setRefreshing(true);
      try {
        const fresh = await api<T>(path);
        cacheWrite(path, fresh);
        setData(fresh);
        setError(null);
        setStale(false);
      } catch (caught) {
        // Only when the server did not answer. A 401 or a 403 is an answer —
        // showing yesterday's numbers over the top of one makes a revoked or
        // not-yet-approved account look like a working app.
        const definitive = caught instanceof ApiError && !caught.retryable;
        const cached = definitive ? null : cacheRead<T>(path);
        if (cached) {
          setData(cached);
          setStale(true);
          setError(null);
        } else {
          // Was an English literal, on the path every screen loads through —
          // so a German athlete with no signal was told about it in English.
          setError(messageFor(caught, 'somethingWentWrong'));
        }
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
    stale,
    reload: () => load('refresh'),
    set: (value: T) => {
      cacheWrite(path, value);
      setData(value);
      setStale(false);
    },
  };
}
