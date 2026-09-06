import { beforeEach, describe, expect, it, vi } from 'vitest';

// `prefs.ts` reads localStorage once, at import time (`let current = load()`), and keeps the
// preferences in module-level state. So every case seeds a fresh storage stub first and then
// re-imports the module through `freshPrefs()`.
//
// `usePrefs` is the only door to the subscriber list, and it goes through React's
// `useSyncExternalStore`. Stubbing that one function hands us the `subscribe` callback without
// needing a renderer (the vitest config has no jsdom and no React plugin on purpose).

const react = vi.hoisted(() => ({ subscribe: null as null | ((fn: () => void) => () => void) }));

vi.mock('react', () => ({
  useSyncExternalStore: <T>(
    subscribe: (fn: () => void) => () => void,
    getSnapshot: () => T,
  ): T => {
    react.subscribe = subscribe;
    return getSnapshot();
  },
}));

const KEY = 'gitclient.prefs';
const LEGACY_KEY = 'gitclient.pullMode';

const makeStorage = (seed: Record<string, string> = {}): Storage => {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length(): number {
      return map.size;
    },
    clear: (): void => map.clear(),
    getItem: (k: string): string | null => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number): string | null => [...map.keys()][i] ?? null,
    removeItem: (k: string): void => void map.delete(k),
    setItem: (k: string, v: string): void => void map.set(k, v),
  };
};

/** Seed localStorage, drop the cached module and import it again so `load()` re-runs. */
async function freshPrefs(seed: Record<string, string> = {}): Promise<typeof import('./prefs')> {
  globalThis.localStorage = makeStorage(seed);
  vi.resetModules();
  return import('./prefs');
}

const stored = (): Record<string, unknown> =>
  JSON.parse(globalThis.localStorage.getItem(KEY) ?? 'null') as Record<string, unknown>;

beforeEach(() => {
  react.subscribe = null;
});

describe('load', () => {
  it('falls back to the defaults when nothing is stored', async () => {
    const { getPrefs, DEFAULT_PREFS } = await freshPrefs();
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
    // A copy, not the exported constant: mutating the live prefs must not edit the defaults.
    expect(getPrefs()).not.toBe(DEFAULT_PREFS);
  });

  it('round-trips a stored blob', async () => {
    const blob = {
      avatars: false,
      pullMode: 'rebase',
      confirmDirtyCheckout: false,
      commitColumnGuide: false,
      graphColumns: { author: true, date: true, sha: false },
      theme: 'light',
    };
    const { getPrefs } = await freshPrefs({ [KEY]: JSON.stringify(blob) });
    expect(getPrefs()).toEqual(blob);
  });

  it('falls back per field, keeping the fields that are valid', async () => {
    const blob = { avatars: 'yes', pullMode: 'rebase', commitColumnGuide: 0, nonsense: 42 };
    const { getPrefs, DEFAULT_PREFS } = await freshPrefs({ [KEY]: JSON.stringify(blob) });
    expect(getPrefs()).toEqual({
      avatars: DEFAULT_PREFS.avatars,
      pullMode: 'rebase',
      confirmDirtyCheckout: DEFAULT_PREFS.confirmDirtyCheckout,
      commitColumnGuide: DEFAULT_PREFS.commitColumnGuide,
      graphColumns: DEFAULT_PREFS.graphColumns,
      theme: DEFAULT_PREFS.theme,
    });
  });

  // The theme is the one setting the main process is told about as well, so a blob carrying a
  // value that is not one of the three has to land on the default rather than reach the bridge.
  it('keeps a valid theme and falls back on anything else (GC-013)', async () => {
    for (const theme of ['dark', 'light', 'system']) {
      const { getPrefs } = await freshPrefs({ [KEY]: JSON.stringify({ theme }) });
      expect(getPrefs().theme).toBe(theme);
    }
    for (const theme of ['neon', '', 42, null]) {
      const { getPrefs, DEFAULT_PREFS } = await freshPrefs({ [KEY]: JSON.stringify({ theme }) });
      expect(getPrefs().theme).toBe(DEFAULT_PREFS.theme);
    }
  });

  it('defaults the graph columns to off and falls back per column', async () => {
    const fresh = await freshPrefs();
    expect(fresh.getPrefs().graphColumns).toEqual({ author: false, date: false, sha: false });

    // A half-written object keeps the columns it does carry; a value of the wrong shape is ignored
    // wholesale and every column falls back.
    const half = await freshPrefs({ [KEY]: JSON.stringify({ graphColumns: { date: true, sha: 'yes' } }) });
    expect(half.getPrefs().graphColumns).toEqual({ author: false, date: true, sha: false });

    const wrong = await freshPrefs({ [KEY]: JSON.stringify({ graphColumns: 'all' }) });
    expect(wrong.getPrefs().graphColumns).toEqual(wrong.DEFAULT_PREFS.graphColumns);
    // A copy, so a patch cannot edit the exported defaults.
    expect(wrong.getPrefs().graphColumns).not.toBe(wrong.DEFAULT_PREFS.graphColumns);
  });

  it('falls back to the defaults when the blob is malformed JSON', async () => {
    const { getPrefs, DEFAULT_PREFS } = await freshPrefs({ [KEY]: '{"avatars": fal' });
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('migrates the legacy pull-mode key, writes the blob and removes the old key', async () => {
    const { getPrefs, DEFAULT_PREFS } = await freshPrefs({ [LEGACY_KEY]: 'rebase' });
    expect(getPrefs()).toEqual({ ...DEFAULT_PREFS, pullMode: 'rebase' });
    expect(stored()).toEqual({ ...DEFAULT_PREFS, pullMode: 'rebase' });
    expect(globalThis.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('ignores the legacy key when a blob already exists', async () => {
    const blob = { avatars: true, pullMode: 'ff', confirmDirtyCheckout: true, commitColumnGuide: true };
    const { getPrefs } = await freshPrefs({ [KEY]: JSON.stringify(blob), [LEGACY_KEY]: 'rebase' });
    expect(getPrefs().pullMode).toBe('ff');
    expect(stored()).toEqual(blob);
    // The blob wins, so the migration branch never runs and the stale key is left alone.
    expect(globalThis.localStorage.getItem(LEGACY_KEY)).toBe('rebase');
  });
});

describe('setPrefs', () => {
  it('merges the patch, persists it and notifies subscribers', async () => {
    const { getPrefs, setPrefs, usePrefs, DEFAULT_PREFS } = await freshPrefs();

    usePrefs();
    expect(react.subscribe).not.toBeNull();
    const seen: boolean[] = [];
    const unsubscribe = react.subscribe!(() => seen.push(getPrefs().avatars));

    setPrefs({ avatars: false });
    expect(getPrefs()).toEqual({ ...DEFAULT_PREFS, avatars: false });
    expect(stored()).toEqual({ ...DEFAULT_PREFS, avatars: false });
    expect(seen).toEqual([false]);

    // A second patch must keep the first one: a merge, not a replace.
    setPrefs({ pullMode: 'rebase' });
    expect(getPrefs()).toEqual({ ...DEFAULT_PREFS, avatars: false, pullMode: 'rebase' });
    expect(seen).toEqual([false, false]);

    unsubscribe();
    setPrefs({ avatars: true });
    expect(seen).toEqual([false, false]);
  });
});
