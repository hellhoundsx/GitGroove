import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type MouseEvent } from 'react';
import type { CheckoutOptions, Commit, GitRef, IgnoreKind, Remote, RepoChange, RepoSnapshot, Stash, StatusEntry } from '@shared/types';
import { defaultRemote } from '@shared/remotes';
import { useDragWidth } from './ui/useDragWidth';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { LeftPanel } from './components/LeftPanel';
import { DetailPanel, discardFileConfirm, type FileMenuTarget, type StagingActions } from './components/DetailPanel';
import { StatusBar } from './components/StatusBar';
import { CommitGraph, WIP } from './graph/CommitGraph';
import { DiffView, type FileViewSource } from './diff/DiffView';
import { Preferences } from './components/Preferences';
import { Shortcuts } from './components/Shortcuts';
import { setPrefs, usePrefs } from './prefs';
import { matches } from './shortcuts';
import { useUi } from './ui/UiContext';
import type { MenuItem } from './ui/ContextMenu';
import type { MenuAnchor } from './ui/UiContext';

const LAST_REPO_KEY = 'gitclient.lastRepo';
/** Remembered state like `gitclient.lastRepo`, not a preference: the list of paths, newest first (GC-044). */
const RECENT_REPOS_KEY = 'gitclient.recentRepos';
const MAX_RECENT = 10;
/** The pinned branch is per repository, so the key carries the path. */
const pinKey = (path: string): string => `gitclient.pinned.${path}`;
/** The refs hidden from the graph, per repository, as a JSON array of full names (GC-073). */
const hiddenKey = (path: string): string => `gitclient.hidden.${path}`;

function readHidden(path: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(hiddenKey(path)) ?? '[]');
    return Array.isArray(raw) ? raw.filter((n): n is string => typeof n === 'string' && n.length > 0) : [];
  } catch {
    return [];
  }
}
/** Two hidden sets holding the same names in the same order (GC-099). */
const sameNames = (a: string[], b: string[]): boolean => a.length === b.length && a.every((n, i) => n === b[i]);
const MAX_COMMITS = 2000;
/** Commits appended each time the graph is scrolled near the end of what is loaded (GC-012). */
const PAGE_COMMITS = 1000;

/** Windows hands the same folder back with either separator and either case, so dedupe on this (GC-044). */
const normRepoPath = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** How deep to load `path`: what is already on screen for it, or the first page for a new one (GC-012). */
const pageDepth = (paged: { path: string; loaded: number }, path: string): number =>
  paged.path !== '' && normRepoPath(paged.path) === normRepoPath(path) ? Math.max(MAX_COMMITS, paged.loaded) : MAX_COMMITS;
/** The folder name is the label; the full path is the hint next to it. */
const folderName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

const readRecents = (): string[] => {
  try {
    const raw = localStorage.getItem(RECENT_REPOS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string' && p.length > 0).slice(0, MAX_RECENT);
  } catch {
    return []; // a hand-edited or truncated blob must not break the app
  }
};

const isEditable = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
/**
 * Whether a staging row's file is gone from the working tree (GC-072). The unstaged side is the
 * later of the two, so it decides when both are set: a staged deletion the user has since
 * recreated is on disk again, and a staged edit the user then deleted is not.
 */
const deletedFromTree = (e: StatusEntry): boolean => (e.unstaged ? e.unstaged === 'deleted' : e.staged === 'deleted');
/** The ahead/behind a branch row shows, in the toolbar badge's arrows; null when it tracks nothing (GC-088). */
const aheadBehind = (r: GitRef): string | null => {
  const parts = [r.ahead ? `↑${r.ahead}` : '', r.behind ? `↓${r.behind}` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
};
/** Human-readable error text: strips Electron's IPC wrapper and the error class name. */
const msg = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e))
    .replace(/^Error invoking remote method '[^']+': /, '')
    .replace(/^(GitError|Error): /, '')
    .trim();

