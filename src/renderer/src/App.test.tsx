import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GitApi, RepoChange, RepoSnapshot, RepoStatus, StatusEntry } from '@shared/types';
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
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Every `loadRepo` call, oldest first, waiting to be resolved. */
let loads: Deferred<RepoSnapshot>[] = [];
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
  statuses = [];
  repoChanged = null;
  // Avatars are gated inside `useGravatar`, so switching them off keeps the render clear of
  // `crypto.subtle` and of any gravatar.com request.
  setPrefs({ avatars: false });
  localStorage.setItem('gitclient.lastRepo', REPO); // so the mount effect opens a repository
  const api = {
    checkGit: async () => ({ available: true, version: 'git version 2.45.0' }),
    loadRepo: () => {
      const d = defer<RepoSnapshot>();
      loads.push(d);
      return d.promise;
    },
    getStatus: () => {
      const d = defer<RepoStatus>();
      statuses.push(d);
      return d.promise;
    },
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
