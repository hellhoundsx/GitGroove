import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiffView } from './DiffView';
import { UiProvider } from '../ui/UiContext';
import { DEFAULT_PREFS, getPrefs, setPrefs } from '../prefs';

// The split view's markup (GC-014). The e2e suite proves that staging a hunk from the split view
// reaches git; what it cannot see cheaply is the shape of a row — which side each cell belongs to,
// and that a padded side renders no `pre` at all — so that is what this file pins.

// Explicit imports rather than vitest globals is the house style, so RTL's own cleanup and
// act-environment hooks never register; both are wired up by hand, as the other component tests do.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
  setPrefs({ ...DEFAULT_PREFS });
  localStorage.clear();
});

const DIFF = [
  'diff --git a/f.txt b/f.txt',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,3 +1,4 @@',
  ' alpha',
  '-beta',
  '+BETA',
  '+GAMMA',
  ' delta',
  '',
].join('\n');

/** Only the two calls `DiffView` makes; `prefs.ts` reaches for `setTheme` on every write. */
const stubApi = (): void => {
  (window as unknown as { api: Record<string, unknown> }).api = {
    getWorkdirFileDiff: () => Promise.resolve(DIFF),
    getCommitFileDiff: () => Promise.resolve(DIFF),
    setTheme: () => Promise.resolve(),
  };
};

const noop = (): Promise<void> => Promise.resolve();

/** Render the unstaged side of `f.txt` and let the diff promise resolve. */
const open = async (): Promise<void> => {
  stubApi();
  render(
    <UiProvider>
      <DiffView
        repo="/repo"
        view={{ source: 'wip', path: 'f.txt', staged: false, kind: 'modified' }}
        version={0}
        onClose={noop}
        onStageFile={noop}
        onUnstageFile={noop}
        onDiscardFile={noop}
        onApplyPatch={noop}
      />
    </UiProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
};

/** Every row of the split table as [old number, old text, new number, new text]. */
const splitRows = (): (string | null)[][] =>
  [...document.querySelectorAll('.hunk-lines.split tr.line')].map((tr) => {
    const td = [...tr.querySelectorAll('td')];
    return [td[0]!.textContent, td[2]!.querySelector('pre')?.textContent ?? null, td[3]!.textContent, td[5]!.querySelector('pre')?.textContent ?? null];
  });

const seg = (label: string): HTMLElement => screen.getByRole('button', { name: label });

describe('DiffView (GC-014)', () => {
  it('opens in the unified layout and flips to split from the header', async () => {
    await open();
    expect(document.querySelector('.hunk-lines.split')).toBeNull();
    expect(document.querySelectorAll('.hunk-lines tr.line')).toHaveLength(5);
    expect(seg('Unified').className).toContain('on');

    fireEvent.click(seg('Split'));

    expect(document.querySelector('.hunk-lines.split')).not.toBeNull();
    expect(seg('Split').className).toContain('on');
    expect(seg('Unified').className).not.toContain('on');
    // Remembered, so the next file view opens the way this one was left.
    expect(getPrefs().diffView).toBe('split');
  });

  it('pairs the two sides and pads the row the old file has no line for', async () => {
    setPrefs({ diffView: 'split' });
    await open();
    expect(splitRows()).toEqual([
      ['1', 'alpha', '1', 'alpha'],
      ['2', 'beta', '2', 'BETA'],
      ['', null, '3', 'GAMMA'],
      ['3', 'delta', '4', 'delta'],
    ]);
  });

  it('tints each cell by its own side, because a row is one line of each file', async () => {
    setPrefs({ diffView: 'split' });
    await open();
    const cells = (row: number): string[] => [...document.querySelectorAll('.hunk-lines.split tr.line')[row]!.querySelectorAll('td')].map((td) => td.className);
    expect(cells(1)).toEqual(['no del', 'mark del', 'code del', 'no add', 'mark add', 'code add']);
    expect(cells(2)).toEqual(['no pad', 'mark pad', 'code pad', 'no add', 'mark add', 'code add']);
    expect(cells(3)).toEqual(['no context', 'mark context', 'code context', 'no context', 'mark context', 'code context']);
  });

  it('keeps the hunk buttons live in the split layout: they act on the hunk, not on the rows', async () => {
    await open();
    const actions = (): string[] => [...document.querySelectorAll('.hunk-actions .btn')].map((b) => b.textContent ?? '');
    const enabled = (): boolean[] => [...document.querySelectorAll<HTMLButtonElement>('.hunk-actions .btn')].map((b) => !b.disabled);
    expect(actions()).toEqual(['Stage hunk', 'Discard hunk']);
    expect(enabled()).toEqual([true, true]);

    fireEvent.click(seg('Split'));

    // The layout is a render of what is already loaded: no reload, so nothing is disabled and the
    // same two buttons are still there.
    expect(actions()).toEqual(['Stage hunk', 'Discard hunk']);
    expect(enabled()).toEqual([true, true]);
    expect(document.querySelector('.diff-body')?.className).not.toContain('stale');
  });
});

// GC-083: when the load rejects there is no text, so none of the body's other branches match and
// the panel used to be blank — the only sign of what happened was the small red line above it.
describe('DiffView says why the body is empty when the load fails (GC-083)', () => {
  const ERROR = "fatal: ambiguous argument 'gone.txt': unknown revision or path not in the working tree";

  /** The same render as `open()`, with the one call `DiffView` makes rejecting. */
  const openFailing = async (): Promise<void> => {
    (window as unknown as { api: Record<string, unknown> }).api = {
      getWorkdirFileDiff: () => Promise.reject(new Error(ERROR)),
      getCommitFileDiff: () => Promise.reject(new Error(ERROR)),
      setTheme: () => Promise.resolve(),
    };
    render(
      <UiProvider>
        <DiffView
          repo="/repo"
          view={{ source: 'wip', path: 'gone.txt', staged: false, kind: 'modified' }}
          version={0}
          onClose={noop}
          onStageFile={noop}
          onUnstageFile={noop}
          onDiscardFile={noop}
          onApplyPatch={noop}
        />
      </UiProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('puts git\'s message in the body rather than leaving it empty', async () => {
    await openFailing();
    const body = document.querySelector('.diff-body');
    expect(body?.textContent).toContain(ERROR);
    expect(body?.textContent?.trim().length).toBeGreaterThan(0);
    // It is the same shape as the other three empty states, not a fourth kind of thing.
    expect(document.querySelectorAll('.diff-body .diff-empty')).toHaveLength(1);
    // The line above the body still reports it too: that was the only sign before, and it stays.
    expect(document.querySelector('.file-view-sub .err')?.textContent).toContain(ERROR);
    // And nothing claims to be loading any more.
    expect(body?.textContent).not.toContain('Loading diff');
  });

  it('adds nothing to the body of a diff that loads', async () => {
    await open();
    expect(document.querySelectorAll('.diff-body .diff-empty')).toHaveLength(0);
    expect(document.querySelectorAll('.diff-body .hunk')).toHaveLength(1);
  });
});