export function App(): JSX.Element {
  const ui = useUi();
  const prefs = usePrefs();
  const [repoPath, setRepoPath] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_REPO_KEY);
    } catch {
      return null;
    }
  });
  const [recents, setRecents] = useState<string[]>(readRecents);
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(WIP);
  const [fileView, setFileView] = useState<FileViewSource | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // Both side panels are draggable (GC-050); the widths are remembered state on their own keys,
  // the way the ref column's is, and reach the panels as CSS variables on the app root.
  const leftW = useDragWidth({ key: 'gitclient.leftPanelW', def: 220, min: 160, max: 420 });
  const detailW = useDragWidth({ key: 'gitclient.detailPanelW', def: 400, min: 300, max: 720, dir: -1 });
  const [workdirVersion, setWorkdirVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); // label of the running operation
  const [error, setError] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null); // git itself is missing (GC-025)
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null); // branch name pinned to column 0
  // Refs kept out of the graph (GC-073). The ref mirrors the state because `load()` needs the set
  // as it stands at the moment it spawns `git log`, without every callback that loads a repository
  // having to be rebuilt each time the set changes.
  const [hidden, setHidden] = useState<string[]>([]);
  const hiddenRef = useRef<string[]>([]);
  // How much of which repository's log is loaded, and whether the traversal had more behind it
  // (GC-012). The depth is a ref because every load reads it as it stands at the moment it spawns
  // `git log`, the way the hidden set above does.
  const paged = useRef<{ path: string; loaded: number }>({ path: '', loaded: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // The search bar over the graph. `searchTick` changes on every request to open it so that
  // Ctrl+F refocuses the field even when the bar is already showing. The query lives here rather
  // than in `CommitGraph` because that component unmounts whenever a file view opens (GC-030);
  // only closing the bar clears it.
  const [search, setSearch] = useState({ open: false, tick: 0, query: '' });
  const openSearch = useCallback(() => setSearch((s) => ({ ...s, open: true, tick: s.tick + 1 })), []);
  const closeSearch = useCallback(() => setSearch((s) => ({ ...s, open: false, query: '' })), []);
  const setSearchQuery = useCallback((query: string) => setSearch((s) => ({ ...s, query })), []);

  // The recents list is state here and one JSON blob in localStorage; writing it from an effect
  // keeps the updaters below pure (GC-044).
  useEffect(() => {
    try {
      localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(recents));
    } catch {
      /* ignore */
    }
  }, [recents]);

  // Nothing tied a git result to the moment it was asked for, so a slow background load could
  // resolve after a user action had already reloaded and replace the fresh snapshot with the one
  // it captured before the click — a staged file showing as unstaged until the next watcher event
  // (GC-068). Every read below captures this counter when it starts and drops its result if it has
  // moved on by the time git answers; `run()` bumps it, so a user action always invalidates the
  // background work already in flight. Dropping is silent: whatever superseded it is already on
  // screen, so there is nothing to report and no spinner to clear.
  const generation = useRef(0);

  // What the app has actually put on screen, as opposed to the invalidation counter above: bumped
  // every time a snapshot or a status is applied to state, whether that came from `run()`'s reload
  // or from the watcher's background refresh. It reaches the DOM as `data-gen` on the status bar,
  // which is the only announcement a reload has ever made: before it, the e2e suite could see the
  // spinner go up and come down but had nothing to tell a finished reload from one that had not
  // started, and covered the gap with 43.8s of fixed sleeps per run (GC-080).
  const [dataGen, setDataGen] = useState(0);
  const bumpGen = useCallback(() => setDataGen((g) => g + 1), []);

  const load = useCallback(
    async (path: string) => {
      const gen = generation.current;
      // The hidden set belongs to the path about to be loaded, so it is read here rather than left
      // to the prune effect below, which only runs once a snapshot has landed: that made every cold
      // open two `git log` runs at MAX_COMMITS and painted the hidden branches before removing them
      // (GC-099). Reading it here also resets it when the path changes, so one repository's hidden
      // set can never reach another's first load. A path the dialog hands back uncanonicalised has
      // no stored set under its key, which loads unfiltered and lets the prune effect correct it —
      // the old behaviour, for the one case that cannot be keyed up front.
      const hide = readHidden(path);
      // A reload of the repository already open asks for everything on screen, not just the first
      // page (GC-012): the user scrolled to row 4000, and snapping back to 2000 on every watcher
      // refresh would move the graph under them. A different path starts from one page again.
      const want = pageDepth(paged.current, path);
      try {
        const snap = await window.api.loadRepo(path, want, hide);
        if (gen !== generation.current) return; // (GC-068) something newer has already landed
        setSnapshot(snap);
        // Applied in the same commit as the snapshot it was loaded with, so no frame is ever
        // painted with a chip for a ref that snapshot already excludes, and recorded as the set
        // this snapshot was built with so the prune effect below has nothing to correct (GC-099).
        // It is recorded here rather than before the await because the effect clears it while
        // there is no snapshot, which on a cold open runs between the two and would otherwise
        // leave the effect comparing this snapshot against an empty set — the second load again.
        hiddenRef.current = hide;
        setHidden((prev) => (sameNames(prev, hide) ? prev : hide));
        paged.current = { path: snap.info.path, loaded: snap.commits.length };
        // A short answer is the end of the history; a full one may have more behind it (GC-012).
        setHasMore(snap.commits.length >= want);
        bumpGen();
        setRepoPath(snap.info.path);
        // git hands back the canonical path, so dedupe against that rather than the one asked for.
        setRecents((prev) => [snap.info.path, ...prev.filter((p) => normRepoPath(p) !== normRepoPath(snap.info.path))].slice(0, MAX_RECENT));
        try {
          localStorage.setItem(LAST_REPO_KEY, snap.info.path);
        } catch {
          /* ignore */
        }
      } catch (e) {
        // A stale failure must not clear a repository a newer load has since opened, so the error
        // path is generation-checked too (GC-068).
        if (gen !== generation.current) return;
        setSnapshot(null);
        // Nothing is loaded any more, so nothing can be paged onto it (GC-012).
        paged.current = { path: '', loaded: 0 };
        setHasMore(false);
        // The empty snapshot is a state change like any other, so it counts as a generation: a
        // failed load has to end a wait, not leave one hanging until it times out (GC-080).
        bumpGen();
        // The path did not load, so the status bar must stop naming it as the open repository; the
        // remembered path stays in localStorage in case the folder comes back (GC-025).
        setRepoPath(null);
        // An entry that no longer loads drops out of the list so the menu stops offering it; the
        // error still shows in the status bar (GC-044).
        setRecents((prev) => prev.filter((p) => normRepoPath(p) !== normRepoPath(path)));
        setError(msg(e));
      }
    },
    [bumpGen],
  );

  /**
   * Append the next page of the log (GC-012). The graph asks for it when it is scrolled within
   * `NEAR_END` rows of what is loaded, so the request is made before the user reaches the bottom
   * and the rows are usually there by the time they would have seen the end.
   *
   * The page continues the traversal the snapshot on screen was built from, so it is asked for
   * with the same hidden set, and it is dropped if a reload has landed since it was asked for: the
   * commits it holds count from a range that no longer exists (GC-068).
   */
  const loadMore = useCallback(async () => {
    const { path, loaded } = paged.current;
    if (!path || loadingMore || !hasMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    try {
      const page = await window.api.getLog(path, loaded, PAGE_COMMITS, hiddenRef.current);
      if (gen !== generation.current) return;
      if (page.length > 0) {
        paged.current = { path, loaded: loaded + page.length };
        setSnapshot((s) => (s ? { ...s, commits: [...s.commits, ...page] } : s));
        // Appending is a snapshot change like any other, so it counts as a generation (GC-080).
        bumpGen();
      }
      setHasMore(page.length === PAGE_COMMITS);
    } catch {
      // A page that will not load is not worth a banner over a graph that is fine: keep what is on
      // screen and stop offering more, rather than asking again on every scroll event.
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [bumpGen, hasMore, loadingMore]);

  // The graph asks from an effect, so the callback has to keep its identity between renders or the
  // effect would re-run on every one of them (GC-012).
  const askForMore = useCallback(() => void loadMore(), [loadMore]);

  useEffect(() => {
    // One `git --version`, before anything is attempted: every action shells out, so a missing git
    // makes the whole client useless and the empty state has to say so rather than show a bare
    // ENOENT after the first action (GC-025).
    void window.api
      .checkGit()
      .then((r) => setGitError(r.available ? null : r.error ?? null))
      .catch((e) => setGitError(msg(e)));
    if (repoPath) {
      setBusy('Loading repository');
      setError(null);
      void load(repoPath).finally(() => setBusy(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Switch to a repository: the folder dialog and the recents list both land here. */
  const openPath = useCallback(
    async (path: string) => {
      // Switching repositories is a user action like any other, so it too invalidates a background
      // load already running against the one being left (GC-068).
      generation.current += 1;
      setFileView(null);
      setSelected(WIP);
      setBusy('Loading repository');
      setError(null);
      await load(path).finally(() => setBusy(null));
    },
    [load],
  );

  const openRepo = useCallback(async () => {
    const path = await window.api.openRepoDialog();
    if (path) await openPath(path);
  }, [openPath]);

  const repo = snapshot?.info.path ?? null;

  // The pin follows the repository, so re-read it whenever a different one is loaded.
  useEffect(() => {
    if (!repo) {
      setPinned(null);
      return;
    }
    try {
      setPinned(localStorage.getItem(pinKey(repo)));
    } catch {
      setPinned(null);
    }
  }, [repo]);

  const pinBranch = useCallback(
    (name: string | null) => {
      setPinned(name);
      if (!repo) return;
      try {
        if (name === null) localStorage.removeItem(pinKey(repo));
        else localStorage.setItem(pinKey(repo), name);
      } catch {
        /* ignore */
      }
    },
    [repo],
  );

  /** Re-read the working directory status after a mutation. */
  const refreshStatus = useCallback(async () => {
    if (!repo) return;
    const gen = generation.current;
    const status = await window.api.getStatus(repo);
    if (gen !== generation.current) return; // (GC-068)
    setSnapshot((s) => (s ? { ...s, status } : s));
    setWorkdirVersion((v) => v + 1);
    bumpGen();
  }, [bumpGen, repo]);

  /** Run a git operation with busy/error handling, then reload the snapshot (or only the status). */
  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>, opts: { statusOnly?: boolean; rethrow?: boolean } = {}): Promise<void> => {
      if (!repo) return;
      // The user acted, so whatever a background load is about to return was captured before this
      // and must not land on top of the reload below (GC-068).
      generation.current += 1;
      setBusy(label);
      setError(null);
      let failure: unknown = null;
      try {
        await fn();
      } catch (e) {
        failure = e;
      } finally {
        try {
          if (opts.statusOnly) await refreshStatus();
          else {
            await load(repo);
            setWorkdirVersion((v) => v + 1);
          }
        } catch (e) {
          failure ??= e;
        } finally {
          setBusy(null);
        }
      }
      if (failure !== null) {
        // git often exits non-zero while leaving the repo in a state the panels now show (conflicts,
        // an empty cherry-pick, a stopped rebase), so keep the message visible after the reload
        setError(msg(failure));
        if (opts.rethrow) throw failure;
      }
    },
    [repo, load, refreshStatus],
  );

  // ---- hidden refs (GC-073) ----------------------------------------------------------
  // The stored set is re-read and pruned against every snapshot: a branch that has since been
  // deleted stops being excluded, so a name cannot outlive its ref in `localStorage` and keep
  // `git log` refusing a ref nobody can see any more. When the pruned set differs from the one the
  // snapshot on screen was built with — a different repository was opened, or a hidden branch is
  // gone — the graph is rebuilt with it.
  useEffect(() => {
    if (!repo || !snapshot) {
      hiddenRef.current = [];
      setHidden((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const stored = readHidden(repo);
    const live = new Set(snapshot.refs.map((r) => r.fullName));
    const next = stored.filter((n) => live.has(n));
    if (next.length !== stored.length) {
      try {
        if (next.length === 0) localStorage.removeItem(hiddenKey(repo));
        else localStorage.setItem(hiddenKey(repo), JSON.stringify(next));
      } catch {
        /* ignore */
      }
    }
    const applied = hiddenRef.current;
    hiddenRef.current = next;
    // Keeping the array's identity when the names have not changed stops a snapshot that says
    // nothing new about the hidden set from re-rendering the panels that read it.
    setHidden((prev) => (sameNames(prev, next) ? prev : next));
    // Only when the snapshot on screen was built with a different set is a rebuild owed. Now that
    // `load()` applies the stored set to the first call for a path (GC-099), that means a hidden
    // ref has genuinely disappeared — the ordinary open costs one `git log`, not two.
    if (!sameNames(next, applied)) void run('Updating graph', async () => undefined);
  }, [repo, snapshot, run]);

  /** Persist a new hidden set and rebuild the graph with it. */
  const applyHidden = useCallback(
    (next: string[]) => {
      if (!repo) return;
      try {
        if (next.length === 0) localStorage.removeItem(hiddenKey(repo));
        else localStorage.setItem(hiddenKey(repo), JSON.stringify(next));
      } catch {
        /* ignore */
      }
      hiddenRef.current = next;
      setHidden(next);
      void run('Updating graph', async () => undefined);
    },
    [repo, run],
  );

  /**
   * One ref per action: hiding a local branch does not also hide the upstream its chip absorbs.
   * The eye sits on a row that stands for exactly one ref, and taking a second one out silently
   * would hide something the user did not name — so a branch whose commits are also reachable from
   * its upstream stays in the graph until that upstream is hidden too, which the row below it does.
   */
  const toggleHidden = useCallback(
    (r: GitRef) => {
      if (r.isHead) return; // the checked-out branch is never hidden
      const set = hiddenRef.current;
      applyHidden(set.includes(r.fullName) ? set.filter((n) => n !== r.fullName) : [...set, r.fullName]);
    },
    [applyHidden],
  );

  /** Everything but this branch and the checked-out one; tags are untouched. */
  const soloRef = useCallback(
    (r: GitRef) => {
      const refs = snapshot?.refs ?? [];
      applyHidden(refs.filter((x) => (x.kind === 'head' || x.kind === 'remote') && !x.isHead && x.fullName !== r.fullName).map((x) => x.fullName));
    },
    [applyHidden, snapshot],
  );

  const showAll = useCallback(
    (kind: 'head' | 'remote') => {
      const refs = snapshot?.refs ?? [];
      const of = new Set(refs.filter((r) => r.kind === kind).map((r) => r.fullName));
      applyHidden(hiddenRef.current.filter((n) => !of.has(n)));
    },
    [applyHidden, snapshot],
  );

  /** The Hide / Show / Solo group both branch menus carry (GC-073). */
  const visibilityItems = useCallback(
    (r: GitRef): MenuItem[] => [
      {
        label: hidden.includes(r.fullName) ? 'Show in graph' : 'Hide in graph',
        hint: hidden.includes(r.fullName) ? undefined : 'keep this branch out of the graph',
        disabled: r.isHead,
        onClick: () => toggleHidden(r),
      },
      { label: 'Solo in graph', hint: 'hide every other branch', onClick: () => soloRef(r) },
    ],
    [hidden, soloRef, toggleHidden],
  );

  const actions = useMemo<StagingActions>(
    () => ({
      stage: (paths) => run('Staging', () => window.api.stage(repo!, paths), { statusOnly: true, rethrow: true }),
      unstage: (paths) => run('Unstaging', () => window.api.unstage(repo!, paths), { statusOnly: true, rethrow: true }),
      stageAll: () => run('Staging all', () => window.api.stageAll(repo!), { statusOnly: true, rethrow: true }),
      unstageAll: () => run('Unstaging all', () => window.api.unstageAll(repo!), { statusOnly: true, rethrow: true }),
      discard: (entries: StatusEntry[]) =>
        run(
          'Discarding',
          () =>
            window.api.discard(repo!, {
              tracked: entries.filter((e) => e.unstaged !== null && e.unstaged !== 'untracked').map((e) => e.path),
              untracked: entries.filter((e) => e.unstaged === 'untracked').map((e) => e.path),
            }),
          { statusOnly: true, rethrow: true },
        ),
      commit: (summary, body, amend) => run('Committing', () => window.api.commit(repo!, { summary, body, amend }), { rethrow: true }),
      abortOperation: () => run('Aborting', () => window.api.abortOperation(repo!), { rethrow: true }),
    }),
    [repo, run],
  );

  const applyPatch = useCallback(
    (patch: string, opts: { cached?: boolean; reverse?: boolean }) => run('Applying patch', () => window.api.applyPatch(repo!, patch, opts), { statusOnly: true, rethrow: true }),
    [repo, run],
  );

  // ---- file-system watcher -----------------------------------------------------------
  // The main process pushes `repo:changed` whenever something moves under the working tree or
  // .git, so an editor's save and a commit typed in a terminal show up without a click (GC-011).
  // A change that lands while an action is running is parked instead of applied: `run()` reloads
  // when it finishes anyway, and refreshing underneath it is how a refresh loop starts.
  const pendingChange = useRef<RepoChange['scope'] | null>(null);
  const busyRef = useRef(false);

  const applyChange = useCallback(
    async (scope: RepoChange['scope']) => {
      if (!repo) return;
      try {
        if (scope === 'tree') {
          await refreshStatus();
          return;
        }
        // Not `load()`: its failure path clears the open repository (GC-025), which a refresh
        // nobody asked for must never do, so the snapshot is replaced only when one arrives.
        const gen = generation.current;
        // As deep as what is on screen, or a refresh nobody asked for would drop the pages the
        // user scrolled to load (GC-012).
        const want = pageDepth(paged.current, repo);
        const snap = await window.api.loadRepo(repo, want, hiddenRef.current);
        if (gen !== generation.current) return; // (GC-068) a user action has reloaded since
        setSnapshot(snap);
        paged.current = { path: snap.info.path, loaded: snap.commits.length };
        setHasMore(snap.commits.length >= want);
        setWorkdirVersion((v) => v + 1);
        bumpGen();
      } catch {
        /* a background refresh must not raise a banner over the user's work */
      }
    },
    [bumpGen, refreshStatus, repo],
  );

  const flushChange = useCallback(() => {
    const scope = pendingChange.current;
    if (scope === null) return;
    pendingChange.current = null;
    void applyChange(scope);
  }, [applyChange]);

  useEffect(() => {
    busyRef.current = busy !== null;
    if (busy === null) flushChange(); // whatever arrived mid-action is applied once, and only here
  }, [busy, flushChange]);

  useEffect(() => {
    if (!repo) return;
    void window.api.watchRepo(repo);
    const off = window.api.onRepoChanged((change) => {
      if (change.repo !== repo) return;
      // 'refs' wins over 'tree': the full reload it asks for covers a status change too.
      if (pendingChange.current !== 'refs') pendingChange.current = change.scope;
      if (!busyRef.current) flushChange();
    });
    return () => {
      off();
      void window.api.watchRepo(null);
    };
  }, [repo, flushChange]);

  // Close a WIP file view whose file no longer has changes of that kind.
  useEffect(() => {
    if (!fileView || fileView.source !== 'wip' || !snapshot) return;
    const entry = snapshot.status.entries.find((e) => e.path === fileView.path);
    const still = entry && (fileView.staged ? entry.staged !== null : entry.unstaged !== null);
    if (!still) setFileView(null);
  }, [snapshot, fileView]);

  const commits = snapshot?.commits ?? [];
  const selectedCommit = useMemo(() => (selected && selected !== WIP ? commits.find((c) => c.sha === selected) ?? null : null), [commits, selected]);
  const headCommit = useMemo(() => (snapshot?.info.headSha ? commits.find((c) => c.sha === snapshot.info.headSha) ?? null : null), [commits, snapshot]);
  const headRef = useMemo(() => snapshot?.refs.find((r) => r.isHead) ?? null, [snapshot]);
  // Resolved on every snapshot so the pinned lane follows the branch as it gains commits; a pin on a
  // branch that no longer exists simply stops resolving and column 0 goes back to HEAD's lineage.
  // The graph is handed only what it should draw, so a hidden ref's chip disappears with its rows
  // and the local-absorbs-upstream pairing works off the same list (GC-073). The left panel still
  // gets every ref: it is where a hidden one is shown dimmed and brought back.
  const visibleRefs = useMemo(() => {
    if (hidden.length === 0) return snapshot?.refs ?? [];
    const set = new Set(hidden);
    return (snapshot?.refs ?? []).filter((r) => !set.has(r.fullName));
  }, [hidden, snapshot]);

  const pinnedRef = useMemo(() => (pinned ? snapshot?.refs.find((r) => r.kind === 'head' && r.name === pinned) ?? null : null), [pinned, snapshot]);
  const currentBranch = snapshot?.info.branch ?? null;

  const select = useCallback((sha: string) => {
    setSelected(sha);
    setFileView(null);
  }, []);

  // ---- ref / commit / stash operations ------------------------------------------------

  // Every checkout the UI can trigger goes through here: with a dirty working tree git either
  // carries the changes over or refuses, so ask first and offer to stash them out of the way.
  const runCheckout = useCallback(
    async (name: string, doCheckout: () => Promise<void>): Promise<void> => {
      // Untracked files come across a checkout untouched, so a tree holding nothing else is not at
      // risk and must not be asked about (GC-019); the count names the files that are, which is the
      // staging list minus those untracked rows.
      const atRisk = (snapshot?.status.entries ?? []).filter((e) => !(e.staged === null && e.unstaged === 'untracked'));
      if (prefs.confirmDirtyCheckout && atRisk.length) {
        const r = await ui.prompt({
          title: 'Uncommitted changes',
          message: `You have uncommitted changes in ${atRisk.length} file${atRisk.length === 1 ? '' : 's'}. Check out ${name} anyway?`,
          input: false,
          okLabel: 'Check out anyway',
          secondary: { label: 'Stash and check out' },
        });
        if (!r) return;
        if (r.choice === 'secondary') {
          await run(`Stashing and checking out ${name}`, async () => {
            await window.api.stashSave(repo!, { includeUntracked: true, message: `Before checking out ${name}` });
            try {
              await doCheckout();
            } catch (e) {
              // restore the changes on the branch we never left, then report why
              await window.api.stashPop(repo!, 0).catch(() => undefined);
              throw e;
            }
            await window.api.stashPop(repo!, 0);
          });
          return;
        }
      }
      await run(`Checking out ${name}`, doCheckout);
    },
    [prefs.confirmDirtyCheckout, repo, run, snapshot, ui],
  );

  // git refuses to start a cherry-pick, a revert, a merge or a rebase while anything is staged: it
  // prints its hint and stops before touching the repository, so the click looks valid and the only
  // feedback is a line naming a fix the user has to leave the app for. Same shape as the checkout
  // guard above — ask first, offer to stash — minus "continue anyway", which git would only refuse
  // (GC-090). Untracked and unstaged-only trees are not in the way and are never asked about: git
  // carries those into the action.
  const runSequencer = useCallback(
    async (what: string, label: string, action: () => Promise<unknown>): Promise<void> => {
      const staged = (snapshot?.status.entries ?? []).filter((e) => e.staged !== null || e.unstaged === 'conflicted');
      if (!staged.length) {
        await run(label, action);
        return;
      }
      const r = await ui.prompt({
        title: 'Staged changes in the way',
        message: `git refuses to ${what} while anything is staged, and you have ${staged.length} staged file${staged.length === 1 ? '' : 's'}. Stash them, ${what}, and put them back?`,
        input: false,
        okLabel: 'Stash and continue',
      });
      if (!r) return;
      const stashMessage = `Before ${label.toLowerCase()}`;
      await run(label, async () => {
        await window.api.stashSave(repo!, { includeUntracked: true, message: stashMessage });
        try {
          await action();
        } catch (e) {
          // The action failed. When git stopped mid-operation — a conflicted cherry-pick, a rebase
          // waiting to be continued — the stash stays where it is: a pop runs `git reset`, which
          // removes CHERRY_PICK_HEAD and the rest, so putting the index back would quietly clear
          // the state the user has to resolve or abort. Say where the changes are instead. With
          // nothing in flight they go straight back, and a pop that cannot land leaves the stash in
          // the list rather than losing it.
          const after = await window.api.getStatus(repo!).catch(() => null);
          if (after?.operation) throw new Error(`${msg(e)}\nYour staged changes are in the stash "${stashMessage}" until this ${after.operation} is finished or aborted.`);
          await window.api.stashPop(repo!, 0).catch(() => undefined);
          throw e;
        }
        await window.api.stashPop(repo!, 0);
      });
    },
    [repo, run, snapshot, ui],
  );

  const checkoutRef = useCallback(
    (r: GitRef): Promise<void> => {
      if (r.isHead) return Promise.resolve();
      const opts: CheckoutOptions = r.kind === 'tag' ? { detach: true } : r.kind === 'remote' ? { track: true } : {};
      return runCheckout(r.name, () => window.api.checkout(repo!, r.name, opts));
    },
    [repo, runCheckout],
  );

  const createBranchAt = useCallback(
    async (startPoint: string, startLabel: string) => {
      const r = await ui.prompt({ title: 'Create branch', message: `From ${startLabel}`, label: 'Branch name', placeholder: 'feature/name', checkbox: { label: 'Checkout after creating', defaultChecked: true }, okLabel: 'Create' });
      if (r) await run('Creating branch', () => window.api.createBranch(repo!, { name: r.value, startPoint, checkout: r.checked }));
    },
    [repo, run, ui],
  );

  const createTagAt = useCallback(
    async (sha: string) => {
      const r = await ui.prompt({ title: 'Create tag', message: `At commit ${sha.slice(0, 7)}`, label: 'Tag name', placeholder: 'v1.0.0', checkbox: { label: 'Annotated tag (uses the name as message)' }, okLabel: 'Create' });
      if (r) await run('Creating tag', () => window.api.createTag(repo!, { name: r.value, sha, message: r.checked ? r.value : undefined }));
    },
    [repo, run, ui],
  );

  const deleteBranch = useCallback(
    async (r: GitRef) => {
      if (r.kind === 'remote') {
        const [remote, ...rest] = r.name.split('/');
        const branch = rest.join('/');
        if (!(await ui.confirm({ title: `Delete ${r.name}?`, message: `This deletes branch "${branch}" on the remote "${remote}".`, okLabel: 'Delete from remote', danger: true }))) return;
        await run(`Deleting ${r.name}`, () => window.api.deleteRemoteBranch(repo!, remote!, branch));
        return;
      }
      if (!(await ui.confirm({ title: `Delete branch ${r.name}?`, okLabel: 'Delete', danger: true }))) return;
      const wasPinned = r.name === pinned;
      let deleted = false;
      try {
        await run(`Deleting ${r.name}`, () => window.api.deleteBranch(repo!, r.name, false), { rethrow: true });
        deleted = true;
      } catch (e) {
        if (/not fully merged/i.test(msg(e))) {
          if (await ui.confirm({ title: `${r.name} is not fully merged`, message: 'Deleting it will lose the commits that are not reachable from another branch.', okLabel: 'Force delete', danger: true })) {
            try {
              await run(`Deleting ${r.name}`, () => window.api.deleteBranch(repo!, r.name, true), { rethrow: true });
              deleted = true;
            } catch {
              /* the message is already on the status bar */
            }
          }
        }
      }
      // The pin is stored by name, so one left behind by a deleted branch never resolves again
      // and its key outlives the repository's history (GC-021).
      if (deleted && wasPinned) pinBranch(null);
    },
    [pinBranch, pinned, repo, run, ui],
  );

  /**
   * The actions that apply to a commit whichever surface named it: a commit row, or a branch
   * row naming its tip (GC-049). Both menus compose these same items rather than each writing
   * their own, so the wording, the guards and the hard-reset confirmation cannot drift apart.
   * They are handed back individually because the two menus order them differently.
   */
  const tipCommitActions = useCallback(
    (sha: string) => {
      const short = sha.slice(0, 7);
      const target = currentBranch ?? 'HEAD';
      const resetItem = (mode: 'soft' | 'mixed' | 'hard', hint: string): MenuItem => ({
        label: `Reset ${target} to ${short}: ${mode}`,
        hint,
        danger: mode === 'hard',
        onClick: async () => {
          if (mode === 'hard' && !(await ui.confirm({ title: `Hard reset ${target} to ${short}?`, message: 'All uncommitted changes will be lost.', okLabel: 'Reset', danger: true }))) return;
          await run(`Resetting (${mode})`, () => window.api.reset(repo!, mode, sha));
        },
      });
      return {
        cherryPick: { label: 'Cherry pick commit', disabled: !currentBranch, onClick: () => runSequencer('cherry-pick', `Cherry-picking ${short}`, () => window.api.cherryPick(repo!, sha)) } as MenuItem,
        revert: { label: 'Revert commit', disabled: !currentBranch, onClick: () => runSequencer('revert', `Reverting ${short}`, () => window.api.revert(repo!, sha)) } as MenuItem,
        resets: [resetItem('soft', 'keep all changes staged'), resetItem('mixed', 'keep changes in the working directory'), resetItem('hard', 'discard all changes')],
        createTag: { label: 'Create tag here…', onClick: () => createTagAt(sha) } as MenuItem,
        copySha: { label: 'Copy commit sha', onClick: () => void navigator.clipboard.writeText(sha) } as MenuItem,
      };
    },
    [createTagAt, currentBranch, repo, run, runSequencer, ui],
  );

  const refMenuItems = useCallback(
    (r: GitRef): MenuItem[] => {
      const items: MenuItem[] = [];
      const cur = currentBranch ?? 'HEAD';
      const remotes = snapshot?.remotes ?? [];
      const fallback = defaultRemote(remotes);
      if (r.kind === 'tag') {
        items.push({ label: `Checkout ${r.name} (detached)`, onClick: () => checkoutRef(r) });
        items.push({ label: `Create branch from ${r.name}…`, onClick: () => createBranchAt(r.name, `tag ${r.name}`) });
        items.push({ separator: true });
        if (remotes.length > 1) {
          for (const rem of remotes) {
            items.push({ label: `Push tag ${r.name} to ${rem.name}`, onClick: () => run(`Pushing tag ${r.name} to ${rem.name}`, () => window.api.push(repo!, { remote: rem.name, branch: r.name })) });
          }
        } else {
          items.push({ label: `Push tag to remote`, disabled: !fallback, onClick: () => run(`Pushing tag ${r.name}`, () => window.api.push(repo!, { remote: fallback, branch: r.name })) });
        }
        items.push({ label: `Delete tag ${r.name}`, danger: true, onClick: async () => (await ui.confirm({ title: `Delete tag ${r.name}?`, okLabel: 'Delete', danger: true })) && run('Deleting tag', () => window.api.deleteTag(repo!, r.name)) });
        items.push({ separator: true });
        items.push({ label: 'Copy tag name', onClick: () => void navigator.clipboard.writeText(r.name) });
        return items;
      }
      items.push({ label: r.isHead ? `${r.name} is checked out` : `Checkout ${r.name}`, disabled: r.isHead, onClick: () => checkoutRef(r) });
      if (!r.isHead && currentBranch) {
        items.push({ label: `Merge ${r.name} into ${cur}`, onClick: () => runSequencer('merge', `Merging ${r.name}`, () => window.api.merge(repo!, r.name)) });
        items.push({ label: `Rebase ${cur} onto ${r.name}`, onClick: () => runSequencer('rebase', `Rebasing onto ${r.name}`, () => window.api.rebase(repo!, r.name)) });
      }
      items.push({ separator: true });
      items.push({ label: `Create branch from ${r.name}…`, onClick: () => createBranchAt(r.name, r.name) });
      if (r.kind === 'head') {
        // The branch's tip is a commit like any other, and the only way to reset onto it used to
        // be finding that exact row in the graph — impossible once it has scrolled out (GC-049).
        const tip = tipCommitActions(r.sha);
        items.push({ separator: true });
        items.push(tip.cherryPick, tip.revert);
        items.push({ separator: true });
        items.push(...tip.resets);
        items.push({ separator: true });
        items.push(tip.createTag, tip.copySha);
        const isPinned = r.name === pinned;
        items.push({ separator: true });
        items.push({
          label: isPinned ? 'Unpin from Left' : 'Pin to Left',
          hint: isPinned ? 'give column 0 back to the checked-out branch' : 'keep this branch in the leftmost column',
          onClick: () => pinBranch(isPinned ? null : r.name),
        });
        items.push(...visibilityItems(r));
        items.push({ separator: true });
        items.push({
          label: `Rename ${r.name}…`,
          onClick: async () => {
            const res = await ui.prompt({ title: 'Rename branch', label: 'New name', defaultValue: r.name, okLabel: 'Rename' });
            if (!res || res.value === r.name) return;
            try {
              await run('Renaming branch', () => window.api.renameBranch(repo!, r.name, res.value), { rethrow: true });
            } catch {
              return; // the message is already on the status bar, and the old name still stands
            }
            // The pin is stored by name, so without this the graph silently falls back to HEAD
            // in column 0 and the branch has to be pinned again (GC-021).
            if (isPinned) pinBranch(res.value);
          },
        });
        if (remotes.length > 1) {
          // MenuItem has no submenu, so the remotes become their own separated group (GC-031)
          items.push({ separator: true });
          for (const rem of remotes) {
            items.push({
              label: `Push ${r.name} to ${rem.name}`,
              hint: r.upstream ? undefined : 'sets the upstream',
              onClick: () => run(`Pushing ${r.name} to ${rem.name}`, () => window.api.push(repo!, { remote: rem.name, branch: r.name, setUpstream: !r.upstream })),
            });
          }
        } else {
          items.push({
            label: `Push ${r.name}${r.upstream ? ` to ${r.upstream}` : ' and set upstream'}`,
            disabled: !fallback,
            onClick: () => run(`Pushing ${r.name}`, () => window.api.push(repo!, { branch: r.name, setUpstream: !r.upstream })),
          });
        }
      }
      if (r.kind === 'remote') {
        items.push({ separator: true });
        items.push(...visibilityItems(r));
      }
      items.push({ separator: true });
      items.push({ label: `Delete ${r.name}`, danger: true, disabled: r.isHead, onClick: () => deleteBranch(r) });
      items.push({ separator: true });
      items.push({ label: 'Copy branch name', onClick: () => void navigator.clipboard.writeText(r.name) });
      return items;
    },
    [checkoutRef, createBranchAt, currentBranch, deleteBranch, pinBranch, pinned, repo, run, runSequencer, snapshot, ui, visibilityItems],
  );

  const commitMenuItems = useCallback(
    (c: Commit): MenuItem[] => {
      const short = c.sha.slice(0, 7);
      const target = currentBranch ?? 'HEAD';
      const resetItem = (mode: 'soft' | 'mixed' | 'hard', hint: string): MenuItem => ({
        label: `Reset ${target} to ${short}: ${mode}`,
        hint,
        danger: mode === 'hard',
        onClick: async () => {
          if (mode === 'hard' && !(await ui.confirm({ title: `Hard reset ${target} to ${short}?`, message: 'All uncommitted changes will be lost.', okLabel: 'Reset', danger: true }))) return;
          await run(`Resetting (${mode})`, () => window.api.reset(repo!, mode, c.sha));
        },
      });
      return [
        { label: 'Checkout this commit (detached)', onClick: () => runCheckout(short, () => window.api.checkout(repo!, c.sha, { detach: true })) },
        { separator: true },
        { label: 'Create branch here…', onClick: () => createBranchAt(c.sha, `commit ${short}`) },
        { label: 'Create tag here…', onClick: () => createTagAt(c.sha) },
        { separator: true },
        { label: 'Cherry pick commit', disabled: !currentBranch, onClick: () => runSequencer('cherry-pick', `Cherry-picking ${short}`, () => window.api.cherryPick(repo!, c.sha)) },
        { label: 'Revert commit', disabled: !currentBranch, onClick: () => runSequencer('revert', `Reverting ${short}`, () => window.api.revert(repo!, c.sha)) },
        { separator: true },
        resetItem('soft', 'keep all changes staged'),
        resetItem('mixed', 'keep changes in the working directory'),
        resetItem('hard', 'discard all changes'),
        { separator: true },
        { label: 'Copy commit sha', onClick: () => void navigator.clipboard.writeText(c.sha) },
        { label: 'Copy commit summary', onClick: () => void navigator.clipboard.writeText(c.summary) },
      ];
    },
    [createBranchAt, createTagAt, currentBranch, repo, run, runCheckout, runSequencer, ui],
  );

  const stashChanges = useCallback(async () => {
    const r = await ui.prompt({ title: 'Stash changes', label: 'Message (optional)', required: false, placeholder: 'WIP on ' + (currentBranch ?? 'HEAD'), checkbox: { label: 'Include untracked files', defaultChecked: true }, okLabel: 'Stash' });
    if (r) await run('Stashing', () => window.api.stashSave(repo!, { message: r.value, includeUntracked: r.checked }));
  }, [currentBranch, repo, run, ui]);

  const stashMenuItems = useCallback(
    (s: Stash): MenuItem[] => [
      { label: 'Apply stash', onClick: () => run('Applying stash', () => window.api.stashApply(repo!, s.index)) },
      { label: 'Pop stash', hint: 'apply and drop', onClick: () => run('Popping stash', () => window.api.stashPop(repo!, s.index)) },
      { separator: true },
      { label: 'Drop stash', danger: true, onClick: async () => (await ui.confirm({ title: 'Drop this stash?', message: s.message, okLabel: 'Drop', danger: true })) && run('Dropping stash', () => window.api.stashDrop(repo!, s.index)) },
    ],
    [repo, run, ui],
  );

  const wipMenuItems = useCallback(
    (): MenuItem[] => {
      const entries = snapshot?.status.entries ?? [];
      return [
        { label: 'Stage all changes', disabled: entries.length === 0, onClick: () => actions.stageAll().catch(() => undefined) },
        { label: 'Unstage all changes', disabled: !entries.some((e) => e.staged), onClick: () => actions.unstageAll().catch(() => undefined) },
        { separator: true },
        { label: 'Stash changes…', disabled: entries.length === 0, onClick: stashChanges },
        { separator: true },
        {
          label: 'Discard all changes',
          danger: true,
          disabled: entries.length === 0,
          onClick: async () => (await ui.confirm({ title: 'Discard all uncommitted changes?', message: 'Untracked files will be deleted. This cannot be undone.', okLabel: 'Discard everything', danger: true })) && actions.discard(entries).catch(() => undefined),
        },
      ];
    },
    [actions, snapshot, stashChanges, ui],
  );

  // Handing a file to the OS is the one menu action that never touches git, so it does not go
  // through `run()`: there is nothing to reload afterwards and a refusal only has to reach the
  // status bar the way every other error does (GC-043).
  const inShell = useCallback((fn: () => Promise<void>) => void fn().catch((e: unknown) => setError(msg(e))), []);

  // Writing the pattern is an action like any other, so it goes through `run()`: the status
  // refreshes, the row leaves Unstaged and .gitignore itself turns up as the change (GC-093).
  const ignoreFile = useCallback(
    (path: string, kind: IgnoreKind): Promise<void> => run(`Ignoring ${path}`, () => window.api.ignore(repo!, { path, kind })),
    [repo, run],
  );

  const fileMenuItems = useCallback(
    (t: FileMenuTarget): MenuItem[] => {
      const path = t.source === 'wip' ? t.entry.path : t.file.path;
      const items: MenuItem[] = [];
      if (t.source === 'wip') {
        const e = t.entry;
        if (t.group === 'staged') items.push({ label: 'Unstage file', onClick: () => actions.unstage([path]).catch(() => undefined) });
        else items.push({ label: t.group === 'conflicted' ? 'Mark resolved' : 'Stage file', hint: t.group === 'conflicted' ? 'stage the resolved file' : undefined, onClick: () => actions.stage([path]).catch(() => undefined) });
        // Discarding is offered exactly where the row's ✕ button is, and for the same reason: it
        // throws the working-tree change away, so a staged-only row has nothing for it to take and
        // a conflicted one has to be resolved or the whole operation aborted instead. The action
        // that does not apply is left out rather than shown disabled, as in the ref menus (GC-043).
        if (t.group === 'unstaged') {
          items.push({
            label: e.unstaged === 'untracked' ? 'Delete file' : 'Discard changes',
            danger: true,
            onClick: async () => (await ui.confirm(discardFileConfirm(e))) && actions.discard([e]).catch(() => undefined),
          });
        }
        // Ignoring is offered on an untracked row and nowhere else: a tracked file is already in
        // the index, where .gitignore has no say, so the entry would look like it did something
        // and change nothing (GC-093). The two generalising rows are absent when they have nothing
        // to say — a name with no extension, a file at the repository root.
        if (t.group === 'unstaged' && e.unstaged === 'untracked') {
          const dot = path.split('/').pop()?.lastIndexOf('.') ?? -1;
          const folder = path.split('/').slice(0, -1).join('/');
          items.push({ separator: true });
          // The hints are bare paths, without the leading `/` and trailing `/` the patterns
          // themselves carry: `.ctx-hint.path` ellipsises at the start by turning the box RTL, and
          // a slash at either end of the string is a neutral character, so it is reordered to the
          // opposite end — `/build/out/x.log` read as `build/out/x.log/` on screen (GC-067).
          items.push({ label: 'Ignore file', hint: path, hintPath: true, onClick: () => void ignoreFile(path, 'file') });
          if (dot > 0) items.push({ label: `Ignore all *${path.slice(path.lastIndexOf('.'))} files`, onClick: () => void ignoreFile(path, 'extension') });
          if (folder) items.push({ label: 'Ignore this folder', hint: folder, hintPath: true, onClick: () => void ignoreFile(path, 'folder') });
        }
        items.push({ separator: true });
      }
      // Both shell actions go through `repoFile()`, which refuses a path that is not in the
      // working tree, so on a row whose file is gone neither of them can do anything but put an
      // error in the status bar. They are disabled together rather than one of them being left
      // offered as the only item that always fails (GC-072).
      const gone = t.source === 'commit' ? t.file.kind === 'deleted' : deletedFromTree(t.entry);
      items.push({
        label: 'Open file',
        disabled: gone,
        onClick: () => inShell(() => window.shell.openFile(repo!, path)),
      });
      items.push({ label: 'Show in folder', disabled: gone, onClick: () => inShell(() => window.shell.showInFolder(repo!, path)) });
      items.push({ separator: true });
      items.push({ label: 'Copy file path', hint: 'relative to the repository', onClick: () => void navigator.clipboard.writeText(path) });
      return items;
    },
    [actions, ignoreFile, inShell, repo, ui],
  );

  const addRemote = useCallback(async () => {
    const r = await ui.prompt({ title: 'Add remote', label: 'Remote name', placeholder: 'upstream', okLabel: 'Next' });
    if (!r || !r.value.trim()) return;
    const name = r.value.trim();
    const u = await ui.prompt({ title: `Add remote ${name}`, label: 'URL', placeholder: 'https://github.com/owner/repo.git', okLabel: 'Add' });
    if (!u || !u.value.trim()) return;
    await run(`Adding remote ${name}`, () => window.api.remoteAdd(repo!, name, u.value.trim()));
  }, [repo, run, ui]);

  const remoteMenuItems = useCallback(
    (rem: Remote): MenuItem[] => [
      { label: `Fetch ${rem.name}`, onClick: () => run(`Fetching ${rem.name}`, () => window.api.fetch(repo!, rem.name)) },
      { separator: true },
      {
        label: 'Edit URL…',
        onClick: async () => {
          const r = await ui.prompt({ title: `Edit ${rem.name}`, label: 'URL', defaultValue: rem.fetchUrl, okLabel: 'Save' });
          if (r && r.value.trim() && r.value.trim() !== rem.fetchUrl) await run(`Updating ${rem.name}`, () => window.api.remoteSetUrl(repo!, rem.name, r.value.trim()));
        },
      },
      {
        label: 'Rename…',
        onClick: async () => {
          const r = await ui.prompt({ title: 'Rename remote', label: 'New name', defaultValue: rem.name, okLabel: 'Rename' });
          if (r && r.value.trim() && r.value.trim() !== rem.name) await run(`Renaming ${rem.name}`, () => window.api.remoteRename(repo!, rem.name, r.value.trim()));
        },
      },
      {
        label: `Remove ${rem.name}`,
        danger: true,
        onClick: async () => {
          if (!(await ui.confirm({ title: `Remove remote ${rem.name}?`, message: 'Its remote-tracking branches are deleted locally. The remote repository is untouched.', okLabel: 'Remove', danger: true }))) return;
          await run(`Removing ${rem.name}`, () => window.api.remoteRemove(repo!, rem.name));
        },
      },
      { separator: true },
      { label: 'Copy remote URL', onClick: () => void navigator.clipboard.writeText(rem.fetchUrl) },
    ],
    [repo, run, ui],
  );

  const onMenu = useCallback((e: MouseEvent, items: MenuItem[]) => ui.openMenu(e, items), [ui]);

  // The repository breadcrumb and the title bar's `+` both open this list (GC-044). It is the
  // ordinary context menu, anchored by the caller at the bottom-left corner of whatever was
  // clicked rather than at the pointer, so it reads as a dropdown hanging off that control.
  const openRepoMenu = useCallback(
    (at: { clientX: number; clientY: number }) => {
      const items: MenuItem[] = [];
      if (recents.length) {
        // The list is captioned the way the empty state's copy of it is, so the paths below read
        // as history rather than as one more command (GC-067).
        items.push({ label: 'Recently opened', caption: true });
        for (const p of recents) {
          items.push({
            label: folderName(p),
            hint: p,
            hintPath: true,
            disabled: repoPath !== null && normRepoPath(p) === normRepoPath(repoPath),
            onClick: () => void openPath(p),
          });
        }
        items.push({ separator: true });
      }
      items.push({ label: 'Open repository…', onClick: () => void openRepo() });
      ui.openMenu(at, items);
    },
    [openPath, openRepo, recents, repoPath, ui],
  );

  // The branch crumb's dropdown: the quickest way to switch branches without hunting for the row
  // in the left panel or the chip in the graph (GC-088). Rows are the branch names themselves, so
  // the checked-out one is marked with the same check the left panel puts on its row rather than
  // reworded, and every selection goes through `checkoutRef` — the dirty-tree guard, the stash
  // offer and the tracking-branch path all come with it.
  const openBranchMenu = useCallback(
    (at: MenuAnchor) => {
      const refs = snapshot?.refs ?? [];
      const row = (r: GitRef): MenuItem => ({
        label: r.isHead ? `✓ ${r.name}` : r.name,
        hint: aheadBehind(r) ?? r.sha.slice(0, 7),
        disabled: r.isHead,
        onClick: () => void checkoutRef(r),
      });
      const items: MenuItem[] = [];
      const locals = refs.filter((r) => r.kind === 'head');
      const remotes = refs.filter((r) => r.kind === 'remote');
      if (locals.length) {
        items.push({ label: 'Local', caption: true });
        for (const r of locals) items.push(row(r));
      }
      if (remotes.length) {
        if (locals.length) items.push({ separator: true });
        items.push({ label: 'Remote', caption: true });
        for (const r of remotes) items.push(row(r));
      }
      if (!items.length) items.push({ label: 'No branches yet', disabled: true });
      ui.openMenu(at, items);
    },
    [checkoutRef, snapshot, ui],
  );

  // ---- keyboard ----------------------------------------------------------------------
  // Every layer on top of the app is closed here and nowhere else: the shortcuts overlay,
  // Preferences, the prompt/confirm modal, the context menu and the toolbar's Pull popover
  // (whose open flag lives here for exactly that reason). Escape closes the topmost one and
  // nothing else, which is why no layer handles Escape itself. The listener runs in the capture
  // phase so that when it does close a layer it can stop the event before any React handler
  // underneath sees it — the find bar's input closes itself on Escape otherwise.
  const layerOpen = shortcutsOpen || prefsOpen || ui.dialogOpen || ui.menuOpen || pullOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // The topmost layer owns the keyboard while it is up: it closes on Escape (and the overlay
      // also on `?`), and every other window-level shortcut is swallowed so the graph does not
      // move and the diff does not close behind it. Keys still reach the focused element, which
      // is what lets a modal's own input and its Enter handler keep working.
      if (layerOpen) {
        if (matches('dialogCancel', e) || (shortcutsOpen && matches('help', e))) {
          e.preventDefault();
          e.stopPropagation();
          if (shortcutsOpen) setShortcutsOpen(false);
          else if (prefsOpen) setPrefsOpen(false);
          else if (ui.dialogOpen) ui.closeDialog();
          else if (ui.menuOpen) ui.closeMenu();
          else setPullOpen(false);
        }
        return;
      }
      // Ctrl+F works from anywhere, including the commit message field
      if (matches('openSearch', e)) {
        if (!snapshot) return;
        e.preventDefault();
        setFileView(null);
        openSearch();
        return;
      }
      if (isEditable(e.target)) return;
      if (matches('help', e)) {
        setShortcutsOpen(true);
        return;
      }
      if (matches('escape', e)) {
        // With a diff open the search bar is hidden behind it, so Escape closes the diff first
        // and the query survives to the graph underneath (GC-030).
        if (fileView) setFileView(null);
        else if (search.open) closeSearch();
        return;
      }
      if (!snapshot) return;
      const dir = matches('selectNext', e) ? 1 : matches('selectPrev', e) ? -1 : 0;
      if (dir === 0) return;
      e.preventDefault();
      const order = [WIP, ...snapshot.commits.map((c) => c.sha)];
      const i = selected ? order.indexOf(selected) : -1;
      const next = dir === 1 ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1);
      const sha = order[next];
      if (sha !== undefined) setSelected(sha);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [snapshot, selected, search.open, fileView, openSearch, closeSearch, layerOpen, shortcutsOpen, prefsOpen, ui]);

  return (
    <div
      className={`app ${leftW.resizing || detailW.resizing ? 'resizing' : ''}`}
      style={{ '--left-panel-w': `${leftW.width}px`, '--detail-panel-w': `${detailW.width}px` } as CSSProperties}
    >
      <TitleBar repoName={snapshot?.info.name ?? null} onOpenRepo={openRepo} onRepoMenu={openRepoMenu} />
      <Toolbar
        info={snapshot?.info ?? null}
        busy={busy !== null}
        ahead={snapshot?.status.ahead ?? 0}
        behind={snapshot?.status.behind ?? 0}
        hasUpstream={!!headRef?.upstream}
        hasRemotes={(snapshot?.remotes.length ?? 0) > 0}
        pushRemote={defaultRemote(snapshot?.remotes ?? []) ?? null}
        hasChanges={(snapshot?.status.entries.length ?? 0) > 0}
        stashCount={snapshot?.stashes.length ?? 0}
        pullMode={prefs.pullMode}
        pullOpen={pullOpen}
        onPullModeChange={(mode) => setPrefs({ pullMode: mode })}
        onPullOpenChange={setPullOpen}
        onFetch={() => void run('Fetching', () => window.api.fetch(repo!))}
        onPull={(mode) => void run('Pulling', () => window.api.pull(repo!, mode))}
        onOpenPreferences={() => setPrefsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onRepoMenu={openRepoMenu}
        onBranchMenu={openBranchMenu}
        onPush={() => void run('Pushing', () => window.api.push(repo!, { setUpstream: !headRef?.upstream }))}
        onCreateBranch={() => void createBranchAt('HEAD', currentBranch ?? 'HEAD')}
        onStash={() => void stashChanges()}
        onPop={() => void run('Popping stash', () => window.api.stashPop(repo!, 0))}
        onRefresh={() => void run('Refreshing', async () => undefined)}
        searchOpen={search.open}
        onSearch={() => {
          // While a diff is open the bar is hidden behind it: bring the graph back and refocus
          // the field rather than closing a search the user cannot see (GC-030).
          if (fileView) {
            setFileView(null);
            openSearch();
          } else if (search.open) closeSearch();
          else openSearch();
        }}
      />
      <div className="main">
        {snapshot && repo ? (
          <>
            <LeftPanel
              refs={snapshot.refs}
              stashes={snapshot.stashes}
              remotes={snapshot.remotes}
              pinnedName={pinnedRef?.name ?? null}
              hidden={hidden}
              onToggleHidden={toggleHidden}
              onShowAll={showAll}
              collapsed={leftCollapsed || fileView !== null}
              resize={leftW.handle}
              onExpand={() => (fileView ? setFileView(null) : setLeftCollapsed(false))}
              onCollapse={() => setLeftCollapsed(true)}
              onRefMenu={(e, r) => onMenu(e, refMenuItems(r))}
              onRefActivate={(r) => void checkoutRef(r)}
              onStashMenu={(e, s) => onMenu(e, stashMenuItems(s))}
              onStashActivate={(s) => void run('Applying stash', () => window.api.stashApply(repo, s.index))}
              onRemoteMenu={(e, rem) => onMenu(e, remoteMenuItems(rem))}
              onAddRemote={() => void addRemote()}
            />
            {fileView ? (
              <DiffView
                repo={repo}
                view={fileView}
                version={workdirVersion}
                onClose={() => setFileView(null)}
                onStageFile={(p) => actions.stage([p])}
                onUnstageFile={(p) => actions.unstage([p])}
                onDiscardFile={(p, untracked) => actions.discard([{ path: p, staged: null, unstaged: untracked ? 'untracked' : 'modified' }])}
                onApplyPatch={applyPatch}
              />
            ) : (
              <CommitGraph
                commits={commits}
                refs={visibleRefs}
                status={snapshot.status}
                headSha={snapshot.info.headSha}
                pinnedSha={pinnedRef?.sha ?? null}
                pinnedName={pinnedRef?.name ?? null}
                selected={selected}
                searchOpen={search.open}
                searchTick={search.tick}
                searchQuery={search.query}
                onSearchQuery={setSearchQuery}
                onCloseSearch={closeSearch}
                onSelect={select}
                onCommitMenu={(e, c) => onMenu(e, commitMenuItems(c))}
                onWipMenu={(e) => onMenu(e, wipMenuItems())}
                onRefMenu={(e, r) => onMenu(e, refMenuItems(r))}
                onRefActivate={(r) => void checkoutRef(r)}
                detached={!snapshot.info.branch}
                hasMore={hasMore}
                loadingMore={loadingMore}
                onLoadMore={askForMore}
              />
            )}
            <DetailPanel
              repo={repo}
              commit={selectedCommit}
              headCommit={headCommit}
              status={snapshot.status}
              openFile={fileView}
              actions={actions}
              resize={detailW.handle}
              onSelectSha={select}
              onOpenFile={setFileView}
              onFileMenu={(e, t) => onMenu(e, fileMenuItems(t))}
            />
          </>
        ) : (
          <div className="graph-panel">
            <div className="graph-empty">
              <div>
                <div style={{ fontSize: 'var(--fs-xl)', color: 'var(--text)' }}>GitClient</div>
                {/* With no git there is nothing to open, so name the cause here instead of the prompt (GC-025). */}
                {gitError ? <div style={{ color: 'var(--danger)' }}>{gitError}</div> : <div>Open a repository to see its commit graph.</div>}
                {error && error !== gitError && <div style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
                {/* The same list the breadcrumb menu offers, so a second repository is one click
                    away from the empty state too (GC-044). */}
                {recents.length > 0 && (
                  <div className="recent-list">
                    <div className="recent-caption">Recently opened</div>
                    {recents.map((p) => (
                      <button key={p} className="recent-row" title={p} onClick={() => void openPath(p)}>
                        <span className="recent-name">{folderName(p)}</span>
                        <span className="recent-path">{p}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="primary">
                  <button className="btn primary large" onClick={openRepo}>
                    Open repository…
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <StatusBar repoPath={repoPath} commitCount={commits.length} busy={busy} generation={dataGen} error={error} onDismissError={() => setError(null)} />
      {prefsOpen && <Preferences onClose={() => setPrefsOpen(false)} />}
      {shortcutsOpen && <Shortcuts onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
