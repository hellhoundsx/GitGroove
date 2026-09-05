import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type {
  ApplyPatchOptions,
  CheckoutOptions,
  Commit,
  CommitFile,
  CommitRequest,
  CreateBranchRequest,
  CreateTagRequest,
  DiscardRequest,
  FileChangeKind,
  GitRef,
  PullMode,
  PushRequest,
  Remote,
  RepoInfo,
  RepoOperation,
  RepoSnapshot,
  RepoStatus,
  ResetMode,
  Stash,
  StashSaveRequest,
  StatusEntry,
  WorkdirDiffRequest,
} from '@shared/types';

const FIELD = '\x1f';
const RECORD = '\x1e';

export class GitError extends Error {
  constructor(
    message: string,
    public readonly args: string[],
    public readonly stderr: string,
    public readonly code: number | null,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

interface RunOptions {
  /** Text to write to git's stdin. */
  input?: string;
  /** Exit codes other than 0 that should resolve instead of reject. */
  okCodes?: number[];
}

const BASE_ARGS = ['--no-pager', '-c', 'core.quotepath=off', '-c', 'color.ui=never'];

/** Run git in the given working directory and return stdout. */
export function runGit(cwd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', [...BASE_ARGS, ...args], {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (out += d));
    child.stderr.on('data', (d: string) => (err += d));
    child.on('error', (e) => reject(new GitError(e.message, args, '', null)));
    child.on('close', (code) => {
      if (code === 0 || (opts.okCodes ?? []).includes(code ?? -1)) resolvePromise(out);
      else {
        // merge/cherry-pick/rebase report conflicts on stdout, so fall back to it when stderr is empty
        const detail = err.trim() || out.trim().split('\n').slice(-6).join('\n');
        reject(new GitError(detail || `git ${args[0]} exited with code ${code}`, args, err, code));
      }
    });
    child.stdin.on('error', () => undefined); // git may exit before reading stdin
    child.stdin.end(opts.input ?? '');
  });
}

// ---------------------------------------------------------------------------
// Repository overview
// ---------------------------------------------------------------------------

export async function getRepoInfo(cwd: string): Promise<RepoInfo> {
  const top = (await runGit(cwd, ['rev-parse', '--show-toplevel'])).trim();
  let headSha: string | null = null;
  try {
    headSha = (await runGit(top, ['rev-parse', '--verify', '-q', 'HEAD'])).trim() || null;
  } catch {
    headSha = null; // unborn branch
  }
  let branch: string | null = null;
  try {
    branch = (await runGit(top, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim() || null;
  } catch {
    branch = null; // detached HEAD
  }
  return { path: top, name: basename(top), headSha, branch };
}

const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%cI', '%s', '%b', '%D'].join(FIELD) + RECORD;

export async function getLog(cwd: string, maxCount = 500): Promise<Commit[]> {
  let out: string;
  try {
    out = await runGit(cwd, ['log', '--exclude=refs/stash', '--all', '--date-order', `--max-count=${maxCount}`, `--format=${LOG_FORMAT}`]);
  } catch (e) {
    if (e instanceof GitError && /does not have any commits|bad default revision|unknown revision/i.test(e.stderr)) return [];
    throw e;
  }
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim().length > 0)
    .map((record) => {
      const [sha, parents, authorName, authorEmail, authorDate, committerName, committerDate, summary, body, refs] =
        record.split(FIELD);
      return {
        sha,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        authorName,
        authorEmail,
        authorDate,
        committerName,
        committerDate,
        summary,
        body: (body ?? '').replace(/\n+$/, ''),
        refs: refs
          ? refs
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      };
    });
}

const REF_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname)',
  '%(*objectname)', // peeled sha for annotated tags
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track)',
].join(FIELD);

export async function getRefs(cwd: string): Promise<GitRef[]> {
  const out = await runGit(cwd, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags']);
  const refs: GitRef[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [fullName, short, sha, peeled, head, upstream, track] = line.split(FIELD);
    if (fullName.endsWith('/HEAD')) continue; // skip refs/remotes/origin/HEAD
    const kind = fullName.startsWith('refs/heads/') ? 'head' : fullName.startsWith('refs/remotes/') ? 'remote' : 'tag';
    const ahead = /ahead (\d+)/.exec(track ?? '');
    const behind = /behind (\d+)/.exec(track ?? '');
    refs.push({
      name: short,
      fullName,
      kind,
      sha: peeled || sha,
      isHead: head === '*',
      upstream: upstream || undefined,
      ahead: ahead ? Number(ahead[1]) : undefined,
      behind: behind ? Number(behind[1]) : undefined,
    });
  }
  return refs;
}

function kindFromCode(code: string): FileChangeKind | null {
  switch (code[0]) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'typechange';
    case 'U':
      return 'conflicted';
    default:
      return null;
  }
}

