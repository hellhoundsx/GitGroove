import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authSummary, cloneRepo, getCompareFileDiffWith, getCompareWith, GitError, ignorePattern, isAuthMessage, resolveConflictWith, restoreStashWith, runGit, stashRenameWith, type GitRunner } from './git';
import { cloneTargetName } from '@shared/remotes';
import { ADVISORY, AUTH_FAILURE, conflictSides } from '@shared/types';

// `restoreStashWith` is the whole of GC-092's decision: whether a failed `stash apply --index`
// left the repository alone, and may be retried without `--index`, or merged and conflicted, where
// the retry throws git's real message away. Both cases are one `git status --porcelain` apart, so a
// fake runner covers them without a repository.

/** A scripted git: `status` returns the next queued snapshot, `stash …` the next queued outcome. */
function fakeGit(statuses: string[], outcomes: Array<string | Error>): { run: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: GitRunner = async (args) => {
    calls.push(args);
    if (args[0] === 'status') return statuses.shift() ?? '';
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return next ?? '';
  };
  return { run, calls };
}

const conflicted = new GitError('CONFLICT (content): Merge conflict in f.txt', ['stash', 'pop', '-q', '--index'], '', 1);
const refused = new GitError('conflicts in index. Try without --index.', ['stash', 'pop', '-q', '--index'], '', 1);

/** How many of the recorded calls actually ran a stash verb. */
const stashCalls = (calls: string[][]): string[][] => calls.filter((c) => c[0] === 'stash');

describe('restoreStashWith', () => {
  it('does not retry when --index applied and conflicted', async () => {
    // The common pop onto a tree that has moved on: git merges, writes markers, keeps the stash.
    const { run, calls } = fakeGit([' M f.txt\n', 'UU f.txt\nM  g.txt\n'], [conflicted]);
    await expect(restoreStashWith(run, 'pop', 0)).rejects.toBe(conflicted);
    expect(stashCalls(calls)).toEqual([['stash', 'pop', '-q', '--index', 'stash@{0}']]);
  });

  it('does not retry when --index applied cleanly but still failed', async () => {
    // No unmerged entry, but the status moved, so the working tree came back: a second apply would
    // land on changes that are already there.
    const { run, calls } = fakeGit(['', ' M f.txt\n'], [conflicted]);
    await expect(restoreStashWith(run, 'pop', 0)).rejects.toBe(conflicted);
    expect(stashCalls(calls)).toHaveLength(1);
  });

  it('retries the plain form when --index refused without applying', async () => {
    // GC-082's fallback: nothing moved, so the plain form is worth a try.
    const { run, calls } = fakeGit([' M f.txt\n', ' M f.txt\n'], [refused, '']);
    await expect(restoreStashWith(run, 'pop', 0)).rejects.toThrow(/could not be put back in the index/);
    expect(stashCalls(calls)).toEqual([
      ['stash', 'pop', '-q', '--index', 'stash@{0}'],
      ['stash', 'pop', '-q', 'stash@{0}'],
    ]);
  });

  it('marks that fallback advisory, so the status bar does not call it a failure (GC-091)', async () => {
    const { run } = fakeGit([' M f.txt\n', ' M f.txt\n'], [refused, '']);
    const e = await restoreStashWith(run, 'pop', 0).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GitError);
    expect((e as GitError).advisory).toBe(true);
    // The name is the part that survives Electron's serialisation, so it is what the renderer reads.
    expect((e as GitError).name).toBe(ADVISORY);
  });

  it('leaves an ordinary git failure unmarked, so it stays a red line (GC-091)', async () => {
    const conflicted = new GitError('CONFLICT (content): Merge conflict in f.txt', ['stash', 'pop'], '', 1);
    const { run } = fakeGit([' M f.txt\n', 'UU f.txt\n'], [conflicted]);
    const e = await restoreStashWith(run, 'pop', 0).catch((x: unknown) => x);
    expect((e as GitError).advisory).toBe(false);
    expect((e as GitError).name).toBe('GitError');
  });

  it('propagates git when the retry fails too', async () => {
    const second = new GitError('error: could not write index', ['stash', 'pop', '-q'], '', 1);
    const { run } = fakeGit(['', ''], [refused, second]);
    await expect(restoreStashWith(run, 'pop', 0)).rejects.toBe(second);
  });

  it('does not retry when the state cannot be read at all', async () => {
    const run: GitRunner = async (args) => {
      if (args[0] === 'status') throw new GitError('not a git repository', args, '', 128);
      throw conflicted;
    };
    await expect(restoreStashWith(run, 'apply', 1)).rejects.toBe(conflicted);
  });

  it('passes --index and the stash ref through on the happy path', async () => {
    const { run, calls } = fakeGit([''], ['']);
    await expect(restoreStashWith(run, 'apply', 2)).resolves.toBe('');
    expect(stashCalls(calls)).toEqual([['stash', 'apply', '-q', '--index', 'stash@{2}']]);
  });
});

