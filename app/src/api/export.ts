/**
 * Everything this app holds about somebody, handed to them as a file.
 *
 * `GET /me/export` has answered this for months; what was missing was a way to
 * reach it from a phone. A right that requires curl is not a right somebody
 * has — GDPR Article 15 asks for access and Article 20 asks for it in a form
 * that can be taken elsewhere, and a JSON file in the share sheet is both.
 *
 * Through `api()` rather than a raw fetch (§16), which is also what gives this
 * the same 401 and pending-approval handling as every other call. The timeout
 * is raised because the export is the one request that grows with the length
 * of somebody's training history, and eight seconds is sized for a gym wifi
 * answering a small question.
 *
 * The file goes to the cache directory on purpose: iOS may reclaim it, which
 * is the correct lifetime for a copy that exists to be handed to the share
 * sheet and then belongs wherever it was sent.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api } from './client';

const TIMEOUT_MS = 60_000;

export type ExportResult = 'shared' | 'unavailable';

/** What the server sends back. Only the field the filename is built from. */
type ExportPayload = { exportedAt?: string };

export async function exportMyData(): Promise<ExportResult> {
  const payload = await api<ExportPayload>('/me/export', { timeoutMs: TIMEOUT_MS });

  // The server names the file by the day it was made; if it ever stops
  // sending that, today is the same answer for the purpose a name serves.
  const day = (payload.exportedAt ?? new Date().toISOString()).slice(0, 10);
  const file = new File(Paths.cache, `lockin-${day}.json`);

  // A second export on the same day would otherwise hit a file that is
  // already there. Overwriting is right: it is the same data, freshly asked
  // for, and keeping lockin-2026-09-14 (1).json helps nobody.
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(payload, null, 2));

  /**
   * Checked rather than assumed. Sharing is unavailable on a simulator without
   * the share sheet and on a device where it has been restricted, and the
   * failure there is silent — the promise resolves and nothing appears, which
   * reads as the button being broken.
   */
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';

  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
  });

  return 'shared';
}
