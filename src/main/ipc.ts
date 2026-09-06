import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type {
  ApplyPatchOptions,
  CheckoutOptions,
  CommitRequest,
  CreateBranchRequest,
  CreateTagRequest,
  DiffOptions,
  DiscardRequest,
  IgnoreKind,
  IgnoreRequest,
  PullMode,
  PushRequest,
  ResetMode,
  ResolvedTheme,
  StashSaveRequest,
  WorkdirDiffRequest,
} from '@shared/types';
import * as git from './git';
import { watchRepo } from './watch';

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${what} is required`);
  return value;
}

function strs(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((p) => typeof p !== 'string' || p.length === 0)) throw new Error(`${what} must be a list of strings`);
  return value as string[];
}

function int(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${what} must be a non-negative integer`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new Error(`${what} must be one of ${allowed.join(', ')}`);
  return value as T;
}

const repoOf = (v: unknown): string => str(v, 'A repository path');

/**
 * The OS window controls are drawn by Windows, not by us, so they are the one part of the frame a
 * `tokens.css` theme cannot reach: they keep whatever colours the window was built with until the
 * renderer says the theme changed (GC-013). These two pairs are the `--bg-titlebar` and a text
 * colour from each palette, kept here rather than read from CSS because the window is created
 * before any renderer exists to ask.
 */
export const TITLE_BAR_OVERLAY: Record<ResolvedTheme, { color: string; symbolColor: string; height: number }> = {
  dark: { color: '#2a2d34', symbolColor: '#d4d6db', height: 34 },
  light: { color: '#e3e5ea', symbolColor: '#3a3d44', height: 34 },
};

/**
 * Repaint one window's controls. Only Windows draws an overlay, and only a window built with
 * `titleBarStyle: 'hidden'` accepts one, so a platform that has neither is a no-op rather than an
 * error reaching the renderer as a failed IPC call.
 */
function applyTitleBarOverlay(win: BrowserWindow, theme: ResolvedTheme): void {
  if (process.platform !== 'win32') return;
  try {
    win.setTitleBarOverlay(TITLE_BAR_OVERLAY[theme]);
  } catch {
    /* a window without an overlay has nothing to repaint */
  }
}

/** The two themes the window controls can be painted for, validated like every other enum (GC-013). */
const THEMES: readonly ResolvedTheme[] = ['dark', 'light'];

/**
 * `--bg-app` from each palette, for the same reason the overlay pairs are here: the window is
 * painted before any renderer exists to ask (GC-102). The dark value used to be a `#1b1d22` of its
 * own in `index.ts`, one shade off the token it was standing in for.
 */
export const WINDOW_BACKGROUND: Record<ResolvedTheme, string> = { dark: '#1c1e23', light: '#f1f2f5' };

/**
 * The theme setting itself lives in the renderer's `localStorage` — `prefs.ts` resolves `system`
 * there and reports the answer over `window:theme` (GC-013) — so the main process has no way to
 * know it at `createWindow` time and built every window dark, whatever the theme (GC-102). It gets
 * its own copy: one small file under the profile's `userData`, which is per Electron profile, so a
 * launcher run on its own port cannot change what Ricardo's window opens as (GC-060).
 *
 * Read lazily rather than at module scope, because `index.ts` applies `GITCLIENT_USER_DATA` with
 * `app.setPath` after this module has been imported.
 */
const themeFile = (): string => join(app.getPath('userData'), 'window-theme.json');

/** What to build the next window with. A first-ever start has nothing remembered, and stays dark. */
export function rememberedTheme(): ResolvedTheme {
  try {
    const raw = JSON.parse(readFileSync(themeFile(), 'utf8')) as { theme?: unknown };
    return (THEMES as readonly string[]).includes(raw.theme as string) ? (raw.theme as ResolvedTheme) : 'dark';
  } catch {
    return 'dark'; // no file yet, or one edited into something that is not a theme
  }
}

