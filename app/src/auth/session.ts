/**
 * Ending a session, and ending an account. Two different things, and the app
 * says so plainly — signing out leaves everything on the server, deleting does
 * not.
 */
import { api } from '../api/client';
import { clearConfig } from '../api/config';

export type Account = {
  user: { id: number; name: string | null; email: string | null };
  /** 'root' accounts were provisioned by whoever runs the server. */
  kind: 'apple' | 'root';
};

export async function loadAccount(): Promise<Account> {
  return api<Account>('/account');
}

/**
 * This device only. The server revokes the token; the keychain forgets it
 * either way, because a sign-out that fails on a bad connection and leaves
 * somebody signed in is the wrong answer to a tapped button.
 */
export async function signOut(): Promise<void> {
  try {
    await api('/auth/signout', { method: 'POST', body: {} });
  } catch {
    // Nothing to recover: the token is about to be unusable from here.
  }
  await clearConfig();
}

/** Irreversible, and the caller is expected to have said so. */
export async function deleteAccount(): Promise<void> {
  await api('/account', { method: 'DELETE' });
  await clearConfig();
}
