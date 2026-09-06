import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Commit, GitApi, RepoChange, RepoSnapshot, RepoStatus, StatusEntry } from '@shared/types';
import { App } from './App';
import { UiProvider } from './ui/UiContext';
import { DEFAULT_PREFS, setPrefs } from './prefs';

// GC-068: a load that finishes late must not overwrite a fresher snapshot. The race needs a slow
// git, so neither the scratch repository nor the e2e suite can stage it; here `loadRepo` and
// `getStatus` hand back promises this file resolves by hand, in whatever order the case needs.
//
// Like `Preferences.test.tsx` and `CommitGraph.test.tsx` this file does NOT use
// `vi.resetModules()`: React Testing Library is imported statically, so re-importing a renderer
// module would hand the component a second React instance and every hook in it would throw.

// Explicit imports rather than vitest globals is the house style, which means RTL's own
// auto-cleanup and act-environment hooks never register. Both are wired up by hand here.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // `CommitGraph`'s virtualisation effect observes `.graph-body`; jsdom has no ResizeObserver.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const REPO = '/repo';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Every `loadRepo` call, oldest first, waiting to be resolved. */
let loads: Deferred<RepoSnapshot>[] = [];
/** What each of those calls was given, so a case can assert what the first load excluded (GC-099). */
let loadArgs: { path: string; maxCommits?: number; exclude?: string[] }[] = [];
/** The same for `getStatus`, which is the `tree` half of the watcher. */
let statuses: Deferred<RepoStatus>[] = [];
/** The watcher subscription `App` registers, so a case can push a `repo:changed` by hand. */
let repoChanged: ((change: RepoChange) => void) | null = null;

const status = (entries: StatusEntry[]): RepoStatus => ({ branch: 'main', upstream: null, ahead: 0, behind: 0, entries, operation: null });

const snapshot = (entries: StatusEntry[]): RepoSnapshot => ({
  info: { path: REPO, name: 'repo', headSha: null, branch: 'main' },
  commits: [],
  refs: [],
  status: status(entries),
  stashes: [],
  remotes: [],
});

/** What the file looks like before the stage, and what it looks like after it. */
const UNSTAGED: StatusEntry[] = [{ path: 'a.txt', staged: null, unstaged: 'modified' }];
const STAGED: StatusEntry[] = [{ path: 'a.txt', staged: 'modified', unstaged: null }];

beforeEach(() => {
  loads = [];
  loadArgs = [];
  statuses = [];
  repoChanged = null;
  // Avatars are gated inside `useGravatar`, so switching them off keeps the render clear of
  // `crypto.subtle` and of any gravatar.com request.
  setPrefs({ avatars: false });
  localStorage.setItem('gitclient.lastRepo', REPO); // so the mount effect opens a repository
  const api = {
    checkGit: async () => ({ available: true, version: 'git version 2.45.0' }),
    loadRepo: (path: string, maxCommits?: number, exclude?: string[]) => {
      const d = defer<RepoSnapshot>();
      loads.push(d);
      loadArgs.push({ path, maxCommits, exclude });
      return d.promise;
    },
    getStatus: () => {
      const d = defer<RepoStatus>();
      statuses.push(d);
      return d.promise;
    },
    stageAll: async () => undefined,
    // The commit view lists a commit's files; every case here is about which commit is selected,
    // not about what it touched (GC-016).
    getCommitFiles: async () => [],
    watchRepo: async () => undefined,
    onRepoChanged: (listener: (change: RepoChange) => void) => {
      repoChanged = listener;
      return () => {
        repoChanged = null;
      };
    },
  };
  window.api = api as unknown as GitApi;
});

afterEach(() => {
  cleanup();
  setPrefs({ ...DEFAULT_PREFS });
  localStorage.clear();
});

/** Runs `fn` and lets every promise it touched settle, inside one `act`. */
const settle = async (fn: () => void = () => {}): Promise<void> => {
  await act(async () => {
    fn();
  });
};

/** The count in a `.group-head`, e.g. `Staged Files (1)`. */
const groupCount = (label: string): number => {
  const head = screen.getByText(new RegExp(`^${label} Files \\(\\d+\\)$`));
  return Number(/\((\d+)\)/.exec(head.textContent ?? '')?.[1]);
};

