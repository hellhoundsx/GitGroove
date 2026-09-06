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

/**
 * What git answers with for an unmerged path (GC-180): `diff --cc`, an `@@@` header and one prefix
 * column per parent. It is drawn as one column of code whatever the layout preference says, which
 * is the state GC-188 is about.
 */
const COMBINED_DIFF = [
  'diff --cc f.txt',
  'index 90eb71e,6a9aab3..0000000',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@@ -1,3 -1,3 +1,7 @@@',
  '  alpha',
  '++<<<<<<< HEAD',
  ' +OURS',
  '++=======',
  '+ THEIRS',
  '++>>>>>>> other',
  '  gamma',
  '',
].join('\n');

/** Only the two calls `DiffView` makes; `prefs.ts` reaches for `setTheme` on every write. */
const stubApi = (diff = DIFF): void => {
  (window as unknown as { api: Record<string, unknown> }).api = {
    getWorkdirFileDiff: () => Promise.resolve(diff),
    getCommitFileDiff: () => Promise.resolve(diff),
    setTheme: () => Promise.resolve(),
  };
};

const noop = (): Promise<void> => Promise.resolve();

/** Render the unstaged side of `f.txt` and let the diff promise resolve. */
const open = async (diff = DIFF): Promise<void> => {
  stubApi(diff);
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
    // `pickable` is GC-121's "this line can be clicked", not a tint, so it is dropped here: what
    // this test is about is that each cell carries the kind of its own side.
    const cells = (row: number): string[] =>
      [...document.querySelectorAll('.hunk-lines.split tr.line')[row]!.querySelectorAll('td')].map((td) =>
        td.className.split(' ').filter((c) => c !== 'pickable').join(' '),
      );
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

describe('DiffView line selection (GC-121)', () => {
  /** Render the unstaged side and keep every patch a hunk button hands to `onApplyPatch`. */
  const openCapturing = async (): Promise<string[]> => {
    stubApi();
    const patches: string[] = [];
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
          onApplyPatch={(patch) => {
            patches.push(patch);
            return Promise.resolve();
          }}
        />
      </UiProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    return patches;
  };

  const stageLabel = (): string => document.querySelector('.hunk-actions .btn')!.textContent ?? '';
  const stage = async (): Promise<void> => {
    fireEvent.click(document.querySelector('.hunk-actions .btn')!);
    await act(async () => {
      await Promise.resolve();
    });
  };
  /** The unified table's rows, in file order: 0 alpha, 1 -beta, 2 +BETA, 3 +GAMMA, 4 delta. */
  const uniRow = (i: number): HTMLElement => [...document.querySelectorAll<HTMLElement>('.hunk-lines:not(.split) tr.line')][i]!;
  /** The right-hand code cell of a split row, which is the new file's side. */
  const splitCell = (row: number, side: 'left' | 'right'): HTMLElement =>
    [...document.querySelectorAll('.hunk-lines.split tr.line')[row]!.querySelectorAll<HTMLElement>('td')][side === 'left' ? 2 : 5]!;

  it('names the count while lines are picked and goes back to the hunk when they are dropped', async () => {
    await openCapturing();
    expect(stageLabel()).toBe('Stage hunk');

    fireEvent.click(uniRow(2)); // +BETA
    expect(stageLabel()).toBe('Stage 1 line');
    expect(uniRow(2).className).toContain('sel');

    fireEvent.click(uniRow(3)); // +GAMMA as well
    expect(stageLabel()).toBe('Stage 2 lines');

    fireEvent.click(uniRow(3)); // clicking a picked line drops it
    expect(stageLabel()).toBe('Stage 1 line');
    fireEvent.click(uniRow(2));
    // Nothing picked is not an empty selection: it is the whole-hunk button again.
    expect(stageLabel()).toBe('Stage hunk');
    expect(uniRow(2).className).not.toContain('sel');
  });

  it('extends a run with shift, over the changed lines only', async () => {
    await openCapturing();
    fireEvent.click(uniRow(1)); // -beta
    fireEvent.click(uniRow(3), { shiftKey: true }); // through +GAMMA
    expect(stageLabel()).toBe('Stage 3 lines');
    // The context lines either end are not part of it and cannot be.
    expect(uniRow(0).className).not.toContain('sel');
    expect(uniRow(4).className).not.toContain('sel');
  });

  it('stages only the picked line, leaving the rest of the hunk out of the patch', async () => {
    const patches = await openCapturing();
    fireEvent.click(uniRow(2)); // +BETA only
    await stage();
    expect(patches).toHaveLength(1);
    const body = patches[0]!.split('\n').slice(3, -1);
    // `beta` was not picked, so it stays as context rather than being removed, and `GAMMA` is gone:
    // applying this leaves alpha, beta, BETA, delta, which is the four lines the new count states.
    expect(body).toEqual(['@@ -1,3 +1,4 @@', ' alpha', ' beta', '+BETA', ' delta']);
  });

  it('builds a byte-identical patch from the same selection in either layout', async () => {
    const unified = await openCapturing();
    fireEvent.click(uniRow(1)); // -beta
    fireEvent.click(uniRow(2)); // +BETA
    await stage();
    cleanup();

    setPrefs({ diffView: 'split' });
    const split = await openCapturing();
    fireEvent.click(splitCell(1, 'left')); // the same -beta
    fireEvent.click(splitCell(1, 'right')); // the same +BETA
    expect(stageLabel()).toBe('Stage 2 lines');
    await stage();

    expect(split[0]).toBe(unified[0]);
  });

  it('offers no line picking on the staged side, where a partial unstage is not built yet', async () => {
    stubApi();
    render(
      <UiProvider>
        <DiffView
          repo="/repo"
          view={{ source: 'wip', path: 'f.txt', staged: true, kind: 'modified' }}
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
    expect(document.querySelectorAll('.hunk-lines .pickable')).toHaveLength(0);
    fireEvent.click(uniRow(2));
    expect(stageLabel()).toBe('Unstage hunk');
  });
});

// GC-188: a combined diff is drawn unified by construction, so the switch above it has to say
// Unified — a control showing a setting that is not what is on screen is the disagreement GC-117
// fixed for the graph's optional columns, one component over.
describe('DiffView, the layout switch on a combined diff (GC-188)', () => {
  it('shows Unified pressed and Split disabled with the reason, with Split remembered', async () => {
    setPrefs({ diffView: 'split' });
    await open(COMBINED_DIFF);

    // one column of code, whatever the preference asks for (GC-180)
    expect(document.querySelector('.hunk-lines.split')).toBeNull();
    expect(seg('Unified').className).toContain('on');
    expect(seg('Unified').getAttribute('aria-pressed')).toBe('true');
    expect(seg('Split').className).not.toContain('on');
    expect(seg('Split').getAttribute('aria-pressed')).toBe('false');
    expect((seg('Split') as HTMLButtonElement).disabled).toBe(true);
    expect(seg('Split').title).toContain('conflicted file');
    // the preference is untouched, so the next ordinary file opens in the layout the user chose
    expect(getPrefs().diffView).toBe('split');
  });

  it('comes back to split on the next ordinary file, from that untouched preference', async () => {
    setPrefs({ diffView: 'split' });
    await open(COMBINED_DIFF);
    expect(seg('Unified').className).toContain('on');

    cleanup();
    await open();

    expect(document.querySelector('.hunk-lines.split')).not.toBeNull();
    expect(seg('Split').className).toContain('on');
    expect((seg('Split') as HTMLButtonElement).disabled).toBe(false);
  });
});
