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

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  bearerToken: required('APP_BEARER_TOKEN'),

  // The key never leaves the backend (§2). The app talks only to this server.
  geminiApiKey: required('GEMINI_API_KEY'),
  geminiModelFast: optional('GEMINI_MODEL_FAST', 'gemini-3.6-flash'),
  geminiModelSmart: optional('GEMINI_MODEL_SMART', 'gemini-3.6-flash'),
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  timezone: process.env.TZ ?? 'Europe/Berlin',
};
