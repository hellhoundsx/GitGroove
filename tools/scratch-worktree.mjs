// A scratch git worktree whose `node_modules` is a junction back to this checkout, made and
// removed in the one order that cannot reach through the junction (GC-189).
//
// The review routine works in a detached worktree of `origin/main` under `%TEMP%/gitclient-review/wt`
// and junctions `node_modules` into it so its `npm test` costs no install. That part is fine. The
// removal is where the hole was: a recursive delete of the worktree **follows the junction** and
// deletes files out of the real `node_modules`. Measured on 2026-09-06 during the GC-186 batch —
// 129 packages and `node_modules/.bin` gone from this checkout, `tsc` and `@babel/core` with them,
// and the repair was nearly blocked by an unrelated Electron holding `default_app.asar`.
//
// So the order is here, in a script, rather than in a sentence in `TICKETS.md` that every session
// has to follow by hand:
//
//   1. remove `<wt>/node_modules` as a **link** — `rmdir` on the reparse point, never a recursive
//      delete, which is what walks into the target;
//   2. assert the link is gone and that this checkout's `node_modules/.bin` is still there;
//   3. only then `git worktree remove`.
//
// Step 2 refuses rather than repairs: if the junction is still standing the worktree is left where
// it is, because a worktree nobody removed costs a temp directory and a `git worktree prune`,
// while `git worktree remove --force` over a live junction costs an `npm install` — if it can be
// run at all.
//
// Usage:
//   node tools/scratch-worktree.mjs add <dir> [ref]   # default ref: origin/main
//   node tools/scratch-worktree.mjs remove <dir>
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root: this file is at <root>/tools/. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What `git worktree add` is pointed at when the caller names no ref. */
export const DEFAULT_REF = 'origin/main';

/**
 * Whether `p` is a link rather than a real directory — a Windows junction, a directory symlink or
 * a file symlink all answer true. `lstat`, never `stat`: the whole point is not to follow it.
 * A path that does not exist is not a link.
 */
export function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Remove `p` when it is a link, leaving whatever it points at untouched. A real directory is
 * refused outright: this function exists precisely so that the caller cannot delete the target's
 * contents by accident, and a `node_modules` that turned out to be a real install is the case
 * where a recursive delete would be a disaster. Answers whether there was a link to remove.
 *
 * On Windows a directory junction is deleted with `RemoveDirectory`, which is `rmdir`; `unlink` is
 * what a file symlink takes, so both are tried in that order and neither recurses.
 */
export function removeLink(p) {
  if (!existsSync(p) && !isLink(p)) return false;
  if (!isLink(p)) throw new Error(`refusing to remove ${p}: it is a real directory, not a link`);
  try {
    rmdirSync(p);
  } catch {
    unlinkSync(p);
  }
  return true;
}

/**
 * The guard between step 1 and step 3: the worktree's `node_modules` must be gone and the real one
 * must still have its `.bin`, or nothing is removed. `.bin` is the check because it is what the
 * 2026-09-06 damage took first — it sorts before every scoped package — and because its absence is
 * what made `npm run typecheck` fail with "'tsc' is not recognized".
 */
export function assertSafeToRemove(wtDir, rootDir = ROOT) {
  const linked = join(wtDir, 'node_modules');
  if (existsSync(linked) || isLink(linked)) {
    throw new Error(`refusing to remove ${wtDir}: ${linked} is still there, and removing the worktree would reach through it`);
  }
  const bin = join(rootDir, 'node_modules', '.bin');
  if (!existsSync(bin)) {
    throw new Error(`refusing to remove ${wtDir}: ${bin} is missing, so this checkout's node_modules is already damaged`);
  }
}

function git(args, cwd = ROOT) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  });
}

/**
 * A detached worktree of `ref` at `dir`, with `node_modules` junctioned from this checkout so the
 * caller's `npm test` needs no install. Answers the worktree's absolute path.
 */
export function addWorktree(dir, ref = DEFAULT_REF, rootDir = ROOT) {
  const wt = resolve(dir);
  mkdirSync(dirname(wt), { recursive: true });
  git(['worktree', 'add', '--detach', wt, ref], rootDir);
  const target = join(rootDir, 'node_modules');
  if (existsSync(target)) symlinkSync(target, join(wt, 'node_modules'), 'junction');
  return wt;
}

/**
 * Remove a worktree made by `addWorktree`, in the safe order. Answers nothing; throws with the
 * reason when the guard refuses, leaving the worktree standing.
 */
export function removeWorktree(dir, rootDir = ROOT) {
  const wt = resolve(dir);
  removeLink(join(wt, 'node_modules'));
  assertSafeToRemove(wt, rootDir);
  git(['worktree', 'remove', '--force', wt], rootDir);
  git(['worktree', 'prune'], rootDir);
}

/** How many entries this checkout's `node_modules` holds, which is what a caller prints either side. */
export function countNodeModules(rootDir = ROOT) {
  const target = join(rootDir, 'node_modules');
  return existsSync(target) ? readdirSync(target).length : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const [cmd, dir, ref] = process.argv.slice(2);
  if (!cmd || !dir) {
    console.error('usage: node tools/scratch-worktree.mjs add <dir> [ref] | remove <dir>');
    process.exit(2);
  }
  if (cmd === 'add') {
    console.log(`added ${addWorktree(dir, ref || DEFAULT_REF)} (node_modules: ${countNodeModules()} entries)`);
  } else if (cmd === 'remove') {
    removeWorktree(dir);
    console.log(`removed ${resolve(dir)} (node_modules: ${countNodeModules()} entries)`);
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
}
