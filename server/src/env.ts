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
  /**
   * The iOS bundle identifier. It is what binds an Apple identity token to
   * this app — without it, a token Apple issued to any other app would sign
   * somebody in here.
   */
  appleBundleId: optional('APPLE_BUNDLE_ID', 'de.dotspiro.lockin'),
  /**
   * Who may let themselves in.
   *
   * `invite` is how this has always worked: signing in with Apple creates an
   * account and an operator admits it. That is right while the people using
   * the app are people you know, and it is the default here so that nothing
   * changes by deploying this.
   *
   * `open` admits an account the moment it is created, which is what a public
   * app has to do — nobody downloads something and waits for a stranger to
   * press a button. It stays a setting rather than a rewrite because the way
   * back matters: if this is ever abused, one variable closes the door again
   * without touching anybody already inside.
   */
  signupMode: (process.env.SIGNUP_MODE === 'open' ? 'open' : 'invite') as 'open' | 'invite',
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  /**
   * The container's own clock, for log timestamps. It is NOT what "today"
   * means — that comes from profile.timezone via services/clock.ts.
   */
  timezone: process.env.TZ ?? 'Europe/Berlin',
};
