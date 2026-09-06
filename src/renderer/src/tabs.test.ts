import { describe, expect, it } from 'vitest';
import { cycle, makeTabs, neighbourOf, readTabs } from './tabs';

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
});
