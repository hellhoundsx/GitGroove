// The open repository tabs (GC-016). What a tab is, how the remembered list is read back, and the
// two questions the bar asks that are worth answering in one place rather than inside a click
// handler: which tab is left showing when one is closed, and which one Ctrl+Tab moves to.
//
// The list is remembered *state*, not a preference, so it lives on its own `localStorage` key
// beside `gitclient.lastRepo` rather than in the `gitclient.prefs` blob: there is no Preferences
// row for it and nothing in it is a setting.

/** One tab in the title bar: a repository, and an identity that outlives its path. */
export interface Tab {
  /**
   * Stable for the life of the tab. The parked state of a tab that is not showing is keyed by it
   * rather than by the path, because the path changes under it the moment git answers with its
   * canonical form — a dialog hands back `c:\repo` and `rev-parse` calls it `C:/repo`.
   */
  id: number;
  /**
   * Null for a tab that has not been given a repository yet: `+` makes one of these and the empty
   * state is its content, which is where a repository is picked (GC-163). It is not remembered —
   * `storedPaths` drops it — because a tab holding nothing has nothing worth coming back to.
   */
  path: string | null;
}

/** The paths of the open tabs, in bar order, newest last. */
export const TABS_KEY = 'gitclient.tabs';

/** The stored list, tolerant of a hand-edited blob the way every other remembered key is. */
export function readTabs(raw: string | null): string[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string' && p.length > 0);
  } catch {
    return [];
  }
}

/** Number the paths, in order, from 1. Ids are handed out afresh on every start. */
export function makeTabs(paths: string[]): Tab[] {
  return paths.map((path, i) => ({ id: i + 1, path }));
}

/**
 * What goes on `gitclient.tabs`: the real repositories, in bar order. A tab still waiting to be
 * given one contributes nothing, so the key stays an array of paths and a restart comes back with
 * only the repositories that were actually open (GC-163).
 */
export function storedPaths(tabs: Tab[]): string[] {
  return tabs.map((t) => t.path).filter((p): p is string => p !== null);
}

/**
 * Which tab is showing after `id` is closed: the one to its right, then the one to its left, then
 * none at all — the empty state, which is what the app shows before a repository is ever opened.
 * Answered here so it is a test rather than a comment.
 */
export function neighbourOf(tabs: Tab[], id: number): Tab | null {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return null;
  return tabs[i + 1] ?? tabs[i - 1] ?? null;
}

/** The tab Ctrl+Tab (`dir` 1) or Ctrl+Shift+Tab (`dir` -1) moves to, wrapping at either end. */
export function cycle(tabs: Tab[], activeId: number | null, dir: 1 | -1): number | null {
  if (tabs.length === 0) return null;
  const i = tabs.findIndex((t) => t.id === activeId);
  // With nothing showing — or an id the bar no longer holds — the first tab is where cycling
  // starts, whichever direction was asked for.
  if (i < 0) return tabs[0]!.id;
  return tabs[(i + dir + tabs.length) % tabs.length]!.id;
}
