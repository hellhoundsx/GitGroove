import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Commit, GitApi, GitRef, RepoChange, RepoSnapshot, RepoStatus, StatusEntry } from '@shared/types';
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
/** Every branch `checkout` reached git with, so a case can tell a silent checkout from a guarded one (GC-124). */
let checkouts: string[] = [];

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
  checkouts = [];
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
    checkout: async (_path: string, name: string) => {
      checkouts.push(name);
    },
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
  // The count is its own `.count` element beside the title now (GC-196), so the head is found by
  // its title and the number read off the element that holds it.
  const head = screen.getByText(`${label} Files`).closest('.group-head');
  return Number(head?.querySelector('.count')?.textContent);
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
/**
 * One row of the open recents menu, by folder name. Picked out of `.ctx-item` rather than by text,
 * because the same folder name is on the tab in the bar behind the menu.
 */
const recentRow = (name: string): HTMLElement => {
  const row = [...document.querySelectorAll('.ctx-item')].find((r) => r.querySelector('.ctx-label')?.textContent === name);
  if (!row) throw new Error(`no recents row for ${name}`);
  return row as HTMLElement;
};
/**
 * The recents menu, opened from one of its two triggers: the title bar's chevron and the
 * repository breadcrumb both open the same list and both mean "take me to that repository", so
 * GC-164 changed them together and both are worth driving.
 */
const openRecents = (from: 'titlebar' | 'toolbar'): HTMLElement =>
  document.querySelector(`.${from === 'titlebar' ? 'titlebar' : 'toolbar'} [title="Recent repositories"]`) as HTMLElement;