// `stashRename` has no command of its own: it stores the stash again and drops the old entry, and
// `git stash store` **prepends** a reflog entry, so by the time the drop runs every stash has
// shifted down one and the old one is at `index + 1` (GC-129). Getting that wrong destroys the
// neighbouring stash and keeps the one it was asked to rename — silently, with no error. e2e step
// 38 covers it against a live repository; these four cover the arithmetic in milliseconds (GC-167).
describe('stashRenameWith', () => {
  /** A scripted git for the rename: `rev-parse` answers a sha, everything else the next outcome. */
  function fakeRename(outcomes: Array<string | Error> = []): { run: GitRunner; calls: string[][] } {
    const calls: string[][] = [];
    const run: GitRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return 'abc1234\n';
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return next ?? '';
    };
    return { run, calls };
  }

  it('reads the sha, stores under the new message, then drops the shifted entry', async () => {
    const { run, calls } = fakeRename();
    await stashRenameWith(run, 2, 'a better message');
    expect(calls).toEqual([
      ['rev-parse', 'stash@{2}'],
      ['stash', 'store', '-m', 'a better message', 'abc1234'],
      ['stash', 'drop', '-q', 'stash@{3}'],
    ]);
  });

  it('drops index + 1, because the store has already pushed the old entry down one', async () => {
    const { run, calls } = fakeRename();
    await stashRenameWith(run, 0, 'renamed');
    const drop = calls.find((c) => c[1] === 'drop');
    // `stash@{0}` here would take the entry the store has just made and leave the old message.
    expect(drop).toEqual(['stash', 'drop', '-q', 'stash@{1}']);
  });

  it('reads the sha before either write, since the drop is what makes it unreachable', async () => {
    const { run, calls } = fakeRename();
    await stashRenameWith(run, 1, 'x');
    expect(calls[0][0]).toBe('rev-parse');
  });

  it('attempts no drop when the store fails, or the stash is lost outright', async () => {
    const failed = new GitError('fatal: bad object', ['stash', 'store'], '', 128);
    const { run, calls } = fakeRename([failed]);
    await expect(stashRenameWith(run, 0, 'x')).rejects.toBe(failed);
    expect(calls.some((c) => c[1] === 'drop')).toBe(false);
  });
});

// Resolving a conflict is two calls in one order (GC-181): the checkout writes the side's blob
// over the working-tree copy and the add records it, and only both together take the path out of
// the unmerged state. The seam is the same one `stashRenameWith` is driven through (GC-167).
describe('resolveConflictWith', () => {
  /** A scripted git that records what it was asked to run, and can fail the first call. */
  function fakeResolve(outcomes: Array<string | Error> = []): { run: GitRunner; calls: string[][] } {
    const calls: string[][] = [];
    const run: GitRunner = async (args) => {
      calls.push(args);
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return next ?? '';
    };
    return { run, calls };
  }

  it('checks the side out and then stages it', async () => {
    const { run, calls } = fakeResolve();
    await resolveConflictWith(run, 'src/f.txt', 'ours');
    expect(calls).toEqual([
      ['checkout', '--ours', '--', 'src/f.txt'],
      ['add', '--', 'src/f.txt'],
    ]);
  });

  it('passes the side straight through as the flag', async () => {
    const { run, calls } = fakeResolve();
    await resolveConflictWith(run, 'f.txt', 'theirs');
    expect(calls[0]).toEqual(['checkout', '--theirs', '--', 'f.txt']);
  });

  it('stages nothing when the checkout fails, so a half-resolved path is never recorded', async () => {
    const failed = new GitError("error: path 'f.txt' does not have our version", ['checkout', '--ours'], '', 1);
    const { run, calls } = fakeResolve([failed]);
    await expect(resolveConflictWith(run, 'f.txt', 'ours')).rejects.toBe(failed);
    expect(calls.some((c) => c[0] === 'add')).toBe(false);
  });

  it('ends both calls with -- so a path that reads like a revision cannot be taken for one', async () => {
    const { run, calls } = fakeResolve();
    await resolveConflictWith(run, 'main', 'ours');
    for (const c of calls) expect(c[c.length - 2]).toBe('--');
  });
});