/** Mounts the app and settles the load its mount effect starts, leaving the file unstaged. */
async function mount(): Promise<void> {
  render(
    <UiProvider>
      <App />
    </UiProvider>,
  );
  await settle(() => loads[0]?.resolve(snapshot(UNSTAGED)));
  expect(repoChanged).not.toBeNull();
  expect(groupCount('Unstaged')).toBe(1);
}

describe('App drops a background reload that a user action has overtaken (GC-068)', () => {
  it('keeps the snapshot the Refresh loaded when the watcher load resolves after it', async () => {
    await mount();

    // Something moved a ref outside the app — a commit typed in a terminal — so the watcher starts
    // a full reload. On a large repository that takes about a second.
    await settle(() => repoChanged?.({ repo: REPO, scope: 'refs' }));
    expect(loads).toHaveLength(2);

    // The user acts during that second. Refresh is the cheapest action that reloads everything.
    await settle(() => fireEvent.click(screen.getByTitle('Refresh')));
    expect(loads).toHaveLength(3);

    // The action's own load comes back first and shows the file staged.
    await settle(() => loads[2]?.resolve(snapshot(STAGED)));
    expect(groupCount('Staged')).toBe(1);
    expect(groupCount('Unstaged')).toBe(0);

    // Then the watcher's load, captured before the click, finally answers. It is stale, so it is
    // dropped silently rather than putting the file back in the unstaged group.
    await settle(() => loads[1]?.resolve(snapshot(UNSTAGED)));
    expect(groupCount('Staged')).toBe(1);
    expect(groupCount('Unstaged')).toBe(0);
  });

  it('drops a late status read the same way', async () => {
    await mount();

    // A `tree` change reloads only the status, which is the other read that can finish late.
    await settle(() => repoChanged?.({ repo: REPO, scope: 'tree' }));
    expect(statuses).toHaveLength(1);

    await settle(() => fireEvent.click(screen.getByTitle('Refresh')));
    await settle(() => loads[1]?.resolve(snapshot(STAGED)));
    expect(groupCount('Staged')).toBe(1);

    await settle(() => statuses[0]?.resolve(status(UNSTAGED)));
    expect(groupCount('Staged')).toBe(1);
    expect(groupCount('Unstaged')).toBe(0);
  });
});

// GC-099: the hidden set has to reach the *first* `loadRepo` for a path. It used to be applied by
// an effect that only runs once a snapshot has landed, so every cold open was two full `git log`
// runs and painted the hidden branches before removing them. The counts below are the whole point:
// one load when the stored set still matches the refs, two only when one of them has gone.
const WIP_REF = 'refs/heads/wip-branch';
const withRefs = (entries: StatusEntry[], refs: string[]): RepoSnapshot => ({
  ...snapshot(entries),
  refs: refs.map((fullName) => ({ name: fullName.replace('refs/heads/', ''), fullName, kind: 'head' as const, sha: 'abc123', isHead: false })),
});

describe('App applies the stored hidden set to a path\'s first load (GC-099)', () => {
  it('excludes the hidden refs on the first call and does not reload afterwards', async () => {
    localStorage.setItem(`gitclient.hidden.${REPO}`, JSON.stringify([WIP_REF]));
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    // The set was read from the path about to be loaded, not from the snapshot that came back.
    expect(loadArgs[0]?.exclude).toEqual([WIP_REF]);

    await settle(() => loads[0]?.resolve(withRefs(UNSTAGED, [WIP_REF, 'refs/heads/main'])));
    // The ref still exists, so the set that was applied is the set that is wanted: no second load.
    expect(loads).toHaveLength(1);
  });

  it('costs the one extra load only when a hidden ref has since been deleted', async () => {
    localStorage.setItem(`gitclient.hidden.${REPO}`, JSON.stringify([WIP_REF]));
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    // The snapshot comes back without that ref: it was deleted outside the app.
    await settle(() => loads[0]?.resolve(withRefs(UNSTAGED, ['refs/heads/main'])));
    expect(loads).toHaveLength(2);
    expect(loadArgs[1]?.exclude).toEqual([]);
    // and the name that no longer names anything is pruned out of storage rather than kept.
    expect(localStorage.getItem(`gitclient.hidden.${REPO}`)).toBeNull();
  });

  it('opens a repository with nothing hidden in one load', async () => {
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    expect(loadArgs[0]?.exclude).toEqual([]);
    await settle(() => loads[0]?.resolve(withRefs(UNSTAGED, ['refs/heads/main'])));
    expect(loads).toHaveLength(1);
  });
});

