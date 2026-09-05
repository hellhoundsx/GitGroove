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

export interface RepoSnapshot {
  info: RepoInfo;
  commits: Commit[];
  refs: GitRef[];
  status: RepoStatus;
  stashes: Stash[];
  remotes: Remote[];
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
  openRepoDialog(): Promise<string | null>;
  loadRepo(path: string, maxCommits?: number): Promise<RepoSnapshot>;
  getStatus(repo: string): Promise<RepoStatus>;
  getCommitFiles(repo: string, sha: string): Promise<CommitFile[]>;
  getCommitFileDiff(repo: string, sha: string, path: string): Promise<string>;
  getWorkdirFileDiff(repo: string, req: WorkdirDiffRequest): Promise<string>;
  stage(repo: string, paths: string[]): Promise<void>;
  unstage(repo: string, paths: string[]): Promise<void>;
  stageAll(repo: string): Promise<void>;
  unstageAll(repo: string): Promise<void>;
  discard(repo: string, req: DiscardRequest): Promise<void>;
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
  // remotes
  remoteAdd(repo: string, name: string, url: string): Promise<void>;
  remoteRemove(repo: string, name: string): Promise<void>;
  remoteSetUrl(repo: string, name: string, url: string): Promise<void>;
  remoteRename(repo: string, oldName: string, newName: string): Promise<void>;
  fetch(repo: string, remote?: string): Promise<void>;
  pull(repo: string, mode: PullMode): Promise<void>;
  push(repo: string, req: PushRequest): Promise<void>;
  // stashes
  stashSave(repo: string, req: StashSaveRequest): Promise<void>;
  stashApply(repo: string, index: number): Promise<void>;
  stashPop(repo: string, index: number): Promise<void>;
  stashDrop(repo: string, index: number): Promise<void>;
}
