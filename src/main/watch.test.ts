import { describe, expect, it } from 'vitest';
import { ignored, scopeOf, toRel } from './watch';

// `ignored` and `scopeOf` are pure functions over one relative path, and GC-011's refresh loop was
// one path decided wrongly. Importing them pulls in `node:fs` and nothing else — the module's only
// electron reference is a type import, erased before this ever runs (GC-063).

/** What the watcher does with a path: ignore it, or push a change of this scope. */
type Decision = 'ignored' | 'tree' | 'refs';

function decide(filename: string): Decision {
  const rel = toRel(filename);
  if (rel && ignored(rel)) return 'ignored';
  return rel ? scopeOf(rel) : 'tree';
}

// One row per path the watcher has to get right, so a new rule is a line rather than a block.
const cases: Array<[string, Decision, string]> = [
  // The regression guard. Our own `git status` writes and removes `.git/index.lock`; Windows
  // reports that as a `change` on `.git` itself, with no second segment for the ignore list to
  // match, so the renderer reloaded the status, which ran `git status` again — a push every 300ms
  // forever on an idle repository (GC-011).
  ['.git', 'ignored', 'a bare .git directory event carries nothing a named event does not'],
  ['.git/index.lock', 'ignored', 'the lock files git drops around every command'],
  ['.git/objects', 'ignored', 'object writes'],
  ['.git/objects/ab/cdef', 'ignored', 'object writes, named'],
  ['.git/logs/HEAD', 'ignored', 'the reflog'],
  ['.git/COMMIT_EDITMSG', 'ignored', 'the message buffer git rewrites on every commit'],
  ['node_modules', 'ignored', 'the one directory that dwarfs a checkout'],
  ['node_modules/pkg/x.js', 'ignored', 'anything under it'],

  ['.git/refs', 'refs', 'a ref changed, so the graph moved'],
  ['.git/refs/heads/main', 'refs', 'a named ref'],
  ['.git/HEAD', 'refs', 'the checkout moved'],
  ['.git/packed-refs', 'refs', 'refs were packed'],
  // The remotes and a branch's upstream live only in the full snapshot, so a config write made
  // outside the app produced no REMOTE row at all until the page was reloaded (GC-190).
  ['.git/config', 'refs', 'a remote or an upstream changed, and only the full snapshot carries them'],
  ['.git/config.lock', 'ignored', 'git writes config through a lock file, as it does every ref'],

  ['.git/index', 'tree', 'staging only moves the status'],
  ['.git/MERGE_HEAD', 'tree', 'an operation started: the status shows the banner'],
  ['src/a.txt', 'tree', 'an editor saved a working-tree file'],
];

describe('the watcher path rules', () => {
  for (const [path, expected, why] of cases) {
    it(`${path} -> ${expected} (${why})`, () => {
      expect(decide(path)).toBe(expected);
    });
  }

  it('normalises the backslashes Windows reports', () => {
    // fs.watch hands us the platform separator, and both rules split on '/' only, so without
    // toRel a Windows ref change looked like one unrecognised working-tree path.
    expect(toRel('.git\\refs\\heads\\main')).toBe('.git/refs/heads/main');
    expect(decide('.git\\refs\\heads\\main')).toBe('refs');
    expect(decide('node_modules\\pkg\\x.js')).toBe('ignored');
  });

  it('treats an unnamed event as a working-tree change', () => {
    // Some platforms report that something moved without saying what; the watcher assumes the
    // cheaper reload rather than dropping the event.
    expect(toRel(null)).toBe('');
    expect(decide('')).toBe('tree');
  });
});