// GC-084: the actions writing `busy` and `error` had no identity of their own, so of two that
// overlap, whichever finished first cleared the status bar while the other was still running.
describe('App keeps the status bar with the action that still owns it (GC-084)', () => {
  /** The label the status bar is showing, or null when it shows no operation at all. */
  const busyLabel = (): string | null => document.querySelector('.statusbar .busy')?.textContent?.replace(/…\s*$/, '').trim() ?? null;

  /** Refresh, then Stage all while it is still running: two `run()` calls in flight at once. */
  async function overlap(): Promise<void> {
    await mount();
    await settle(() => fireEvent.click(screen.getByTitle('Refresh')));
    expect(busyLabel()).toBe('Refreshing');
    expect(loads).toHaveLength(2);
    // The detail panel's buttons are gated on its own busy flag, not the toolbar's, so this one
    // is live while the refresh runs — which is exactly the overlap the bug needs.
    await settle(() => fireEvent.click(screen.getByText('Stage all changes')));
    expect(busyLabel()).toBe('Staging all');
    expect(statuses).toHaveLength(1);
  }

  it('leaves the spinner up until the later of two overlapping actions finishes', async () => {
    await overlap();

    // The refresh comes back first. It no longer owns the bar, so it must not clear it.
    await settle(() => loads[1]?.resolve(snapshot(UNSTAGED)));
    expect(busyLabel()).toBe('Staging all');

    // Only the action that still owns it does.
    await settle(() => statuses[0]?.resolve(status(STAGED)));
    expect(busyLabel()).toBeNull();
    expect(groupCount('Staged')).toBe(1);
  });

  it('leaves the bar with a repository open started after it (GC-108)', async () => {
    // The two "Loading repository" busies were written outside `run()` and took no token, so the
    // action that started first still believed it owned the bar and took the open's spinner down
    // with it — the same lie GC-084 fixed, from the other direction.
    const OTHER = '/other';
    (window.api as unknown as { openRepoDialog: () => Promise<string> }).openRepoDialog = async () => OTHER;

    await mount();
    await settle(() => fireEvent.click(screen.getByTitle('Refresh')));
    expect(busyLabel()).toBe('Refreshing');
    expect(loads).toHaveLength(2);

    await settle(() => fireEvent.click(screen.getByTitle('Open repository')));
    expect(busyLabel()).toBe('Loading repository');
    expect(loads).toHaveLength(3);
    expect(loadArgs[2]?.path).toBe(OTHER);

    // The refresh's reload lands while the open is still running. It no longer owns the bar.
    await settle(() => loads[1]?.resolve(snapshot(UNSTAGED)));
    expect(busyLabel()).toBe('Loading repository');

    // The open owns it, so the open clears it.
    await settle(() => loads[2]?.resolve(snapshot(UNSTAGED)));
    expect(busyLabel()).toBeNull();
  });

  it('does not raise the earlier action\'s error over the later one', async () => {
    await overlap();

    // The refresh fails while the staging is still running: its message describes a state the
    // bar is no longer reporting on, so it is dropped rather than shown.
    await settle(() => loads[1]?.reject(new Error('fatal: could not read the repository')));
    expect(document.querySelector('.statusbar .err')).toBeNull();
    expect(busyLabel()).toBe('Staging all');

    await settle(() => statuses[0]?.resolve(status(STAGED)));
    expect(busyLabel()).toBeNull();
    expect(document.querySelector('.statusbar .err')).toBeNull();
  });
});

// GC-016: two repositories are open at once and each tab keeps its own snapshot, selection and
// file view. What the acceptance asks for is that switching preserves them, so these cases assert
// against a second repository's tab rather than against the tab bar's markup alone. The scroll
// position, the other half of that acceptance, is not testable here — jsdom has no layout, so
// `scrollTop` reads back 0 whatever is assigned to it — and is verified in the running app.
const REPO2 = '/other-repo';

const commit = (sha: string, summary: string): Commit => ({
  sha,
  parents: [],
  authorName: 'Ricardo',
  authorEmail: 'r@example.com',
  authorDate: '2026-09-06T10:00:00+00:00',
  committerName: 'Ricardo',
  committerDate: '2026-09-06T10:00:00+00:00',
  summary,
  body: '',
  refs: [],
});