/** Detect an in-progress merge, rebase, cherry-pick or revert from the git directory. */
export async function getOperation(cwd: string): Promise<RepoOperation> {
  const raw = (await runGit(cwd, ['rev-parse', '--git-dir'])).trim();
  const gitDir = isAbsolute(raw) ? raw : resolve(cwd, raw);
  if (existsSync(join(gitDir, 'MERGE_HEAD'))) return 'merge';
  if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) return 'rebase';
  if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
  if (existsSync(join(gitDir, 'REVERT_HEAD'))) return 'revert';
  return null;
}

/** Parse `git status --porcelain=v2 --branch -z`. */
export async function getStatus(cwd: string): Promise<RepoStatus> {
  const [out, operation] = await Promise.all([runGit(cwd, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']), getOperation(cwd)]);
  const status: RepoStatus = { branch: null, upstream: null, ahead: 0, behind: 0, entries: [], operation };
  const tokens = out.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const line = tokens[i];
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      const v = line.slice('# branch.head '.length);
      status.branch = v === '(detached)' ? null : v;
    } else if (line.startsWith('# branch.upstream ')) {
      status.upstream = line.slice('# branch.upstream '.length);
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        status.ahead = Number(m[1]);
        status.behind = Number(m[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const parts = line.split(' ');
      const xy = parts[1];
      const isRename = line.startsWith('2 ');
      const isUnmerged = line.startsWith('u ');
      const path = isRename ? parts.slice(9).join(' ') : isUnmerged ? parts.slice(10).join(' ') : parts.slice(8).join(' ');
      let origPath: string | undefined;
      if (isRename) origPath = tokens[++i]; // rename entries carry the original path in the next NUL token
      const entry: StatusEntry = {
        path,
        origPath,
        staged: isUnmerged ? 'conflicted' : xy[0] === '.' ? null : kindFromCode(xy[0]),
        unstaged: isUnmerged ? 'conflicted' : xy[1] === '.' ? null : kindFromCode(xy[1]),
      };
      status.entries.push(entry);
    } else if (line.startsWith('? ')) {
      status.entries.push({ path: line.slice(2), staged: null, unstaged: 'untracked' });
    }
  }
  return status;
}

export async function getStashes(cwd: string): Promise<Stash[]> {
  const out = await runGit(cwd, ['stash', 'list', `--format=%gd${FIELD}%H${FIELD}%gs${FIELD}%ci`]);
  return out
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const [ref, sha, message, date] = line.split(FIELD);
      const m = /stash@\{(\d+)\}/.exec(ref ?? '');
      return { index: m ? Number(m[1]) : 0, sha: sha ?? '', message: message ?? '', date: date ?? '' };
    });
}

export async function getRemotes(cwd: string): Promise<Remote[]> {
  const out = await runGit(cwd, ['remote', '-v']);
  const map = new Map<string, Remote>();
  for (const line of out.split('\n')) {
    const m = /^(\S+)\t(\S+) \((fetch|push)\)$/.exec(line.trim());
    if (!m) continue;
    const r = map.get(m[1]!) ?? { name: m[1]!, fetchUrl: '', pushUrl: '' };
    if (m[3] === 'fetch') r.fetchUrl = m[2]!;
    else r.pushUrl = m[2]!;
    map.set(r.name, r);
  }
  return [...map.values()];
}

export async function loadRepo(path: string, maxCommits = 500): Promise<RepoSnapshot> {
  const info = await getRepoInfo(path);
  const [commits, refs, status, stashes, remotes] = await Promise.all([
    getLog(info.path, maxCommits),
    getRefs(info.path),
    getStatus(info.path),
    getStashes(info.path),
    getRemotes(info.path),
  ]);
  return { info, commits, refs, status, stashes, remotes };
}

// ---------------------------------------------------------------------------
// Commit contents and diffs
// ---------------------------------------------------------------------------

/** Files changed by a commit, compared with its first parent (or the empty tree for a root commit). */
export async function getCommitFiles(cwd: string, sha: string): Promise<CommitFile[]> {
  let out: string;
  try {
    out = await runGit(cwd, ['diff-tree', '-r', '-M', '--name-status', '-z', `${sha}^`, sha]);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    out = await runGit(cwd, ['diff-tree', '-r', '-M', '--name-status', '-z', '--root', '--no-commit-id', sha]);
  }
  const tokens = out.split('\0');
  const files: CommitFile[] = [];
  for (let i = 0; i < tokens.length; ) {
    const code = tokens[i];
    if (!code) {
      i++;
      continue;
    }
    const kind = kindFromCode(code) ?? 'modified';
    if (code.startsWith('R') || code.startsWith('C')) {
      files.push({ path: tokens[i + 2] ?? '', origPath: tokens[i + 1], kind });
      i += 3;
    } else {
      files.push({ path: tokens[i + 1] ?? '', kind });
      i += 2;
    }
  }
  return files;
}

/** Unified diff of one file in a commit, against the first parent. */
export async function getCommitFileDiff(cwd: string, sha: string, path: string): Promise<string> {
  try {
    return await runGit(cwd, ['diff', '-M', '--no-ext-diff', `${sha}^`, sha, '--', path]);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    // root commit: show the whole file as added
    return runGit(cwd, ['show', '--format=', '-M', '--no-ext-diff', sha, '--', path]);
  }
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Unified diff for a working-directory file: unstaged, staged, or a synthesised diff for untracked files. */
export async function getWorkdirFileDiff(cwd: string, req: WorkdirDiffRequest): Promise<string> {
  if (req.untracked) {
    const buf = await readFile(join(cwd, req.path));
    const header = `diff --git a/${req.path} b/${req.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${req.path}\n`;
    if (looksBinary(buf)) return header + 'Binary files /dev/null and b/' + req.path + ' differ\n';
    const text = buf.toString('utf8');
    if (text.length === 0) return header;
    const endsWithNewline = text.endsWith('\n');
    const lines = (endsWithNewline ? text.slice(0, -1) : text).split('\n');
    let body = `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n') + '\n';
    if (!endsWithNewline) body += '\\ No newline at end of file\n';
    return header + body;
  }
  const args = ['diff', '-M', '--no-ext-diff'];
  if (req.staged) args.push('--cached');
  return runGit(cwd, [...args, '--', req.path]);
}

// ---------------------------------------------------------------------------
// Staging and committing
// ---------------------------------------------------------------------------

export async function stage(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await runGit(cwd, ['add', '-A', '--', ...paths]);
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await runGit(cwd, ['reset', '-q', '--', ...paths]);
  } catch (e) {
    // unborn branch: there is no HEAD to reset to, drop the paths from the index instead
    if (e instanceof GitError && /HEAD|ambiguous argument/i.test(e.stderr)) await runGit(cwd, ['rm', '-r', '-q', '--cached', '--', ...paths]);
    else throw e;
  }
}

export async function stageAll(cwd: string): Promise<void> {
  await runGit(cwd, ['add', '-A']);
}

export async function unstageAll(cwd: string): Promise<void> {
  try {
    await runGit(cwd, ['reset', '-q']);
  } catch (e) {
    if (e instanceof GitError && /HEAD|ambiguous argument/i.test(e.stderr)) await runGit(cwd, ['rm', '-r', '-q', '--cached', '.']);
    else throw e;
  }
}

/** Discard unstaged changes to tracked files and delete untracked files. Destructive. */
export async function discard(cwd: string, req: DiscardRequest): Promise<void> {
  if (req.tracked.length) await runGit(cwd, ['checkout', '-q', '--', ...req.tracked]);
  if (req.untracked.length) await runGit(cwd, ['clean', '-f', '-q', '--', ...req.untracked]);
}

/** Apply a unified diff to the index (cached) or the working tree, optionally in reverse. */
export async function applyPatch(cwd: string, patch: string, opts: ApplyPatchOptions): Promise<void> {
  const args = ['apply', '--whitespace=nowarn', '--recount'];
  if (opts.cached) args.push('--cached');
  if (opts.reverse) args.push('--reverse');
  await runGit(cwd, [...args, '-'], { input: patch });
}

export async function commit(cwd: string, req: CommitRequest): Promise<string> {
  const args = ['commit', '-q'];
  if (req.amend) args.push('--amend');
  let input: string | undefined;
  if (req.summary.trim()) {
    input = req.body && req.body.trim() ? `${req.summary.trim()}\n\n${req.body.trim()}\n` : `${req.summary.trim()}\n`;
    args.push('--file=-');
  } else {
    args.push('--no-edit'); // conclude a merge/revert with the message git prepared
  }
  await runGit(cwd, args, { input });
  return (await runGit(cwd, ['rev-parse', 'HEAD'])).trim();
}

// ---------------------------------------------------------------------------
// Stashes
// ---------------------------------------------------------------------------

export async function stashSave(cwd: string, req: StashSaveRequest): Promise<void> {
  const args = ['stash', 'push', '-q'];
  if (req.includeUntracked) args.push('-u');
  if (req.message && req.message.trim()) args.push('-m', req.message.trim());
  await runGit(cwd, args);
}

export const stashApply = (cwd: string, index: number): Promise<string> => runGit(cwd, ['stash', 'apply', '-q', `stash@{${index}}`]);
export const stashPop = (cwd: string, index: number): Promise<string> => runGit(cwd, ['stash', 'pop', '-q', `stash@{${index}}`]);
export const stashDrop = (cwd: string, index: number): Promise<string> => runGit(cwd, ['stash', 'drop', '-q', `stash@{${index}}`]);

// ---------------------------------------------------------------------------
// Branches, tags, history
// ---------------------------------------------------------------------------

export async function checkout(cwd: string, ref: string, opts: CheckoutOptions = {}): Promise<void> {
  if (opts.detach) {
    await runGit(cwd, ['checkout', '-q', '--detach', ref]);
    return;
  }
  if (opts.track) {
    try {
      await runGit(cwd, ['checkout', '-q', '--track', ref]);
      return;
    } catch (e) {
      // a local branch with that name already exists: switch to it instead
      if (!(e instanceof GitError) || !/already exists/i.test(e.stderr)) throw e;
      const local = ref.split('/').slice(1).join('/');
      await runGit(cwd, ['checkout', '-q', local]);
      return;
    }
  }
  await runGit(cwd, ['checkout', '-q', ref]);
}

export async function createBranch(cwd: string, req: CreateBranchRequest): Promise<void> {
  const start = req.startPoint ? [req.startPoint] : [];
  if (req.checkout) await runGit(cwd, ['checkout', '-q', '-b', req.name, ...start]);
  else await runGit(cwd, ['branch', req.name, ...start]);
}

export const deleteBranch = (cwd: string, name: string, force = false): Promise<string> => runGit(cwd, ['branch', force ? '-D' : '-d', name]);
export const renameBranch = (cwd: string, oldName: string, newName: string): Promise<string> => runGit(cwd, ['branch', '-m', oldName, newName]);
export const deleteRemoteBranch = (cwd: string, remote: string, branch: string): Promise<string> => runGit(cwd, ['push', remote, '--delete', branch]);

export const merge = (cwd: string, ref: string): Promise<string> => runGit(cwd, ['merge', '--no-edit', ref]);
export const rebase = (cwd: string, onto: string): Promise<string> => runGit(cwd, ['rebase', onto]);
export const cherryPick = (cwd: string, sha: string): Promise<string> => runGit(cwd, ['cherry-pick', sha]);
export const revert = (cwd: string, sha: string): Promise<string> => runGit(cwd, ['revert', '--no-edit', sha]);
export const reset = (cwd: string, mode: ResetMode, sha: string): Promise<string> => runGit(cwd, ['reset', '-q', `--${mode}`, sha]);

export async function abortOperation(cwd: string): Promise<void> {
  const op = await getOperation(cwd);
  if (op === 'merge') await runGit(cwd, ['merge', '--abort']);
  else if (op === 'rebase') await runGit(cwd, ['rebase', '--abort']);
  else if (op === 'cherry-pick') await runGit(cwd, ['cherry-pick', '--abort']);
  else if (op === 'revert') await runGit(cwd, ['revert', '--abort']);
}

export async function createTag(cwd: string, req: CreateTagRequest): Promise<void> {
  const target = req.sha ? [req.sha] : [];
  if (req.message && req.message.trim()) await runGit(cwd, ['tag', '-a', req.name, '-m', req.message.trim(), ...target]);
  else await runGit(cwd, ['tag', req.name, ...target]);
}

export const deleteTag = (cwd: string, name: string): Promise<string> => runGit(cwd, ['tag', '-d', name]);

// ---------------------------------------------------------------------------
// Remote operations
// ---------------------------------------------------------------------------

export async function fetch(cwd: string, remote?: string): Promise<void> {
  await runGit(cwd, remote ? ['fetch', '--prune', remote] : ['fetch', '--all', '--prune']);
}

export async function pull(cwd: string, mode: PullMode): Promise<void> {
  const flag = mode === 'rebase' ? '--rebase' : mode === 'ff-only' ? '--ff-only' : '--no-rebase';
  await runGit(cwd, ['pull', flag]);
}

export async function push(cwd: string, req: PushRequest): Promise<void> {
  const args = ['push'];
  if (req.force) args.push('--force-with-lease');
  if (req.tags) args.push('--tags');
  if (req.setUpstream || req.remote || req.branch) {
    let remote = req.remote;
    if (!remote) {
      const remotes = await getRemotes(cwd);
      remote = remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name;
      if (!remote) throw new GitError('This repository has no remotes to push to', args, '', null);
    }
    const branch = req.branch ?? (await runGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim();
    if (!branch) throw new GitError('Cannot push from a detached HEAD', args, '', null);
    if (req.setUpstream) args.push('-u');
    args.push(remote, branch);
  }
  await runGit(cwd, args);
}
