import { Directory, File, Paths } from 'expo-file-system';

/**
 * The progress photographs, which live here and nowhere else.
 *
 * WHY THE PHONE
 *
 * The server stores what the trainer said about a photograph and never the
 * photograph. That was a decision about what this app is in a position to
 * promise: a picture of somebody's body on a rented droplet in Frankfurt is a
 * different kind of liability from a row saying they squatted 100kg, and the
 * privacy notice has said since the first version that photographs are not
 * kept. Keeping the words and dropping the image is the only version of this
 * feature that leaves that sentence true.
 *
 * The cost is honest and worth stating plainly: a new phone starts with an
 * empty album, and the data export carries the paragraphs but not the
 * pictures. An iCloud backup restores them, because this writes into the
 * app's documents directory like any other app data — that is iOS doing what
 * somebody already asked it to do with everything else on their phone, not
 * this app sending anything anywhere.
 *
 * WHY THERE IS NO TABLE
 *
 * The filename is the index. `2026-09-15.jpg` is the whole record: one
 * photograph per day, the day is the key, and listing the directory is the
 * query. A SQLite table beside the files would add a second source of truth
 * that can drift from the first — a row whose file was cleared by iOS, or a
 * file with no row — and there is nothing it would buy.
 */

const FOLDER = 'physique';
const NAME = /^(\d{4}-\d{2}-\d{2})\.jpg$/;

export type StoredPhoto = { takenOn: string; uri: string };

/**
 * How many earlier photographs go with a new one.
 *
 * Three, which with today's makes the four the server will accept. Enough to
 * see a direction rather than a single step — one comparison is noise, three
 * is a line — and few enough that the upload still finishes on a phone
 * network.
 */
export const HISTORY_PHOTOS = 3;

function folder(): Directory {
  const directory = new Directory(Paths.document, FOLDER);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

const fileFor = (takenOn: string) => new File(folder(), `${takenOn}.jpg`);

/**
 * Newest first, which is the order the comparison wants and the order the
 * screen shows. The directory decides what exists; anything in there that is
 * not a dated jpeg is ignored rather than repaired.
 */
export function listPhotos(): StoredPhoto[] {
  return folder()
    .list()
    .flatMap((entry) => {
      const matched = entry instanceof File ? NAME.exec(entry.name) : null;
      return matched ? [{ takenOn: matched[1]!, uri: entry.uri }] : [];
    })
    .sort((a, b) => (a.takenOn < b.takenOn ? 1 : -1));
}

/**
 * Write today's photograph, replacing any earlier attempt from the same day.
 *
 * Overwriting is right: a second photograph on the same morning is somebody
 * retaking one they were unhappy with, and keeping both would put two
 * pictures of the same day into a comparison that is about weeks.
 */
export function savePhoto(takenOn: string, base64: string): StoredPhoto {
  const file = fileFor(takenOn);
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: 'base64' });
  return { takenOn, uri: file.uri };
}

export async function readBase64(takenOn: string): Promise<string> {
  return fileFor(takenOn).base64();
}

export function deletePhoto(takenOn: string): void {
  const file = fileFor(takenOn);
  if (file.exists) file.delete();
}
