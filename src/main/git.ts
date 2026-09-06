import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type {
  ApplyPatchOptions,
  CheckoutOptions,
  Commit,
  CommitFile,
  CommitRequest,
  CreateBranchRequest,
  CreateTagRequest,
  DiffOptions,
  DiscardRequest,
  FileChangeKind,
  GitAvailability,
  GitRef,
  IgnoreRequest,
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
// A value, not a type: the one word both processes agree an advisory failure is named by (GC-091).
import { ADVISORY } from '@shared/types';
import { defaultRemote } from '@shared/remotes';

const FIELD = '\x1f';
const RECORD = '\x1e';

export class GitError extends Error {
  constructor(
    message: string,
    public readonly args: string[],
    public readonly stderr: string,
    public readonly code: number | null,
    /**
     * The action did most of what was asked, and this message is what the user still has to know
     * rather than a failure (GC-091). It becomes the error name, which is the only part of an
     * error the renderer receives once Electron has serialised it across IPC.
     */
    public readonly advisory = false,
  ) {
    super(message);
    this.name = advisory ? ADVISORY : 'GitError';
  }
}

interface RunOptions {
  /** Text to write to git's stdin. */
  input?: string;
  /** Exit codes other than 0 that should resolve instead of reject. */
  okCodes?: number[];
}

const BASE_ARGS = ['--no-pager', '-c', 'core.quotepath=off', '-c', 'color.ui=never'];

/**
 * What the status bar and the empty state say when git itself is missing: Node only offers
 * `spawn git ENOENT`, which names neither git nor the fix, and every action here shells out (GC-025).
 */
export const GIT_MISSING_MESSAGE = 'git was not found on PATH. GitClient runs the system git for every operation: install Git, make sure "git" is on PATH, then restart GitClient.';

/** Run git in the given working directory and return stdout. */
export function runGit(cwd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    // Node reports the same ENOENT when the cwd does not exist as when the binary is missing, so
    // rule the folder out first: a moved or mistyped repository must not read as a missing git (GC-025).
    if (!existsSync(cwd)) {
      reject(new GitError(`Repository folder not found: ${cwd}`, args, '', null));
      return;
    }
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
    child.on('error', (e) => reject(new GitError((e as NodeJS.ErrnoException).code === 'ENOENT' ? GIT_MISSING_MESSAGE : e.message, args, '', null)));
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

/**
 * One `git --version` at startup so a missing git is named before any action is tried (GC-025).
 * It runs in the home directory, which always exists, rather than in the last repository: a stale
 * path there would fail with the folder message and hide the real cause.
 */
export async function checkGit(): Promise<GitAvailability> {
  const home = homedir();
  const cwd = home && existsSync(home) ? home : process.cwd();
  try {
    return { available: true, version: (await runGit(cwd, ['--version'])).trim() };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e) };
  }
}

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

/** The ref namespaces the graph draws, in the order the traversal walks them (GC-095). */
const GRAPH_GLOBS = ['refs/heads/*', 'refs/remotes/*', 'refs/tags/*'];

/**
 * What the graph traverses: the three namespaces `getRefs` lists, plus HEAD — not `--all`, which
 * means every ref under `refs/` and so put rows in the graph that no chip and no left-panel row
 * could account for: notes, a `refs/pull/*` fetch refspec, any tool's private namespace, and since
 * GC-073 they could also keep a hidden branch's commits on screen with nothing saying why (GC-095).
 * `refs/stash` is out by construction now rather than by name.
 *
 * `exclude` is a list of full ref names to keep out of the graph (GC-073), and each traversal
 * option consumes the `--exclude=`s accumulated before it — so the list is repeated ahead of every
 * glob, or only the first namespace would honour it. `--glob` matches those patterns against the
 * full ref name, which is the form the renderer stores; `--branches`/`--tags` would match them
 * relative to their own namespace and silently exclude nothing. A commit reachable from any ref
 * that is still included keeps its row, so hiding one of two branches over the same history removes
 * nothing. HEAD is a revision rather than a glob, so it is never excluded and column 0 keeps the
 * checked-out lineage whatever is hidden; `--ignore-missing` covers the unborn branch, where HEAD
 * resolves to nothing and git would otherwise refuse the whole traversal.
 */
