/**
 * Typed environment. Reads once, fails loudly at boot rather than at 3am
 * during a workout.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  bearerToken: required('APP_BEARER_TOKEN'),
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  timezone: process.env.TZ ?? 'Europe/Berlin',
};
