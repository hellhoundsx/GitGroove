import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { release } from 'node:os';
import type {
  ApplyPatchOptions,
  CheckoutOptions,
  CommitRequest,
  ConflictSide,
  CreateBranchRequest,
  CreateTagRequest,
  DiffOptions,
  DiscardRequest,
  IgnoreKind,
  IgnoreRequest,
  PullMode,
  PushRequest,
  ResetMode,
  StashSaveRequest,
  WorkdirDiffRequest,
} from '@shared/types';
import { isWebUrl } from '@shared/remotes';
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
 * The OS window controls are drawn by Windows, not by us, so they are the one part of the frame
 * `tokens.css` cannot reach (GC-013). Kept here rather than read from CSS because the window is
 * created before any renderer exists to ask.
 *
 * One pair, not one per theme (GC-213): there is one look now, so these are `--bg-chrome`'s
 * ground and a symbol colour off `--text-muted`, and nothing ever repaints them. `window:theme`
 * and the `window-theme.json` that remembered what to build the next window with went with the
 * setting — with a single palette there is nothing to remember and nothing to get wrong on the
 * first frame, which is the whole of what GC-102 existed to solve.
 */
export const TITLE_BAR_OVERLAY = { color: '#141414', symbolColor: '#adadad', height: 34 };

/** `--bg-app`, for the same reason: the window is painted before any renderer exists to ask. */
export const WINDOW_BACKGROUND = '#141414';

/**
 * Whether this process can put the window material behind a window at all (GC-212). The material
 * is **acrylic** (GC-213, see `index.ts`). Three conditions, each
 * ruling it out for a reason rather than out of caution:
 *
 * - **Windows 11** (build 22000) is where the materials exist.
 * - **Not stealth.** A stealth launch is rendered offscreen, so there is no OS window for the
 *   compositor to put anything behind; asking would leave the renderer stamping a translucent
 *   ground over nothing and every unattended screenshot would come back over a void.
 * - A **Windows 11 that refuses** — transparency effects switched off — needs nothing here: the OS
 *   substitutes a solid backdrop itself, so the window is still painted.
 *
 * Exported because `index.ts` both builds the window with it and tells the renderer about it: the
 * answer travels as a query parameter on the URL rather than over IPC (GC-213), so `main.tsx` can
 * stamp `data-material` before the first render instead of a frame or two after it.
 */
export const glassAvailable =
  process.platform === 'win32' &&
  process.env.GITCLIENT_STEALTH !== '1' &&
  Number(release().split('.')[2] ?? 0) >= 22000;

/** The three patterns the row menu can write, validated like every other enum argument (GC-093). */
const IGNORE_KINDS: readonly IgnoreKind[] = ['file', 'extension', 'folder'];
const CONFLICT_SIDES: readonly ConflictSide[] = ['ours', 'theirs'];

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
 * The containment check on its own, answering the repository-relative path: the renderer named a
 * path, and this is the one implementation of "it has to land inside this repository" — a `..`, an
 * absolute path and another Windows drive are all refused (GC-093). It says nothing about the
 * working tree, which is what makes it usable by the handlers that ask git about a file the tree no
 * longer has: `repo:fileLog` follows a deleted file by construction (GC-166), and
 * `workdir:resolveConflict` and `workdir:restoreFile` name a path git resolves for itself. Those
 * three took a bare `str` before this existed, each with its own comment explaining why it could
 * not use `repoRel` — so the check that actually matters was skipped by exactly the handlers that
 * could not afford the other one (GC-198).
 */
function repoRelAny(repo: unknown, path: unknown): string {
  const root = resolve(repoOf(repo));
  const rel = str(path, 'A file path');
  const inside = relative(root, resolve(root, rel));
  // relative() answers '' for the repository itself and an absolute path when the two are on
  // different Windows drives, so neither is "inside".
  if (inside === '' || inside === '..' || inside.startsWith('../') || inside.startsWith('..\\') || isAbsolute(inside)) throw new Error(`Path is outside the repository: ${rel}`);
  return inside.replace(/\\/g, '/');
}

/**
 * That check plus the working tree: what `workdir:ignore` builds its pattern from, and what
 * `repoFile()` resolves, so neither can be made out of a path this repository does not have on
 * disk (GC-093).
 */
function repoRel(repo: unknown, path: unknown): string {
  const rel = repoRelAny(repo, path);
  if (!existsSync(resolve(resolve(repoOf(repo)), rel))) throw new Error(`File not found in the working tree: ${rel}`);
  return rel;
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
  // One path's history (GC-166), through `repoRelAny`: the containment check without the
  // working-tree one, which is the pairing this handler needs — a history is read precisely for a
  // file the tree no longer has (GC-198).
  ipcMain.handle('repo:fileLog', (_e, repo: unknown, path: unknown, maxCount?: unknown) => {
    const max = typeof maxCount === 'number' && maxCount > 0 ? Math.min(maxCount, 5000) : 200;
    return git.getFileLog(repoOf(repo), repoRelAny(repo, path), max);
  });
  ipcMain.handle('repo:status', (_e, repo: unknown) => git.getStatus(repoOf(repo)));
  // The `window:*` group is gone with the settings it served (GC-213). `window:theme` repainted
  // the OS window controls for a theme that no longer varies, and `window:material` answered
  // which of three materials had been applied when there is now one, decided before the window
  // exists and told to the renderer on the URL. Two channels, two preload entries and a
  // `window-theme.json` under every profile, all in service of a choice that has been removed.
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
  // The comparison against the working directory (GC-152): the same two shapes one source over.
  ipcMain.handle('commit:compare', (_e, repo: unknown, sha: unknown) => git.getCompare(repoOf(repo), str(sha, 'A commit sha')));
  ipcMain.handle('commit:compareFileDiff', (_e, repo: unknown, sha: unknown, path: unknown, opts: unknown) => {
    const o = (opts ?? {}) as Partial<DiffOptions>;
    return git.getCompareFileDiff(repoOf(repo), str(sha, 'A commit sha'), str(path, 'A file path'), { ignoreWhitespace: !!o.ignoreWhitespace });
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
  ipcMain.handle('workdir:resolveConflict', (_e, repo: unknown, path: unknown, side: unknown) =>
    git.resolveConflict(repoOf(repo), repoRelAny(repo, path), oneOf(side, CONFLICT_SIDES, 'A conflict side')),
  );
  ipcMain.handle('workdir:restoreFile', (_e, repo: unknown, sha: unknown, path: unknown) => git.restoreFile(repoOf(repo), str(sha, 'A commit sha'), repoRelAny(repo, path)));
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
  // The one `shell:*` channel with no repository and so no `repoFile()` to lean on (GC-159): what
  // it hands to the OS is a URL, and `shell.openExternal` follows whatever it is given, so a
  // `file:` or `javascript:` URL would be a way out of the app. `isWebUrl` is the whole check and
  // it is shared with `setWindowOpenHandler`, the other place a URL reaches `openExternal`.
  ipcMain.handle('shell:openExternal', async (_e, url: unknown) => {
    const u = str(url, 'url');
    if (!isWebUrl(u)) throw new Error(`Refusing to open ${u}: only http and https links are opened`);
    await shell.openExternal(u);
  });
}