function rememberTheme(theme: ResolvedTheme): void {
  try {
    writeFileSync(themeFile(), JSON.stringify({ theme }));
  } catch {
    /* a profile we cannot write to only costs the next start its first frame */
  }
}

/** The three patterns the row menu can write, validated like every other enum argument (GC-093). */
const IGNORE_KINDS: readonly IgnoreKind[] = ['file', 'extension', 'folder'];

/**
 * A repository-relative file path for the `shell:*` channels, resolved to an absolute one (GC-043).
 * Those two hand a path straight to the operating system, so the renderer is not trusted with it:
 * resolve against the repository and refuse anything that does not land inside it, which is what
 * stops a `..`, an absolute path or another drive from reaching `shell`. Existence is checked here
 * too so a file that has since been deleted reports that rather than opening nothing.
 */
function repoFile(repo: unknown, path: unknown): string {
  return resolve(resolve(repoOf(repo)), repoRel(repo, path));
}

/**
 * The same check, answering the repository-relative path instead of the absolute one: what
 * `workdir:ignore` builds its pattern from, so a pattern can never be made out of a path that
 * does not belong to this repository (GC-093).
 */
function repoRel(repo: unknown, path: unknown): string {
  const root = resolve(repoOf(repo));
  const rel = str(path, 'A file path');
  const full = resolve(root, rel);
  const inside = relative(root, full);
  // relative() answers '' for the repository itself and an absolute path when the two are on
  // different Windows drives, so neither is "inside".
  if (inside === '' || inside === '..' || inside.startsWith('../') || inside.startsWith('..\\') || isAbsolute(inside)) throw new Error(`Path is outside the repository: ${rel}`);
  if (!existsSync(full)) throw new Error(`File not found in the working tree: ${rel}`);
  return inside.replace(/\\/g, '/');
}