export async function getLog(cwd: string, maxCount = 500, exclude: string[] = [], skip = 0): Promise<Commit[]> {
  let out: string;
  const excludes = exclude.map((r) => `--exclude=${r}`);
  try {
    out = await runGit(cwd, [
      'log',
      ...GRAPH_GLOBS.flatMap((g) => [...excludes, `--glob=${g}`]),
      '--ignore-missing',
      'HEAD',
      '--date-order',
      // `--skip` counts in the same traversal `--date-order` produces, so page N+1 begins exactly
      // where page N ended as long as the excludes match — which is why the renderer pages with the
      // hidden set it loaded with (GC-012).
      ...(skip > 0 ? [`--skip=${skip}`] : []),
      `--max-count=${maxCount}`,
      `--format=${LOG_FORMAT}`,
      '--',
    ]);
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
  // `%P` on the same walk gives the parents of the stash commit; the first is the commit the
  // stash was taken from, which is the row the graph marks (GC-140) — no second call, no spawn
  // per stash.
  const out = await runGit(cwd, ['stash', 'list', `--format=%gd${FIELD}%H${FIELD}%gs${FIELD}%ci${FIELD}%P`]);
  return out
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const [ref, sha, message, date, parents] = line.split(FIELD);
      const m = /stash@\{(\d+)\}/.exec(ref ?? '');
      return { index: m ? Number(m[1]) : 0, sha: sha ?? '', message: message ?? '', date: date ?? '', parent: (parents ?? '').split(' ')[0] ?? '' };
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

export async function loadRepo(path: string, maxCommits = 500, exclude: string[] = []): Promise<RepoSnapshot> {
  const info = await getRepoInfo(path);
  const [commits, refs, status, stashes, remotes] = await Promise.all([
    getLog(info.path, maxCommits, exclude),
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

/** `-w` when the file view asks to ignore whitespace, and nothing otherwise (GC-052). */
const diffFlags = (opts?: DiffOptions): string[] => (opts?.ignoreWhitespace ? ['-w'] : []);

/** Unified diff of one file in a commit, against the first parent. */
export async function getCommitFileDiff(cwd: string, sha: string, path: string, opts?: DiffOptions): Promise<string> {
  const flags = diffFlags(opts);
  try {
    return await runGit(cwd, ['diff', '-M', '--no-ext-diff', ...flags, `${sha}^`, sha, '--', path]);
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    // root commit: show the whole file as added
    return runGit(cwd, ['show', '--format=', '-M', '--no-ext-diff', ...flags, sha, '--', path]);
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
  // The synthesised untracked diff above returns before this, so `-w` never reaches a file
  // with no old side to compare against (GC-052).
  const args = ['diff', '-M', '--no-ext-diff', ...diffFlags(req)];
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

/**
 * The `.gitignore` line one of the row menu's three "Ignore …" entries writes (GC-093), or null
 * when that entry does not apply to this path — no extension to match, or no folder above the
 * repository root. A file and a folder pattern are rooted with a leading `/` so `build` at the top
 * does not also ignore `src/build`; an extension pattern deliberately is not, because matching it
 * anywhere is the whole point of asking for one.
 */
export function ignorePattern(rel: string, kind: IgnoreRequest['kind']): string | null {
  const posix = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  const base = posix.split('/').pop() ?? '';
  if (kind === 'extension') {
    const dot = base.lastIndexOf('.');
    // a leading dot is a dotfile's name, not an extension: ".gitignore" has nothing to generalise
    return dot > 0 ? `*${base.slice(dot)}` : null;
  }
  if (kind === 'folder') {
    const dir = posix.split('/').slice(0, -1).join('/');
    return dir ? `/${dir}/` : null;
  }
  return `/${posix}`;
}

/**
 * Append a pattern to the repository's root `.gitignore`, creating the file if it is not there
 * (GC-093). An existing file that does not end in a newline gains one first, or the pattern would
 * join the last line and neither would match. An exact repeat of a line already present is left
 * alone, so asking twice is not an error and writes nothing.
 */
export async function ignore(cwd: string, req: IgnoreRequest): Promise<void> {
  const pattern = ignorePattern(req.path, req.kind);
  if (!pattern) throw new GitError(`There is nothing to ignore for ${req.path}`, ['ignore'], '', null);
  const file = join(cwd, '.gitignore');
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch {
    text = ''; // no .gitignore yet: the append creates it
  }
  if (text.split(/\r?\n/).some((l) => l.trim() === pattern)) return;
  await appendFile(file, `${text.length && !text.endsWith('\n') ? '\n' : ''}${pattern}\n`, 'utf8');
}

/**
 * Put one file back to the way `sha` had it (GC-107). `git checkout <sha> -- <path>` writes the
 * working-tree copy **and stages it** — that is one command, not a flag that can be dropped — so
 * the confirmation in the renderer says the change will be staged rather than pretending
 * otherwise. Nothing here checks the path exists at that sha: git's own refusal is the `GitError`
 * it should be, and the row is left out on a file the commit deleted.
 */
export const restoreFile = (cwd: string, sha: string, path: string): Promise<string> => runGit(cwd, ['checkout', sha, '--', path]);

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

/** One git call, bound to a repository: what `restoreStashWith` runs and what a test replaces. */
export type GitRunner = (args: string[]) => Promise<string>;

/** The porcelain codes for an unmerged path — both sides of the pair, in either order. */
const UNMERGED = /^(DD|AU|UD|UA|DU|AA|UU) /m;

/** `git status --porcelain`, or null when even that fails. */
async function statusOrNull(run: GitRunner): Promise<string | null> {
  try {
    return await run(['status', '--porcelain']);
  } catch {
    return null;
  }
}

/**
 * Apply or pop a stash, index and all. Without `--index` git merges everything the stash held into
 * the working directory, so what the user had staged when they stashed comes back unstaged and the
 * staging is lost with no way back but redoing it by hand (GC-082).
 *
 * `--index` fails in two ways that need opposite handling (GC-092). It can refuse before touching
 * anything, when the stashed index will not go back on ("conflicts in index"), and then retrying
 * the plain form is worth it: the working directory comes back, the staging does not, and saying so
 * beats failing outright. Or it can merge, write conflict markers, keep the stash and exit non-zero
 * — the common case of popping onto a tree that has moved on — and there a retry only fails again
 * against the tree it has just conflicted, reporting `could not write index` in place of git's own
 * conflict message. Which one happened is read off the repository state rather than the wording,
 * which is stable across neither git versions nor locales: an unmerged entry, or any change to the
 * status at all, means it applied.
 */
export async function restoreStashWith(run: GitRunner, verb: 'apply' | 'pop', index: number): Promise<string> {
  const ref = `stash@{${index}}`;
  const before = await statusOrNull(run);
  try {
    return await run(['stash', verb, '-q', '--index', ref]);
  } catch (first) {
    const after = await statusOrNull(run);
    // No reading of the state is a reading that nothing happened: propagate git's own error
    // rather than retrying an apply that may already be half done.
    if (before === null || after === null || after !== before || UNMERGED.test(after)) throw first;
    await run(['stash', verb, '-q', ref]);
    // Advisory, not a failure: the stash did come back, and only the staging did not (GC-091).
    // Reported as a red error line this read as "the pop failed" while the pop had succeeded.
    throw new GitError(
      `The stash was ${verb === 'pop' ? 'popped' : 'applied'} to the working directory, but what it had staged could not be put back in the index.`,
      ['stash', verb, ref],
      '',
      null,
      true,
    );
  }
}

const restoreStash = (cwd: string, verb: 'apply' | 'pop', index: number): Promise<string> =>
  restoreStashWith((args) => runGit(cwd, args), verb, index);

export const stashApply = (cwd: string, index: number): Promise<string> => restoreStash(cwd, 'apply', index);
export const stashPop = (cwd: string, index: number): Promise<string> => restoreStash(cwd, 'pop', index);
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

/**
 * Delete a tag on a remote (GC-112). The refspec is fully qualified — `refs/tags/<name>`, never a
 * bare name — because a remote holding both a branch and a tag called `v1` would otherwise leave
 * git to guess which of the two this meant, and it refuses rather than guessing. Until now the
 * menu could push a tag to a remote and had no call at all to take it back.
 */
export const deleteRemoteTag = (cwd: string, remote: string, name: string): Promise<string> => runGit(cwd, ['push', remote, '--delete', `refs/tags/${name}`]);

// ---------------------------------------------------------------------------
// Remote operations
// ---------------------------------------------------------------------------

export async function fetch(cwd: string, remote?: string): Promise<void> {
  await runGit(cwd, remote ? ['fetch', '--prune', remote] : ['fetch', '--all', '--prune']);
}

/** Add a remote and fetch it, so its branches appear straight away. */
export async function remoteAdd(cwd: string, name: string, url: string): Promise<void> {
  await runGit(cwd, ['remote', 'add', name, url]);
  await runGit(cwd, ['fetch', '--prune', name]);
}

export const remoteRemove = (cwd: string, name: string): Promise<string> => runGit(cwd, ['remote', 'remove', name]);

export const remoteSetUrl = (cwd: string, name: string, url: string): Promise<string> => runGit(cwd, ['remote', 'set-url', name, url]);

export const remoteRename = (cwd: string, oldName: string, newName: string): Promise<string> => runGit(cwd, ['remote', 'rename', oldName, newName]);

/**
 * `remote` names where to pull from instead of the branch's upstream (GC-057). It has to name the
 * branch too: `git pull <remote>` with no refspec still merges whatever `branch.<name>.merge`
 * says, which is the upstream the caller asked to bypass. The branch on the other side is taken
 * to have the same name, which is exactly what the popover row "Pull from <remote>" promises.
 */
export async function pull(cwd: string, mode: PullMode, remote?: string): Promise<void> {
  const flag = mode === 'rebase' ? '--rebase' : mode === 'ff-only' ? '--ff-only' : '--no-rebase';
  const args = ['pull', flag];
  if (remote) {
    const branch = (await runGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'], { okCodes: [0, 1] })).trim();
    if (!branch) throw new GitError('Cannot pull into a detached HEAD', args, '', null);
    args.push(remote, branch);
  }
  await runGit(cwd, args);
}

/**
 * Bring `branch` up to `upstream` without checking it out (GC-100). For a branch that is not
 * HEAD this is `git fetch . <upstream>:<branch>`: a local fetch refuses anything that is not a
 * fast-forward, which is exactly the guarantee wanted, and it touches neither the index nor the
 * working tree. The checked-out branch is the one case that cannot go that way -- git will not
 * fetch into the ref HEAD points at -- so it gets `git merge --ff-only`, the same promise for the
 * one ref that has a working tree attached. Either refusal is the `GitError` it already is;
 * nothing here forces anything.
 */
export async function fastForward(cwd: string, branch: string, upstream: string): Promise<void> {
  const head = (await runGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'], { okCodes: [0, 1] })).trim();
  if (head === branch) await runGit(cwd, ['merge', '--ff-only', upstream]);
  else await runGit(cwd, ['fetch', '.', `${upstream}:${branch}`]);
}

/**
 * Point `branch` at `upstream`, or clear its upstream when `upstream` is null (GC-100). Until
 * now a local branch could only get one as a side effect of being pushed with `-u`, which is no
 * use for a remote branch that already exists.
 */
export async function setUpstream(cwd: string, branch: string, upstream: string | null): Promise<void> {
  await runGit(cwd, upstream ? ['branch', `--set-upstream-to=${upstream}`, branch] : ['branch', '--unset-upstream', branch]);
}

export async function push(cwd: string, req: PushRequest): Promise<void> {
  const args = ['push'];
  if (req.force) args.push('--force-with-lease');
  if (req.tags) args.push('--tags');
  if (req.setUpstream || req.remote || req.branch) {
    let remote = req.remote;
    if (!remote) {
      const remotes = await getRemotes(cwd);
      remote = defaultRemote(remotes);
      if (!remote) throw new GitError('This repository has no remotes to push to', args, '', null);
    }
    const branch = req.branch ?? (await runGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim();
    if (!branch) throw new GitError('Cannot push from a detached HEAD', args, '', null);
    if (req.setUpstream) args.push('-u');
    args.push(remote, branch);
  }
  await runGit(cwd, args);
}
