import { describe, expect, it } from 'vitest';
import { GitError, ignorePattern, restoreStashWith, type GitRunner } from './git';
import { ADVISORY } from '@shared/types';

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