export function registerIpc(): void {
  ipcMain.handle('repo:checkGit', () => git.checkGit());

  ipcMain.handle('repo:openDialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = { title: 'Open repository', properties: ['openDirectory'] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Making a repository rather than opening one (GC-128). Neither of the two git handlers takes
  // a repository path — there is no repository yet — so neither goes through `repoOf`: the clone
  // is run in its parent folder and the init in the folder it is turning into one.
  ipcMain.handle('repo:chooseFolder', async (event, title: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = { title: str(title, 'A dialog title'), properties: ['openDirectory', 'createDirectory'] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('repo:clone', (_e, url: unknown, parentDir: unknown, name?: unknown) =>
    git.cloneRepo(str(url, 'A repository URL'), str(parentDir, 'A folder to clone into'), name === undefined || name === null ? undefined : str(name, 'A folder name')),
  );
  ipcMain.handle('repo:init', (_e, dir: unknown) => git.initRepo(str(dir, 'A folder to initialise')));

  ipcMain.handle('repo:load', (_e, path: unknown, maxCommits?: unknown, exclude?: unknown) => {
    const max = typeof maxCommits === 'number' && maxCommits > 0 ? Math.min(maxCommits, 20000) : 500;
    // The hidden refs are optional, so an omitted argument is an empty list rather than an error.
    return git.loadRepo(repoOf(path), max, exclude === undefined || exclude === null ? [] : strs(exclude, 'The hidden refs'));
  });
  // One more page of the same traversal `repo:load` opened (GC-012). Only the commits: the refs,
  // the status and the stashes describe the repository as a whole and are already on screen.
  ipcMain.handle('repo:log', (_e, path: unknown, skip: unknown, maxCommits?: unknown, exclude?: unknown) => {
    const max = typeof maxCommits === 'number' && maxCommits > 0 ? Math.min(maxCommits, 20000) : 500;
    return git.getLog(repoOf(path), max, exclude === undefined || exclude === null ? [] : strs(exclude, 'The hidden refs'), int(skip, 'The number of commits to skip'));
  });
  ipcMain.handle('repo:status', (_e, repo: unknown) => git.getStatus(repoOf(repo)));
  // The one channel that touches neither git nor the file system: the window controls Windows
  // draws for us, repainted for the theme the renderer resolved (GC-013).
  ipcMain.handle('window:theme', (event, theme: unknown) => {
    const resolved = oneOf(theme, THEMES, 'A theme');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) applyTitleBarOverlay(win, resolved);
    // Remembered whether or not there is a window to repaint: what the next start is built with
    // is the point, and this is the only moment the main process is ever told (GC-102).
    rememberTheme(resolved);
  });
  // The watcher pushes on `repo:changed`; this is only the renderer saying what to watch (GC-011).
  ipcMain.handle('repo:watch', (event, repo: unknown) => {
    watchRepo(event.sender, repo === null || repo === undefined ? null : repoOf(repo));
  });

  // commits and diffs
  ipcMain.handle('commit:files', (_e, repo: unknown, sha: unknown) => git.getCommitFiles(repoOf(repo), str(sha, 'A commit sha')));
  ipcMain.handle('commit:fileDiff', (_e, repo: unknown, sha: unknown, path: unknown, opts: unknown) => {
    const o = (opts ?? {}) as Partial<DiffOptions>;
    return git.getCommitFileDiff(repoOf(repo), str(sha, 'A commit sha'), str(path, 'A file path'), { ignoreWhitespace: !!o.ignoreWhitespace });
  });
  ipcMain.handle('workdir:fileDiff', (_e, repo: unknown, req: unknown) => {
    const r = (req ?? {}) as Partial<WorkdirDiffRequest>;
    return git.getWorkdirFileDiff(repoOf(repo), { path: str(r.path, 'A file path'), staged: !!r.staged, untracked: !!r.untracked, ignoreWhitespace: !!r.ignoreWhitespace });
  });

  // staging and committing
  ipcMain.handle('workdir:stage', (_e, repo: unknown, paths: unknown) => git.stage(repoOf(repo), strs(paths, 'paths')));
  ipcMain.handle('workdir:unstage', (_e, repo: unknown, paths: unknown) => git.unstage(repoOf(repo), strs(paths, 'paths')));
  ipcMain.handle('workdir:stageAll', (_e, repo: unknown) => git.stageAll(repoOf(repo)));
  ipcMain.handle('workdir:unstageAll', (_e, repo: unknown) => git.unstageAll(repoOf(repo)));
  ipcMain.handle('workdir:discard', (_e, repo: unknown, req: unknown) => {
    const r = (req ?? {}) as Partial<DiscardRequest>;
    return git.discard(repoOf(repo), { tracked: r.tracked ? strs(r.tracked, 'tracked') : [], untracked: r.untracked ? strs(r.untracked, 'untracked') : [] });
  });
  ipcMain.handle('workdir:ignore', (_e, repo: unknown, req: unknown) => {
    const r = (req ?? {}) as Partial<IgnoreRequest>;
    // The path is validated the way the shell channels validate theirs, and the pattern is built
    // from what comes back rather than from what the renderer sent (GC-093).
    return git.ignore(repoOf(repo), { path: repoRel(repo, r.path), kind: oneOf(r.kind, IGNORE_KINDS, 'An ignore kind') });
  });
  ipcMain.handle('workdir:restoreFile', (_e, repo: unknown, sha: unknown, path: unknown) => git.restoreFile(repoOf(repo), str(sha, 'A commit sha'), str(path, 'A file path')));
  ipcMain.handle('workdir:applyPatch', (_e, repo: unknown, patch: unknown, opts: unknown) => {
    const o = (opts ?? {}) as ApplyPatchOptions;
    return git.applyPatch(repoOf(repo), str(patch, 'A patch'), { cached: !!o.cached, reverse: !!o.reverse });
  });
  ipcMain.handle('workdir:commit', (_e, repo: unknown, req: unknown) => {
    const r = (req ?? {}) as Partial<CommitRequest>;
    return git.commit(repoOf(repo), { summary: typeof r.summary === 'string' ? r.summary : '', body: typeof r.body === 'string' ? r.body : undefined, amend: !!r.amend });
  });

  // refs and history
  ipcMain.handle('ref:checkout', (_e, repo: unknown, ref: unknown, opts: unknown) => {
    const o = (opts ?? {}) as CheckoutOptions;
    return git.checkout(repoOf(repo), str(ref, 'A ref'), { detach: !!o.detach, track: !!o.track });
  });
  ipcMain.handle('ref:createBranch', (_e, repo: unknown, req: unknown) => {
    const r = (req ?? {}) as Partial<CreateBranchRequest>;
    return git.createBranch(repoOf(repo), { name: str(r.name, 'A branch name'), startPoint: typeof r.startPoint === 'string' ? r.startPoint : undefined, checkout: !!r.checkout });
  });
  ipcMain.handle('ref:deleteBranch', (_e, repo: unknown, name: unknown, force: unknown) => git.deleteBranch(repoOf(repo), str(name, 'A branch name'), !!force).then(() => undefined));
  ipcMain.handle('ref:renameBranch', (_e, repo: unknown, oldName: unknown, newName: unknown) =>
    git.renameBranch(repoOf(repo), str(oldName, 'The current branch name'), str(newName, 'The new branch name')).then(() => undefined),
  );
  ipcMain.handle('ref:deleteRemoteBranch', (_e, repo: unknown, remote: unknown, branch: unknown) =>
    git.deleteRemoteBranch(repoOf(repo), str(remote, 'A remote'), str(branch, 'A branch name')).then(() => undefined),
  );
  ipcMain.handle('ref:merge', (_e, repo: unknown, ref: unknown) => git.merge(repoOf(repo), str(ref, 'A ref')).then(() => undefined));
  ipcMain.handle('ref:rebase', (_e, repo: unknown, onto: unknown) => git.rebase(repoOf(repo), str(onto, 'A ref')).then(() => undefined));
  ipcMain.handle('ref:cherryPick', (_e, repo: unknown, sha: unknown) => git.cherryPick(repoOf(repo), str(sha, 'A commit sha')).then(() => undefined));
  ipcMain.handle('ref:revert', (_e, repo: unknown, sha: unknown) => git.revert(repoOf(repo), str(sha, 'A commit sha')).then(() => undefined));
  ipcMain.handle('ref:reset', (_e, repo: unknown, mode: unknown, sha: unknown) =>
    git.reset(repoOf(repo), oneOf<ResetMode>(mode, ['soft', 'mixed', 'hard'], 'Reset mode'), str(sha, 'A commit sha')).then(() => undefined),
  );
  ipcMain.handle('ref:abortOperation', (_e, repo: unknown) => git.abortOperation(repoOf(repo)));
  ipcMain.handle('ref:createTag', (_e, repo: unknown, req: unknown) => {
    const r = (req ?? {}) as Partial<CreateTagRequest>;
    return git.createTag(repoOf(repo), { name: str(r.name, 'A tag name'), sha: typeof r.sha === 'string' ? r.sha : undefined, message: typeof r.message === 'string' ? r.message : undefined });
  });
  ipcMain.handle('ref:deleteTag', (_e, repo: unknown, name: unknown) => git.deleteTag(repoOf(repo), str(name, 'A tag name')).then(() => undefined));
  ipcMain.handle('ref:deleteRemoteTag', (_e, repo: unknown, remote: unknown, name: unknown) => git.deleteRemoteTag(repoOf(repo), str(remote, 'A remote name'), str(name, 'A tag name')));

  ipcMain.handle('ref:fastForward', (_e, repo: unknown, branch: unknown, upstream: unknown) =>
    git.fastForward(repoOf(repo), str(branch, 'A branch name'), str(upstream, 'An upstream ref')),
  );
  ipcMain.handle('ref:setUpstream', (_e, repo: unknown, branch: unknown, upstream: unknown) =>
    // null clears it, which is what `Unset upstream` sends (GC-100)
    git.setUpstream(repoOf(repo), str(branch, 'A branch name'), upstream === null || upstream === undefined ? null : str(upstream, 'An upstream ref')),
  );

  // remotes
  ipcMain.handle('remote:add', (_e, repo: unknown, name: unknown, url: unknown) => git.remoteAdd(repoOf(repo), str(name, 'A remote name'), str(url, 'A remote URL')));
  ipcMain.handle('remote:remove', (_e, repo: unknown, name: unknown) => git.remoteRemove(repoOf(repo), str(name, 'A remote name')).then(() => undefined));
  ipcMain.handle('remote:setUrl', (_e, repo: unknown, name: unknown, url: unknown) =>
    git.remoteSetUrl(repoOf(repo), str(name, 'A remote name'), str(url, 'A remote URL')).then(() => undefined),
  );
  ipcMain.handle('remote:rename', (_e, repo: unknown, oldName: unknown, newName: unknown) =>
    git.remoteRename(repoOf(repo), str(oldName, 'A remote name'), str(newName, 'A remote name')).then(() => undefined),
  );
  ipcMain.handle('remote:fetch', (_e, repo: unknown, remote: unknown) => git.fetch(repoOf(repo), typeof remote === 'string' && remote ? remote : undefined));
  ipcMain.handle('remote:pull', (_e, repo: unknown, mode: unknown, remote: unknown) =>
    // an optional remote, validated the way `remote:fetch`'s is: absent means the upstream (GC-057)
    git.pull(repoOf(repo), oneOf<PullMode>(mode, ['ff', 'ff-only', 'rebase'], 'Pull mode'), typeof remote === 'string' && remote ? remote : undefined),
  );
  ipcMain.handle('remote:push', (_e, repo: unknown, req: unknown) => {
    const r = (req ?? {}) as Partial<PushRequest>;
    return git.push(repoOf(repo), {
      remote: typeof r.remote === 'string' ? r.remote : undefined,
      branch: typeof r.branch === 'string' ? r.branch : undefined,
      setUpstream: !!r.setUpstream,
      force: !!r.force,
      tags: !!r.tags,
    });
  });

  // Kills a remote command waiting on a credential (GC-169). Like `repo:checkGit` it takes no
  // arguments: what it stops is a process, not something inside a repository.
  ipcMain.handle('remote:cancel', () => git.cancelRemote());

  // stashes
  ipcMain.handle('stash:save', (_e, repo: unknown, req: unknown) => {
    const r = (req ?? {}) as Partial<StashSaveRequest>;
    return git.stashSave(repoOf(repo), { message: typeof r.message === 'string' ? r.message : undefined, includeUntracked: !!r.includeUntracked });
  });
  ipcMain.handle('stash:apply', (_e, repo: unknown, index: unknown) => git.stashApply(repoOf(repo), int(index, 'Stash index')).then(() => undefined));
  ipcMain.handle('stash:pop', (_e, repo: unknown, index: unknown) => git.stashPop(repoOf(repo), int(index, 'Stash index')).then(() => undefined));
  ipcMain.handle('stash:drop', (_e, repo: unknown, index: unknown) => git.stashDrop(repoOf(repo), int(index, 'Stash index')).then(() => undefined));
  ipcMain.handle('stash:rename', (_e, repo: unknown, index: unknown, message: unknown) => git.stashRename(repoOf(repo), int(index, 'Stash index'), str(message, 'A stash message')));

  // opening a file in the OS (GC-043): Electron's own `shell`, no git anywhere in it, which is why
  // these two live here and not in git.ts.
  ipcMain.handle('shell:openPath', async (_e, repo: unknown, path: unknown) => {
    // openPath reports a failure as a message and resolves anyway, so turn one into a rejection.
    const failure = await shell.openPath(repoFile(repo, path));
    if (failure) throw new Error(failure);
  });
  ipcMain.handle('shell:showItemInFolder', (_e, repo: unknown, path: unknown) => {
    shell.showItemInFolder(repoFile(repo, path));
  });
}