/** The same list as it is drawn on the recents page itself, by folder name. */
const recentPageRow = (name: string): HTMLElement => {
  const row = [...document.querySelectorAll('.recent-row')].find((r) => r.querySelector('.recent-name')?.textContent === name);
  if (!row) throw new Error(`no recents page row for ${name}`);
  return row as HTMLElement;
};

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

    // `+` makes a tab holding no repository (GC-163); its page is where the second repository is
    // chosen, and "Open repository…" there fills that tab rather than making another.
    (window.api as unknown as { openRepoDialog: () => Promise<string> }).openRepoDialog = async () => REPO2;
    await settle(() => fireEvent.click(screen.getByTitle('New tab')));
    await settle(() => fireEvent.click(screen.getByText('Open repository…')));
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
    // The bar draws nothing at all now: the inert "New Tab" placeholder that used to stand here
    // was not a tab and is gone (GC-163). The empty state still fills the window.
    expect(tabLabels()).toEqual([]);
    expect(document.querySelector('.graph-empty')).not.toBeNull();
  });

  it('takes the user to the tab a repository is already open in rather than duplicating it', async () => {
    await twoTabs();
    const before = loads.length;
    // The showing tab is REPO2, so REPO's recents row is live; picking it goes to the tab it is
    // already open in rather than making a second copy of it (GC-164).
    await settle(() => fireEvent.click(openRecents('titlebar')));
    await settle(() => fireEvent.click(recentRow('repo')));
    expect(tabLabels()).toEqual(['repo', 'other-repo']);
    expect(activeLabel()).toBe('repo');
    // The switch restored what that tab was parked with, so the only load is its background refresh.
    expect(loads).toHaveLength(before + 1);
  });

  // GC-163: `+` no longer means "open a repository, but in a new tab". It makes a tab that holds
  // nothing, whose content is the page the empty state already drew.
  describe('`+` makes a tab with no repository in it (GC-163)', () => {
    /** One repository open, then `+`. `openRepoDialog` throws so a stray call is a failure, not a hang. */
    async function plus(): Promise<void> {
      render(
        <UiProvider>
          <App />
        </UiProvider>,
      );
      await settle(() => loads[0]?.resolve(withCommits(REPO, ['first commit'])));
      (window.api as unknown as { openRepoDialog: () => Promise<string> }).openRepoDialog = () => {
        throw new Error('+ must not open a folder dialog (GC-163)');
      };
      await settle(() => fireEvent.click(screen.getByTitle('New tab')));
    }

    it('appends a real tab, selects it and shows the recents page, with no dialog and no load', async () => {
      await plus();
      expect(tabLabels()).toEqual(['repo', 'New Tab']);
      expect(activeLabel()).toBe('New Tab');
      expect(document.querySelector('.graph-empty')).not.toBeNull();
      // Nothing to load: an empty tab costs no git call at all.
      expect(loads).toHaveLength(1);
    });

    it('does not remember it: gitclient.tabs stays the real repositories', async () => {
      await plus();
      expect(JSON.parse(localStorage.getItem('gitclient.tabs') ?? '[]')).toEqual([REPO]);
    });

    it('closes onto its neighbour like any other tab', async () => {
      await plus();
      await settle(() => fireEvent.click(document.querySelector('.titlebar .tab.selected .tab-close')!));
      expect(tabLabels()).toEqual(['repo']);
      expect(activeLabel()).toBe('repo');
    });

    it('gives the tab that was showing its selection back when it returns', async () => {
      render(
        <UiProvider>
          <App />
        </UiProvider>,
      );
      await settle(() => loads[0]?.resolve(withCommits(REPO, ['first commit', 'second commit'])));
      await settle(() => fireEvent.keyDown(window, { key: 'ArrowDown' }));
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('first commit');
      await settle(() => fireEvent.click(screen.getByTitle('New tab')));
      const before = loads.length;
      await settle(() => fireEvent.click(screen.getAllByTitle(REPO)[0]!));
      // Parked and put back in one commit, exactly as a switch between two repositories is.
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('first commit');
      expect(loads).toHaveLength(before + 1);
    });

    it('is what Ctrl+T does, so the ? overlay documents it', async () => {
      render(
        <UiProvider>
          <App />
        </UiProvider>,
      );
      await settle(() => loads[0]?.resolve(withCommits(REPO, ['first commit'])));
      await settle(() => fireEvent.keyDown(window, { key: 't', ctrlKey: true }));
      expect(tabLabels()).toEqual(['repo', 'New Tab']);
    });

    it('closes itself when its recents row hands the user to a tab already holding that repository', async () => {
      await plus();
      // The list on that page is the repository history; picking from it is what the tab is for.
      await settle(() => fireEvent.click(document.querySelector('.recent-row')!));
      expect(loadArgs[loadArgs.length - 1]?.path).toBe(REPO);
      // REPO is already in the bar, so the user is taken to its tab (GC-016) — and the empty tab
      // they asked from goes, because it was made for a repository it never got (GC-173).
      expect(tabLabels()).toEqual(['repo']);
      expect(activeLabel()).toBe('repo');
    });

    it('stays in the bar when the user leaves it by clicking another tab', async () => {
      await plus();
      // Not a hand-over: the user chose a tab, they did not ask this one for a repository, so the
      // empty tab is still theirs (GC-173).
      await settle(() => fireEvent.click(screen.getAllByTitle(REPO)[0]!));
      expect(tabLabels()).toEqual(['repo', 'New Tab']);
      expect(activeLabel()).toBe('repo');
    });

    it('takes a repository it does not already hold into itself, not into a third tab', async () => {
      localStorage.setItem('gitclient.recentRepos', JSON.stringify([REPO2, REPO]));
      await plus();
      await settle(() => fireEvent.click(recentPageRow('other-repo')));
      await settle(() => loads[loads.length - 1]?.resolve(withCommits(REPO2, ['other repository'])));
      // The tab the user was standing in is the one that was filled: still two tabs (GC-163).
      expect(tabLabels()).toEqual(['repo', 'other-repo']);
      expect(activeLabel()).toBe('other-repo');
      expect(JSON.parse(localStorage.getItem('gitclient.tabs') ?? '[]')).toEqual([REPO, REPO2]);
    });
  });

  // GC-164: a recents row used to call `openPath`, which rewrote the showing tab's path — the
  // repository the user was on was not moved aside, it was gone, with its parked state dropped.
  describe('a recents row opens a tab beside the one showing (GC-164)', () => {
    /** One repository open, a second one in the recents list, and the menu up. */
    async function menuWithBoth(): Promise<void> {
      localStorage.setItem('gitclient.recentRepos', JSON.stringify([REPO2, REPO]));
      render(
        <UiProvider>
          <App />
        </UiProvider>,
      );
      await settle(() => loads[0]?.resolve(withCommits(REPO, ['first commit', 'second commit'])));
      await settle(() => fireEvent.keyDown(window, { key: 'ArrowDown' }));
      await settle(() => fireEvent.click(openRecents('titlebar')));
    }

    it('leaves two tabs, the new one showing and the old one still in the bar', async () => {
      await menuWithBoth();
      await settle(() => fireEvent.click(recentRow('other-repo')));
      await settle(() => loads[loads.length - 1]?.resolve(withCommits(REPO2, ['other repository'])));
      expect(tabLabels()).toEqual(['repo', 'other-repo']);
      expect(activeLabel()).toBe('other-repo');
      expect(JSON.parse(localStorage.getItem('gitclient.tabs') ?? '[]')).toEqual([REPO, REPO2]);
    });

    it('never dropped what the old tab had parked, from the breadcrumb\'s copy of the list', async () => {
      await menuWithBoth();
      // The breadcrumb's menu is the same `openRepoMenu`, opened from the other trigger.
      await settle(() => fireEvent.keyDown(window, { key: 'Escape' }));
      await settle(() => fireEvent.click(openRecents('toolbar')));
      await settle(() => fireEvent.click(recentRow('other-repo')));
      await settle(() => loads[loads.length - 1]?.resolve(withCommits(REPO2, ['other repository'])));
      const before = loads.length;
      await settle(() => fireEvent.click(screen.getAllByTitle(REPO)[0]!));
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('first commit');
      expect(loads).toHaveLength(before + 1);
    });

    it('is true of the empty state\'s copy of the list, which opens exactly one tab', async () => {
      localStorage.removeItem('gitclient.lastRepo');
      localStorage.setItem('gitclient.recentRepos', JSON.stringify([REPO2, REPO]));
      render(
        <UiProvider>
          <App />
        </UiProvider>,
      );
      // Nothing open at all: the bar is empty and the window is the recents page.
      expect(tabLabels()).toEqual([]);
      await settle(() => fireEvent.click(recentPageRow('other-repo')));
      await settle(() => loads[loads.length - 1]?.resolve(withCommits(REPO2, ['other repository'])));
      expect(tabLabels()).toEqual(['other-repo']);
    });
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

    // `+` makes a tab holding no repository (GC-163); its page is where the second repository is
    // chosen, and "Open repository…" there fills that tab rather than making another.
    (window.api as unknown as { openRepoDialog: () => Promise<string> }).openRepoDialog = async () => REPO2;
    await settle(() => fireEvent.click(screen.getByTitle('New tab')));
    await settle(() => fireEvent.click(screen.getByText('Open repository…')));
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

// GC-215: a checkout is attempted, not asked about. git carries uncommitted changes onto the
// branch being checked out wherever it can — which is what someone double-clicking a branch is
// asking for — so GC-004's dialog stood in front of the case that works, offering "Check out
// anyway", which is precisely what git was about to do. The guard now sits on git's own refusal,
// which is the one moment there is something to decide, and what it offers is the way through
// rather than "anyway": stash, check out, put the changes back on top.
//
// These cases still open the branch menu over a tree that goes dirty behind it, because that is
// also GC-124's shape — the rows a `ContextMenu` is opened with are captured, so their handlers
// are closures from that render. The rule GC-124 fixed (read the tree from `statusRef`, never
// from the closure) is untouched; it lives in `runSequencer`, which is the guard that still counts.
describe('a checkout carries the working tree across, and asks only when git refuses (GC-215)', () => {
  const REFS = [
    { name: 'main', fullName: 'refs/heads/main', kind: 'head' as const, sha: 'a'.repeat(40), isHead: true },
    { name: 'feature', fullName: 'refs/heads/feature', kind: 'head' as const, sha: 'b'.repeat(40), isHead: false },
  ];
  const withRefs = (entries: StatusEntry[]): RepoSnapshot => ({ ...snapshot(entries), refs: REFS });

  /** Opens the branch menu over a clean tree, then dirties the tree behind it via the watcher. */
  async function menuThenDirty(): Promise<void> {
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve(withRefs([])));
    await settle(() => fireEvent.click(screen.getByTitle('Switch branch')));
    // The rows are captured, so `checkoutRef` in them is this render's closure.
    await settle(() => repoChanged?.({ repo: REPO, scope: 'tree' }));
    await settle(() => statuses[0]?.resolve(status(UNSTAGED)));
    expect(groupCount('Unstaged')).toBe(1);
  }

  it('checks a dirty tree out without asking, because git carries the changes across', async () => {
    await menuThenDirty();
    await settle(() => fireEvent.click(recentRow('feature')));
    await settle(() => loads[1]?.resolve(withRefs(UNSTAGED)));
    // GC-004 asked here, and the answer on offer was the one git was going to give anyway.
    expect(document.querySelector('.modal')).toBeNull();
    expect(checkouts).toEqual(['feature']);
  });

  it('stays silent when the tree is clean, as it always did', async () => {
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve(withRefs(UNSTAGED)));
    await settle(() => fireEvent.click(screen.getByTitle('Switch branch')));
    await settle(() => repoChanged?.({ repo: REPO, scope: 'tree' }));
    await settle(() => statuses[0]?.resolve(status([])));
    await settle(() => fireEvent.click(recentRow('feature')));
    await settle(() => loads[1]?.resolve(withRefs([])));
    expect(document.querySelector('.modal')).toBeNull();
    expect(checkouts).toEqual(['feature']);
  });

  it('puts git s refusal to the user as a question with a way through it, not as a red line', async () => {
    const calls: string[] = [];
    let refuse = true;
    Object.assign(window.api, {
      checkout: async (_path: string, name: string) => {
        calls.push(`checkout:${name}`);
        if (!refuse) return;
        refuse = false;
        // The way Electron delivers a rejected handler, with git's own words inside it.
        throw new Error(
          ["Error invoking remote method 'ref:checkout': GitError: error: Your local changes to the following files would be overwritten by checkout:", '\ta.txt', 'Please commit your changes or stash them before you switch branches.', 'Aborting'].join('\n'),
        );
      },
      stashSave: async () => {
        calls.push('stash');
      },
      stashPop: async () => {
        calls.push('pop');
      },
    });
    await menuThenDirty();
    await settle(() => fireEvent.click(recentRow('feature')));
    // `run` reloads before it rethrows, so the dialog is on screen once that load lands.
    await settle(() => loads[1]?.resolve(withRefs(UNSTAGED)));

    // The question names the file git actually stopped on — not a count of everything
    // uncommitted, which is what the staging list behind the dialog is already saying.
    const asked = document.querySelector('.modal .modal-message')?.textContent ?? '';
    expect(asked).toContain('a.txt');
    expect(asked).toMatch(/stash your changes, check out feature, and put them back on top/i);
    // And nothing red behind it: the user has not made the decision yet (GC-215's `quiet`).
    expect(document.querySelector('.statusbar .err')).toBeNull();

    await settle(() => fireEvent.click(document.querySelector('.modal-buttons .btn:last-child') as HTMLElement));
    await settle(() => loads[2]?.resolve(withRefs([])));
    // Stash, check out, and put the changes back on top of the branch that was asked for.
    expect(calls).toEqual(['checkout:feature', 'stash', 'checkout:feature', 'pop']);
  });

  it('leaves every other failure on the status bar and does nothing else', async () => {
    Object.assign(window.api, {
      checkout: async () => {
        throw new Error("Error invoking remote method 'ref:checkout': GitError: error: pathspec 'feature' did not match any file(s) known to git");
      },
    });
    await menuThenDirty();
    await settle(() => fireEvent.click(recentRow('feature')));
    await settle(() => loads[1]?.resolve(withRefs(UNSTAGED)));
    expect(document.querySelector('.modal')).toBeNull();
    expect(document.querySelector('.statusbar .err .line')?.textContent).toContain('did not match');
  });
});

