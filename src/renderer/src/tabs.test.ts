import { describe, expect, it } from 'vitest';
import { CLOSED_MAX, cycle, makeTabs, neighbourOf, popClosed, pushClosed, readTabs, storedPaths, survivorOf, type Tab } from './tabs';

/** A tab that has not been given a repository yet, as `+` makes one (GC-163). */
const empty = (id: number): Tab => ({ id, path: null });

describe('readTabs tolerates whatever is on the key (GC-016)', () => {
  it('reads back a list of paths', () => {
    expect(readTabs(JSON.stringify(['/a', '/b']))).toEqual(['/a', '/b']);
  });

  it('answers empty for a missing, malformed or wrongly shaped blob', () => {
    expect(readTabs(null)).toEqual([]);
    expect(readTabs('not json')).toEqual([]);
    expect(readTabs('"/a"')).toEqual([]);
    expect(readTabs('{"a":1}')).toEqual([]);
  });

  it('drops the entries that are not usable paths rather than the whole list', () => {
    expect(readTabs(JSON.stringify(['/a', '', 3, null, '/b']))).toEqual(['/a', '/b']);
  });
});

describe('storedPaths is what gitclient.tabs holds (GC-163)', () => {
  it('keeps the real repositories in bar order', () => {
    expect(storedPaths(makeTabs(['/a', '/b']))).toEqual(['/a', '/b']);
  });

  it('drops a tab that has not been given one, so a restart comes back without it', () => {
    const tabs = [...makeTabs(['/a', '/b']), empty(3)];
    expect(storedPaths(tabs)).toEqual(['/a', '/b']);
  });

  it('answers empty for a bar holding nothing but an empty tab', () => {
    expect(storedPaths([empty(1)])).toEqual([]);
  });

  it('round-trips through readTabs, which never produced a null in the first place', () => {
    expect(readTabs(JSON.stringify(storedPaths([...makeTabs(['/a']), empty(2)])))).toEqual(['/a']);
  });
});

describe('neighbourOf picks the tab left showing when one is closed (GC-016)', () => {
  const tabs = makeTabs(['/a', '/b', '/c']);

  it('takes the tab to the right', () => {
    expect(neighbourOf(tabs, tabs[0]!.id)?.path).toBe('/b');
    expect(neighbourOf(tabs, tabs[1]!.id)?.path).toBe('/c');
  });

  it('falls back to the left when the closed tab was the last one', () => {
    expect(neighbourOf(tabs, tabs[2]!.id)?.path).toBe('/b');
  });

  it('answers none when the closed tab was the only one, which is the empty state', () => {
    const one = makeTabs(['/a']);
    expect(neighbourOf(one, one[0]!.id)).toBeNull();
  });

  it('answers none for an id the bar does not hold', () => {
    expect(neighbourOf(tabs, 99)).toBeNull();
  });

  // A tab holding no repository closes like any other: it is a real tab in the bar (GC-163).
  it('falls to the neighbour of a closed empty tab, and can land on one', () => {
    const mixed: Tab[] = [{ id: 1, path: '/a' }, empty(2), { id: 3, path: '/c' }];
    expect(neighbourOf(mixed, 2)?.path).toBe('/c');
    expect(neighbourOf(mixed, 1)?.path).toBeNull();
  });
});