const withCommits = (path: string, summaries: string[]): RepoSnapshot => ({
  ...snapshot(UNSTAGED),
  info: { path, name: path.replace('/', ''), headSha: null, branch: 'main' },
  commits: summaries.map((s, i) => commit(`${path}-${i}`, s)),
});

/** The tab labels the title bar is drawing, in bar order. */
const tabLabels = (): string[] => [...document.querySelectorAll('.titlebar .tab')].map((t) => t.querySelector('span')?.textContent ?? '');
/** The label on the tab currently showing. */
const activeLabel = (): string | null => document.querySelector('.titlebar .tab.selected span')?.textContent ?? null;

describe('App keeps a tab per repository (GC-016)', () => {
  /** Opens REPO with two commits, selects the second of them, then opens REPO2 in a new tab. */
  async function twoTabs(): Promise<void> {
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve(withCommits(REPO, ['first commit', 'second commit'])));
    // Down from the working directory row selects the first commit; the detail panel is then the
    // commit view, which is what proves the selection came back after a switch.
    await settle(() => fireEvent.keyDown(window, { key: 'ArrowDown' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('first commit');

    (window.api as unknown as { openRepoDialog: () => Promise<string> }).openRepoDialog = async () => REPO2;
    await settle(() => fireEvent.click(screen.getByTitle('New tab')));
    await settle(() => loads[1]?.resolve(withCommits(REPO2, ['other repository'])));
  }

  it('opens a second repository beside the first rather than replacing it', async () => {
    await twoTabs();
    expect(tabLabels()).toEqual(['repo', 'other-repo']);
    expect(activeLabel()).toBe('other-repo');
    // The new tab starts on the working directory, not on the other repository's selection.
    expect(screen.queryByText('first commit')).toBeNull();
  });

  it('gives the tab back its own selection, with no reload needed to show it', async () => {
    await twoTabs();
    const before = loads.length;

    await settle(() => fireEvent.click(screen.getAllByTitle(REPO)[0]!));
    expect(activeLabel()).toBe('repo');
    // Restored in the same commit as the switch: the heading is already the first repository's
    // selected commit, and the reload below is only the refresh that follows it.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('first commit');

    // That refresh is asked for because the watcher only ever followed the tab that was showing,
    // so what this one kept may be minutes old.
    expect(loads).toHaveLength(before + 1);
    expect(loadArgs[before]?.path).toBe(REPO);
    await settle(() => loads[before]?.resolve(withCommits(REPO, ['first commit', 'second commit'])));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('first commit');
  });

  it('cycles the tabs with Ctrl+Tab', async () => {
    await twoTabs();
    await settle(() => fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true }));
    expect(activeLabel()).toBe('repo');
    await settle(() => fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true }));
    expect(activeLabel()).toBe('other-repo');
    await settle(() => fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true }));
    expect(activeLabel()).toBe('repo');
  });

  it('closes a tab onto its neighbour, and the last one onto the empty state', async () => {
    await twoTabs();
    // The showing tab is the second one, so closing it falls back to the tab on its left.
    await settle(() => fireEvent.click(document.querySelectorAll('.titlebar .tab.selected .tab-close')[0]!));
    expect(tabLabels()).toEqual(['repo']);
    expect(activeLabel()).toBe('repo');

    await settle(() => fireEvent.click(document.querySelector('.titlebar .tab-close')!));
    expect(tabLabels()).toEqual(['New Tab']);
    expect(document.querySelector('.graph-empty')).not.toBeNull();
  });

  it('takes the user to the tab a repository is already open in rather than duplicating it', async () => {
    await twoTabs();
    (window.api as unknown as { openRepoDialog: () => Promise<string> }).openRepoDialog = async () => REPO;
    const before = loads.length;
    await settle(() => fireEvent.click(screen.getByTitle('New tab')));
    expect(tabLabels()).toEqual(['repo', 'other-repo']);
    expect(activeLabel()).toBe('repo');
    // The switch restored what that tab was parked with, so the only load is its background refresh.
    expect(loads).toHaveLength(before + 1);
  });

  it('remembers the open tabs and which one was showing', async () => {
    await twoTabs();
    expect(JSON.parse(localStorage.getItem('gitclient.tabs') ?? '[]')).toEqual([REPO, REPO2]);
    expect(localStorage.getItem('gitclient.lastRepo')).toBe(REPO2);
    await settle(() => fireEvent.click(screen.getAllByTitle(REPO)[0]!));
    expect(localStorage.getItem('gitclient.lastRepo')).toBe(REPO);
  });
});