// A commit read against the working directory rather than against its parent (GC-152). One
// command each, so what these pin is the arguments: the wrong ones here are a diff of something
// else entirely, reported as though it were this comparison.
describe('getCompareWith and getCompareFileDiffWith', () => {
  const record = (out = ''): { run: GitRunner; calls: string[][] } => {
    const calls: string[][] = [];
    return { run: async (args) => (calls.push(args), out), calls };
  };

  it('lists the files with one `git diff <sha>`, name-status and NUL-separated', () => {
    const { run, calls } = record();
    void getCompareWith(run, 'abc1234');
    // No second revision and no `--cached`: that is what makes it the working tree, index and all.
    expect(calls).toEqual([['diff', '-M', '--name-status', '-z', 'abc1234']]);
  });

  it('reads the codes as being relative to the commit', async () => {
    // `A` is a file the working tree has and the commit does not, which is the direction the file
    // rows are read in; a rename carries both paths, as it does in a commit's own list.
    const out = ['A', 'new.txt', 'M', 'edited.txt', 'D', 'gone.txt', 'R100', 'was.txt', 'now.txt', ''].join('\0');
    const files = await getCompareWith(record(out).run, 'abc1234');
    expect(files).toEqual([
      { path: 'new.txt', kind: 'added' },
      { path: 'edited.txt', kind: 'modified' },
      { path: 'gone.txt', kind: 'deleted' },
      { path: 'now.txt', origPath: 'was.txt', kind: 'renamed' },
    ]);
  });

  it('diffs one file with the path after `--`, and takes -w like every other diff', () => {
    const { run, calls } = record();
    void getCompareFileDiffWith(run, 'abc1234', 'src/f.ts');
    expect(calls[0]).toEqual(['diff', '-M', '--no-ext-diff', 'abc1234', '--', 'src/f.ts']);
    const w = record();
    void getCompareFileDiffWith(w.run, 'abc1234', 'src/f.ts', { ignoreWhitespace: true });
    expect(w.calls[0]).toEqual(['diff', '-M', '--no-ext-diff', '-w', 'abc1234', '--', 'src/f.ts']);
  });
});

// Which sides a conflict actually has, which is what decides whether the menu offers a row at all
// rather than offering one git will refuse (GC-181).
describe('conflictSides', () => {
  const cases: Array<[string | undefined, string[], string]> = [
    ['UU', ['ours', 'theirs'], 'both modified: three stages, either side works'],
    ['AA', ['ours', 'theirs'], 'both added: stages 2 and 3'],
    ['AU', ['ours'], 'added by us: no stage 3 for --theirs to find'],
    ['UD', ['ours'], 'deleted by them: no stage 3'],
    ['UA', ['theirs'], 'added by them: no stage 2 for --ours to find'],
    ['DU', ['theirs'], 'deleted by us: no stage 2'],
    ['DD', [], 'both deleted: neither side has a blob to keep'],
    [undefined, [], 'not a conflict at all'],
    ['M.', [], 'an ordinary porcelain code is not an unmerged one'],
  ];
  for (const [code, expected, why] of cases) {
    it(`${code ?? 'no code'}: ${why}`, () => {
      expect(conflictSides(code)).toEqual(expected);
    });
  }
});