// GC-136: Ctrl+K hides the detail panel outright, and until now nothing on screen brought it back
// — the left panel's Ctrl+J at least leaves a clickable rail. This is the only reversible action
// in the app whose reverse was keyboard-only.
describe('a hidden detail panel has something on screen to bring it back (GC-136)', () => {
  it('shows a strip where the panel was, and one click restores it', async () => {
    await mount();
    expect(document.querySelector('.detail-panel')).not.toBeNull();
    // Absent while the panel is showing: it stands in the panel's place, not beside it.
    expect(document.querySelector('.detail-reveal')).toBeNull();

    await settle(() => fireEvent.keyDown(window, { key: 'k', ctrlKey: true }));
    expect(document.querySelector('.detail-panel')).toBeNull();
    const strip = document.querySelector<HTMLElement>('.detail-reveal');
    expect(strip).not.toBeNull();
    // It says what it does, which is the other half of "reachable with the mouse alone".
    expect(strip!.getAttribute('title')).toMatch(/detail panel/i);

    await settle(() => fireEvent.click(strip!));
    expect(document.querySelector('.detail-panel')).not.toBeNull();
    expect(document.querySelector('.detail-reveal')).toBeNull();
  });
});

// GC-202: which failures get the details dialog, and which line the bar draws. GC-169 built the
// dialog for credential refusals alone, so every other multi-line failure kept its explanation in
// a `title` with nothing on screen saying there was more to read.
describe('a failure with more to say than the bar can hold (GC-202)', () => {
  /** Stage all, and fail it with `message` the way Electron delivers a rejected handler. */
  async function failStaging(message: string): Promise<void> {
    (window.api as unknown as { stageAll: () => Promise<void> }).stageAll = () => Promise.reject(new Error(`Error invoking remote method 'workdir:stageAll': ${message}`));
    await mount();
    await settle(() => fireEvent.click(screen.getByText('Stage all changes')));
    // `run()` reloads after the failure and re-applies the error over it.
    await settle(() => statuses[0]?.resolve(status(UNSTAGED)));
  }

  const drawn = (): string => document.querySelector('.statusbar .err .line')?.textContent?.trim() ?? '';

  const REJECTED = [
    'GitError: To C:/tmp/origin.git',
    ' ! [rejected]        main -> main (non-fast-forward)',
    "error: failed to push some refs to 'C:/tmp/origin.git'",
    "hint: use 'git pull' before pushing again.",
  ].join('\n');

  it('draws the rejection and offers the rest, without opening anything by itself', async () => {
    await failStaging(REJECTED);

    expect(drawn()).toContain('(non-fast-forward)');
    expect(drawn()).not.toContain('failed to push some refs');
    // The action is over and the user may know why, so the dialog is offered, not raised.
    expect(document.querySelector('.modal.error-details')).toBeNull();
    expect(screen.getByText('Details')).toBeTruthy();

    await settle(() => fireEvent.click(document.querySelector('.statusbar .err') as HTMLElement));
    const modal = document.querySelector('.modal.error-details');
    expect(modal).not.toBeNull();
    // The whole of git's message, hints included — the lines a one-line bar was dropping.
    expect(modal?.querySelector('.error-details-text')?.textContent).toContain("hint: use 'git pull' before pushing again.");
    // Not an auth failure, so neither the title nor the credential note claims it is.
    expect(modal?.querySelector('h3')?.textContent).toBe('The command failed');
    expect(modal?.querySelector('.modal-note')).toBeNull();
  });

  it('leaves a credential refusal exactly as GC-169 left it', async () => {
    await failStaging(['GitAuthError: Push to origin (https://example.test/r.git) was refused', 'remote: Please re-authorise your token for SSO.', "fatal: unable to access 'https://example.test/r.git/': 403"].join('\n'));

    // The summary the main process composed, not the `fatal:` line `headline` would otherwise pick.
    expect(drawn()).toContain('Push to origin (https://example.test/r.git) was refused');
    // And it raises itself, because the user has to go and re-authorise something.
    const modal = document.querySelector('.modal.error-details');
    expect(modal).not.toBeNull();
    expect(modal?.querySelector('h3')?.textContent).toBe('Authentication failed');
    expect(modal?.querySelector('.modal-note')).not.toBeNull();
    expect(modal?.querySelector('.error-details-text')?.textContent).toContain('remote: Please re-authorise');
  });

  it('leaves a one-line failure as it always was: one line, and a click dismisses it', async () => {
    await failStaging("GitError: error: pathspec 'nope' did not match any file(s) known to git");

    expect(drawn()).toContain("pathspec 'nope' did not match");
    expect(document.querySelector('.statusbar .err .more')).toBeNull();
    expect(document.querySelector('.statusbar .err')?.className).not.toContain('has-details');

    await settle(() => fireEvent.click(document.querySelector('.statusbar .err') as HTMLElement));
    expect(document.querySelector('.statusbar .err')).toBeNull();
  });
});

