// Types shared between the Electron main process, the preload bridge and the renderer.

export interface Commit {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string; // ISO 8601
  committerName: string;
  committerDate: string; // ISO 8601
  summary: string;
  body: string;
  /** Decorations as reported by git (%D): "HEAD -> main, origin/main, tag: v1" */
  refs: string[];
}

export type RefKind = 'head' | 'remote' | 'tag' | 'stash';

export interface GitRef {
  name: string; // short name, e.g. "main", "origin/main", "v1.0"
  fullName: string; // refs/heads/main
  kind: RefKind;
  sha: string;
  isHead: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export interface Stash {
  index: number; // stash@{index}
  sha: string;
  message: string;
  date: string; // ISO-ish from %ci
  /** The commit the stash was taken from — its first parent, which is where the graph marks it (GC-140). */
  parent: string;
}

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export type FileChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted' | 'typechange';

export interface StatusEntry {
  path: string;
  origPath?: string;
  staged: FileChangeKind | null;
  unstaged: FileChangeKind | null;
  /**
   * The two-letter porcelain code of an unmerged path — `UU`, `DU`, `AA` and the rest — set only
   * on a conflicted entry (GC-181). `staged`/`unstaged` collapse all seven to `conflicted`, which
   * is all the file list needs, but which side git actually holds a blob for is the difference
   * between an action that works and one that fails, and only the code says.
   */
  unmerged?: string;
}

/** Which side of a conflict to keep: git's `--ours` (stage 2) or `--theirs` (stage 3). */
export type ConflictSide = 'ours' | 'theirs';

/**
 * The stages an unmerged path actually has, by porcelain code (GC-181). `git checkout --ours`
 * needs stage 2 and `--theirs` needs stage 3, and a conflict where one side deleted or only added
 * the file has only one of them — so the code is what decides whether an action can be offered at
 * all rather than offered and then failing. Both letters are needed: `UA` and `AU` differ only in
 * which side the addition came from.
 */
const CONFLICT_STAGES: Record<string, ConflictSide[]> = {
  UU: ['ours', 'theirs'], // both modified
  AA: ['ours', 'theirs'], // both added
  AU: ['ours'], // added by us, no stage 3
  UD: ['ours'], // deleted by them, no stage 3
  UA: ['theirs'], // added by them, no stage 2
  DU: ['theirs'], // deleted by us, no stage 2
  DD: [], // both deleted: neither side has a blob to keep
};

/** Which sides of a conflict can be checked out, given its porcelain code. */
export function conflictSides(code: string | undefined): ConflictSide[] {
  return code === undefined ? [] : (CONFLICT_STAGES[code] ?? []);
}

export type RepoOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null;

export interface RepoStatus {
  branch: string | null; // null when detached
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: StatusEntry[];
  operation: RepoOperation; // an in-progress merge/rebase/cherry-pick/revert
}

export interface RepoInfo {
  path: string; // top level working directory
  name: string;
  headSha: string | null;
  branch: string | null;
}

/** The result of the startup `git --version` probe (GC-025). */
export interface GitAvailability {
  available: boolean;
  version?: string; // "git version 2.45.0" when it ran
  error?: string; // why it did not, ready to show
}

export interface RepoSnapshot {
  info: RepoInfo;
  commits: Commit[];
  refs: GitRef[];
  status: RepoStatus;
  stashes: Stash[];
  remotes: Remote[];
}

/** A file-system change the main process saw under the watched repository (GC-011). */
export interface RepoChange {
  repo: string; // the repository the watcher was pointed at
  /** 'refs' when the graph moved (`.git/refs`, HEAD, packed-refs), 'tree' when only the status did. */
  scope: 'tree' | 'refs';
}

export interface CommitFile {
  path: string;
  origPath?: string;
  kind: FileChangeKind;
}

export interface WorkdirDiffRequest {
  path: string;
  staged: boolean;
  untracked: boolean;
  /** `-w`, so a whitespace-only change produces no hunk at all (GC-052). */
  ignoreWhitespace?: boolean;
}

/** The one option a committed file's diff takes (GC-052). */
export interface DiffOptions {
  ignoreWhitespace?: boolean;
}

/** What an "Ignore …" row writes: the file itself, everything with its extension, or its folder (GC-093). */
export type IgnoreKind = 'file' | 'extension' | 'folder';

export interface IgnoreRequest {
  /** Repository-relative path of the row the menu was opened on. */
  path: string;
  kind: IgnoreKind;
}

export interface DiscardRequest {
  tracked: string[];
  untracked: string[];
}

export interface ApplyPatchOptions {
  cached?: boolean;
  reverse?: boolean;
}

export interface CommitRequest {
  summary: string; // may be empty when concluding a merge (git uses MERGE_MSG)
  body?: string;
  amend?: boolean;
}

export type PullMode = 'ff' | 'ff-only' | 'rebase';

/** The theme setting. `system` follows the OS (GC-013). */
export type Theme = 'dark' | 'light' | 'system';
/** The theme actually on screen: `system` already resolved by the renderer (GC-013). */
export type ResolvedTheme = 'dark' | 'light';
export type ResetMode = 'soft' | 'mixed' | 'hard';

export interface CheckoutOptions {
  detach?: boolean;
  /** For remote branches: create a local tracking branch. */
  track?: boolean;
}

export interface CreateBranchRequest {
  name: string;
  startPoint?: string;
  checkout?: boolean;
}

export interface CreateTagRequest {
  name: string;
  sha?: string;
  message?: string; // annotated when given
}

export interface PushRequest {
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  force?: boolean;
  tags?: boolean;
}

export interface StashSaveRequest {
  message?: string;
  includeUntracked?: boolean;
}

export interface GitApi {
  checkGit(): Promise<GitAvailability>;
  openRepoDialog(): Promise<string | null>;
  /**
   * Pick a folder for a clone's parent or an init's target (GC-128). The same dialog
   * `openRepoDialog` uses, titled for what it is being asked for, so the two entry points that
   * make a repository do not each grow one of their own.
   */
  chooseFolder(title: string): Promise<string | null>;
  /**
   * Clone `url` into a new folder under `parentDir`, answering the absolute path of the
   * repository it made — which is what `openPath` takes (GC-128).
   */
  cloneRepo(url: string, parentDir: string, name?: string): Promise<string>;
  /** `git init` in an existing folder, answering the repository's absolute path (GC-128). */
  initRepo(dir: string): Promise<string>;
  /** `exclude`: full names of refs to keep out of the graph (GC-073). */
  loadRepo(path: string, maxCommits?: number, exclude?: string[]): Promise<RepoSnapshot>;
  /**
   * One more page of the log, continuing the traversal `loadRepo` opened (GC-012). `exclude` must
   * be the set the page before it was loaded with, or `skip` counts through a different traversal.
   */
  getLog(path: string, skip: number, maxCommits?: number, exclude?: string[]): Promise<Commit[]>;
  /**
   * The commits that touched one path, newest first, with `--follow` (GC-166). Its own traversal:
   * the graph's globs and hidden set have no part in a question about one file.
   */
  getFileLog(repo: string, path: string, maxCount?: number): Promise<Commit[]>;
  getStatus(repo: string): Promise<RepoStatus>;
  /** Repaint the OS window controls for the theme now showing (GC-013). */
  setTheme(theme: ResolvedTheme): Promise<void>;
  /** Point the file-system watcher at a repository, or pass null to stop it (GC-011). */
  watchRepo(repo: string | null): Promise<void>;
  /** Subscribe to watcher pushes; the returned function unsubscribes (GC-011). */
  onRepoChanged(listener: (change: RepoChange) => void): () => void;
  getCommitFiles(repo: string, sha: string): Promise<CommitFile[]>;
  getCommitFileDiff(repo: string, sha: string, path: string, opts?: DiffOptions): Promise<string>;
  /** The files that differ between a commit and the working directory, and one file of them (GC-152). */
  getCompare(repo: string, sha: string): Promise<CommitFile[]>;
  getCompareFileDiff(repo: string, sha: string, path: string, opts?: DiffOptions): Promise<string>;
  getWorkdirFileDiff(repo: string, req: WorkdirDiffRequest): Promise<string>;
  stage(repo: string, paths: string[]): Promise<void>;
  unstage(repo: string, paths: string[]): Promise<void>;
  stageAll(repo: string): Promise<void>;
  unstageAll(repo: string): Promise<void>;
  discard(repo: string, req: DiscardRequest): Promise<void>;
  /** Keep one side of a conflicted path and stage it, in one action (GC-181). */
  resolveConflict(repo: string, path: string, side: ConflictSide): Promise<void>;
  ignore(repo: string, req: IgnoreRequest): Promise<void>;
  /** Write one file back to the way a commit had it, staged as git leaves it (GC-107). */
  restoreFile(repo: string, sha: string, path: string): Promise<void>;
  applyPatch(repo: string, patch: string, opts: ApplyPatchOptions): Promise<void>;
  commit(repo: string, req: CommitRequest): Promise<string>;
  // refs and history
  checkout(repo: string, ref: string, opts?: CheckoutOptions): Promise<void>;
  createBranch(repo: string, req: CreateBranchRequest): Promise<void>;
  deleteBranch(repo: string, name: string, force?: boolean): Promise<void>;
  renameBranch(repo: string, oldName: string, newName: string): Promise<void>;
  deleteRemoteBranch(repo: string, remote: string, branch: string): Promise<void>;
  merge(repo: string, ref: string): Promise<void>;
  rebase(repo: string, onto: string): Promise<void>;
  cherryPick(repo: string, sha: string): Promise<void>;
  revert(repo: string, sha: string): Promise<void>;
  reset(repo: string, mode: ResetMode, sha: string): Promise<void>;
  abortOperation(repo: string): Promise<void>;
  createTag(repo: string, req: CreateTagRequest): Promise<void>;
  deleteTag(repo: string, name: string): Promise<void>;
  /** Delete a tag on a remote, by its fully qualified refs/tags name (GC-112). */
  deleteRemoteTag(repo: string, remote: string, name: string): Promise<void>;
  /** Move a branch up to its upstream without checking it out; never anything but a fast-forward (GC-100). */
  fastForward(repo: string, branch: string, upstream: string): Promise<void>;
  /** Point a branch at an upstream, or clear it with `null` (GC-100). */
  setUpstream(repo: string, branch: string, upstream: string | null): Promise<void>;
  // remotes
  remoteAdd(repo: string, name: string, url: string): Promise<void>;
  remoteRemove(repo: string, name: string): Promise<void>;
  remoteSetUrl(repo: string, name: string, url: string): Promise<void>;
  remoteRename(repo: string, oldName: string, newName: string): Promise<void>;
  fetch(repo: string, remote?: string): Promise<void>;
  /** `remote` overrides the upstream, as the toolbar popover offers (GC-057). */
  pull(repo: string, mode: PullMode, remote?: string): Promise<void>;
  push(repo: string, req: PushRequest): Promise<void>;
  /**
   * Stop a remote command that is waiting on a credential, and answer whether there was one
   * (GC-169). The only handler that takes no repository besides `repo:checkGit`: what it kills is
   * a process, and there is at most one.
   */
  cancelRemote(): Promise<boolean>;
  // stashes
  stashSave(repo: string, req: StashSaveRequest): Promise<void>;
  stashApply(repo: string, index: number): Promise<void>;
  stashPop(repo: string, index: number): Promise<void>;
  stashDrop(repo: string, index: number): Promise<void>;
  stashRename(repo: string, index: number, message: string): Promise<void>;
}

/**
 * Handing a file to the operating system (GC-043). None of it is git, so it is its own bridge
 * (`window.shell`) rather than another section of `GitApi`. Both take a repository-relative path
 * and the main process refuses one that resolves outside `repo` or is not on disk.
 */
export interface ShellApi {
  /** Open the file with whatever the OS has registered for it. */
  openFile(repo: string, path: string): Promise<void>;
  /** Reveal the file in the OS file manager. */
  showInFolder(repo: string, path: string): Promise<void>;
  /**
   * Open a URL in the default browser (GC-159). The one channel in this group with no repository
   * and so no path check to lean on: the main process refuses any scheme but `http:` and `https:`,
   * because `shell.openExternal` follows whatever it is handed.
   */
  openExternal(url: string): Promise<void>;
}

/**
 * The `name` a `GitError` carries when what happened is **advisory**: the action did most of what
 * was asked, and the line the user sees should say so rather than read as a failure (GC-091).
 *
 * It rides on the error's `name` rather than on a property of its own because that is the part
 * that survives the trip: Electron serialises a rejected handler down to a string, and the
 * renderer's `msg()` already has to strip `<name>: ` off the front of it. So both sides agree on
 * this one word, and nothing else about the error has to change.
 */
export const ADVISORY = 'GitAdvisory';

/**
 * The `name` a `GitError` carries when a remote operation was refused over a credential (GC-169):
 * a 403 under SAML SSO, an expired token, a key the server will not take. One more word both
 * processes agree on, on the error's name for `ADVISORY`'s reason above.
 *
 * The message under that name is the whole of what git wrote, under a first line naming the
 * remote and its URL. The first line is the status bar's summary; the rest is what the dialog
 * shows, because the `remote:` lines saying how to fix it are exactly the ones a one-line status
 * bar drops.
 */
export const AUTH_FAILURE = 'GitAuthError';
