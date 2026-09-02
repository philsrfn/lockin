/**
 * Apple Health.
 *
 * Logging fatigue is the main reason fitness apps are deleted in week three,
 * and the antidote is not a better logger — it is not having to log. Steps,
 * sleep, resting heart rate and a smart scale are already on the phone.
 *
 * Two things shape everything here:
 *
 *  1. HealthKit is a native module. It does not exist in Expo Go, and every
 *     entry point below returns "unavailable" rather than throwing, so the
 *     development loop keeps working in Expo Go with this feature simply off.
 *  2. A sync is a *window*, not a diff. The phone sends the last fortnight on
 *     every foreground and lets the server work out what is new. A client that
 *     remembers what it already sent is a client that loses a week when the
 *     app is reinstalled.
 */
import Constants, { AppOwnership } from 'expo-constants';
import { Platform } from 'react-native';
import { api } from '../api/client';

export type SyncResult = {
  days: number;
  workouts: { imported: number; alreadyHad: number };
  weights: { imported: number; keptHisOwn: number };
};

export type HealthState = 'unavailable' | 'denied' | 'ready';

/** How far back a sync reaches. Enough to fill in a phone that was off. */
const WINDOW_DAYS = 14;

type HealthKit = typeof import('@kingstinct/react-native-healthkit');

/**
 * Whether the native side can possibly be there.
 *
 * Checked *before* requiring, not after. HealthKit sits on Nitro modules, and
 * their absence surfaces as an error that a try/catch around the require does
 * not contain — in Expo Go that put a red screen on the settings tab. So the
 * environment is the gate and the try/catch below is only a second line.
 *
 * `appOwnership` rather than `executionEnvironment`: the latter reports Expo Go
 * and a development build identically, and a development build does have the
 * native side. Deprecated, and still the only thing that answers the question
 * being asked.
 */
function couldExist(): boolean {
  return Platform.OS === 'ios' && Constants.appOwnership !== AppOwnership.Expo;
}

let cached: HealthKit | null | undefined;

function healthkit(): HealthKit | null {
  if (cached !== undefined) return cached;
  if (!couldExist()) {
    cached = null;
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('@kingstinct/react-native-healthkit') as HealthKit;
  } catch {
    cached = null;
  }
  return cached;
}

/** What we read. Nothing is written back yet — see docs/health.md. */
const READ_TYPES = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierBodyMass',
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKWorkoutTypeIdentifier',
] as const;

export function isSupported(): boolean {
  const kit = healthkit();
  if (!kit) return false;
  try {
    return kit.isHealthDataAvailable();
  } catch {
    return false;
  }
}

/**
 * Asks once. iOS never reports read permission back — by design, so an app
 * cannot infer what somebody declined to share — so "ready" here means the
 * sheet was shown, not that anything was granted. An empty sync is the honest
 * signal that nothing was.
 */
export async function requestPermission(): Promise<HealthState> {
  const kit = healthkit();
  if (!kit || !isSupported()) return 'unavailable';

  try {
    await kit.requestAuthorization({ toRead: READ_TYPES as never });
    return 'ready';
  } catch {
    return 'denied';
  }
}

/** HealthKit's sleep values: asleep, and the three stages of it. */
const ASLEEP_VALUES = new Set([1, 3, 4, 5]);

/**
 * Lifting is logged in the app itself, so importing HealthKit's strength
 * workouts would double-count the session he just finished. Everything else
 * maps onto the kinds the weekly target understands.
 */
function kindFor(activityType: number): 'zone2' | 'intervals' | 'sport' | 'walk' | 'other' | null {
  switch (activityType) {
    case 20: // functionalStrengthTraining
    case 50: // traditionalStrengthTraining
      return null;
    case 52: // walking
      return 'walk';
    case 63: // highIntensityIntervalTraining
      return 'intervals';
    case 6: // basketball
    case 41: // soccer
    case 48: // tennis
      return 'sport';
    case 13: // cycling
    case 16: // elliptical
    case 24: // hiking
    case 35: // rowing
    case 37: // running
    case 44: // stairClimbing
    case 46: // swimming
      return 'zone2';
    default:
      return 'other';
  }
}

const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

/**
 * Reads the window and posts it. Every read is individually guarded: a phone
 * that shares steps but not sleep should still get its steps, rather than one
 * refusal costing the whole sync.
 */