// GC-217: double-clicking a remote branch used to run `checkout --track`, whose own fallback
// switches to the local copy when one exists — and that was the whole of it, so clicking
// `origin/master` while sitting on a `master` two commits behind checked out the branch already
// checked out and changed nothing at all. The gesture names the *remote* branch, so landing on the
// local one and stopping there answers half of it; the local copy is brought up to the ref clicked.
describe('a remote branch checkout takes you to where the ref points (GC-217)', () => {
  const LOCAL = 'a'.repeat(40);
  const REMOTE = 'b'.repeat(40);
  const ORIGIN = { name: 'origin', fetchUrl: 'https://example.invalid/r.git', pushUrl: 'https://example.invalid/r.git' };

  /** `main` checked out at `localSha`, with `origin/main` standing at `REMOTE`. */
  const withRemote = (localSha: string, extra: GitRef[] = []): RepoSnapshot => ({
    ...snapshot([]),
    refs: [
      { name: 'main', fullName: 'refs/heads/main', kind: 'head', sha: localSha, isHead: true, upstream: 'origin/main' },
      { name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote', sha: REMOTE, isHead: false },
      ...extra,
    ],
    remotes: [ORIGIN],
  });

  /** Every call the checkout made, in order, so "what did it actually run" is the assertion. */
  function record(fastForward: () => Promise<void> = async () => undefined): string[] {
    const calls: string[] = [];
    Object.assign(window.api, {
      checkout: async (_p: string, name: string, opts?: { track?: boolean }) => {
        calls.push(`checkout:${name}${opts?.track ? ':track' : ''}`);
      },
      fastForward: async (_p: string, branch: string, upstream: string) => {
        calls.push(`ff:${branch}->${upstream}`);
        await fastForward();
      },
    });
    return calls;
  }

  /** Open the branch crumb's menu and pick a row from it. */
  async function pick(first: RepoSnapshot, row: string, then: RepoSnapshot): Promise<void> {
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve(first));
    await settle(() => fireEvent.click(screen.getByTitle('Switch branch')));
    await settle(() => fireEvent.click(recentRow(row)));
    await settle(() => loads[1]?.resolve(then));
  }

  it('checks the local copy out and fast-forwards it to the ref that was clicked', async () => {
    const calls = record();
    await pick(withRemote(LOCAL), 'origin/main', withRemote(REMOTE));
    expect(calls).toEqual(['checkout:origin/main:track', 'ff:main->origin/main']);
    // Nothing to ask and nothing to report: the graph moving is the answer.
    expect(document.querySelector('.modal')).toBeNull();
    expect(document.querySelector('.statusbar .err')).toBeNull();
    expect(document.querySelector('.statusbar .notice')).toBeNull();
  });

  it('attempts no fast-forward when the two are already the same commit', async () => {
    const calls = record();
    await pick(withRemote(REMOTE), 'origin/main', withRemote(REMOTE));
    expect(calls).toEqual(['checkout:origin/main:track']);
  });

  it('attempts none for a remote branch with no local copy: --track makes it at that commit', async () => {
    const calls = record();
    const only: GitRef = { name: 'origin/solo', fullName: 'refs/remotes/origin/solo', kind: 'remote', sha: 'c'.repeat(40), isHead: false };
    await pick(withRemote(LOCAL, [only]), 'origin/solo', withRemote(LOCAL, [only]));
    expect(calls).toEqual(['checkout:origin/solo:track']);
  });

  /** git's own refusal when the two have each moved on. */
  const DIVERGED = () => Promise.reject(new Error("Error invoking remote method 'ref:fastForward': GitError: fatal: Not possible to fast-forward, aborting."));

  it('puts a divergence to the user as a choice, not as a line telling them about it', async () => {
    // GC-221: the checkout happened and the catch-up could not, which is the one outcome only the
    // user can settle. An advisory named the problem and offered nothing.
    const calls = record(DIVERGED);
    await pick(withRemote(LOCAL), 'origin/main', withRemote(LOCAL));
    expect(calls).toEqual(['checkout:origin/main:track', 'ff:main->origin/main']);
    const asked = document.querySelector('.modal .modal-message')?.textContent ?? '';
    expect(asked).toContain('origin/main');
    expect(asked).toMatch(/cannot be fast-forwarded/i);
    // It is the destructive one of the two, so it says what it drops and is marked as such.
    expect(asked).toMatch(/discards/i);
    const buttons = [...document.querySelectorAll('.modal-buttons .btn')].map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['Cancel', 'Create a branch here…', 'Reset main to origin/main']);
    expect(document.querySelector('.modal-buttons .btn:last-child')?.className).toContain('danger');
    // Nothing red: the checkout the user asked for did happen.
    expect(document.querySelector('.statusbar .err')).toBeNull();
  });

  it('cancelling it leaves the branch exactly where the checkout left it', async () => {
    const calls = record(DIVERGED);
    Object.assign(window.api, { reset: async () => calls.push('reset') });
    await pick(withRemote(LOCAL), 'origin/main', withRemote(LOCAL));
    await settle(() => fireEvent.click(document.querySelector('.modal-buttons .btn') as HTMLElement));
    expect(calls).toEqual(['checkout:origin/main:track', 'ff:main->origin/main']);
    expect(document.querySelector('.modal')).toBeNull();
  });

  it('and taking the reset moves the local branch onto the ref that was clicked', async () => {
    const calls = record(DIVERGED);
    Object.assign(window.api, {
      reset: async (_p: string, mode: string, sha: string) => {
        calls.push(`reset:${mode}:${sha}`);
      },
    });
    await pick(withRemote(LOCAL), 'origin/main', withRemote(LOCAL));
    await settle(() => fireEvent.click(document.querySelector('.modal-buttons .btn:last-child') as HTMLElement));
    await settle(() => loads[2]?.resolve(withRemote(REMOTE)));
    expect(calls).toEqual(['checkout:origin/main:track', 'ff:main->origin/main', 'reset:hard:origin/main']);
  });

  it('lets a working tree in the way through to GC-215 s question, naming the ref clicked', async () => {
    // git says "would be overwritten by merge" for a blocked fast-forward, in the same shape it
    // says "by checkout" — so this is the question, not a sentence about branches that have not
    // diverged at all. The file is in the way of `origin/main`, not of the `main` already under
    // the user's feet, and the question has to say so.
    const calls = record(() =>
      Promise.reject(new Error(["Error invoking remote method 'ref:fastForward': GitError: error: Your local changes to the following files would be overwritten by merge:", '\tshared.txt', 'Please commit your changes or stash them before you merge.', 'Aborting'].join('\n'))),
    );
    await pick(withRemote(LOCAL), 'origin/main', withRemote(LOCAL));
    expect(calls).toEqual(['checkout:origin/main:track', 'ff:main->origin/main']);
    const asked = document.querySelector('.modal .modal-message')?.textContent ?? '';
    expect(asked).toContain('shared.txt');
    expect(asked).toContain('origin/main would overwrite');
    expect(asked).not.toContain('main would overwrite: shared.txt. Stash your changes, check out main,');
    expect(document.querySelector('.statusbar .err')).toBeNull();
  });
});