describe('App keeps a tab pointing at its own repository while it loads (GC-016)', () => {
  it('does not let a tab shown before its first load take the previous tab\'s path', async () => {
    // The tab bar and `repoPath` move at different moments: the tab is showing as soon as it is
    // clicked, while `repoPath` is still the repository that was showing until git answers. The
    // effect that adopts git's canonical path has to tell those two apart, or the new tab is
    // relabelled with the old repository — and keeps that label if its own load then fails.
    localStorage.setItem('gitclient.tabs', JSON.stringify([REPO, REPO2]));
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve(withCommits(REPO, ['first commit'])));
    expect(tabLabels()).toEqual(['repo', 'other-repo']);

    await settle(() => fireEvent.click(screen.getAllByTitle(REPO2)[0]!));
    // Its load is still in flight, and the bar already says which repository it is for.
    expect(activeLabel()).toBe('other-repo');
    expect(tabLabels()).toEqual(['repo', 'other-repo']);

    // Even when that load never succeeds, the tab keeps naming the repository it stands for.
    await settle(() => loads[1]?.reject(new Error('fatal: not a git repository')));
    expect(tabLabels()).toEqual(['repo', 'other-repo']);
    expect(JSON.parse(localStorage.getItem('gitclient.tabs') ?? '[]')).toEqual([REPO, REPO2]);
  });
});

describe('App parks the commit message with the tab it was written in (GC-148)', () => {
  const summaryField = (): HTMLInputElement => screen.getByPlaceholderText('Commit summary') as HTMLInputElement;
  const bodyField = (): HTMLTextAreaElement => screen.getByPlaceholderText('Description') as HTMLTextAreaElement;

  /** Both repositories open, a half-written message in the first, showing the second. */
  async function draftThenSwitch(): Promise<void> {
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve(withCommits(REPO, ['first commit'])));
    // The working-directory row is what a repository opens on, so the staging form is on screen.
    await settle(() => fireEvent.change(summaryField(), { target: { value: 'half a message' } }));
    await settle(() => fireEvent.change(bodyField(), { target: { value: 'and its body' } }));

    (window.api as unknown as { openRepoDialog: () => Promise<string> }).openRepoDialog = async () => REPO2;
    await settle(() => fireEvent.click(screen.getByTitle('New tab')));
    await settle(() => loads[1]?.resolve(withCommits(REPO2, ['other repository'])));
  }

  it('gives the draft back when the tab returns, and never shows it over another repository', async () => {
    await draftThenSwitch();
    // GC-016's promise, which the panel's key used to keep on its own: the other repository's
    // staging view is empty, not carrying a message written for the first one.
    expect(summaryField().value).toBe('');
    expect(bodyField().value).toBe('');

    const before = loads.length;
    await settle(() => fireEvent.click(screen.getAllByTitle(REPO)[0]!));
    // Back in the same commit as the switch, before the refresh that follows it lands.
    expect(summaryField().value).toBe('half a message');
    expect(bodyField().value).toBe('and its body');
    await settle(() => loads[before]?.resolve(withCommits(REPO, ['first commit'])));
    expect(summaryField().value).toBe('half a message');
  });

  it('clears the draft when a repository is opened into the showing tab', async () => {
    await draftThenSwitch();
    await settle(() => fireEvent.click(screen.getAllByTitle(REPO)[0]!));
    expect(summaryField().value).toBe('half a message');
    // Not a tab switch: the same tab is pointed at another repository, so the message written for
    // the one being left must not sit over the new one's staged files.
    (window.api as unknown as { openRepoDialog: () => Promise<string> }).openRepoDialog = async () => '/third-repo';
    await settle(() => fireEvent.click(screen.getByTitle('Open repository')));
    await settle(() => loads[loads.length - 1]?.resolve(withCommits('/third-repo', ['third'])));
    expect(summaryField().value).toBe('');
  });
});