describe('cycle is what Ctrl+Tab moves to (GC-016)', () => {
  const tabs = makeTabs(['/a', '/b', '/c']);
  const at = (i: number): number => tabs[i]!.id;

  it('walks forwards and wraps at the end', () => {
    expect(cycle(tabs, at(0), 1)).toBe(at(1));
    expect(cycle(tabs, at(2), 1)).toBe(at(0));
  });

  it('walks backwards and wraps at the start', () => {
    expect(cycle(tabs, at(1), -1)).toBe(at(0));
    expect(cycle(tabs, at(0), -1)).toBe(at(2));
  });

  it('stays put with a single tab, so the binding is a no-op rather than a flicker', () => {
    const one = makeTabs(['/a']);
    expect(cycle(one, one[0]!.id, 1)).toBe(one[0]!.id);
    expect(cycle(one, one[0]!.id, -1)).toBe(one[0]!.id);
  });

  it('answers nothing at all with no tabs open', () => {
    expect(cycle([], null, 1)).toBeNull();
  });

  it('starts at the first tab when nothing is showing, whichever way it was asked', () => {
    expect(cycle(tabs, null, 1)).toBe(at(0));
    expect(cycle(tabs, 99, -1)).toBe(at(0));
  });

  // Ctrl+Tab walks the bar, and a tab with no repository in it is part of the bar (GC-163).
  it('cycles through an empty tab like any other', () => {
    const mixed: Tab[] = [{ id: 1, path: '/a' }, empty(2)];
    expect(cycle(mixed, 1, 1)).toBe(2);
    expect(cycle(mixed, 2, 1)).toBe(1);
  });
});

// Closing several tabs at once is one close path, so "Close other tabs" and "Close tabs to the
// right" cannot disagree with a single close about what is left showing (GC-151).
describe('survivorOf', () => {
  const tabs = makeTabs(['/a', '/b', '/c', '/d']);
  const at = (i: number): number => tabs[i]!.id;

  it('is neighbourOf when one tab closes', () => {
    for (const t of tabs) expect(survivorOf(tabs, new Set([t.id]), t.id)).toBe(neighbourOf(tabs, t.id));
  });

  it('skips the tabs that are closing too, to the right first', () => {
    // "Close tabs to the right" from /b, with /b showing: /c and /d go, /b stays showing itself —
    // it is not in the set. From /a with /a, /b, /c closing, /d is what is left.
    expect(survivorOf(tabs, new Set([at(0), at(1), at(2)]), at(0))).toBe(tabs[3]);
  });

  it('falls to the left when everything to the right is closing', () => {
    expect(survivorOf(tabs, new Set([at(2), at(3)]), at(2))).toBe(tabs[1]);
  });

  it('answers nothing when the whole bar closes, which is the empty state', () => {
    expect(survivorOf(tabs, new Set(tabs.map((t) => t.id)), at(1))).toBeNull();
  });

  it('answers nothing for an id the bar does not hold', () => {
    expect(survivorOf(tabs, new Set([99]), 99)).toBeNull();
  });
});

// The reopen stack (GC-151): session-only, newest first, and the one thing standing between a
// middle-click and a repository the user has to go and find again.
describe('pushClosed and popClosed', () => {
  it('puts the newest closed repository at the front', () => {
    let stack = pushClosed([], '/a');
    stack = pushClosed(stack, '/b');
    expect(stack).toEqual(['/b', '/a']);
    expect(popClosed(stack)).toEqual({ path: '/b', rest: ['/a'] });
  });

  it('remembers nothing for a tab that held no repository', () => {
    // `+` makes one of these and there is nothing to put back, so it must not consume a reopen.
    expect(pushClosed(['/a'], null)).toEqual(['/a']);
  });

  it('moves a repository closed twice to the front rather than keeping two entries', () => {
    // Otherwise reopening the same repository twice costs two presses and opens it once.
    expect(pushClosed(['/b', '/a'], '/a')).toEqual(['/a', '/b']);
  });

  it('answers a null path on an empty stack, so the action is simply a no-op', () => {
    expect(popClosed([])).toEqual({ path: null, rest: [] });
  });

  it('caps the stack, since it is a session convenience and not a history', () => {
    let stack: string[] = [];
    for (let i = 0; i < CLOSED_MAX + 5; i++) stack = pushClosed(stack, `/r${i}`);
    expect(stack).toHaveLength(CLOSED_MAX);
    expect(stack[0]).toBe(`/r${CLOSED_MAX + 4}`);
  });

  it('never mutates the stack it was given', () => {
    const before = ['/a'];
    pushClosed(before, '/b');
    popClosed(before);
    expect(before).toEqual(['/a']);
  });
});
