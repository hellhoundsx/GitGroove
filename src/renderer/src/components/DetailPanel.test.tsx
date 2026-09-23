import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DetailPanel, pruneStagingGroups, readStagingGroups } from './DetailPanel';
import { UiProvider } from '../ui/UiContext';
import { WIP } from '../graph/CommitGraph';
import { DEFAULT_PREFS, setPrefs } from '../prefs';
import type { Commit, CommitFile, RepoStatus, Stash, StatusEntry } from '@shared/types';
import type { MenuItem } from '../ui/ContextMenu';

// The commit view's working-directory banner (GC-045). The e2e suite drives the dirty case
// end to end; what it cannot reach is the clean one — the fixture always has changes waiting, and
// `App` closes a file view as soon as its path leaves the status list, so there is no moment in a
// run where a commit is selected over an empty working tree.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
  setPrefs({ ...DEFAULT_PREFS });
  localStorage.clear();
});

/** The one call `CommitView` makes. */
const stubApi = (files: CommitFile[] = []): void => {
  (window as unknown as { api: Record<string, unknown> }).api = {
    getCommitFiles: () => Promise.resolve(files),

  };
};

const COMMIT: Commit = {
  sha: 'b4220d4b4220d4b4220d4b4220d4b4220d4b4220',
  parents: [],
  refs: [],
  summary: 'A commit to read',
  body: '',
  authorName: 'Test User',
  authorEmail: 'test@example.com',
  authorDate: '2026-09-01T10:00:00Z',
  committerName: 'Test User',
  committerDate: '2026-09-01T10:00:00Z',
};

const entry = (path: string): StatusEntry => ({ path, staged: null, unstaged: 'modified' });
const statusWith = (...paths: string[]): RepoStatus => ({
  branch: 'main',
  upstream: null,
  ahead: 0,
  behind: 0,
  operation: null,
  entries: paths.map(entry),
});

const noop = (): void => undefined;

function renderPanel(status: RepoStatus, onSelectSha: (sha: string) => void = noop, files: CommitFile[] = []): void {
  stubApi(files);
  setPrefs({ avatars: false }); // no gravatar and no crypto.subtle in the render
  render(
    <UiProvider>
      <DetailPanel
        repo="C:/repo"
        commit={COMMIT}
        stash={null}
        headCommit={COMMIT}
        status={status}
        openFile={null}
        refs={[]}
        compare={false}
        onExitCompare={noop}
        onRefMenu={noop}
        onRefActivate={noop}
        actions={
          {
            stage: noop,
            unstage: noop,
            discard: noop,
            stageAll: noop,
            unstageAll: noop,
            commit: noop,
            abort: noop,
            ignore: noop,
          } as never
        }
        resize={{} as never}
        focusSummary={0}
        draft={{ summary: '', body: '', amend: false }}
        onDraft={noop}
        onSelectSha={onSelectSha}
        onOpenFile={noop}
        onFileMenu={noop}
        stashActions={() => []}
      />
    </UiProvider>,
  );
}

/** The same panel with no commit and no stash selected, which is the staging view (GC-197). */
function renderStaging(status: RepoStatus): void {
  stubApi([]);
  setPrefs({ avatars: false });
  render(
    <UiProvider>
      <DetailPanel
        repo="C:/repo"
        commit={null}
        stash={null}
        headCommit={COMMIT}
        status={status}
        openFile={null}
        refs={[]}
        compare={false}
        onExitCompare={noop}
        onRefMenu={noop}
        onRefActivate={noop}
        actions={{ stage: noop, unstage: noop, discard: noop, stageAll: noop, unstageAll: noop, commit: noop, abort: noop, ignore: noop } as never}
        resize={{} as never}
        focusSummary={0}
        draft={{ summary: '', body: '', amend: false }}
        onDraft={noop}
        onSelectSha={noop}
        onOpenFile={noop}
        onFileMenu={noop}
        stashActions={() => []}
      />
    </UiProvider>,
  );
}

describe('the commit view banner', () => {
  it('counts what is waiting in the working directory and gets back to it', () => {
    let selected: string | null = null;
    renderPanel(statusWith('a.txt', 'b.txt'), (sha) => (selected = sha));

    expect(screen.getByText('2 file changes in the working directory')).toBeTruthy();
    fireEvent.click(screen.getByText('View changes'));
    expect(selected).toBe(WIP);
  });

  it('says "file change" for one, so the banner never reads as a count of zero-or-many', () => {
    renderPanel(statusWith('a.txt'));
    expect(screen.getByText('1 file change in the working directory')).toBeTruthy();
  });

  it('shows nothing at all when the tree is clean', () => {
    renderPanel(statusWith());
    expect(document.querySelector('.banner')).toBeNull();
  });
});

