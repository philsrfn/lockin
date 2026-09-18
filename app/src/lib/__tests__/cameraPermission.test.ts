/**
 * The camera permission string has to name every reason the camera opens.
 *
 * It drifted the way these always drift. The string was written when the only
 * thing the camera did was read a barcode — "lockin scans food barcodes to log
 * what you eat" — and then three more surfaces were added on top of it: the
 * meal photo, the fridge, and the weekly progress photo. Nothing broke,
 * because a permission string is not code. What happened instead is that
 * somebody pointing the camera at their own body to take a progress photo got
 * a system dialog telling them the app scans food barcodes.
 *
 * That is worse than untidy. It is the one sentence iOS shows at the moment
 * somebody decides whether to trust the app with a camera, and §17's whole
 * posture is that the promises made to a stranger have to be the ones the code
 * keeps. It is also expensive to get wrong: `NSCameraUsageDescription` is
 * baked into the binary at build time, so noticing it after a build costs a
 * whole EAS cycle (docs/deploy.md, and the five builds §0 counts).
 *
 * So a guard, in the shape of `routes/__tests__/coachGate.test.ts`: a pinned
 * list of the files that open the camera, and for each one the word the
 * permission string must carry. A fifth camera surface fails this test until
 * somebody has looked at the sentence and said what it now has to say.
 *
 * It cannot tell a good sentence from a bad one — only a missing subject from
 * a present one. That is the same blunt instrument the tenancy guard is, and
 * it catches the same kind of mistake: the one that fails silently.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(import.meta.dirname, '..', '..', '..');

/**
 * Every file that opens the camera, and the word the athlete has to be able
 * to find in the dialog when it does. Add the file, add the word, and say the
 * new thing in `app.json` — in that order.
 */
const CAMERA_SURFACES: Record<string, string> = {
  'app/fridge.tsx': 'fridge',
  'src/components/BarcodeScanner.tsx': 'barcode',
  'src/components/MealCamera.tsx': 'food',
  'src/components/PhysiqueCamera.tsx': 'progress',
};

function tsxFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(path, base));
    else if (entry.name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** The files that actually mount a camera, as paths relative to `app/`. */
function openTheCamera(): string[] {
  return [...tsxFiles(join(APP, 'app')), ...tsxFiles(join(APP, 'src'))]
    .filter((path) => readFileSync(path, 'utf8').includes('CameraView'))
    .map((path) => path.slice(APP.length + 1))
    .sort();
}

const permission = (): string => {
  const config = JSON.parse(readFileSync(join(APP, 'app.json'), 'utf8')) as {
    expo: { plugins: (string | [string, Record<string, string>])[] };
  };
  const camera = config.expo.plugins.find(
    (plugin): plugin is [string, Record<string, string>] =>
      Array.isArray(plugin) && plugin[0] === 'expo-camera',
  );
  return camera?.[1].cameraPermission ?? '';
};

describe('the camera permission string', () => {
  it('knows about every screen that opens the camera', () => {
    expect(openTheCamera()).toEqual(Object.keys(CAMERA_SURFACES).sort());
  });

  it('says what each of them is for', () => {
    const sentence = permission().toLowerCase();
    const unsaid = Object.entries(CAMERA_SURFACES)
      .filter(([, word]) => !sentence.includes(word))
      .map(([file, word]) => `${file} needs "${word}"`);

    expect(unsaid).toEqual([]);
  });

  it('is a sentence, not a label', () => {
    // Apple rejects an empty or perfunctory purpose string, and a reader
    // deserves better than one word. The old one was 44 characters and wrong;
    // the bar is only that there is something here to read.
    expect(permission().length).toBeGreaterThan(40);
  });
});