// One row per path the three "Ignore …" entries have to get right (GC-093). Null is the entry
// being absent from the menu, not an error the user can reach.
describe('ignorePattern', () => {
  const cases: Array<[string, 'file' | 'extension' | 'folder', string | null, string]> = [
    ['new.txt', 'file', '/new.txt', 'a root file is rooted, so /build never means src/build'],
    ['src/new.txt', 'file', '/src/new.txt', 'a nested file keeps its path'],
    ['new.txt', 'extension', '*.txt', 'an extension matches anywhere, which is why it is asked for'],
    ['src/deep/bundle.min.js', 'extension', '*.js', 'the last dot wins'],
    ['noext', 'extension', null, 'nothing to generalise from a name with no extension'],
    ['.gitignore', 'extension', null, 'a leading dot is the name, not an extension'],
    ['build/out/x.log', 'folder', '/build/out/', 'the folder pattern is rooted and closed with a slash'],
    ['new.txt', 'folder', null, 'a root-level file has no folder above it'],
    ['src\\win\\path.txt', 'file', '/src/win/path.txt', 'a Windows separator is written git-style'],
  ];
  for (const [path, kind, expected, why] of cases) {
    it(`${kind} of ${path}: ${why}`, () => {
      expect(ignorePattern(path, kind)).toBe(expected);
    });
  }
});

// ---- GC-169: a remote refused over a credential ---------------------------------------------

// The messages below are what git and the common helpers actually write; the SAML one is the
// shape Ricardo hit on `catena-feed`, retyped here rather than captured from a live refusal, and
// no repository of his is touched by any of this.
describe('isAuthMessage: which failures are about who you are', () => {
  const auth: Array<[string, string]> = [
    [
      'SAML SSO, the case that cannot be waited out',
      "remote: The 'Catena-Media' organization has enabled or enforced SAML SSO.\nremote: To access this repository, visit https://github.com/orgs/Catena-Media/sso and sign in.\nfatal: unable to access 'https://github.com/Catena-Media/catena-feed.git/': The requested URL returned error: 403",
    ],
    ["a token that no longer carries the scope", "fatal: unable to access 'https://github.com/x/y.git/': The requested URL returned error: 401"],
    ['the helper answering outright', "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/x/y.git/'"],
    ['no credential and nobody to ask', "fatal: could not read Username for 'https://github.com': terminal prompts disabled"],
    ['ssh with a key the server will not take', 'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'],
    ['a password where a token is now required', 'remote: Support for password authentication was removed on August 13, 2021.'],
  ];
  for (const [what, text] of auth) {
    it(`flags ${what}`, () => {
      expect(isAuthMessage(text)).toBe(true);
    });
  }

  const other: Array<[string, string]> = [
    [
      'a non-fast-forward push, which must behave exactly as it does today',
      " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'https://github.com/x/y.git'\nhint: Updates were rejected because the remote contains work that you do not have locally.",
    ],
    ['a remote that is not there', "fatal: 'origin' does not appear to be a git repository"],
    ['a branch the other side does not have', "error: src refspec nope does not match any\nerror: failed to push some refs to 'origin'"],
    ['a merge conflict from a pull', 'CONFLICT (content): Merge conflict in f.txt\nAutomatic merge failed; fix conflicts and then commit the result.'],
    ['a 403 that is only a number in a commit message', 'error: could not apply 1234403 - fix the 401 parser'],
  ];
  for (const [what, text] of other) {
    it(`leaves ${what} unflagged`, () => {
      expect(isAuthMessage(text)).toBe(false);
    });
  }
});

describe('the flag on the error, which is all IPC keeps (GC-169)', () => {
  it('names the error so the renderer can read it back off the name', () => {
    const e = new GitError('Authentication failed for origin', ['fetch'], '', 128, false, true);
    expect(e.auth).toBe(true);
    expect(e.name).toBe(AUTH_FAILURE);
    // The two flags are separate severities and never both: an advisory outcome keeps its own name.
    expect(new GitError('x', ['fetch'], '', 1, true).name).toBe(ADVISORY);
    expect(new GitError('x', ['fetch'], '', 1).name).toBe('GitError');
  });

  it('puts the remote and its URL in the summary line, which is what the status bar shows', () => {
    expect(authSummary('origin', 'https://github.com/x/y.git')).toBe('Authentication failed for origin (https://github.com/x/y.git)');
    expect(authSummary('origin', null)).toBe('Authentication failed for origin');
    // With no name, the URL git was refused by is the next best identifier, and the bare
    // wording is the last resort rather than the answer (GC-169).
    expect(authSummary(null, 'https://github.com/x/y.git')).toBe('Authentication failed for https://github.com/x/y.git');
    expect(authSummary(null, null)).toBe('Authentication failed for the remote');
  });
});