describe("the commit view's change readout (GC-143)", () => {
  const files: CommitFile[] = [
    { path: 'a.txt', kind: 'added' },
    { path: 'b.txt', kind: 'modified' },
    { path: 'c.txt', kind: 'deleted' },
    { path: 'd.txt', kind: 'renamed', origPath: 'was.txt' },
  ];

  it('draws each count with the mark the file rows draw, not a text glyph', async () => {
    renderPanel(statusWith(), noop, files);
    const readout = await screen.findByText(/1 added/).then((el) => el.closest('.readout')!);
    // The four states the readout can report, each an icon and a number. Before this they were the
    // characters `+`, `✎`, `−` and `→` — a second, unrelated rendering of the three states the
    // rows below draw with the icon set, which is the half of GC-143 that weight alone could not fix.
    expect(readout.querySelectorAll('svg.kind')).toHaveLength(4);
    expect(readout.textContent).not.toMatch(/[✎−→]/);
    // Same mark for the same kind in both places: the class is what carries the colour token and
    // the kind, and it is `FileKindIcon` that puts it on either surface.
    for (const kind of ['added', 'modified', 'deleted', 'renamed']) {
      expect(readout.querySelector(`svg.kind-${kind}`)).toBeTruthy();
    }
  });

  it('draws the modified pencil filled and the rest heavier than the app default', async () => {
    renderPanel(statusWith(), noop, files);
    const readout = await screen.findByText(/1 added/).then((el) => el.closest('.readout')!);
    const pencil = readout.querySelector('svg.kind-modified')!;
    // The pencil's meaning is its silhouette, so it is painted rather than outlined; `fill` is on
    // the Tabler glyph itself, which is what keeps @tabler/icons-react the only icon source (rule 1).
    expect(pencil.getAttribute('fill')).toBe('currentColor');
    const plus = readout.querySelector('svg.kind-added')!;
    expect(plus.getAttribute('fill')).toBe('none');
    // 1.75 at 12px is the hairline this ticket measured.
    expect(Number(plus.getAttribute('stroke-width'))).toBeGreaterThan(1.75);
  });
});

// GC-197: the two lists the study calls collapsible. With 29 unstaged files the Staged head — the
// group you are staging into — sat below 788px of the group you are staging from.
describe('the staging view’s collapsible groups (GC-197)', () => {
  const headFor = (title: string): HTMLElement => {
    const el = screen.getByText(title).closest('.group-head');
    if (!(el instanceof HTMLElement)) throw new Error(`no head for ${title}`);
    return el;
  };
  const rowsOf = (title: string): number => headFor(title).parentElement?.querySelectorAll('.file-row').length ?? -1;

  it('starts every group with entries open, and closes one to its head on a click', () => {
    renderStaging(statusWith('a.txt', 'b.txt'));
    expect(rowsOf('Unstaged Files')).toBe(2);

    fireEvent.click(headFor('Unstaged Files').querySelector('.group-toggle') as HTMLElement);

    // Head only, and the list stops asking for a share of the column so the group under it rises.
    expect(rowsOf('Unstaged Files')).toBe(0);
    expect(headFor('Unstaged Files').parentElement?.className).toContain('closed');
    // The count is its own element beside the title, and a closed group still says how many (GC-196).
    expect(headFor('Unstaged Files').querySelector('.count')?.textContent).toBe('2');
    // The action button is unaffected by the state.
    expect(headFor('Unstaged Files').querySelector('button.btn')).toBeTruthy();
  });

  it('remembers only what was toggled, so an untouched group is open whatever is stored', () => {
    renderStaging(statusWith('a.txt'));
    fireEvent.click(headFor('Unstaged Files').querySelector('.group-toggle') as HTMLElement);

    expect(readStagingGroups()).toEqual({ unstaged: false });
    cleanup();

    // A remount is the file view and the tab switch this panel is unmounted by (GC-148): the
    // arrangement comes back because it was never component state.
    renderStaging(statusWith('a.txt'));
    expect(rowsOf('Unstaged Files')).toBe(0);
    expect(rowsOf('Staged Files')).toBe(0); // untouched, open, and empty
    expect(headFor('Staged Files').parentElement?.className).not.toContain('closed');
  });

  it('drops the state of a group that has emptied, so it is open when it fills again', () => {
    expect(pruneStagingGroups({ unstaged: false, staged: false }, { conflicted: 0, unstaged: 0, staged: 3 })).toEqual({ staged: false });

    renderStaging(statusWith('a.txt'));
    fireEvent.click(headFor('Unstaged Files').querySelector('.group-toggle') as HTMLElement);
    expect(readStagingGroups()).toEqual({ unstaged: false });
    cleanup();

    // The same panel over an empty tree: the close is forgotten rather than left to hide rows
    // later, since a closed empty group and an open empty one look identical.
    renderStaging(statusWith());
    expect(readStagingGroups()).toEqual({});
    cleanup();

    renderStaging(statusWith('a.txt', 'b.txt'));
    expect(rowsOf('Unstaged Files')).toBe(2);
  });

  it('reads a hand-edited blob as absent rather than as closed', () => {
    localStorage.setItem('gitclient.stagingGroups', 'not json at all');
    expect(readStagingGroups()).toEqual({});
    localStorage.setItem('gitclient.stagingGroups', JSON.stringify({ nonsense: true, unstaged: 'no' }));
    expect(readStagingGroups()).toEqual({});
  });
});

