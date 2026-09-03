/**
 * Adds an athlete and prints their token once.
 *
 * A command rather than an endpoint: "first friends" means Phil runs this on
 * the box and hands someone a string, which needs no new public surface and no
 * signup flow to attack. Sign in with Apple replaces it when this stops being
 * a handful of people.
 *
 *   npm run user:create -- --name Sam --timezone Europe/Berlin
 */
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from './db';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from './domain/time';
import { provisionUser } from './services/users';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const name = flag('name');
  const email = flag('email');
  const timezone = flag('timezone') ?? DEFAULT_TIME_ZONE;
  const heightCm = flag('height') ? Number(flag('height')) : undefined;

  if (!name) throw new Error('Usage: npm run user:create -- --name <name> [--email <email>] [--timezone <zone>] [--height <cm>]');
  if (!isValidTimeZone(timezone)) throw new Error(`${timezone} is not a timezone this server knows`);

  // 32 bytes of randomness, printed once and stored only as a hash.
  const token = randomBytes(32).toString('base64url');
  // Approved on the spot: running this command is the approval.
  const { user } = await provisionUser({
    name,
    email,
    token,
    timezone,
    heightCm,
    approved: true,
  });

  console.log(`\nCreated user ${user.id} (${user.name}) in ${timezone}.`);
  console.log('\nTheir token — shown once, never recoverable:\n');
  console.log(`  ${token}\n`);
  console.log('Paste it into the app on their phone. It is the whole of their');
  console.log('authentication, so send it the way you would send a password.\n');
}

const isEntrypoint =
  !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main()
    .then(() => pool.end())
    .catch((error) => {
      console.error((error as Error).message);
      process.exit(1);
    });
}