export async function syncHealth(): Promise<SyncResult | null> {
  const kit = healthkit();
  if (!kit || !isSupported()) return null;

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (WINDOW_DAYS - 1));
  start.setHours(0, 0, 0, 0);

  const filter = { date: { startDate: start, endDate: end } };
  const byDay = new Map<string, Record<string, number>>();

  const put = (day: string, key: string, value: number) => {
    const entry = byDay.get(day) ?? {};
    entry[key] = value;
    byDay.set(day, entry);
  };

  const attempt = async (read: () => Promise<void>) => {
    try {
      await read();
    } catch {
      // One type declined or unavailable must not cost the rest of the sync.
    }
  };

  await attempt(async () => {
    const daily = await kit.queryStatisticsCollectionForQuantity(
      'HKQuantityTypeIdentifierStepCount',
      ['cumulativeSum'],
      start,
      { day: 1 },
      { filter, unit: 'count' },
    );
    for (const bucket of daily) {
      if (bucket.startDate && bucket.sumQuantity) {
        put(isoDay(bucket.startDate), 'steps', Math.round(bucket.sumQuantity.quantity));
      }
    }
  });

  await attempt(async () => {
    const daily = await kit.queryStatisticsCollectionForQuantity(
      'HKQuantityTypeIdentifierActiveEnergyBurned',
      ['cumulativeSum'],
      start,
      { day: 1 },
      { filter, unit: 'kcal' },
    );
    for (const bucket of daily) {
      if (bucket.startDate && bucket.sumQuantity) {
        put(isoDay(bucket.startDate), 'activeKcal', Math.round(bucket.sumQuantity.quantity));
      }
    }
  });

  await attempt(async () => {
    const samples = await kit.queryQuantitySamples(
      'HKQuantityTypeIdentifierRestingHeartRate',
      { filter, limit: 0, unit: 'count/min' },
    );
    for (const sample of samples) {
      put(isoDay(sample.startDate), 'restingHr', Math.round(sample.quantity));
    }
  });

  await attempt(async () => {
    const samples = await kit.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
      filter,
      limit: 0,
    });
    const minutes = new Map<string, number>();
    for (const sample of samples) {
      if (!ASLEEP_VALUES.has(sample.value as number)) continue;
      // Filed against the day he woke up, which is how a person reads "last
      // night's sleep".
      const day = isoDay(sample.endDate);
      const length = (sample.endDate.getTime() - sample.startDate.getTime()) / 60_000;
      minutes.set(day, (minutes.get(day) ?? 0) + length);
    }
    for (const [day, total] of minutes) put(day, 'sleepMinutes', Math.round(total));
  });

  const workouts: Record<string, unknown>[] = [];
  await attempt(async () => {
    const samples = await kit.queryWorkoutSamples({ filter, limit: 0 });
    for (const workout of samples) {
      const kind = kindFor(workout.workoutActivityType as unknown as number);
      if (!kind) continue;

      const minutes = Math.round(workout.duration.quantity / 60);
      if (minutes < 1) continue;

      workouts.push({
        externalId: workout.uuid,
        startedAt: workout.startDate.toISOString(),
        minutes,
        kind,
        distanceKm: workout.totalDistance
          ? Math.round((workout.totalDistance.quantity / 1000) * 100) / 100
          : null,
      });
    }
  });

  const weights: Record<string, unknown>[] = [];
  await attempt(async () => {
    const samples = await kit.queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', {
      filter,
      limit: 0,
      unit: 'kg',
    });
    // One per day: a scale that reports twice should not argue with itself.
    const byDate = new Map<string, number>();
    for (const sample of samples) byDate.set(isoDay(sample.startDate), sample.quantity);
    for (const [measuredOn, weightKg] of byDate) {
      weights.push({ measuredOn, weightKg: Math.round(weightKg * 10) / 10 });
    }
  });

  const days = [...byDay.entries()].map(([day, values]) => ({ day, ...values }));
  if (days.length === 0 && workouts.length === 0 && weights.length === 0) return null;

  const { result } = await api<{ result: SyncResult }>('/vitals/sync', {
    method: 'POST',
    body: { days, workouts, weights },
    timeoutMs: 20_000,
  });
  return result;
}
