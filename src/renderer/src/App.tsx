import { useCallback, useEffect, useMemo, useState, type JSX, type MouseEvent } from 'react';
import type { CheckoutOptions, Commit, GitRef, Remote, RepoSnapshot, Stash, StatusEntry } from '@shared/types';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { LeftPanel } from './components/LeftPanel';
import { DetailPanel, type StagingActions } from './components/DetailPanel';
import { StatusBar } from './components/StatusBar';
import { CommitGraph, WIP } from './graph/CommitGraph';
import { DiffView, type FileViewSource } from './diff/DiffView';
import { Preferences } from './components/Preferences';
import { Shortcuts } from './components/Shortcuts';
import { setPrefs, usePrefs } from './prefs';
import { matches } from './shortcuts';
import { useUi } from './ui/UiContext';
import type { MenuItem } from './ui/ContextMenu';

const LAST_REPO_KEY = 'gitclient.lastRepo';
/** The pinned branch is per repository, so the key carries the path. */
const pinKey = (path: string): string => `gitclient.pinned.${path}`;
const MAX_COMMITS = 2000;

const isEditable = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
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
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(WIP);
  const [fileView, setFileView] = useState<FileViewSource | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [workdirVersion, setWorkdirVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); // label of the running operation
  const [error, setError] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null); // git itself is missing (GC-025)
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null); // branch name pinned to column 0
  // The search bar over the graph. `searchTick` changes on every request to open it so that
  // Ctrl+F refocuses the field even when the bar is already showing. The query lives here rather
  // than in `CommitGraph` because that component unmounts whenever a file view opens (GC-030);
  // only closing the bar clears it.
  const [search, setSearch] = useState({ open: false, tick: 0, query: '' });
  const openSearch = useCallback(() => setSearch((s) => ({ ...s, open: true, tick: s.tick + 1 })), []);
  const closeSearch = useCallback(() => setSearch((s) => ({ ...s, open: false, query: '' })), []);
  const setSearchQuery = useCallback((query: string) => setSearch((s) => ({ ...s, query })), []);

  const load = useCallback(async (path: string) => {
    try {
      const snap = await window.api.loadRepo(path, MAX_COMMITS);
      setSnapshot(snap);
      setRepoPath(snap.info.path);
      try {
        localStorage.setItem(LAST_REPO_KEY, snap.info.path);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setSnapshot(null);
      // The path did not load, so the status bar must stop naming it as the open repository; the
      // remembered path stays in localStorage in case the folder comes back (GC-025).
      setRepoPath(null);
      setError(msg(e));
    }
  }, []);

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

  const openRepo = useCallback(async () => {
    const path = await window.api.openRepoDialog();
    if (path) {
      setFileView(null);
      setSelected(WIP);
      setBusy('Loading repository');
      setError(null);
      await load(path).finally(() => setBusy(null));
    }
  }, [load]);

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
    const status = await window.api.getStatus(repo);
    setSnapshot((s) => (s ? { ...s, status } : s));
    setWorkdirVersion((v) => v + 1);
  }, [repo]);

  /** Run a git operation with busy/error handling, then reload the snapshot (or only the status). */
  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>, opts: { statusOnly?: boolean; rethrow?: boolean } = {}): Promise<void> => {
      if (!repo) return;
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
      if (prefs.confirmDirtyCheckout && snapshot?.status.entries.length) {
        const r = await ui.prompt({
          title: 'Uncommitted changes',
          message: `You have uncommitted changes. Check out ${name} anyway?`,
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
      try {
        await run(`Deleting ${r.name}`, () => window.api.deleteBranch(repo!, r.name, false), { rethrow: true });
      } catch (e) {
        if (/not fully merged/i.test(msg(e))) {
          if (await ui.confirm({ title: `${r.name} is not fully merged`, message: 'Deleting it will lose the commits that are not reachable from another branch.', okLabel: 'Force delete', danger: true }))
            await run(`Deleting ${r.name}`, () => window.api.deleteBranch(repo!, r.name, true));
        }
      }
    },
    [repo, run, ui],
  );

  const refMenuItems = useCallback(
    (r: GitRef): MenuItem[] => {
      const items: MenuItem[] = [];
      const cur = currentBranch ?? 'HEAD';
      if (r.kind === 'tag') {
        items.push({ label: `Checkout ${r.name} (detached)`, onClick: () => checkoutRef(r) });
        items.push({ label: `Create branch from ${r.name}…`, onClick: () => createBranchAt(r.name, `tag ${r.name}`) });
        items.push({ separator: true });
        items.push({ label: `Push tag to remote`, disabled: !snapshot?.remotes.length, onClick: () => run(`Pushing tag ${r.name}`, () => window.api.push(repo!, { remote: snapshot!.remotes[0]!.name, branch: r.name })) });
        items.push({ label: `Delete tag ${r.name}`, danger: true, onClick: async () => (await ui.confirm({ title: `Delete tag ${r.name}?`, okLabel: 'Delete', danger: true })) && run('Deleting tag', () => window.api.deleteTag(repo!, r.name)) });
        items.push({ separator: true });
        items.push({ label: 'Copy tag name', onClick: () => void navigator.clipboard.writeText(r.name) });
        return items;
      }
      items.push({ label: r.isHead ? `${r.name} is checked out` : `Checkout ${r.name}`, disabled: r.isHead, onClick: () => checkoutRef(r) });
      if (!r.isHead && currentBranch) {
        items.push({ label: `Merge ${r.name} into ${cur}`, onClick: () => run(`Merging ${r.name}`, () => window.api.merge(repo!, r.name)) });
        items.push({ label: `Rebase ${cur} onto ${r.name}`, onClick: () => run(`Rebasing onto ${r.name}`, () => window.api.rebase(repo!, r.name)) });
      }
      items.push({ separator: true });
      items.push({ label: `Create branch from ${r.name}…`, onClick: () => createBranchAt(r.name, r.name) });
      if (r.kind === 'head') {
        const isPinned = r.name === pinned;
        items.push({ separator: true });
        items.push({
          label: isPinned ? 'Unpin from Left' : 'Pin to Left',
          hint: isPinned ? 'give column 0 back to the checked-out branch' : 'keep this branch in the leftmost column',
          onClick: () => pinBranch(isPinned ? null : r.name),
        });
        items.push({ separator: true });
        items.push({
          label: `Rename ${r.name}…`,
          onClick: async () => {
            const res = await ui.prompt({ title: 'Rename branch', label: 'New name', defaultValue: r.name, okLabel: 'Rename' });
            if (res && res.value !== r.name) await run('Renaming branch', () => window.api.renameBranch(repo!, r.name, res.value));
          },
        });
        items.push({
          label: `Push ${r.name}${r.upstream ? ` to ${r.upstream}` : ' and set upstream'}`,
          disabled: !snapshot?.remotes.length,
          onClick: () => run(`Pushing ${r.name}`, () => window.api.push(repo!, { branch: r.name, setUpstream: !r.upstream })),
        });
      }
      items.push({ separator: true });
      items.push({ label: `Delete ${r.name}`, danger: true, disabled: r.isHead, onClick: () => deleteBranch(r) });
      items.push({ separator: true });
      items.push({ label: 'Copy branch name', onClick: () => void navigator.clipboard.writeText(r.name) });
      return items;
    },
    [checkoutRef, createBranchAt, currentBranch, deleteBranch, pinBranch, pinned, repo, run, snapshot, ui],
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
        { label: 'Cherry pick commit', disabled: !currentBranch, onClick: () => run(`Cherry-picking ${short}`, () => window.api.cherryPick(repo!, c.sha)) },
        { label: 'Revert commit', disabled: !currentBranch, onClick: () => run(`Reverting ${short}`, () => window.api.revert(repo!, c.sha)) },
        { separator: true },
        resetItem('soft', 'keep all changes staged'),
        resetItem('mixed', 'keep changes in the working directory'),
        resetItem('hard', 'discard all changes'),
        { separator: true },
        { label: 'Copy commit sha', onClick: () => void navigator.clipboard.writeText(c.sha) },
        { label: 'Copy commit summary', onClick: () => void navigator.clipboard.writeText(c.summary) },
      ];
    },
    [createBranchAt, createTagAt, currentBranch, repo, run, runCheckout, ui],
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
    <div className="app">
      <TitleBar repoName={snapshot?.info.name ?? null} onOpenRepo={openRepo} />
      <Toolbar
        info={snapshot?.info ?? null}
        busy={busy !== null}
        ahead={snapshot?.status.ahead ?? 0}
        behind={snapshot?.status.behind ?? 0}
        hasUpstream={!!headRef?.upstream}
        hasRemotes={(snapshot?.remotes.length ?? 0) > 0}
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
              collapsed={leftCollapsed || fileView !== null}
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
                refs={snapshot.refs}
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
              />
            )}
            <DetailPanel
              repo={repo}
              commit={selectedCommit}
              headCommit={headCommit}
              status={snapshot.status}
              openFile={fileView}
              actions={actions}
              onSelectSha={select}
              onOpenFile={setFileView}
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
      <StatusBar repoPath={repoPath} commitCount={commits.length} busy={busy} error={error} onDismissError={() => setError(null)} />
      {prefsOpen && <Preferences onClose={() => setPrefsOpen(false)} />}
      {shortcutsOpen && <Shortcuts onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
