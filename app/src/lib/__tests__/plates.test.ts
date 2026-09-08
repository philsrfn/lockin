import { describe, expect, it } from 'vitest';
import { DEFAULT_BAR_KG, describeLoading, loadBar } from '../plates';

describe('loading a bar', () => {
  it('loads the obvious one', () => {
    // 100 kg: bar plus 40 a side, which is two twenties.
    expect(loadBar(100)).toMatchObject({
      perSide: [25, 15],
      achievedKg: 100,
      shortByKg: 0,
    });
  });

  it('reaches an awkward number exactly when the plates allow it', () => {
    // 82.5 is the one people round away from. 31.25 a side: 25, 5, 1.25.
    expect(loadBar(82.5)).toMatchObject({
      perSide: [25, 5, 1.25],
      achievedKg: 82.5,
      shortByKg: 0,
    });
  });

  it('does not lose the smallest plate to floating point', () => {
    // 8.75 / 1.25 lands on 6.999999999999999 in binary. The symptom of getting
    // this wrong is a bar that is quietly 2.5 kg light.
    const loading = loadBar(37.5);

    expect(loading?.achievedKg).toBe(37.5);
    expect(loading?.perSide).toEqual([5, 2.5, 1.25]);
  });

  it('says how far short it falls rather than pretending', () => {
    // 83 cannot be built from 1.25s. Answering 82.5 silently would leave
    // somebody believing they lifted three kilos more than they did.
    const loading = loadBar(83);

    expect(loading?.achievedKg).toBe(82.5);
    expect(loading?.shortByKg).toBe(0.5);
  });

  it('is the empty bar at exactly the bar', () => {
    expect(loadBar(20)).toMatchObject({ perSide: [], achievedKg: 20, shortByKg: 0 });
  });

  it('has nothing to say below the bar', () => {
    // A dumbbell movement, or a bar somebody has mis-specified. Either way
    // there is no loading, and inventing one would be worse than none.
    expect(loadBar(15)).toBeNull();
    expect(loadBar(0)).toBeNull();
    expect(loadBar(Number.NaN)).toBeNull();
  });

  it('takes a lighter bar', () => {
    expect(loadBar(50, 15)).toMatchObject({ barKg: 15, perSide: [15, 2.5], achievedKg: 50 });
  });

  it('works with the plates a place actually has', () => {
    // A hotel gym with nothing under 5 kg. 82.5 is then not reachable, and
    // saying so beats prescribing a weight that cannot be loaded.
    const loading = loadBar(82.5, DEFAULT_BAR_KG, [20, 10, 5]);

    expect(loading?.achievedKg).toBe(80);
    expect(loading?.shortByKg).toBe(2.5);
  });

  it('counts a heavy bar up correctly', () => {
    const loading = loadBar(200);

    expect(loading?.achievedKg).toBe(200);
    // 90 a side: three 25s, a 15. Not four 20s and a 10 — largest first.
    expect(loading?.perSide).toEqual([25, 25, 25, 15]);
  });
});

describe('describing a loading', () => {
  it('counts repeats rather than listing them', () => {
    expect(describeLoading([25, 25, 10, 2.5])).toBe('2 × 25, 10, 2.5');
  });

  it('says nothing about an empty bar', () => {
    expect(describeLoading([])).toBe('');
  });
});