describe('GIT_TERMINAL_PROMPT is no longer unconditional (GC-169)', () => {
  // A `!` alias runs in a shell, so it can report the environment git was actually spawned with.
  // Read-only, and in this repository: nothing here touches a repository of Ricardo's.
  const showPrompt = ['-c', 'alias.showprompt=!echo "prompt=${GIT_TERMINAL_PROMPT}"', 'showprompt'];

  it('leaves every ordinary command unable to prompt', async () => {
    expect((await runGit(process.cwd(), showPrompt)).trim()).toBe('prompt=0');
  });

  it('lets a command asked for it prompt, which is the only way the helper can ask', async () => {
    expect((await runGit(process.cwd(), showPrompt, { prompt: true })).trim()).toBe('prompt=1');
  });

  // Which commands may prompt is a property of the file, not of one call: `runRemote` is the only
  // way `prompt: true` is ever set, so the set of functions reaching it *is* the set that can ask
  // for a credential (GC-176). Named here so a seventh cannot join them without this failing —
  // and so the two that were missed when GC-169 named "the three" cannot be missed again.
  it('names every function that may ask for a credential', () => {
    const src = readFileSync(fileURLToPath(new URL('./git.ts', import.meta.url)), 'utf8');
    const reaching: string[] = [];
    let owner = '';
    for (const line of src.split('\n')) {
      const declared = /^export (?:async )?function (\w+)/.exec(line) ?? /^export const (\w+) =/.exec(line);
      if (declared) owner = declared[1];
      if (line.includes('runRemote(') && !line.startsWith('async function runRemote') && owner) reaching.push(owner);
    }
    // Six commands: a fetch (twice — `remoteAdd` fetches the remote it has just added), a pull,
    // three pushes, of which two are the deletes GC-176 brought in, and the clone GC-128 added,
    // which is the one that reaches a remote before there is a repository to reach it from.
    expect([...new Set(reaching)].sort()).toEqual(['cloneRepo', 'deleteRemoteBranch', 'deleteRemoteTag', 'fetch', 'pull', 'push', 'remoteAdd']);
  });
});

describe('what a clone is called (GC-128)', () => {
  // The name is derived rather than read back from git, because `runGit` buffers the clone's
  // progress stream and parses none of it — so the path answered to `openPath` is the path the
  // clone was told to use, and this is where that name is decided.
  it('takes the last segment of every URL form git accepts, without its .git', () => {
    expect(cloneTargetName('https://github.com/owner/repo.git')).toBe('repo');
    expect(cloneTargetName('https://github.com/owner/repo')).toBe('repo');
    expect(cloneTargetName('git@github.com:owner/repo.git')).toBe('repo');
    expect(cloneTargetName('ssh://git@host:22/owner/repo.git')).toBe('repo');
    expect(cloneTargetName('C:\\repos\\origin.git')).toBe('origin');
    // A trailing slash is git's own no-op and must not become an empty folder name.
    expect(cloneTargetName('https://github.com/owner/repo.git/  ')).toBe('repo');
    // Only the final `.git` goes: a repository actually called `x.github` keeps its name.
    expect(cloneTargetName('https://host/x.github')).toBe('x.github');
  });

  it('answers nothing for a URL with no segment, which is what refuses the clone', () => {
    expect(cloneTargetName('')).toBe('');
    expect(cloneTargetName('   ')).toBe('');
    expect(cloneTargetName('https://host/')).toBe('host');
  });

  // The two refusals that happen before anything is spawned, so neither depends on a network or a
  // folder: a name that cannot be derived, and one that is a path rather than a folder name.
  it('refuses a target it cannot name, and one that would land outside the chosen folder', async () => {
    await expect(cloneRepo('', process.cwd())).rejects.toThrow(/give it a folder name/);
    await expect(cloneRepo('https://host/repo.git', process.cwd(), '../elsewhere')).rejects.toThrow(/folder name, not a path/);
    await expect(cloneRepo('https://host/repo.git', process.cwd(), '..')).rejects.toThrow(/folder name, not a path/);
  });
});
