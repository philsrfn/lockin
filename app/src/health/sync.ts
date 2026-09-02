import { AppState, type AppStateStatus } from 'react-native';
import { syncHealth } from './index';

/**
 * Syncs on foreground, and no more often than this. Somebody flicking between
 * apps should not trigger a fortnight of HealthKit queries every few seconds.
 */
const MIN_INTERVAL_MS = 15 * 60_000;

let lastRun = 0;

async function runOnce(): Promise<void> {
  const now = Date.now();
  if (now - lastRun < MIN_INTERVAL_MS) return;
  lastRun = now;

  try {
    await syncHealth();
  } catch {
    // Best effort, always. Nothing in the app depends on this having happened,
    // and a phone with Health switched off must not see an error about it.
  }
}

/** Returns a teardown, like startAutoDrain. */
export function startHealthSync(): () => void {
  void runOnce();

  const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') void runOnce();
  });

  return () => subscription.remove();
}

/** Used by the connect button, which should not wait for the throttle. */
export async function syncNow(): Promise<void> {
  lastRun = Date.now();
  await syncHealth();
}
