import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Preferences } from './Preferences';
import { DEFAULT_PREFS, getPrefs, setPrefs } from '../prefs';

// The first component test, and the proof that the jsdom project works (GC-046). Unlike
// `prefs.test.ts` this file does NOT use `vi.resetModules()`: React Testing Library is imported
// statically, so re-importing `prefs.ts` would also hand `Preferences.tsx` a second React
// instance and every hook in it would throw. jsdom gives a real `localStorage` instead, so the
// module-level `load()` runs once against empty storage and lands on the defaults; `afterEach`
// puts them back so nothing leaks into the next test.

// Explicit imports rather than vitest globals is the house style, which means RTL's own
// auto-cleanup and act-environment hooks never register (they only run when `afterEach` and
// `beforeAll` are global). Both are wired up by hand here.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
  setPrefs({ ...DEFAULT_PREFS });
  localStorage.clear();
});

/** The checkbox of the `.pref-row` whose label reads `label`; the input itself has no name. */
const toggleFor = (label: string): HTMLInputElement => {
  const row = screen.getByText(label).closest('.pref-row');
  const input = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input) throw new Error(`no checkbox in the "${label}" row`);
  return input;
};

describe('Preferences', () => {
  it('writes the avatars toggle straight through to the preferences', () => {
    render(<Preferences onClose={() => {}} drawnCols={null} />);

    const avatars = toggleFor('Author avatars');
    expect(getPrefs().avatars).toBe(true);
    expect(avatars.checked).toBe(true);

    fireEvent.click(avatars);

    // The store took the change, and the controlled input reflects it back.
    expect(getPrefs().avatars).toBe(false);
    expect(toggleFor('Author avatars').checked).toBe(false);

    // The row is its own setting: nothing else moved.
    expect(getPrefs().commitColumnGuide).toBe(DEFAULT_PREFS.commitColumnGuide);
    expect(getPrefs().confirmDirtyCheckout).toBe(DEFAULT_PREFS.confirmDirtyCheckout);
    expect(getPrefs().pullMode).toBe(DEFAULT_PREFS.pullMode);
  });

  it("marks a column the window cannot draw, and leaves one that is simply switched off alone", () => {
    // On in the preference, dropped by fitOptCols: the row used to stay checked with nothing
    // anywhere saying the window was the reason (GC-117). The marker comes from the graph’s own
    // answer, so this test hands it the shape the graph reports rather than a width.
    setPrefs({ graphColumns: { author: true, date: true, sha: false } });
    render(<Preferences onClose={() => {}} drawnCols={{ author: true, date: false, sha: false }} />);

    const noteIn = (label: string): string | null => screen.getByText(label).closest(".pref-row")?.querySelector(".pref-note")?.textContent ?? null;
    expect(noteIn("Date / time column")).toMatch(/too narrow/);
    expect(noteIn("Author column")).toBeNull(); // on and drawn
    expect(noteIn("SHA column")).toBeNull(); // off, which is the user’s own doing
  });

  it("claims nothing while no graph is on screen to have an answer", () => {
    setPrefs({ graphColumns: { author: true, date: true, sha: true } });
    render(<Preferences onClose={() => {}} drawnCols={null} />);

    expect(document.querySelectorAll(".pref-note").length).toBe(0);
  });
});