// GC-219: the app opens on the working-directory row, and that row is no longer drawn for a clean
// tree — so the selection it opens on has to go somewhere that exists.
describe('a clean tree leaves the selection on HEAD rather than on a row that is not there', () => {
  const HEAD = 'c'.repeat(40);
  const headCommit: Commit = {
    sha: HEAD,
    parents: [],
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
    authorDate: '2026-01-02T03:04:05Z',
    committerName: 'Ada',
    committerDate: '2026-01-02T03:04:05Z',
    summary: 'the commit HEAD is on',
    body: '',
    refs: [],
  };
  const withHead = (entries: StatusEntry[]): RepoSnapshot => ({
    ...snapshot(entries),
    info: { path: REPO, name: 'repo', headSha: HEAD, branch: 'main' },
    commits: [headCommit],
  });

  it('falls to HEAD when there is nothing in the working directory', async () => {
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve(withHead([])));
    // No row to stand on, so the graph draws none and the panel shows the commit instead of a
    // staging view over three empty lists.
    expect(document.querySelector('.graph-row.wip')).toBeNull();
    expect(document.querySelector('.graph-row.selected')).not.toBeNull();
    expect(document.querySelector('.detail-panel h2')?.textContent).toBe('the commit HEAD is on');
  });

  it('stays on the working-directory row while there is something in it', async () => {
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve(withHead(UNSTAGED)));
    expect(document.querySelector('.graph-row.wip')).not.toBeNull();
    expect(document.querySelector('.graph-row.wip')?.className).toContain('selected');
    expect(groupCount('Unstaged')).toBe(1);
  });

  it('goes back to the row the moment the working directory has something in it', async () => {
    // `WIP` is the app's default, not a choice the user made, so it is still what the state holds
    // — falling to HEAD is only what it *shows* while there is no row. A file appearing puts the
    // selection back where it defaults to, with the panel on the thing that just happened. The
    // state being written to HEAD instead would make that one-way, and a merge stopping with
    // conflicts would arrive with nothing on screen about it.
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve(withHead([])));
    expect(document.querySelector('.graph-row.wip')).toBeNull();
    await settle(() => repoChanged?.({ repo: REPO, scope: 'tree' }));
    await settle(() => statuses[0]?.resolve(status(UNSTAGED)));
    expect(document.querySelector('.graph-row.wip')?.className).toContain('selected');
    expect(groupCount('Unstaged')).toBe(1);
  });

  it('leaves a selection the user actually made alone, in both directions', async () => {
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve(withHead(UNSTAGED)));
    // Pick the commit by hand; that is a sha, and none of the above applies to it.
    await settle(() => fireEvent.click(screen.getByText('the commit HEAD is on')));
    expect(document.querySelector('.detail-panel h2')?.textContent).toBe('the commit HEAD is on');
    // The tree going clean and dirty again moves nothing.
    await settle(() => repoChanged?.({ repo: REPO, scope: 'tree' }));
    await settle(() => statuses[0]?.resolve(status([])));
    expect(document.querySelector('.detail-panel h2')?.textContent).toBe('the commit HEAD is on');
    await settle(() => repoChanged?.({ repo: REPO, scope: 'tree' }));
    await settle(() => statuses[1]?.resolve(status(UNSTAGED)));
    expect(document.querySelector('.detail-panel h2')?.textContent).toBe('the commit HEAD is on');
    expect(document.querySelector('.graph-row.wip')?.className).not.toContain('selected');
  });

  it('keeps the row through an operation, which is the only way to reach Abort', async () => {
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve({ ...withHead([]), status: { ...status([]), operation: 'rebase' } }));
    expect(document.querySelector('.graph-row.wip')).not.toBeNull();
    expect(document.querySelector('.graph-row.wip')?.className).toContain('selected');
  });

  it('leaves it alone on an unborn HEAD, where the working directory is all there is', async () => {
    render(
      <UiProvider>
        <App />
      </UiProvider>,
    );
    await settle(() => loads[0]?.resolve(snapshot([])));
    // `headSha` is null: there is no commit to fall to, so the staging view is right.
    expect(document.querySelector('.graph-row.wip')).toBeNull();
    expect(groupCount('Unstaged')).toBe(0);
  });
});
