import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type JSX, type MouseEvent } from 'react';
import type { CheckoutOptions, Commit, GitRef, IgnoreKind, Remote, RepoChange, RepoSnapshot, Stash, StatusEntry } from '@shared/types';
import { ADVISORY } from '@shared/types';
import { defaultRemote, remoteCopyOf } from '@shared/remotes';
import { fitPanels, useDragWidth, useWindowWidth, MIN_GRAPH_W, type OptCols, type PanelFit } from './ui/useDragWidth';
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
import { firesWhileTyping, matches, type ShortcutId } from './shortcuts';
import { useUi } from './ui/UiContext';
import type { MenuItem } from './ui/ContextMenu';
import type { MenuAnchor } from './ui/UiContext';
import { canDropRef, type RefDragHandlers } from './ui/refDrag';
import { cycle, makeTabs, neighbourOf, readTabs, TABS_KEY, type Tab } from './tabs';

/** Which tab was showing when the app was last closed, so a restart comes back to it. */
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
// Both side panels' ranges, and the 44px the left panel occupies once it is an icon rail. They
// are named because GC-105 needs them in three places: the two hooks, the drag limits each one
// imposes on the other, and the fit that decides what is actually applied.
const LEFT_DEF = 220;
const LEFT_MIN = 160;
const LEFT_MAX = 420;
const DETAIL_DEF = 400;
const DETAIL_MIN = 300;
const DETAIL_MAX = 720;
const RAIL_W = 44;
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

/**
 * What a tab that is not showing keeps (GC-016). Everything here is about one repository, so it is
 * parked when the tab is left and put back when it returns — which is what makes a switch instant
 * and what preserves the selection and the scroll position the tab was left at.
 *
 * `workdirVersion` is deliberately not in it: it is a monotonic counter the diff reads as "the
 * content you loaded is older than this", and handing it back a smaller number than it has already
 * seen would be a lie about which way time ran.
 */
interface TabState {
  snapshot: RepoSnapshot | null;
  selected: string | null;
  fileView: FileViewSource | null;
  hidden: string[];
  paged: { path: string; loaded: number };
  hasMore: boolean;
  search: { open: boolean; tick: number; query: string };
  graphTop: number;
  draft: CommitDraft;
}

/**
 * The staging form's contents (GC-148). It lives here rather than in `StagingView` for the reason
 * the find bar's query does (GC-030): the component unmounts — behind a file view, and on every
 * tab switch, since `DetailPanel` is keyed by repository — and the user's own typing has to
 * outlive it. Being part of `TabState` is what parks it with the tab instead of dropping it.
 */
export interface CommitDraft {
  summary: string;
  body: string;
  amend: boolean;
}

const EMPTY_DRAFT: CommitDraft = { summary: '', body: '', amend: false };