// GC-178: the stash view was the one thing this panel can show that offered nothing to do with it.
describe('the stash view’s actions (GC-178)', () => {
  const STASH: Stash = {
    index: 0,
    sha: 'f00df00df00df00df00df00df00df00df00df00d',
    message: 'On main: half a thought',
    parent: COMMIT.sha,
    date: '2026-09-01T09:00:00Z',
  };

  function renderStash(items: MenuItem[]): void {
    stubApi([]);
    setPrefs({ avatars: false });
    render(
      <UiProvider>
        <DetailPanel
          repo="C:/repo"
          commit={null}
          stash={STASH}
          headCommit={COMMIT}
          status={statusWith()}
          openFile={null}
          refs={[]}
          compare={false}
          onExitCompare={noop}
          onRefMenu={noop}
          onRefActivate={noop}
          actions={{ stage: noop, unstage: noop, discard: noop, stageAll: noop, unstageAll: noop, commit: noop, abort: noop, ignore: noop } as never}
          resize={{} as never}
          focusSummary={0}
          draft={{ summary: '', body: '', amend: false }}
          onDraft={noop}
          onSelectSha={noop}
          onOpenFile={noop}
          onFileMenu={noop}
          stashActions={() => items}
        />
      </UiProvider>,
    );
  }

  /** The shape `App`'s `stashMenuItems` actually returns, `short` and separator included. */
  const menu = (fired: string[]): MenuItem[] => [
    { label: 'Apply stash', short: 'Apply', onClick: () => fired.push('apply') },
    { label: 'Pop stash', short: 'Pop', hint: 'apply and drop', onClick: () => fired.push('pop') },
    { label: 'Edit message…', short: 'Message…', onClick: () => fired.push('edit') },
    { separator: true },
    { label: 'Drop stash', short: 'Drop', danger: true, onClick: () => fired.push('drop') },
  ];

  it('draws the menu’s four actions, in its order, and none of its furniture', () => {
    renderStash(menu([]));
    const labels = [...document.querySelectorAll('.stash-actions .btn')].map((b) => b.textContent);
    // `short`, not `label`: this head already says which stash these act on, and the four long
    // labels came to 390px against 376px of room, which wrapped them onto two ragged lines
    // (GC-213). The menu itself still says "Apply stash".
    expect(labels).toEqual(['Apply', 'Pop', 'Message…', 'Drop']);
    // The separator is not a button, and the destructive row keeps the class that says so.
    expect(document.querySelectorAll('.stash-actions .btn.danger')).toHaveLength(1);
    expect(document.querySelector('.stash-actions .btn.danger')?.textContent).toBe('Drop');
  });

  // `short` is an addition to `MenuItem`, so every item that has not been given one has to keep
  // drawing exactly what it always did — the field is an override, not a requirement.
  it('falls back to the label for an item with no short form', () => {
    renderStash([{ label: 'Apply stash', onClick: noop }, { label: 'Pop stash', short: 'Pop', onClick: noop }]);
    const labels = [...document.querySelectorAll('.stash-actions .btn')].map((b) => b.textContent);
    expect(labels).toEqual(['Apply stash', 'Pop']);
  });

  // The long label is what the button promises on hover, so the short form costs no meaning:
  // whichever of the two is drawn, the other is one pointer away.
  it('keeps the full label reachable as the button’s title', () => {
    renderStash(menu([]));
    const apply = [...document.querySelectorAll('.stash-actions .btn')].find((b) => b.textContent === 'Apply');
    expect(apply?.getAttribute('title')).toBe('Apply stash');
    // An item with a hint keeps the hint, which was already the title and says more than the label.
    const pop = [...document.querySelectorAll('.stash-actions .btn')].find((b) => b.textContent === 'Pop');
    expect(pop?.getAttribute('title')).toBe('apply and drop');
  });

  it('runs the menu’s own handler, which is what makes the two surfaces ask the same question', () => {
    const fired: string[] = [];
    renderStash(menu(fired));
    fireEvent.click(screen.getByText('Drop'));
    // Not a second implementation of Drop: it is `stashMenuItems`' `onClick`, confirmation and all.
    expect(fired).toEqual(['drop']);
  });
});