/** The tabs to start with: the stored list, or the one remembered repository for a profile that predates them. */
const initialTabs = (): Tab[] => {
  try {
    const stored = readTabs(localStorage.getItem(TABS_KEY));
    if (stored.length > 0) return makeTabs(stored);
    const last = localStorage.getItem(LAST_REPO_KEY);
    return last ? makeTabs([last]) : [];
  } catch {
    return [];
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
    .replace(new RegExp(`^(${ADVISORY}|GitError|Error): `), '')
    .trim();
/**
 * Whether the main process marked this failure advisory (GC-091): the action did most of what was
 * asked and the line to show is not a failure. The flag rides on the error's name, which is all
 * that survives Electron's serialisation of a rejected handler — the same name `msg` strips off.
 */
const isAdvisory = (e: unknown): boolean => new RegExp(`(^|: )${ADVISORY}: `).test(e instanceof Error ? e.message : String(e));

export function App(): JSX.Element {
  const ui = useUi();
  const prefs = usePrefs();
  // The open repositories, and which one is showing (GC-016). The tab is the identity: `repoPath`
  // below is what that tab has actually loaded, which is null while it is loading and stays null
  // if it fails, so the two cannot be collapsed into one.
  const [tabs, setTabs] = useState<Tab[]>(initialTabs);
  const [activeId, setActiveId] = useState<number | null>(() => {
    const last = ((): string | null => {
      try {
        return localStorage.getItem(LAST_REPO_KEY);
      } catch {
        return null;
      }
    })();
    const showing = last === null ? undefined : tabs.find((t) => normRepoPath(t.path) === normRepoPath(last));
    return (showing ?? tabs[0])?.id ?? null;
  });
  /** Ids are never reused within a session, so a tab closed while its load is in flight cannot be hit by it. */
  const nextTabId = useRef(tabs.length + 1);
  /** What each tab that is not showing was left with, keyed by tab id (GC-016). */
  const parked = useRef(new Map<number, TabState>());
  const [repoPath, setRepoPath] = useState<string | null>(() => tabs.find((t) => t.id === activeId)?.path ?? null);
  const [recents, setRecents] = useState<string[]>(readRecents);
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(WIP);
  const [fileView, setFileView] = useState<FileViewSource | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // The detail panel hides entirely rather than becoming a rail: it has no icons to keep, and the
  // graph is what the width is wanted for (GC-033). Any selection brings it back, in `select`.
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  // Ticks, not booleans: asking for the same field twice in a row must focus it twice, and this is
  // the shape the find bar's own `searchTick` already uses (GC-033).
  const [focusFilter, setFocusFilter] = useState(0);
  const [focusSummary, setFocusSummary] = useState(0);
  // Both side panels are draggable (GC-050); the widths are remembered state on their own keys,
  // the way the ref column's is, and reach the panels as CSS variables on the app root. Each is
  // also bounded by the window they sit in rather than by its own range alone (GC-105): `limit` is
  // as far as a drag may go given the other panel, and `applied` below is what actually reaches the
  // CSS variables. The two limits refer to each other, so each reads the other's width from a cache
  // written at the end of this block rather than from a hook declared after it — only one panel is
  // ever being dragged, so the other's width is steady and a single render's lag is invisible.
  //
  // What that cache holds is the width the other panel is being **drawn** at — `fitPanels`' answer
  // — and not the number stored for it (GC-111). On any window narrow enough for the fit to be
  // reducing something, the stored number is the larger of the two, so a limit taken from it came
  // out below the panel's own `min` and the drag had nowhere left to go at all.
  const winW = useWindowWidth();
  const leftIsRail = leftCollapsed || fileView !== null;
  const panelW = useRef<PanelFit>({ left: LEFT_DEF, detail: DETAIL_DEF });
  const leftW = useDragWidth({
    key: 'gitclient.leftPanelW',
    def: LEFT_DEF,
    min: LEFT_MIN,
    max: LEFT_MAX,
    limit: winW - panelW.current.detail - MIN_GRAPH_W,
  });
  const detailW = useDragWidth({
    key: 'gitclient.detailPanelW',
    def: DETAIL_DEF,
    min: DETAIL_MIN,
    max: DETAIL_MAX,
    dir: -1,
    limit: winW - (leftIsRail ? RAIL_W : panelW.current.left) - MIN_GRAPH_W,
  });
  // A rail is a fixed 44px that ignores `--left-panel-w`, so at that point only the detail panel
  // has anything to give: it is passed in as a zero-width panel with a zero floor. A detail panel
  // hidden with Ctrl+K is not drawn at all, so it goes in the same way (GC-033) — the graph then
  // has the whole window and the fit has nothing left to reduce.
  const applied = fitPanels(
    leftIsRail ? 0 : leftW.width,
    detailCollapsed ? 0 : detailW.width,
    winW - (leftIsRail ? RAIL_W : 0),
    { left: leftIsRail ? 0 : LEFT_MIN, detail: detailCollapsed ? 0 : DETAIL_MIN },
  );
  panelW.current = applied;
  const [workdirVersion, setWorkdirVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); // label of the running operation
  const [error, setError] = useState<string | null>(null);
  /**
   * The other thing an action can have to say (GC-091): it did most of what was asked, and this is
   * what is left to tell. One slot, one severity each, and an error always wins — `run()` clears both
   * on entry and sets at most one on the way out, so the two can never be on screen together.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null); // git itself is missing (GC-025)
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Which optional graph columns are actually drawn, as `CommitGraph` computed them (GC-117). Held
  // here only to reach Preferences, and compared field by field before it is stored so a graph
  // re-rendering for any other reason does not turn into a render of the whole app.
  const [drawnCols, setDrawnCols] = useState<OptCols | null>(null);
  const onDrawnCols = useCallback(
    (c: OptCols) => setDrawnCols((prev) => (prev && prev.author === c.author && prev.date === c.date && prev.sha === c.sha ? prev : c)),
    [],
  );
  // The two toolbar popovers are one piece of state, not two flags (GC-119). They were kept
  // mutually exclusive only by the outside-click listener in `Toolbar`, and a `<button>` activated
  // from the keyboard fires `click` with no `mousedown` at all, so opening one with Enter while the
  // other was up left both open and overlapping — and then took two Escapes, because the ladder
  // below closes one layer per press. Which one is open is a single answer, so it is a single
  // value, and both open is not a state that can be reached however the button was activated.
  const [popover, setPopover] = useState<'pull' | 'push' | null>(null); // the second one is GC-057
  const pullOpen = popover === 'pull';
  const pushOpen = popover === 'push';
  // A close only closes the popover it names, so `Toolbar`'s outside-click listener — which asks
  // each popover separately whether the click missed it — cannot close the one that was clicked in.
  const setPullOpen = useCallback((open: boolean): void => setPopover((cur) => (open ? 'pull' : cur === 'pull' ? null : cur)), []);
  const setPushOpen = useCallback((open: boolean): void => setPopover((cur) => (open ? 'push' : cur === 'push' ? null : cur)), []);
  const [pinned, setPinned] = useState<string | null>(null); // branch name pinned to column 0
  // The branch being dragged, and where it came from is irrelevant: a chip and a left-panel row
  // stand for the same ref, so the state that both surfaces read lives here (GC-015).
  const [dragRef, setDragRef] = useState<GitRef | null>(null);
  // Refs kept out of the graph (GC-073). The ref mirrors the state because `load()` needs the set
  // as it stands at the moment it spawns `git log`, without every callback that loads a repository
  // having to be rebuilt each time the set changes.
  const [hidden, setHidden] = useState<string[]>([]);
  const hiddenRef = useRef<string[]>([]);
  // How much of which repository's log is loaded, and whether the traversal had more behind it
  // (GC-012). The depth is a ref because every load reads it as it stands at the moment it spawns
  // `git log`, the way the hidden set above does.
  const paged = useRef<{ path: string; loaded: number }>({ path: '', loaded: 0 });
  /**
   * Where the graph is scrolled to, reported by `CommitGraph` on every scroll (GC-016). A ref
   * rather than state: nothing on screen is derived from it, so a wheel event has no business
   * re-rendering the app, and the graph reads it back only when it mounts.
   */
  const graphTop = useRef(0);
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

  // The staging form's contents, held here so they survive the panel unmounting and are parked
  // with the tab they were written in (GC-148).
  const [draft, setDraft] = useState<CommitDraft>(EMPTY_DRAFT);

  // What the showing tab would be parked with, mirrored into a ref on every render — the shape
  // `panelW` above already uses. Keeping it here rather than in the switch callback's closure is
  // what stops that callback from being rebuilt on every keystroke in the find bar (GC-016).
  const live = useRef<TabState>({ snapshot, selected, fileView, hidden, paged: paged.current, hasMore, search, graphTop: graphTop.current, draft });
  live.current = { snapshot, selected, fileView, hidden, paged: paged.current, hasMore, search, graphTop: graphTop.current, draft };

  // The recents list is state here and one JSON blob in localStorage; writing it from an effect
  // keeps the updaters below pure (GC-044).
  useEffect(() => {
    try {
      localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(recents));
    } catch {
      /* ignore */
    }
  }, [recents]);

  // The tab list is remembered state on its own key, the way every other remembered value is, and
  // it holds paths only: the ids are handed out afresh on each start (GC-016).
  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(tabs.map((t) => t.path)));
    } catch {
      /* ignore */
    }
  }, [tabs]);

  /** The repository the showing tab stands for, which is not `repoPath` until its load has landed. */
  const activePath = tabs.find((t) => t.id === activeId)?.path ?? null;

  // What a restart reopens is the tab that was showing, so it follows the tab rather than the load
  // (GC-016): a tab whose load failed keeps its place, which is what GC-025 wanted the remembered
  // path for. With no tab left there is nothing to come back to.
  useEffect(() => {
    try {
      if (activePath === null) localStorage.removeItem(LAST_REPO_KEY);
      else localStorage.setItem(LAST_REPO_KEY, activePath);
    } catch {
      /* ignore */
    }
  }, [activePath]);

  // git hands back the canonical path — a dialog answers `c:\repo` and `rev-parse` calls it
  // `C:/repo` — so the tab adopts the form the load came back with. Only that: the two must be the
  // same repository, or a tab shown before its first load has landed would take the *previous*
  // tab's path, and keep it if that load then failed. A tab that is genuinely being pointed at
  // another repository is retargeted by `openPath` itself (GC-016).
  useEffect(() => {
    if (repoPath === null) return;
    setTabs((prev) =>
      prev.map((t) => (t.id === activeId && t.path !== repoPath && normRepoPath(t.path) === normRepoPath(repoPath) ? { ...t, path: repoPath } : t)),
    );
  }, [repoPath, activeId]);

  // Nothing tied a git result to the moment it was asked for, so a slow background load could
  // resolve after a user action had already reloaded and replace the fresh snapshot with the one
  // it captured before the click — a staged file showing as unstaged until the next watcher event
  // (GC-068). Every read below captures this counter when it starts and drops its result if it has
  // moved on by the time git answers; `run()` bumps it, so a user action always invalidates the
  // background work already in flight. Dropping is silent: whatever superseded it is already on
  // screen, so there is nothing to report and no spinner to clear.
  const generation = useRef(0);
  /** Which `run()` call owns the status bar: the counterpart of `generation`, for the writes (GC-084). */
  const busyToken = useRef(0);
  /**
   * Take the status bar for one piece of work, answering whether that work still owns it. `run()`
   * has taken a token since GC-084; the two "Loading repository" paths outside it — the mount
   * effect and `openPath()` — did not, so opening a repository from the recents dropdown while an
   * action was still running cleared the spinner the action had put up (GC-108). Whichever started
   * last owns the bar, and only the owner may take it down.
   */
  const takeBusy = useCallback((label: string): (() => boolean) => {
    const token = (busyToken.current += 1);
    setBusy(label);
    return () => busyToken.current === token;
  }, []);

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
        // `gitclient.lastRepo` and the showing tab's own path follow `repoPath` from one effect
        // below, so that a tab switch that restores a parked snapshot without calling `load()`
        // remembers itself too (GC-016).
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
      const owns = takeBusy('Loading repository');
      setError(null);
      void load(repoPath).finally(() => {
        if (owns()) setBusy(null);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Replace the snapshot for `path`, keeping what is on screen if it fails. The two callers are
   * refreshes nobody asked for — the watcher's, and the one a tab takes when it comes back to the
   * front (GC-016) — and `load()`'s failure path clears the open repository (GC-025), which is not
   * what either of them means.
   */
  const reloadSnapshot = useCallback(
    async (path: string) => {
      const gen = generation.current;
      // As deep as what is on screen, or a refresh nobody asked for would drop the pages the
      // user scrolled to load (GC-012).
      const want = pageDepth(paged.current, path);
      try {
        const snap = await window.api.loadRepo(path, want, hiddenRef.current);
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
    [bumpGen],
  );

  /** Load `path` into the showing tab: the folder dialog, the recents list and a tab's first look all land here. */
  const openIn = useCallback(
    async (path: string) => {
      // Switching repositories is a user action like any other, so it too invalidates a background
      // load already running against the one being left (GC-068).
      generation.current += 1;
      setFileView(null);
      setSelected(WIP);
      // A message written for another repository must never appear over these staged files: the
      // panel's key no longer clears it, because the draft outlives the panel now (GC-148).
      setDraft(EMPTY_DRAFT);
      graphTop.current = 0; // a repository being opened starts at the top of its history
      const owns = takeBusy('Loading repository');
      setError(null);
      await load(path).finally(() => {
        if (owns()) setBusy(null);
      });
    },
    [load, takeBusy],
  );

  /**
   * Put `t` on screen: what it was parked with if it has been here before, a fresh load if not
   * (GC-016). A parked tab comes back in one commit — no frame is painted between the two
   * repositories — and is then refreshed underneath, because the watcher only ever followed the
   * tab that was showing and what this one kept may be minutes old.
   */
  const showTab = useCallback(
    (t: Tab) => {
      generation.current += 1;
      setActiveId(t.id);
      const back = parked.current.get(t.id);
      if (!back?.snapshot) {
        void openIn(t.path);
        return;
      }
      setSnapshot(back.snapshot);
      setSelected(back.selected);
      setFileView(back.fileView);
      setHidden(back.hidden);
      hiddenRef.current = back.hidden;
      paged.current = back.paged;
      setHasMore(back.hasMore);
      setSearch(back.search);
      setDraft(back.draft);
      graphTop.current = back.graphTop;
      setRepoPath(back.snapshot.info.path);
      setError(null);
      // A tab switch changes everything the panels show, so it is a generation like any other
      // reload: without it nothing waiting on `data-gen` could tell the switch had happened.
      bumpGen();
      void reloadSnapshot(back.snapshot.info.path);
    },
    [bumpGen, openIn, reloadSnapshot],
  );

  /** The tab already holding `path`, if any: a repository is opened once and revisited, not duplicated. */
  const tabFor = useCallback((path: string): Tab | undefined => tabs.find((t) => normRepoPath(t.path) === normRepoPath(path)), [tabs]);

  const selectTab = useCallback(
    (id: number) => {
      if (id === activeId) return;
      const t = tabs.find((x) => x.id === id);
      if (!t) return;
      if (activeId !== null) parked.current.set(activeId, live.current);
      showTab(t);
    },
    [activeId, showTab, tabs],
  );

  /** Switch the showing tab to a repository; with nothing open at all, the first tab is made for it. */
  const openPath = useCallback(
    async (path: string) => {
      const already = tabFor(path);
      // Opening a repository that is already in the bar takes the user to it rather than making a
      // second copy of it, which is what every other tabbed application does.
      if (already && already.id !== activeId) {
        selectTab(already.id);
        return;
      }
      if (activeId === null) {
        const id = nextTabId.current++;
        setTabs((prev) => [...prev, { id, path }]);
        setActiveId(id);
      } else {
        setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, path } : t)));
      }
      await openIn(path);
    },
    [activeId, openIn, selectTab, tabFor],
  );

  /** Open a repository in a tab of its own, beside the showing one (GC-016). */
  const openNewTab = useCallback(
    async (path: string) => {
      const already = tabFor(path);
      if (already) {
        selectTab(already.id);
        return;
      }
      if (activeId !== null) parked.current.set(activeId, live.current);
      const id = nextTabId.current++;
      setTabs((prev) => [...prev, { id, path }]);
      setActiveId(id);
      await openIn(path);
    },
    [activeId, openIn, selectTab, tabFor],
  );

  /**
   * Close a tab, and with it everything it had parked. Closing one that is not showing changes
   * nothing on screen; closing the last one goes back to the empty state, which is where the app
   * starts before a repository has ever been opened.
   */
  const closeTab = useCallback(
    (id: number) => {
      parked.current.delete(id);
      const next = id === activeId ? neighbourOf(tabs, id) : null;
      setTabs((prev) => prev.filter((t) => t.id !== id));
      if (id !== activeId) return;
      if (next) {
        showTab(next);
        return;
      }
      generation.current += 1;
      setActiveId(null);
      setSnapshot(null);
      setRepoPath(null);
      setSelected(WIP);
      setFileView(null);
      setSearch({ open: false, tick: 0, query: '' });
      paged.current = { path: '', loaded: 0 };
      graphTop.current = 0;
      setHasMore(false);
      setError(null);
      bumpGen();
      // `gitclient.lastRepo` follows the showing tab, so closing the last one clears it there.
    },
    [activeId, bumpGen, showTab, tabs],
  );

  const openRepo = useCallback(async () => {
    const path = await window.api.openRepoDialog();
    if (path) await openPath(path);
  }, [openPath]);

  /** `+`: a new tab is a repository this window is not showing yet, so it asks for the folder (GC-016). */
  const newTab = useCallback(async () => {
    const path = await window.api.openRepoDialog();
    if (path) await openNewTab(path);
  }, [openNewTab]);

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
      // The writes need an identity of their own, the way GC-068 gave the reads one (GC-084):
      // without it, of two actions overlapping, whichever finishes first clears the status bar
      // while the other is still running, and its own error lands over the other's state.
      const owns = takeBusy(label);
      setError(null);
      setNotice(null);
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
          if (owns()) setBusy(null);
        }
      }
      if (failure !== null) {
        // git often exits non-zero while leaving the repo in a state the panels now show (conflicts,
        // an empty cherry-pick, a stopped rebase), so keep the message visible after the reload —
        // unless a later action owns the bar by now, whose state this message would not describe.
        // An advisory failure is not a failure to report in red: the stash came back and only its
        // staging did not, and the red line said the pop had failed when it had not (GC-091).
        if (owns()) (isAdvisory(failure) ? setNotice : setError)(msg(failure));
        // The caller asked to handle the failure itself, and its own logic does not depend on
        // which action currently owns the status bar.
        if (opts.rethrow) throw failure;
      }
    },
    [repo, load, refreshStatus, takeBusy],
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
        await reloadSnapshot(repo);
      } catch {
        /* a background refresh must not raise a banner over the user's work */
      }
    },
    [refreshStatus, reloadSnapshot, repo],
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

  // Selecting anything brings the detail panel back: it is what the selection is for, so a panel
  // hidden with Ctrl+K stays hidden only until the user asks to read something (GC-033).
  const select = useCallback((sha: string) => {
    setSelected(sha);
    setFileView(null);
    setDetailCollapsed(false);
  }, []);

  // ---- ref / commit / stash operations ------------------------------------------------

  // Every checkout the UI can trigger goes through here: with a dirty working tree git either
  // carries the changes over or refuses, so ask first and offer to stash them out of the way.
  const runCheckout = useCallback(
    async (name: string, doCheckout: () => Promise<void>): Promise<void> => {
      // Untracked files come across a checkout untouched, so a tree holding nothing else is not at
      // risk and must not be asked about (GC-019); the count names the files that are, which is the
      // staging list minus those untracked rows.
      const entries = snapshot?.status.entries ?? [];
      const atRisk = entries.filter((e) => !(e.staged === null && e.unstaged === 'untracked'));
      // …but "Stash and check out" below does pass `includeUntracked`, because an untracked file
      // can be in the way of a checkout even though an untouched one is not at risk. So the count
      // and the button have different scope, and the message says so in the same sentence
      // (GC-161), in the shape GC-097 gave the sequencer guard next door — which stashes *less*
      // than its own refusal implies and had to say that. Only when there is something to say:
      // with no untracked file the clause would describe nothing, and the message is unchanged.
      const untracked = entries.length - atRisk.length;
      if (prefs.confirmDirtyCheckout && atRisk.length) {
        const r = await ui.prompt({
          title: 'Uncommitted changes',
          message: `You have uncommitted changes in ${atRisk.length} file${atRisk.length === 1 ? '' : 's'}${untracked ? ' — stashing takes your untracked files with it as well' : ''}. Check out ${name} anyway?`,
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
        message: `git refuses to ${what} while anything is staged, and you have ${staged.length} staged file${staged.length === 1 ? '' : 's'}. Stash your tracked changes — untracked files stay where they are — ${what}, and put them back?`,
        input: false,
        okLabel: 'Stash and continue',
      });
      if (!r) return;
      const stashMessage = `Before ${label.toLowerCase()}`;
      await run(label, async () => {
        // No `-u`, unlike the checkout guard this was copied from (GC-097). What git refuses these
        // four for is the **index**; it carries untracked files through all of them untouched, so
        // stashing them moves files that were never in the way — and in the mid-operation case
        // below, where the stash is deliberately kept, they would sit out of the working tree until
        // the user popped it.
        await window.api.stashSave(repo!, { includeUntracked: false, message: stashMessage });
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

  /**
   * The part of a drag-and-drop action that has to happen on a particular branch (GC-015): a
   * merge runs on the branch being merged into and a rebase on the branch being rebased, and the
   * gesture names those rather than leaving them to be whatever is checked out. So the checkout
   * comes first, through `checkoutRef`, which brings the dirty-tree guard and its stash offer
   * with it (GC-004), and the action itself through `runSequencer`, which brings the staged-index
   * guard (GC-090). Two operations on the status bar rather than one: nesting `run()` inside
   * `run()` would take two busy tokens and reload the snapshot twice for a single drop.
   *
   * git is asked where HEAD is between them rather than the snapshot being read, because a
   * cancelled prompt and a failed checkout both return quietly and neither must be followed by a
   * merge onto the branch the user was already on.
   */
  const runOnBranch = useCallback(
    async (branch: GitRef, what: string, label: string, action: () => Promise<unknown>): Promise<void> => {
      if (!repo) return;
      if (!branch.isHead) {
        await checkoutRef(branch);
        const after = await window.api.getStatus(repo).catch(() => null);
        if (after?.branch !== branch.name) return;
      }
      await runSequencer(what, label, action);
    },
    [checkoutRef, repo, runSequencer],
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

  // Where else this branch lives, for the delete confirmation's checkbox (GC-112). The answer is
  // `shared/remotes.ts`'s, beside `defaultRemote` and under its own test (GC-134).
  const copyOf = useCallback((r: GitRef) => remoteCopyOf(r, snapshot?.refs ?? [], snapshot?.remotes ?? []), [snapshot]);

  const deleteBranch = useCallback(
    async (r: GitRef) => {
      if (r.kind === 'remote') {
        const [remote, ...rest] = r.name.split('/');
        const branch = rest.join('/');
        if (!(await ui.confirm({ title: `Delete ${r.name}?`, message: `This deletes branch "${branch}" on the remote "${remote}".`, okLabel: 'Delete from remote', danger: true }))) return;
        await run(`Deleting ${r.name}`, () => window.api.deleteRemoteBranch(repo!, remote!, branch));
        return;
      }
      // Deleting a branch that has been pushed used to take two actions in two menus, and the
      // second was only reachable if that remote's row happened to be on screen — a branch hidden
      // from the graph has no row at all (GC-112). The confirmation carries the second delete as an
      // option on itself, which is what `confirmWithOption` is for (GC-131).
      const copy = copyOf(r);
      const res = await ui.confirmWithOption({
        title: `Delete branch ${r.name}?`,
        checkbox: copy ? { label: `Also delete ${copy.branch} on ${copy.remote}` } : undefined,
        okLabel: 'Delete',
        danger: true,
      });
      if (!res.confirmed) return;
      const alsoRemote = copy !== null && res.checked;
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
      // Order, and it is deliberate (GC-112): the local delete runs first and the remote one is
      // not attempted if it failed — a branch git refused to delete is not one to start deleting
      // copies of. The remote half goes through a plain `run()`, so a failure there reports on the
      // status bar and leaves the local delete standing rather than pretending both were undone.
      if (deleted && alsoRemote && copy) await run(`Deleting ${copy.remote}/${copy.branch}`, () => window.api.deleteRemoteBranch(repo!, copy.remote, copy.branch));
      // The pin is stored by name, so one left behind by a deleted branch never resolves again
      // and its key outlives the repository's history (GC-021).
      if (deleted && wasPinned) pinBranch(null);
    },
    [copyOf, pinBranch, pinned, repo, run, ui],
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
      // The target is said once, in a caption, and the three rows are then just the modes (GC-074).
      // Repeating `Reset <branch> to <sha>` on every row made the middle one 7px too wide for the
      // menu's 420px cap, and whichever of the label and the hint was allowed to win, the other was
      // the one cut — the row simply did not fit. The study's Reset is one entry over a three-row
      // submenu, so the branch and the sha are said once there too.
      const resetItem = (mode: 'soft' | 'mixed' | 'hard', label: string, hint: string): MenuItem => ({
        label,
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
        resets: [
          { label: `Reset ${target} to ${short}`, caption: true } as MenuItem,
          resetItem('soft', 'Soft', 'keep all changes staged'),
          resetItem('mixed', 'Mixed', 'keep changes in the working directory'),
          resetItem('hard', 'Hard', 'discard all changes'),
        ],
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
          items.push({ label: `Push tag ${r.name} to ${fallback ?? 'remote'}`, disabled: !fallback, onClick: () => run(`Pushing tag ${r.name} to ${fallback}`, () => window.api.push(repo!, { remote: fallback, branch: r.name })) });
        }
        // A tag pushed with the row above could not be taken back at all: `deleteTag` is local-only
        // and there was no remote-tag call in `git.ts` (GC-112). The remote rows mirror the push
        // rows exactly — one per remote when there is more than one — and the local delete carries
        // the same "also on the remote" checkbox a branch's does, but only when there is a single
        // remote to name. With several, which of them holds this tag is not something a tag ref can
        // answer, and the explicit rows below are the honest way to say it.
        items.push({
          label: `Delete tag ${r.name}`,
          danger: true,
          onClick: async () => {
            const withRemote = remotes.length === 1 && fallback ? fallback : null;
            const res = await ui.confirmWithOption({
              title: `Delete tag ${r.name}?`,
              checkbox: withRemote ? { label: `Also delete it on ${withRemote}` } : undefined,
              okLabel: 'Delete',
              danger: true,
            });
            if (!res.confirmed) return;
            let deleted = false;
            try {
              await run('Deleting tag', () => window.api.deleteTag(repo!, r.name), { rethrow: true });
              deleted = true;
            } catch {
              /* the message is already on the status bar */
            }
            if (deleted && res.checked && withRemote) await run(`Deleting tag ${r.name} on ${withRemote}`, () => window.api.deleteRemoteTag(repo!, withRemote, r.name));
          },
        });
        if (remotes.length > 1) {
          for (const rem of remotes) {
            items.push({
              label: `Delete tag ${r.name} from ${rem.name}`,
              danger: true,
              onClick: async () =>
                (await ui.confirm({ title: `Delete tag ${r.name} from ${rem.name}?`, message: 'The local tag is not touched.', okLabel: 'Delete from remote', danger: true })) &&
                run(`Deleting tag ${r.name} on ${rem.name}`, () => window.api.deleteRemoteTag(repo!, rem.name, r.name)),
            });
          }
        }
        items.push({ separator: true });
        items.push({ label: 'Copy tag name', onClick: () => void navigator.clipboard.writeText(r.name) });
        return items;
      }
      items.push({ label: r.isHead ? `${r.name} is checked out` : `Checkout ${r.name}`, disabled: r.isHead, onClick: () => checkoutRef(r) });
      if (!r.isHead && currentBranch) {
        items.push({ label: `Merge ${r.name} into ${cur}`, onClick: () => runSequencer('merge', `Merging ${r.name}`, () => window.api.merge(repo!, r.name)) });
        items.push({ label: `Rebase ${cur} onto ${r.name}`, onClick: () => runSequencer('rebase', `Rebasing onto ${r.name}`, () => window.api.rebase(repo!, r.name)) });
      }
      // Bringing a branch up to its upstream, and pointing it at one in the first place (GC-100).
      // Both are local-branch actions and both sit in this group, beside Merge and Rebase, because
      // that is what they are: the study lists "Fast-forward X to Y" as its own row rather than as
      // something you have to check the branch out to get at.
      if (r.kind === 'head') {
        // Absent, not disabled, on a branch with nothing to catch up to: an action that cannot
        // work is left out (GC-072). `behind` comes off `for-each-ref` for every branch, so this
        // is the same number the left panel already draws.
        if (r.upstream && (r.behind ?? 0) > 0) {
          items.push({
            label: `Fast-forward ${r.name} to ${r.upstream}`,
            hint: `${r.behind} behind`,
            onClick: () => run(`Fast-forwarding ${r.name}`, () => window.api.fastForward(repo!, r.name, r.upstream!)),
          });
        }
        items.push({
          label: r.upstream ? `Change upstream of ${r.name}…` : `Set upstream of ${r.name}…`,
          hint: r.upstream,
          onClick: async () => {
            // No submenu on MenuItem and no list in the prompt, so the remote branches that exist
            // are the message and the best guess is the default: the remote-tracking branch of the
            // same name if there is one, else the default remote and this name.
            const candidates = (snapshot?.refs ?? []).filter((x) => x.kind === 'remote').map((x) => x.name);
            const guess = candidates.find((x) => x.endsWith(`/${r.name}`)) ?? (fallback ? `${fallback}/${r.name}` : '');
            const res = await ui.prompt({
              title: `Set upstream of ${r.name}`,
              message: candidates.length ? `Remote branches: ${candidates.join(', ')}` : 'This repository has no remote-tracking branches.',
              label: 'Upstream',
              defaultValue: r.upstream ?? guess,
              okLabel: 'Set upstream',
            });
            if (!res || res.value === r.upstream) return;
            await run(`Setting upstream of ${r.name}`, () => window.api.setUpstream(repo!, r.name, res.value));
          },
        });
        if (r.upstream) {
          items.push({ label: `Unset upstream of ${r.name}`, hint: r.upstream, onClick: () => run(`Unsetting upstream of ${r.name}`, () => window.api.setUpstream(repo!, r.name, null)) });
        }
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
          // The row names the **remote**, never `r.upstream` (GC-114). The push writes
          // `<remote>/<branch>`, so a label naming the upstream ref promised a different one the
          // moment the upstream's branch name was not the local name — which GC-100's "Set
          // upstream…" is exactly what makes reachable. Same wording as the multi-remote rows
          // above and the toolbar button's own title, and the remote is passed explicitly so the
          // label and the command read the same value.
          items.push({
            label: `Push ${r.name} to ${fallback ?? 'remote'}`,
            hint: r.upstream ? undefined : 'sets the upstream',
            disabled: !fallback,
            onClick: () => run(`Pushing ${r.name} to ${fallback}`, () => window.api.push(repo!, { remote: fallback, branch: r.name, setUpstream: !r.upstream })),
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

  /**
   * What a branch dropped on another branch offers (GC-015). The two rows are the branch menu's
   * own Merge and Rebase, with both ends named by the gesture instead of one of them being HEAD:
   * the drag says which branch, so the row can promise a checkout rather than silently acting on
   * whatever happens to be checked out. `canDropRef` has already refused a pair that would leave
   * this list empty, so the caption always heads at least one row.
   */
  const dropMenuItems = useCallback(
    (src: GitRef, dst: GitRef): MenuItem[] => {
      const items: MenuItem[] = [{ label: `${src.name} onto ${dst.name}`, caption: true }];
      if (dst.kind === 'head') {
        items.push({
          label: `Merge ${src.name} into ${dst.name}`,
          hint: dst.isHead ? undefined : `checks out ${dst.name}`,
          onClick: () => void runOnBranch(dst, 'merge', `Merging ${src.name} into ${dst.name}`, () => window.api.merge(repo!, src.name)),
        });
      }
      if (src.kind === 'head') {
        items.push({
          label: `Rebase ${src.name} onto ${dst.name}`,
          hint: src.isHead ? undefined : `checks out ${src.name}`,
          onClick: () => void runOnBranch(src, 'rebase', `Rebasing ${src.name} onto ${dst.name}`, () => window.api.rebase(repo!, dst.name)),
        });
      }
      return items;
    },
    [repo, runOnBranch],
  );

  /**
   * The drag itself, shared by the graph and the left panel so a chip can be dropped on a row and
   * a row on a chip (GC-015). The drop is checked again here: `dragover` decided it from the same
   * predicate, but a drop that arrives without a source — a page reloaded mid-drag, something
   * dragged in from outside — must open nothing.
   */
  const refDrag = useMemo<RefDragHandlers>(
    () => ({
      dragging: dragRef,
      onDragStart: setDragRef,
      onDragEnd: () => setDragRef(null),
      onDrop: (e: DragEvent, dst: GitRef) => {
        setDragRef(null);
        if (!dragRef || !canDropRef(dragRef, dst)) return;
        ui.openMenu(e, dropMenuItems(dragRef, dst));
      },
    }),
    [dragRef, dropMenuItems, ui],
  );

  const commitMenuItems = useCallback(
    (c: Commit): MenuItem[] => {
      const short = c.sha.slice(0, 7);
      // The shared source for everything both menus offer on a commit, so the wording, the guards
      // and the hard-reset confirmation cannot drift between them (GC-049). This menu used to carry
      // its own copy of all five, which is exactly the drift that source exists to prevent — and it
      // is why GC-074's reset group had to be changed in one place rather than two.
      const tip = tipCommitActions(c.sha);
      return [
        { label: 'Checkout this commit (detached)', onClick: () => runCheckout(short, () => window.api.checkout(repo!, c.sha, { detach: true })) },
        { separator: true },
        { label: 'Create branch here…', onClick: () => createBranchAt(c.sha, `commit ${short}`) },
        tip.createTag,
        { separator: true },
        tip.cherryPick,
        tip.revert,
        { separator: true },
        ...tip.resets,
        { separator: true },
        tip.copySha,
        { label: 'Copy commit summary', onClick: () => void navigator.clipboard.writeText(c.summary) },
      ];
    },
    [createBranchAt, repo, runCheckout, tipCommitActions],
  );

  const stashChanges = useCallback(async () => {
    const r = await ui.prompt({ title: 'Stash changes', label: 'Message (optional)', required: false, placeholder: 'WIP on ' + (currentBranch ?? 'HEAD'), checkbox: { label: 'Include untracked files', defaultChecked: true }, okLabel: 'Stash' });
    if (r) await run('Stashing', () => window.api.stashSave(repo!, { message: r.value, includeUntracked: r.checked }));
  }, [currentBranch, repo, run, ui]);

  const editStashMessage = useCallback(
    async (s: Stash) => {
      const r = await ui.prompt({
        title: 'Edit stash message',
        message: 'The stash keeps its changes, and moves to the top of the list.',
        label: 'Message',
        defaultValue: s.message,
        okLabel: 'Save',
      });
      if (r) await run('Renaming stash', () => window.api.stashRename(repo!, s.index, r.value));
    },
    [repo, run, ui],
  );

  const stashMenuItems = useCallback(
    (s: Stash): MenuItem[] => [
      { label: 'Apply stash', onClick: () => run('Applying stash', () => window.api.stashApply(repo!, s.index)) },
      { label: 'Pop stash', hint: 'apply and drop', onClick: () => run('Popping stash', () => window.api.stashPop(repo!, s.index)) },
      // The default is the reflog subject the list already shows, and what is typed replaces it
      // whole — `git stash store -m` sets the subject exactly, so an edited entry loses git's own
      // `On <branch>:` prefix unless the user keeps it. The message names the move to the top,
      // which is the store's doing and not something the user asked for (GC-129).
      { label: 'Edit message…', onClick: () => void editStashMessage(s) },
      { separator: true },
      { label: 'Drop stash', danger: true, onClick: async () => (await ui.confirm({ title: 'Drop this stash?', message: s.message, okLabel: 'Drop', danger: true })) && run('Dropping stash', () => window.api.stashDrop(repo!, s.index)) },
    ],
    [editStashMessage, repo, run, ui],
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
      // A commit's file row is the only place an older version of a file can be reached: the three
      // rows below all act on the working tree, so on a row belonging to last week's commit "Open
      // file" opens today's content (GC-107). It is destructive and it stages what it writes, so it
      // asks first and the confirmation says so. Absent, not disabled, on a file the commit deleted
      // — there is nothing at that sha to restore, and GC-072 settled that an action which cannot
      // work is left out rather than shown greyed. The sha is `selectedCommit`'s, because a commit
      // file row is only ever drawn for the commit the detail panel is showing.
      if (t.source === 'commit' && t.file.kind !== 'deleted' && selectedCommit) {
        const sha = selectedCommit.sha;
        items.push({
          label: 'Restore file from this commit',
          hint: sha.slice(0, 7),
          danger: true,
          onClick: async () =>
            (await ui.confirm({
              title: `Restore ${path} from ${sha.slice(0, 7)}?`,
              message: 'The working-tree copy is overwritten and the result is staged.',
              okLabel: 'Restore',
              danger: true,
            })) && void run(`Restoring ${path}`, () => window.api.restoreFile(repo!, sha, path)),
        });
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
    [actions, ignoreFile, inShell, repo, run, selectedCommit, ui],
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
      // Every row here is a branch, so the menu is a list rather than a set of actions: on a
      // repository with fifty branches and their remotes it is unusable without something to narrow
      // it, and the control it replaces — finding the row in the left panel — has a filter (GC-096).
      // The menu does the narrowing itself; this only asks for the field.
      if (locals.length || remotes.length) items.push({ filter: true, placeholder: 'Filter branches' });
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
  const layerOpen = shortcutsOpen || prefsOpen || ui.dialogOpen || ui.menuOpen || pullOpen || pushOpen;
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
          else setPopover(null);
        }
        return;
      }
      // Whether a binding fires from inside a text field is the table's answer, not this
      // handler's: `whileTyping` had been sitting there unread while one `isEditable` check
      // below decided it for everything (GR-002, GC-033).
      const hit = (id: ShortcutId): boolean => matches(id, e) && (firesWhileTyping(id) || !isEditable(e.target));
      // Ctrl+F works from anywhere, including the commit message field
      if (hit('openSearch')) {
        if (!snapshot) return;
        e.preventDefault();
        setFileView(null);
        openSearch();
        return;
      }
      // Ctrl+Shift+M is the other one that fires while typing: it is how the field is reached, so
      // it selects the working directory first — the commit form only exists on that row.
      if (hit('focusSummary')) {
        if (!snapshot) return;
        e.preventDefault();
        setSelected(WIP);
        setDetailCollapsed(false);
        setFocusSummary((n) => n + 1);
        return;
      }
      // The panels and the filter cost nothing and need no repository open.
      if (hit('toggleLeft')) {
        e.preventDefault();
        setLeftCollapsed((v) => !v);
        return;
      }
      if (hit('toggleDetail')) {
        e.preventDefault();
        setDetailCollapsed((v) => !v);
        return;
      }
      // Cycling the tabs costs nothing and needs no repository open (GC-016). It is deliberately
      // above the bindings that do, so a window with one tab still swallows Ctrl+Tab rather than
      // letting the focus ring walk the toolbar.
      if (hit('nextTab') || hit('prevTab')) {
        e.preventDefault();
        const id = cycle(tabs, activeId, matches('nextTab', e) ? 1 : -1);
        if (id !== null) selectTab(id);
        return;
      }
      if (hit('focusFilter')) {
        if (!snapshot) return;
        e.preventDefault();
        setLeftCollapsed(false);
        setFileView(null); // a file view forces the panel to the rail, where there is no filter
        setFocusFilter((n) => n + 1);
        return;
      }
      // The four that run git follow the toolbar's own disabled states: no repository, an action
      // already running, no remote to fetch from, nothing to stage or unstage.
      if (hit('newBranch')) {
        e.preventDefault();
        if (snapshot && !busy) void createBranchAt('HEAD', currentBranch ?? 'HEAD');
        return;
      }
      if (hit('fetchAll')) {
        e.preventDefault();
        if (snapshot && !busy && snapshot.remotes.length > 0) void run('Fetching', () => window.api.fetch(repo!));
        return;
      }
      if (hit('stageAll')) {
        e.preventDefault();
        if (snapshot && !busy && snapshot.status.entries.length > 0) actions.stageAll().catch(() => undefined);
        return;
      }
      if (hit('unstageAll')) {
        e.preventDefault();
        if (snapshot && !busy && snapshot.status.entries.some((x) => x.staged)) actions.unstageAll().catch(() => undefined);
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
  }, [snapshot, selected, search.open, fileView, openSearch, closeSearch, layerOpen, shortcutsOpen, prefsOpen, pullOpen, pushOpen, ui, busy, repo, run, actions, createBranchAt, currentBranch, tabs, activeId, selectTab]);

  return (
    <div
      className={`app ${leftW.resizing || detailW.resizing ? 'resizing' : ''}`}
      style={{ '--left-panel-w': `${applied.left}px`, '--detail-panel-w': `${applied.detail}px` } as CSSProperties}
    >
      <TitleBar
        tabs={tabs}
        activeId={activeId}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onNewTab={() => void newTab()}
        onOpenRepo={openRepo}
        onRepoMenu={openRepoMenu}
      />
      <Toolbar
        info={snapshot?.info ?? null}
        busy={busy !== null}
        ahead={snapshot?.status.ahead ?? 0}
        behind={snapshot?.status.behind ?? 0}
        hasUpstream={!!headRef?.upstream}
        hasRemotes={(snapshot?.remotes.length ?? 0) > 0}
        pushRemote={defaultRemote(snapshot?.remotes ?? []) ?? null}
        remotes={(snapshot?.remotes ?? []).map((r) => r.name)}
        hasChanges={(snapshot?.status.entries.length ?? 0) > 0}
        stashCount={snapshot?.stashes.length ?? 0}
        pullMode={prefs.pullMode}
        pullOpen={pullOpen}
        pushOpen={pushOpen}
        onPullModeChange={(mode) => setPrefs({ pullMode: mode })}
        onPullOpenChange={setPullOpen}
        onPushOpenChange={setPushOpen}
        onFetch={() => void run('Fetching', () => window.api.fetch(repo!))}
        onPull={(mode, remote) => void run(remote ? `Pulling from ${remote}` : 'Pulling', () => window.api.pull(repo!, mode, remote))}
        onOpenPreferences={() => setPrefsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onRepoMenu={openRepoMenu}
        onBranchMenu={openBranchMenu}
        // A named remote is a deliberate choice, so it sets the upstream when the branch has none
        // wherever it is pushed; with none named this is the button it always was (GC-057).
        onPush={(remote) =>
          void run(remote ? `Pushing to ${remote}` : 'Pushing', () => window.api.push(repo!, { remote, setUpstream: !headRef?.upstream }))
        }
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
              info={snapshot.info}
              refs={snapshot.refs}
              stashes={snapshot.stashes}
              remotes={snapshot.remotes}
              pinnedName={pinnedRef?.name ?? null}
              hidden={hidden}
              onToggleHidden={toggleHidden}
              onShowAll={showAll}
              collapsed={leftCollapsed || fileView !== null}
              focusFilter={focusFilter}
              resize={leftW.handle}
              onExpand={() => (fileView ? setFileView(null) : setLeftCollapsed(false))}
              onCollapse={() => setLeftCollapsed(true)}
              onRefMenu={(e, r) => onMenu(e, refMenuItems(r))}
              onRefActivate={(r) => void checkoutRef(r)}
              // A single click selects the ref's tip, which costs no git call: the sha is already
              // on the `GitRef` and the graph's own effect brings the row into view (GC-141).
              onRefSelect={(r) => select(r.sha)}
              selected={selected}
              refDrag={refDrag}
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
                // Keyed by repository, so the state the graph keeps for itself — the author chip
                // on the find bar, the lane-layout cache, the hovered fold — belongs to the tab it
                // was made in and never arrives over another repository's rows (GC-016). The key
                // is prefixed because the detail panel below is a sibling keyed on the same
                // repository, and two siblings sharing one key is not a swap: React matched the
                // new graph against the old panel, and both graphs stayed on screen at once.
                key={`graph-${repo}`}
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
                // The same two gestures and the same menu the left panel's stash row offers, from
                // the same source, so the two surfaces cannot drift apart (GC-140).
                stashes={snapshot.stashes}
                onStashMenu={(e, s) => onMenu(e, stashMenuItems(s))}
                onStashActivate={(s) => void run('Applying stash', () => window.api.stashApply(repo, s.index))}
                refDrag={refDrag}
                detached={!snapshot.info.branch}
                hasMore={hasMore}
                loadingMore={loadingMore}
                onLoadMore={askForMore}
                scrollTop={graphTop.current}
                onScrollTop={(top) => (graphTop.current = top)}
                onDrawnCols={onDrawnCols}
              />
            )}
            {!detailCollapsed && (
              <DetailPanel
                // Keyed by repository for the same reason the graph is, and prefixed for the same
                // reason: two siblings under one key is not a swap (GC-016). The commit message is
                // no longer what the key is protecting — it is parked with its tab now (GC-148) —
                // but everything else this panel keeps for itself is still about one repository.
                key={`detail-${repo}`}
                repo={repo}
                commit={selectedCommit}
                headCommit={headCommit}
                status={snapshot.status}
                openFile={fileView}
                actions={actions}
                resize={detailW.handle}
                focusSummary={focusSummary}
                draft={draft}
                onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
                onSelectSha={select}
                onOpenFile={setFileView}
                onFileMenu={(e, t) => onMenu(e, fileMenuItems(t))}
                // The same three the graph gets, so a chip in the commit view behaves exactly as
                // the one on its row does (GC-087).
                refs={visibleRefs}
                onRefMenu={(e, r) => onMenu(e, refMenuItems(r))}
                onRefActivate={(r) => void checkoutRef(r)}
              />
            )}
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
      <StatusBar
        repoPath={repoPath}
        commitCount={commits.length}
        busy={busy}
        generation={dataGen}
        error={error}
        notice={notice}
        onDismissError={() => setError(null)}
        onDismissNotice={() => setNotice(null)}
      />
      {/* With a file view open there is no graph to have dropped anything, so the dialog is told
          nothing rather than the last answer some earlier window width produced (GC-117). */}
      {prefsOpen && <Preferences onClose={() => setPrefsOpen(false)} drawnCols={fileView ? null : drawnCols} />}
      {shortcutsOpen && <Shortcuts onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
